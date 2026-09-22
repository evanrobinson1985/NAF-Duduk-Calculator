package com.nafduduk.calculator.engine

import kotlin.math.max
import kotlin.math.min

/**
 * A maker's overrides for the nest — the voicing end of the flute, where the
 * air leaves the slow-air chamber, crosses the flue and hits the splitting
 * edge. Every dimension here has a bore-derived default that the calculator
 * uses when the override is null, so a flute with nothing set builds exactly
 * as it always has. That is the web source's own convention (its
 * `Number.isFinite(...) ? override : formula` checks), preserved here as
 * null-means-auto.
 *
 * These are the numbers experienced makers actually adjust, and they change
 * the instrument's voice rather than its pitch.
 */
data class NestOverrides(
    /** Bore wall thickness. */
    val wallThicknessIn: Double? = null,
    /** Flue depth — the height of the windway over the flue floor. */
    val flueDepthIn: Double? = null,
    /** Flue flat-run length. */
    val flueLengthIn: Double? = null,
    /** Angle the ramp lifts the SAC floor to the seam. */
    val rampAngleDeg: Double? = null,
    /** 0 = a straight ramp face, 1 = fully scooped. */
    val rampCurve: Double? = null,
    /** Angle of the splitting edge's bevel. */
    val fippleAngleDeg: Double? = null,
    /** How far the bore reaches back under the flue. */
    val backsetIn: Double? = null,
    /** Height of the splitting-edge tip above the flue floor. */
    val tipHeightIn: Double? = null,
    /** Width of the flat at the very tip of the splitting edge. */
    val tipFlatIn: Double? = null,
) {
    val isEmpty: Boolean
        get() = this == NestOverrides()
}

/**
 * The nest dimensions actually used, override-or-formula with the source's
 * own clamps. Shared by the 3D preview (mesh/ChamberMeshBuilder.kt) and the
 * split-block CAM (gcode/SplitBlockGcode.kt) so the preview cannot show one
 * nest while the machine cuts another.
 */
class ResolvedNest(bore: Double, soundHoleWidthIn: Double, o: NestOverrides) {
    private val r = bore / 2

    val wallThicknessIn: Double =
        if (o.wallThicknessIn != null && o.wallThicknessIn > 0) max(0.04, min(o.wallThicknessIn, 0.5))
        else max(0.05, r * 0.28)

    val flueLengthIn: Double =
        if (o.flueLengthIn != null && o.flueLengthIn > 0) max(0.1, min(o.flueLengthIn, 2.0))
        else 2 * soundHoleWidthIn

    val flueDepthIn: Double =
        if (o.flueDepthIn != null && o.flueDepthIn > 0) o.flueDepthIn else FluteConst.flueDepth(bore)

    val rampAngleDeg: Double =
        if (o.rampAngleDeg != null && o.rampAngleDeg > 0) o.rampAngleDeg else FluteConst.SAC_EXIT_RAMP_ANGLE_DEG

    val rampCurve: Double = (o.rampCurve ?: 0.0).coerceIn(0.0, 1.0)

    val fippleAngleDeg: Double =
        if (o.fippleAngleDeg != null && o.fippleAngleDeg > 0) o.fippleAngleDeg else 35.0

    /** Clamped against both the bore and the flue: it cannot undercut either. */
    val backsetIn: Double = max(0.0, min(o.backsetIn ?: 0.0, min(bore / 3, flueLengthIn * 0.6)))

    val tipHeightIn: Double = max(0.0, min(o.tipHeightIn ?: (1.0 / 128), flueDepthIn * 0.9))

    val tipFlatIn: Double = max(0.0, min(o.tipFlatIn ?: 0.01, 0.06))
}
