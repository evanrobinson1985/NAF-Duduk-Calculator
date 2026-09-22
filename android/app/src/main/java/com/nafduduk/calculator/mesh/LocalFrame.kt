package com.nafduduk.calculator.mesh

/**
 * A local coordinate frame at a station along the tube centerline —
 * mirrors the web source's per-cut `forward`/`up`/`right` vectors plus
 * `originPoint` (used to place the nest-cut/finger-hole geometry). `toWorld`
 * mirrors `new THREE.Matrix4().makeBasis(forward, up, right)` followed by a
 * translate: local X -> forward, local Y -> up, local Z -> right.
 */
/**
 * An orthonormal frame mapping profile-local (x, y, z) to world space.
 *
 * The three axes are NOT required to be right-handed — the finger-hole and
 * large-bore cutters deliberately swap `up` and `right` to aim the extrusion
 * down a different axis. Anything building a solid through this has to test
 * `forward x up . right` and flip its winding when that is negative, or the
 * solid comes out inside-out; buildExtrudedProfile does.
 */
data class LocalBasis(val origin: Vec3, val forward: Vec3, val up: Vec3, val right: Vec3) {
    fun toWorld(local: Vec3): Vec3 = origin + forward * local.x + up * local.y + right * local.z
}

private val WORLD_UP = Vec3(0.0, 1.0, 0.0)

/**
 * tangent/up/forward/right at parameter t along `pathPoints`, matching the
 * web source's `curvePath.getTangentAt(t)` + `localUpAt(curvePath, t)` +
 * the `forward = tangent - up*(tangent.dot(up))` (tangent projected flat
 * into the up-perpendicular plane) + `right = forward × up` construction
 * used at the TSH/finger-hole cut sites.
 */
fun tangentAt(pathPoints: List<Vec3>, t: Double): Vec3 {
    val n = pathPoints.size
    val tt = t.coerceIn(0.0, 1.0)
    val idx = (tt * (n - 1))
    val i0 = idx.toInt().coerceIn(0, n - 2)
    val i1 = i0 + 1
    return (pathPoints[i1] - pathPoints[i0]).normalized()
}

fun pointAt(pathPoints: List<Vec3>, t: Double): Vec3 {
    val n = pathPoints.size
    val tt = t.coerceIn(0.0, 1.0)
    val idx = tt * (n - 1)
    val i0 = idx.toInt().coerceIn(0, n - 2)
    val frac = idx - i0
    return pathPoints[i0].lerp(pathPoints[i0 + 1], frac)
}

/**
 * Ported 1:1 from localUpAt(): world +Y projected to be perpendicular to
 * the tangent (Gram-Schmidt), falling back to +Z if the tangent is nearly
 * vertical (never hit in practice — this app's curve only bends in the
 * XY plane — but kept for exact fidelity).
 */
fun localUpAt(tangent: Vec3): Vec3 {
    val up = WORLD_UP - tangent * WORLD_UP.dot(tangent)
    return if (up.dot(up) > 1e-6) up.normalized() else Vec3(0.0, 0.0, 1.0)
}

/**
 * The full cut/nest local frame at parameter t: forward/up/right plus the
 * origin point on the tube's outer surface directly "above" that station
 * (`center + up*outerR`), matching the web source's nest-cut setup exactly.
 */
fun nestFrameAt(pathPoints: List<Vec3>, t: Double, outerR: Double): LocalBasis {
    val center = pointAt(pathPoints, t)
    val tangent = tangentAt(pathPoints, t)
    val up = localUpAt(tangent)
    val forward = (tangent - up * tangent.dot(up)).normalized()
    val right = forward.cross(up).normalized()
    val origin = center + up * outerR
    return LocalBasis(origin, forward, up, right)
}
