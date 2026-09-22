package com.nafduduk.calculator.mesh

import com.nafduduk.calculator.engine.Curve
import com.nafduduk.calculator.engine.buildChamberGeometry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Topology of the CSG output. An STL destined for a slicer has to be a closed
 * manifold: every edge shared by exactly two triangles. Csg.kt leaves both
 * T-junctions and, on a long chain of booleans, genuine holes, so the
 * exporters run a repair pass (MeshRepair.kt); these tests are what keep that
 * pass honest.
 *
 * Note the chamber is NOT genus 0. Every through-feature — the six finger
 * holes, the TSH opening, the flue and the blow hole — adds a handle, so the
 * Euler characteristic is a long way below 2. What must hold is that it is
 * even (true of any closed orientable surface, since V-E+F = 2-2g) and that
 * it does not change when it has no business changing.
 */
class MeshTopologyTest {
    private fun geom(bore: Double = 0.75, freq: Double = 369.99, holes: Int = 6) =
        buildChamberGeometry(bore = bore, freq = freq, holeCount = holes)

    /** Triangles with no area at all, which give an STL facet a NaN normal. */
    private fun zeroAreaTriangles(solid: CsgSolid): Int =
        solid.polygons.sumOf { poly ->
            poly.triangulate().count { (a, b, c) ->
                (b.pos - a.pos).cross(c.pos - a.pos).length() < 1e-18
            }
        }

    private fun assertClosed(tag: String, solid: CsgSolid): MeshTopologyReport {
        val r = topologyReport(exportableSolid(solid))
        assertEquals("$tag: open (single-use) edges", 0, r.openEdges)
        assertEquals("$tag: non-manifold (3+ use) edges", 0, r.nonManifoldEdges)
        assertEquals("$tag: zero-area triangles", 0, zeroAreaTriangles(exportableSolid(solid)))
        assertTrue("$tag: is a closed manifold", r.isClosedManifold)
        assertTrue("$tag: Euler characteristic ${r.eulerCharacteristic} implies negative genus", r.eulerCharacteristic <= 2)
        return r
    }

    @Test
    fun `a straight chamber exports a closed manifold solid`() {
        assertClosed("straight", buildChamberSolid(geom(), Curve.STRAIGHT))
    }

    @Test
    fun `a curved chamber has essentially the same topology as the straight one`() {
        // The bow is applied by bending a finished straight body (SineBend.kt)
        // and a bend is an isometry on each cross-section, so the curved body
        // should come out with the same shape of connectivity. Sweeping the
        // CSG along the bow instead used to leave holes and pinched edges.
        //
        // "Essentially" rather than "exactly": the bend shifts coordinates by
        // a hair, which changes which near-coincident CSG vertices fall inside
        // the repair's merge radius, and each such merge can add or remove a
        // handle. That is a sub-micron difference, so the bound is a couple of
        // handles either way — enough to catch a real blow-up (sweeping the
        // CSG along the bow put this at +40 with 23 holes still open) and
        // nothing less.
        val straight = assertClosed("straight", buildChamberSolid(geom(), Curve.STRAIGHT))
        for ((tag, curve) in listOf("slight" to Curve.SLIGHT, "heavy" to Curve.HEAVY)) {
            val bent = assertClosed(tag, buildChamberSolid(geom(), curve))
            val drift = kotlin.math.abs(bent.eulerCharacteristic - straight.eulerCharacteristic)
            assertTrue(
                "$tag: Euler characteristic ${bent.eulerCharacteristic} vs straight ${straight.eulerCharacteristic}",
                drift <= 4,
            )
        }
    }

    @Test
    fun `a large bore uses the elliptical-cut branch and still closes`() {
        assertClosed("large bore", buildChamberSolid(geom(bore = 2.5, freq = 98.0), Curve.STRAIGHT))
    }

    @Test
    fun `every hole shape cuts real holes and leaves a closed solid`() {
        // An extruded cutter built on a left-handed LocalBasis comes out with
        // its normals inverted, and subtracting an inside-out solid intersects
        // instead: the oval shape used to reduce the whole body to a stub.
        val round = assertClosed("round", buildChamberSolid(geom(), Curve.STRAIGHT, holeShapeKey = "round"))
        for (shape in listOf("oval", "undercut", "countersunk")) {
            val r = assertClosed(shape, buildChamberSolid(geom(), Curve.STRAIGHT, holeShapeKey = shape))
            assertEquals(
                "$shape must bore the same number of through-holes as round",
                round.eulerCharacteristic,
                r.eulerCharacteristic,
            )
            assertTrue(
                "$shape body is only ${r.triangles} triangles against round's ${round.triangles} — the cutter is inside out",
                r.triangles > round.triangles / 2,
            )
        }
    }

    @Test
    fun `curved bodies stay within a sane triangle budget`() {
        // Triangles, not polygons: the bend hands back triangles where the
        // straight body still has quads, which is a change of representation
        // rather than of cost. Triangles are what the renderer and every
        // exporter actually pay for.
        val straight = topologyReport(exportableSolid(buildChamberSolid(geom(), Curve.STRAIGHT))).triangles
        val curved = topologyReport(exportableSolid(buildChamberSolid(geom(), Curve.SLIGHT))).triangles
        // Sweeping the CSG along the bow gave every segment its own plane and
        // exploded the split count, which pushed the on-device preview into
        // tens of seconds. Bending a finished straight body costs nothing, so
        // this is a tight bound, not a generous one.
        assertTrue(
            "curved body triangle count $curved is more than 1.2x the straight body's $straight",
            curved <= straight * 6 / 5,
        )
    }

    @Test
    fun `exporters emit well-formed output for every format`() {
        val solid = buildChamberSolid(geom(), Curve.STRAIGHT)
        val stl = exportStl(solid)
        assertTrue(stl.startsWith("solid "))
        assertTrue(stl.trimEnd().endsWith("endsolid naf_flute"))
        assertEquals(
            "facet count must match endfacet count",
            Regex("facet normal").findAll(stl).count(),
            Regex("endfacet").findAll(stl).count(),
        )

        val obj = exportObj(solid)
        assertTrue(obj.contains("\nv "))
        assertTrue(obj.contains("\nf "))
        // OBJ indices are 1-based and must stay within the vertex list.
        val vCount = obj.lineSequence().count { it.startsWith("v ") }
        obj.lineSequence().filter { it.startsWith("f ") }.forEach { face ->
            face.removePrefix("f ").trim().split(" ").forEach { idx ->
                val i = idx.toInt()
                assertTrue("OBJ face index $i out of range 1..$vCount", i in 1..vCount)
            }
        }

        val ply = exportPly(solid)
        assertTrue(ply.startsWith("ply\n"))
        val declared = Regex("element vertex (\\d+)").find(ply)!!.groupValues[1].toInt()
        val actual = ply.substringAfter("end_header\n").lineSequence().count { it.isNotBlank() && !it.startsWith("3 ") }
        assertEquals("PLY header vertex count must match the body", declared, actual)

        val gltf = exportGltf(solid)
        assertTrue("glTF must declare a material so it is not lit as raw metal", gltf.contains("\"materials\""))
        assertTrue(gltf.contains("\"POSITION\""))
        assertTrue(gltf.contains("\"asset\""))
    }

    @Test
    fun `CSG boolean operations behave on simple solids`() {
        val a = buildBox(Vec3(0.0, 0.0, 0.0), Vec3(2.0, 2.0, 2.0))
        val b = buildBox(Vec3(1.0, 0.0, 0.0), Vec3(2.0, 2.0, 2.0))
        assertTrue("union keeps geometry", a.union(b).polygons.isNotEmpty())
        assertTrue("subtract keeps geometry", a.subtract(b).polygons.isNotEmpty())
        assertTrue("intersect keeps geometry", a.intersect(b).polygons.isNotEmpty())
        // Disjoint solids: intersection is empty.
        val far = buildBox(Vec3(100.0, 0.0, 0.0), Vec3(1.0, 1.0, 1.0))
        assertTrue("disjoint intersection is empty", a.intersect(far).polygons.isEmpty())
    }

    @Test
    fun `ear clipping triangulates a concave polygon without spilling outside it`() {
        // An L-shape in the XY plane: fan triangulation from vertex 0 would
        // cut across the notch.
        val n = Vec3(0.0, 0.0, 1.0)
        val pts = listOf(
            Vec3(0.0, 0.0, 0.0), Vec3(2.0, 0.0, 0.0), Vec3(2.0, 1.0, 0.0),
            Vec3(1.0, 1.0, 0.0), Vec3(1.0, 2.0, 0.0), Vec3(0.0, 2.0, 0.0),
        )
        val tris = Polygon(pts.map { Vertex(it, n) }).triangulate()
        assertEquals("an n-gon yields n-2 triangles", pts.size - 2, tris.size)
        val area = tris.sumOf { (a, b, c) ->
            kotlin.math.abs(
                (b.pos.x - a.pos.x) * (c.pos.y - a.pos.y) - (c.pos.x - a.pos.x) * (b.pos.y - a.pos.y),
            ) / 2
        }
        assertEquals("triangulated area must equal the L-shape's area", 3.0, area, 1e-9)
    }
}
