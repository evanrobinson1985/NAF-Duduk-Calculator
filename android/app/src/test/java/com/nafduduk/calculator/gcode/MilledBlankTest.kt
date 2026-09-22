package com.nafduduk.calculator.gcode

import com.nafduduk.calculator.engine.Curve
import com.nafduduk.calculator.engine.FingerHole
import com.nafduduk.calculator.mesh.exportableSolid
import com.nafduduk.calculator.mesh.topologyReport
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The milled blank is what the program will actually leave behind, tool
 * shape and all — the thing you hold up against the stock on the bench. It
 * has to be a solid a CAD package will open, which means watertight, and it
 * has to be smaller than the stock it was cut from.
 */
class MilledBlankTest {
    private val melody = GcodeChamber(
        lengthIn = 15.1, sacLenIn = 3.45, boreIn = 0.75,
        holes = listOf(
            FingerHole(1, "root", 8.9, 6.2, 0.31),
            FingerHole(2, "M2", 7.7, 7.4, 0.31),
            FingerHole(3, "m3", 6.75, 8.35, 0.28),
        ),
        playable = true, label = "MELODY", shWIn = 0.375, shLIn = 0.219,
    )

    private fun program(outline: OutlineMode): String {
        val s = CncSettings(outlineMode = outline)
        return buildGcodePrograms(s, listOf(melody), Curve.STRAIGHT, "separate").first { it.key == "all" }.build()
    }

    private val toolDiameter = CncSettings().resolve(listOf(melody)).toolDiameter

    @Test
    fun `a flat sweep cuts a flat-bottomed channel to the commanded depth`() {
        val g = """
            G20
            ( STOCK-BLOCK label=test x=0 y=0 z=0 lx=2 ly=1 lz=0.5 )
            G0 X0 Y0.5 Z1
            G1 Z0.2 F10
            G1 X2 Y0.5 F30
        """.trimIndent()
        val parsed = parseGcode(g)
        val hms = buildHeightmaps(parsed, resolution = 0.02)
        assertEquals(1, hms.size)
        simulateCutting(parsed, hms, toolDiameter = 0.25, tip = ToolTip.FLAT)

        val hm = hms[0]
        val mid = hm.up[(hm.ny / 2) * hm.nx + hm.nx / 2]
        assertEquals("the channel floor sits at the commanded Z", 0.2, mid, 1e-9)
        // A corner well clear of a 0.25in-wide pass is untouched.
        assertEquals("uncut stock keeps its full height", hm.top, hm.up[0], 1e-9)
    }

    @Test
    fun `a ball nose leaves a rounded floor, a flat mill does not`() {
        // A level pass at constant Z, sampled across the cut. The lead-in is
        // a separate move so the sampled column is cut only by the level one
        // — a ramping move varies in Z by design and would prove nothing.
        val g = """
            G20
            ( STOCK-BLOCK label=t x=0 y=0 z=0 lx=2 ly=1 lz=0.5 )
            G1 X0 Y0.5 Z0.2 F10
            G1 X2 Y0.5 F30
        """.trimIndent()
        val parsed = parseGcode(g)

        fun across(tip: ToolTip): List<Double> {
            val hms = buildHeightmaps(parsed, resolution = 0.005)
            simulateCutting(parsed, hms, toolDiameter = 0.25, tip = tip)
            val hm = hms[0]
            val i = ((1.0 - hm.x0) / hm.cellX).toInt()
            return (0 until hm.ny).map { hm.up[it * hm.nx + i] }.filter { it < hm.top - 1e-9 }
        }

        val flat = across(ToolTip.FLAT)
        val ball = across(ToolTip.BALL)
        assertTrue(flat.isNotEmpty() && ball.isNotEmpty())
        assertTrue("a flat mill leaves one floor height", flat.all { kotlin.math.abs(it - flat[0]) < 1e-9 })
        assertEquals("at the commanded depth", 0.2, flat[0], 1e-9)
        assertTrue("a ball nose's floor rises toward the edges of the cut", ball.max() - ball.min() > 0.01)
        // Only to within a cell: a ball nose reaches the commanded Z exactly
        // on its axis alone, and no grid sample lands exactly on it.
        assertEquals("and its deepest point is the commanded depth", 0.2, ball.min(), 1e-4)
    }

    @Test
    fun `a rapid removes nothing`() {
        val g = "G20\n( STOCK-BLOCK label=t x=0 y=0 z=0 lx=2 ly=1 lz=0.5 )\nG0 X0 Y0.5 Z-1\nG0 X2 Y0.5"
        val parsed = parseGcode(g)
        val hms = buildHeightmaps(parsed, resolution = 0.02)
        simulateCutting(parsed, hms, toolDiameter = 0.25, tip = ToolTip.FLAT)
        assertTrue("a positioning move is not a cut", hms[0].up.all { it == hms[0].top })
    }

    @Test
    fun `a cut can never go below the bottom of the stock`() {
        val g = "G20\n( STOCK-BLOCK label=t x=0 y=0 z=0 lx=2 ly=1 lz=0.5 )\nG1 X0 Y0.5 Z-5 F10\nG1 X2 Y0.5"
        val parsed = parseGcode(g)
        val hms = buildHeightmaps(parsed, resolution = 0.02)
        simulateCutting(parsed, hms, toolDiameter = 0.25, tip = ToolTip.FLAT)
        assertTrue("a plunge past the table clamps at the stock's bottom", hms[0].up.all { it >= hms[0].bottom - 1e-12 })
    }

    @Test
    fun `turning a blank over keeps the cuts, on the other face`() {
        val g = "G20\n( STOCK-BLOCK label=t x=0 y=0 z=0 lx=2 ly=1 lz=0.5 )\nG1 X0 Y0.5 Z0.2 F10\nG1 X2 Y0.5"
        val parsed = parseGcode(g)
        val hms = buildHeightmaps(parsed, resolution = 0.02)
        simulateCutting(parsed, hms, toolDiameter = 0.25, tip = ToolTip.FLAT)
        val hm = hms[0]
        val cutBefore = hm.up.count { it < hm.top - 1e-9 }
        assertTrue(cutBefore > 0)

        hm.flip()
        assertTrue("the blank is now turned over", hm.flipped)
        assertEquals(
            "the seam-side cuts must survive, on the down face",
            cutBefore, hm.down.count { it > hm.bottom + 1e-9 },
        )
        assertTrue("and the new up face is untouched stock", hm.up.all { it >= hm.top - 1e-9 })

        hm.flip()
        assertFalse(hm.flipped)
        assertEquals("turning it back must restore it exactly", cutBefore, hm.up.count { it < hm.top - 1e-9 })
    }

    @Test
    fun `the grid never exceeds its cell budget`() {
        val g = "G20\n( STOCK-BLOCK label=t x=0 y=0 z=0 lx=40 ly=20 lz=2 )\nG1 X1 Y1 Z1 F10"
        val parsed = parseGcode(g)
        // A thousandth of an inch over 40x20in would be 800 million cells.
        val hms = buildHeightmaps(parsed, resolution = 0.001, maxCells = 200_000)
        val hm = hms[0]
        assertTrue("grid was ${hm.nx}x${hm.ny}", hm.nx.toLong() * hm.ny <= 220_000)
        assertTrue("and it still covers the blank", hm.x1 >= 39.9 && hm.y1 >= 19.9)
    }

    @Test
    fun `point-in-polygon decides a square correctly`() {
        val square = listOf(0.0 to 0.0, 2.0 to 0.0, 2.0 to 2.0, 0.0 to 2.0)
        assertTrue(pointInPolygon(1.0, 1.0, square))
        assertFalse(pointInPolygon(3.0, 1.0, square))
        assertFalse(pointInPolygon(-1.0, 1.0, square))
        assertFalse(pointInPolygon(1.0, 3.0, square))
    }

    @Test
    fun `a blank label maps to the outline it belongs to`() {
        assertEquals("lower", blockCategory("lower-nest"))
        assertEquals("lower", blockCategory("bottom-half"))
        assertEquals("upper", blockCategory("upper-shell"))
        assertEquals("upper", blockCategory("top-half"))
        assertEquals(null, blockCategory("mystery blank"))
    }

    @Test
    fun `a real program mills to a watertight solid per blank`() {
        val result = millBlanksFromProgram(program(OutlineMode.CUTOUT), toolDiameter, ToolTip.FLAT, resolution = 0.06)
        assertEquals("one solid per blank", 2, result.blanks.size)
        assertTrue("a cutout pass must be found and used", result.trimmed)

        for ((label, solid) in result.blanks) {
            val r = topologyReport(exportableSolid(solid))
            assertTrue("$label has triangles", r.triangles > 1000)
            assertEquals("$label: open edges", 0, r.openEdges)
            assertEquals("$label: non-manifold edges", 0, r.nonManifoldEdges)
            assertTrue("$label must be a closed manifold", r.isClosedManifold)
        }
    }

    @Test
    fun `the outline pass trims the blank down, and without it the stock survives whole`() {
        val trimmed = millBlanksFromProgram(program(OutlineMode.CUTOUT), toolDiameter, ToolTip.FLAT, resolution = 0.06)
        val whole = millBlanksFromProgram(program(OutlineMode.OFF), toolDiameter, ToolTip.FLAT, resolution = 0.06)

        assertTrue(trimmed.trimmed)
        assertFalse("with no outline pass there is no silhouette to trim to", whole.trimmed)

        // Trimming away the clamping margin and the pin rails has to remove
        // real material, not just relabel it.
        val trimmedTris = trimmed.blanks.sumOf { it.second.polygons.size }
        val wholeTris = whole.blanks.sumOf { it.second.polygons.size }
        assertTrue("trimming must shrink the part: $trimmedTris vs $wholeTris", trimmedTris < wholeTris)
    }

    @Test
    fun `a program with no stock hints has nothing to simulate`() {
        val result = millBlanksFromProgram("G20\nG1 X1 Y1 F10", 0.25, ToolTip.FLAT)
        assertTrue(result.isEmpty)
        assertFalse(result.trimmed)
    }
}
