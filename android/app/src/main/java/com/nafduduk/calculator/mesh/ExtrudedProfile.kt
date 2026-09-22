package com.nafduduk.calculator.mesh

/**
 * Extrudes a closed 2D polygon (points' z ignored — only x/y are read)
 * along local Z from -depth/2 to +depth/2, then maps every vertex into
 * world space via `basis`. Mirrors the web source's pattern of building a
 * `THREE.Shape` + `ExtrudeGeometry(shape, { depth })`, centering with
 * `.translate(0, 0, -depth/2)`, then `.applyMatrix4(basis)` +
 * `.translate(originPoint)` — used for the nest air-space cut and the
 * internal block/ramp solid.
 *
 * Winding is normalized internally (via the polygon's signed area) so
 * callers can list points in whichever order matches how the profile
 * reads on paper — some of the source's `Shape` point lists are CCW, some
 * CW, verified by hand for each one (see ChamberMeshBuilder.kt).
 *
 * The normalization also accounts for the basis's handedness. `LocalBasis`
 * does not promise that forward x up = right: the finger-hole and large-bore
 * cutters build one by swapping up and right to point the extrusion down a
 * different axis, which makes the local-to-world map a reflection rather than
 * a rotation, and a reflection turns every outward normal inward. A solid with
 * inverted normals is inside-out as far as the BSP is concerned, so
 * subtracting it intersects instead — which is exactly what an oval finger
 * hole used to do to the body.
 */
fun buildExtrudedProfile(points: List<Vec3>, depth: Double, basis: LocalBasis): CsgSolid {
    require(points.size >= 3) { "buildExtrudedProfile needs at least 3 points" }

    val signedArea2x = points.indices.sumOf { i ->
        val p = points[i]
        val q = points[(i + 1) % points.size]
        p.x * q.y - q.x * p.y
    }
    // Positive for a right-handed basis, negative for a reflected one.
    val handedness = basis.forward.cross(basis.up).dot(basis.right)
    val wantArea = if (handedness >= 0) 1.0 else -1.0
    val ccw = if (signedArea2x * wantArea < 0) points.reversed() else points

    val z0 = -depth / 2
    val z1 = depth / 2

    fun worldAt(p: Vec3, z: Double): Vec3 = basis.toWorld(Vec3(p.x, p.y, z))

    val polys = mutableListOf<Polygon>()

    // Side walls: for CCW edge (p_i -> p_{i+1}), the winding
    // (p_i,z0) -> (p_{i+1},z0) -> (p_{i+1},z1) -> (p_i,z1) gives an
    // outward-facing normal (hand-derived: (B-A)x(D-A) for that order
    // works out to depth*(dy,-dx,0) in local space, which is exactly the
    // standard "rotate edge -90deg" outward normal of a CCW polygon).
    val n = ccw.size
    for (i in 0 until n) {
        val pi = ccw[i]
        val pj = ccw[(i + 1) % n]
        val a = worldAt(pi, z0)
        val b = worldAt(pj, z0)
        val c = worldAt(pj, z1)
        val d = worldAt(pi, z1)
        val normal = (b - a).cross(d - a).normalized()
        polys.add(Polygon(listOf(Vertex(a, normal), Vertex(b, normal), Vertex(c, normal), Vertex(d, normal))))
    }

    // End faces: natural CCW order at z1 gives local +Z normal (outward on
    // the max-Z face); reversed at z0 gives local -Z (outward on the min-Z
    // face) — same reasoning as buildCappedTube's end caps.
    val z1Verts = ccw.map { worldAt(it, z1) }
    val z0Verts = ccw.reversed().map { worldAt(it, z0) }
    val z1Normal = basis.right
    val z0Normal = -basis.right
    polys.add(Polygon(z1Verts.map { Vertex(it, z1Normal) }))
    polys.add(Polygon(z0Verts.map { Vertex(it, z0Normal) }))

    return CsgSolid(polys)
}
