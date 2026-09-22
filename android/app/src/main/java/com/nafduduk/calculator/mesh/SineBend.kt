package com.nafduduk.calculator.mesh

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * Bends a finished, straight chamber solid onto the app's sine bow.
 *
 * The obvious way to build a curved body is to sweep the tube along the bowed
 * centerline and run the same CSG on it. That is what this did first, and it
 * is worse on both counts that matter:
 *
 *  - **Robustness.** Csg.kt is the classic csg.js-lineage BSP algorithm, whose
 *    numerical behaviour degrades with the number of distinct planes. On a
 *    straight tube every station's side wall is coplanar with the one before,
 *    so the tree collapses them; a bow gives every segment its own plane, and
 *    chaining ten booleans through that left ~95 pinched edges and a couple of
 *    dozen holes no repair pass could honestly close.
 *  - **Cost.** Same cause: a slight bow produced 2.4x the triangles of the
 *    straight body (and, before the segment count was cut, 9.5x the polygons
 *    and ~18x the build time — 4.5s on a desktop core, tens of seconds on a
 *    phone).
 *
 * Bending afterwards avoids both. The bow has no torsion — it is a plane
 * curve — so each cross-section is carried by a rotation about Z plus a
 * translation, which is an isometry: bore diameter, wall thickness and every
 * hole diameter come through exactly, and the mesh keeps the straight body's
 * topology, so a closed manifold stays a closed manifold. The holes and nest
 * bend with the body, which is what a bent flute's radially-drilled holes
 * actually look like.
 *
 * The result is triangles: a quad or larger polygon would come out of the bend
 * slightly warped, and Csg.kt assumes polygons are planar. Triangulating here
 * rather than running the whole repair pass first also keeps the repair to a
 * single pass over the bent geometry — welding twice, once either side of the
 * bend, can pinch an edge where the bend brings a fan apex within the merge
 * radius of a neighbour's edge.
 */
fun bendAlongSineBow(solid: CsgSolid, totalLen: Double, bowAmp: Double): CsgSolid {
    if (bowAmp == 0.0 || totalLen <= 0.0) return solid

    /** Centerline point and unit tangent at axial fraction t of the bow. */
    fun centerAt(t: Double) = Vec3(t * totalLen, bowAmp * sin(t * PI), 0.0)
    fun tangentAt(t: Double) = Vec3(totalLen, bowAmp * PI * cos(t * PI), 0.0).normalized()

    fun bend(p: Vec3): Vec3 {
        val t = p.x / totalLen
        // The nest cut, the mouthpiece plug and the finger-hole cutters all
        // overshoot the body's ends, so t is not confined to [0,1]. Outside
        // it, carry on straight along the end tangent rather than following
        // sin() back down.
        val tc = t.coerceIn(0.0, 1.0)
        val tangent = tangentAt(tc)
        val center = centerAt(tc) + tangent * ((t - tc) * totalLen)
        // buildCappedTube's frame on a straight +X centerline is
        // right = +Z, up = +Y, so p.y and p.z are offsets along those. The
        // bent frame is the same construction at this station: right stays +Z
        // for a curve in the XY plane, and up is the tangent turned a quarter
        // turn within it.
        val up = Vec3(-tangent.y, tangent.x, 0.0)
        return center + up * p.y + Vec3(0.0, 0.0, p.z)
    }

    return CsgSolid(
        solid.polygons.flatMap { poly ->
            poly.triangulate().map { (a, b, c) ->
                val pa = bend(a.pos)
                val pb = bend(b.pos)
                val pc = bend(c.pos)
                // Recompute the normal from the bent geometry; the stored one
                // was the straight body's and is now off by this station's
                // rotation.
                val n = (pb - pa).cross(pc - pa)
                val normal = if (n.length() < 1e-18) poly.plane.normal else n.normalized()
                Polygon(listOf(Vertex(pa, normal), Vertex(pb, normal), Vertex(pc, normal)))
            }
        },
    )
}
