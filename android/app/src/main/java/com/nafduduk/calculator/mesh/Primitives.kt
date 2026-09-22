package com.nafduduk.calculator.mesh

import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.PI

/** Builds a quad (CSG polygons can be n-gons) from 4 CCW vertices sharing one flat normal. */
private fun quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3): Polygon {
    val n = (b - a).cross(d - a).normalized()
    return Polygon(listOf(Vertex(a, n), Vertex(b, n), Vertex(c, n), Vertex(d, n)))
}

/**
 * The same quad, but split into two triangles when its four corners are not
 * coplanar.
 *
 * Csg.kt's BSP assumes each polygon lies on the plane through its first three
 * vertices: it decides which side of a node a polygon falls on from that
 * plane, and treats it as coplanar when it matches the node's. A warped quad
 * breaks that assumption, and the result is a polygon kept on the wrong side
 * or dropped altogether — visible as holes in the exported surface of a
 * *curved* body, which is exactly where the sweep's quads warp. Triangles are
 * planar by construction, so the fix is to split only the warped ones and
 * leave a straight body's genuinely flat quads alone (one polygon instead of
 * two, and a flat side wall shares its plane with its neighbours, which the
 * BSP collapses into a single node).
 */
private fun quadPlanar(a: Vec3, b: Vec3, c: Vec3, d: Vec3): List<Polygon> {
    val n = (b - a).cross(d - a)
    val len = n.length()
    // Distance of the fourth corner from the plane of the first three, scaled
    // out of the cross product's magnitude. The bound is an order of magnitude
    // below Csg.kt's own Plane.EPSILON, so a quad that passes is one the BSP
    // cannot tell from flat.
    val warp = if (len < 1e-18) Double.MAX_VALUE else kotlin.math.abs(n.dot(c - a)) / len
    if (warp < 1e-6) return listOf(quad(a, b, c, d))
    val nAbc = (b - a).cross(c - a).normalized()
    val nAcd = (c - a).cross(d - a).normalized()
    return listOf(
        Polygon(listOf(Vertex(a, nAbc), Vertex(b, nAbc), Vertex(c, nAbc))),
        Polygon(listOf(Vertex(a, nAcd), Vertex(c, nAcd), Vertex(d, nAcd))),
    )
}

private fun ngon(pts: List<Vec3>, normal: Vec3): Polygon = Polygon(pts.map { Vertex(it, normal) })

/**
 * A closed, watertight tube swept along `pathPoints` (evenly spaced samples
 * along the centerline) with the given radius, capped at both ends. The
 * curve here only ever bends in one plane (the app's sine-bow "curve" knob
 * has no torsion), so a simple parallel-transport-free frame — forward
 * from the path tangent, a fixed world "up" reference, right = up x
 * forward — is stable and correct, unlike a naive Frenet frame which
 * flips near inflection points.
 */
fun buildCappedTube(pathPoints: List<Vec3>, radius: Double, radialSegments: Int = 24): CsgSolid {
    require(pathPoints.size >= 2) { "buildCappedTube needs at least 2 path points" }
    val worldUp = Vec3(0.0, 1.0, 0.0)
    val n = pathPoints.size

    // Per-station forward/right/up frame.
    data class Frame(val center: Vec3, val forward: Vec3, val right: Vec3, val up: Vec3)
    val frames = (0 until n).map { i ->
        val tangent = when {
            i == 0 -> (pathPoints[1] - pathPoints[0]).normalized()
            i == n - 1 -> (pathPoints[n - 1] - pathPoints[n - 2]).normalized()
            else -> (pathPoints[i + 1] - pathPoints[i - 1]).normalized()
        }
        var right = tangent.cross(worldUp)
        if (right.length() < 1e-6) right = tangent.cross(Vec3(1.0, 0.0, 0.0))
        right = right.normalized()
        val up = right.cross(tangent).normalized()
        Frame(pathPoints[i], tangent, right, up)
    }

    // Ring of vertices at each station.
    val rings = frames.map { f ->
        (0 until radialSegments).map { s ->
            val theta = 2 * PI * s / radialSegments
            val offset = f.right * (radius * cos(theta)) + f.up * (radius * sin(theta))
            f.center + offset
        }
    }

    val polys = mutableListOf<Polygon>()

    // Side wall quads between consecutive rings. Winding verified by hand
    // (cross-product expansion at theta=0/right=+Z, forward=+X, up=+Y):
    // ringA[s] -> ringB[s] -> ringB[sNext] -> ringA[sNext] is the CCW-from-
    // outside order that gives an outward-pointing plane normal — the
    // seemingly "natural" a[s]->a[sNext]->b[sNext]->b[s] order is inward.
    for (i in 0 until n - 1) {
        val ringA = rings[i]
        val ringB = rings[i + 1]
        for (s in 0 until radialSegments) {
            val sNext = (s + 1) % radialSegments
            polys.addAll(quadPlanar(ringA[s], ringB[s], ringB[sNext], ringA[sNext]))
        }
    }

    // End caps (n-gons). By the same hand-verified winding, a ring taken in
    // its natural (theta-increasing) order has plane normal = -forward
    // regardless of position along the path — correct as-is for the start
    // cap, so the END cap is the one that needs reversing.
    polys.add(ngon(rings.first(), -frames.first().forward))
    polys.add(ngon(rings.last().reversed(), frames.last().forward))

    return CsgSolid(polys)
}

/** An axis-aligned box, `center` at its centroid, full extents `size`. */
fun buildBox(center: Vec3, size: Vec3): CsgSolid {
    val hx = size.x / 2
    val hy = size.y / 2
    val hz = size.z / 2
    val c = center
    val p = { dx: Double, dy: Double, dz: Double -> Vec3(c.x + dx, c.y + dy, c.z + dz) }
    val v = listOf(
        p(-hx, -hy, -hz), p(hx, -hy, -hz), p(hx, hy, -hz), p(-hx, hy, -hz),
        p(-hx, -hy, hz), p(hx, -hy, hz), p(hx, hy, hz), p(-hx, hy, hz),
    )
    val polys = listOf(
        quad(v[0], v[3], v[2], v[1]), // -Z
        quad(v[4], v[5], v[6], v[7]), // +Z
        quad(v[0], v[1], v[5], v[4]), // -Y
        quad(v[3], v[7], v[6], v[2]), // +Y
        quad(v[0], v[4], v[7], v[3]), // -X
        quad(v[1], v[2], v[6], v[5]), // +X
    )
    return CsgSolid(polys)
}

/** A capped cylinder standing along the given axis (forward), `center` at its midpoint. */
fun buildCylinderAlong(center: Vec3, axis: Vec3, length: Double, radius: Double, radialSegments: Int = 20): CsgSolid {
    val fwd = axis.normalized()
    val a = center - fwd * (length / 2)
    val b = center + fwd * (length / 2)
    return buildCappedTube(listOf(a, b), radius, radialSegments)
}
