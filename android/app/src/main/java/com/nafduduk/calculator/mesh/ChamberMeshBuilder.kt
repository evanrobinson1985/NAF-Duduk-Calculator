package com.nafduduk.calculator.mesh

import com.nafduduk.calculator.engine.ChamberGeometry
import com.nafduduk.calculator.engine.Curve
import com.nafduduk.calculator.engine.FluteConst
import com.nafduduk.calculator.engine.curveBowAmplitudeIn
import kotlin.math.PI
import kotlin.math.sin

/**
 * Builds one chamber's solid body via CSG: a hollow tube (outer minus
 * inner), with finger holes and a simplified sound-hole/flue/ramp cut
 * subtracted. This mirrors buildChamberMesh()'s overall shape and real
 * physical dimensions (FLUTE_CONST-derived flue depth/length, TSH width/
 * length, wall thickness), but simplifies the web version's exact
 * extruded-bezier nest profile (ramp curve, fipple bevel, tip flat, bird
 * block) to straightforward box/wedge CSG cuts — full Prairie-dimension
 * precision on that one feature was judged not worth the added CSG risk
 * for a hand-verified, never-compiled port. See android/README.md.
 */
fun buildChamberSolid(geom: ChamberGeometry, curve: Curve, radialSegments: Int = 18): CsgSolid {
    val bowAmp = curveBowAmplitudeIn(curve)
    val totalLen = geom.sacLenIn + geom.lengthIn
    // BSP-tree CSG cost grows steeply with polygon count and this can't be
    // profiled on real hardware in this sandbox, so segment counts here are
    // deliberately conservative (a round tube doesn't need many segments to
    // read as round) rather than tuned for maximum visual smoothness.
    val segments = 20

    fun centerAt(t: Double): Vec3 {
        val x = t * totalLen
        val y = if (bowAmp == 0.0) 0.0 else bowAmp * sin(t * PI)
        return Vec3(x, y, 0.0)
    }
    val pathPoints = (0..segments).map { centerAt(it.toDouble() / segments) }

    val r = geom.bore / 2
    val wallT = maxOf(0.05, r * 0.28)
    val outerR = r + wallT

    var body = buildCappedTube(pathPoints, outerR, radialSegments)
        .subtract(buildCappedTube(pathPoints, r, radialSegments))

    // ── Finger holes: round cutters through the wall, on the "top" (+Y-ish
    // local up) of the tube, at each hole's measured position from the
    // mouth end (sacLen + fromTSH). ──
    for (hole in geom.holes) {
        val t = (geom.sacLenIn + hole.fromTshIn) / totalLen
        if (t < 0 || t > 1) continue
        val center = centerAt(t)
        val holeRadius = hole.diameterIn / 2
        val cutter = buildCylinderAlong(
            center = center + Vec3(0.0, outerR, 0.0),
            axis = Vec3(0.0, 1.0, 0.0),
            length = outerR * 2.2,
            radius = holeRadius,
            radialSegments = 16,
        )
        body = body.subtract(cutter)
    }

    // ── Sound hole (TSH) + flue channel + ramp: simplified as three box/
    // wedge cuts at the real FLUTE_CONST-derived dimensions and position
    // (t = sacLen/totalLen), rather than the exact swept bezier profile.
    run {
        val shW = geom.soundHoleWidthIn
        val shL = geom.soundHoleLengthIn
        val flueDepth = FluteConst.flueDepth(geom.bore)
        val flueLength = 2 * shW
        val tTsh = geom.sacLenIn / totalLen
        if (tTsh in 0.0..1.0) {
            val center = centerAt(tTsh)
            val overshoot = maxOf(0.03, r * 0.08)
            val tshCutDepth = wallT + overshoot

            // TSH window: a box straight down through the wall into the bore.
            val tshCenter = center + Vec3(shL / 2, outerR - tshCutDepth / 2, 0.0)
            body = body.subtract(buildBox(tshCenter, Vec3(shL, tshCutDepth, shW)))

            // Flue channel: a shallow box upstream of the TSH, cut only
            // `flueDepth` into the surface (not through the wall).
            val flueCenter = center + Vec3(-flueLength / 2, outerR - flueDepth / 2, 0.0)
            body = body.subtract(buildBox(flueCenter, Vec3(flueLength, flueDepth, shW)))

            // Ramp: the real geometry is an angled chamfer from the bore floor
            // up to the flue floor; approximated here as a plain axis-aligned
            // box spanning that same vertical rise, upstream of the flue
            // entrance — a visibly blockier stand-in, not a machining-grade
            // profile (a true wedge would need a rotated/tapered solid).
            val rampLen = maxOf(0.15, geom.sacLenIn * 0.35)
            val rampCenter = center + Vec3(-flueLength - rampLen / 2, outerR - (r + flueDepth) / 2, 0.0)
            body = body.subtract(buildBox(rampCenter, Vec3(rampLen, r + flueDepth, shW)))
        }
    }

    return body
}
