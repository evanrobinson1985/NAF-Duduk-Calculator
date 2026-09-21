package com.nafduduk.calculator.mesh

/**
 * Ear-clipping triangulation for a simple (non-self-intersecting) planar
 * polygon — correct for CONCAVE polygons too, unlike naive fan
 * triangulation from vertex 0. This matters here specifically because the
 * exact nest-cut CSG fragments (ChamberMeshBuilder.kt's channel/block
 * profiles) are not convex, and some of their faces can survive a CSG
 * operation with few enough plane-splits that they're still visibly
 * concave in the final result — fan triangulation would draw wrong
 * geometry across the concave notch.
 */
fun Polygon.triangulate(): List<Triple<Vertex, Vertex, Vertex>> {
    val verts = vertices
    if (verts.size == 3) return listOf(Triple(verts[0], verts[1], verts[2]))
    if (verts.size < 3) return emptyList()

    // Project onto the polygon's own plane using two orthonormal in-plane
    // axes, so the 2D ear test works regardless of the polygon's 3D
    // orientation.
    val normal = plane.normal
    var u = if (kotlin.math.abs(normal.x) < 0.9) Vec3(1.0, 0.0, 0.0) else Vec3(0.0, 1.0, 0.0)
    u = (u - normal * normal.dot(u)).normalized()
    val v = normal.cross(u).normalized()
    val origin = verts[0].pos

    data class P2(val x: Double, val y: Double, val vertex: Vertex)
    val pts2d = verts.map { vtx ->
        val d = vtx.pos - origin
        P2(d.dot(u), d.dot(v), vtx)
    }

    fun signedArea(pts: List<P2>): Double {
        var sum = 0.0
        for (i in pts.indices) {
            val a = pts[i]
            val b = pts[(i + 1) % pts.size]
            sum += a.x * b.y - b.x * a.y
        }
        return sum / 2
    }

    // Ear clipping expects CCW winding in this 2D projection; reverse if not.
    var ring = if (signedArea(pts2d) < 0) pts2d.reversed() else pts2d

    fun cross2(o: P2, a: P2, b: P2): Double = (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

    fun pointInTriangle(p: P2, a: P2, b: P2, c: P2): Boolean {
        val d1 = cross2(a, b, p)
        val d2 = cross2(b, c, p)
        val d3 = cross2(c, a, p)
        val hasNeg = d1 < 0 || d2 < 0 || d3 < 0
        val hasPos = d1 > 0 || d2 > 0 || d3 > 0
        return !(hasNeg && hasPos)
    }

    val result = mutableListOf<Triple<Vertex, Vertex, Vertex>>()
    val remaining = ring.toMutableList()
    var guard = 0
    while (remaining.size > 3 && guard < remaining.size * remaining.size + 16) {
        guard++
        var earFound = false
        for (i in remaining.indices) {
            val n = remaining.size
            val prev = remaining[(i - 1 + n) % n]
            val cur = remaining[i]
            val next = remaining[(i + 1) % n]
            // Convex vertex (CCW polygon: interior turn is positive cross product).
            if (cross2(prev, cur, next) <= 0) continue
            var containsOther = false
            for (j in remaining.indices) {
                if (j == i || remaining[j] === prev || remaining[j] === next) continue
                if (pointInTriangle(remaining[j], prev, cur, next)) {
                    containsOther = true
                    break
                }
            }
            if (containsOther) continue
            result.add(Triple(prev.vertex, cur.vertex, next.vertex))
            remaining.removeAt(i)
            earFound = true
            break
        }
        if (!earFound) break // degenerate/self-intersecting input — stop rather than loop forever
    }
    if (remaining.size == 3) {
        result.add(Triple(remaining[0].vertex, remaining[1].vertex, remaining[2].vertex))
    }
    return result
}
