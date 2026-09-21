package com.nafduduk.calculator.engine

import kotlin.math.max
import kotlin.math.min

/**
 * Ported 1:1 from FLUTE_CONST in the web source — every constant/formula
 * comment is preserved verbatim below since these are sourced from real
 * flute-maker references (Flutopedia's "Flute Crafting Dimensions", citing
 * Mike Prairie's "Many Dimensions of the NAF" and Russ Wolf), not invented.
 */
object FluteConst {
    const val SAC_LEN_RATIO = 4.6 // SAC (slow air chamber) length = bore * this (before the cap)
    const val SAC_LEN_MIN = 1.5 // floor — a SAC shorter than this crowds the ramp/flue run

    // Basic drilled layout (hand-finish mode): every locating cut except the SAC and the
    // full bore is machined this much SMALLER than its design dimension, leaving stock
    // for the maker to hand-fit/ream/file to size. ~2mm.
    const val HAND_FINISH_UNDERSIZE_IN = 2.0 / 25.4

    fun autoSacLen(bore: Double): Double = max(SAC_LEN_MIN, bore * SAC_LEN_RATIO)

    const val MOUTHPIECE_MARGIN = 2.0 // inches added to L+sacLen for the trimmed mouthpiece end

    // TSH WIDTH: "a good starting point is half the bore diameter" (Flutopedia).
    fun soundHoleWidth(bore: Double): Double = bore * 0.5

    fun breathHoleWidth(bore: Double): Double = max(0.19, min(bore * 0.45, 0.38))
    fun breathHoleLength(bore: Double): Double = max(0.40, min(bore * 0.85, 0.80))

    // TSH LENGTH: 7/32in documented starting point at a 3/4in-bore anchor, gentle
    // half-strength scaling either side, clamped to a sane real-world range.
    fun soundHoleLength(bore: Double): Double {
        val base = 0.21875
        val midBore = 0.75
        val scaled = base * (0.5 + 0.5 * (bore / midBore))
        return max(0.15, min(scaled, 0.5))
    }

    // Flue-Depth: "start with a depth about 3/64in or so" (~0.047in) for a mid-range flute.
    fun flueDepth(bore: Double): Double {
        val base = 0.047
        val midBore = 0.75
        val scaled = base * (0.4 + 0.6 * (bore / midBore))
        return max(0.02, min(scaled, 0.09))
    }

    fun flueLength(bore: Double): Double = soundHoleWidth(bore) * 2 // "twice the Flue-Width"

    const val SAC_EXIT_RAMP_ANGLE_DEG = 30.0 // Russ Wolf's ~30° recommendation
    const val FLUE_RAMP_FRACTION = 0.4 // retained for reference only

    const val HOLE_OVERLAP_CLEARANCE = 0.75 // a hole's diameter may use at most this fraction of the gap to its nearest neighbor
    const val HOLE_MIN_DIAMETER = 0.12 // absolute floor so the overlap cap never produces an undrillable hole

    const val INTERNAL_WALL_THICKNESS_RATIO = 0.24 // plug thickness = bore * this, clamped below
    const val INTERNAL_WALL_THICKNESS_MIN = 0.12
    const val INTERNAL_WALL_THICKNESS_MAX = 0.5

    const val CURVE_BOW_HEAVY_IN = 1.4
    const val CURVE_BOW_SLIGHT_IN = 0.55
}

enum class Curve { STRAIGHT, SLIGHT, HEAVY }

fun curveBowAmplitudeIn(curve: Curve): Double = when (curve) {
    Curve.HEAVY -> FluteConst.CURVE_BOW_HEAVY_IN
    Curve.SLIGHT -> FluteConst.CURVE_BOW_SLIGHT_IN
    Curve.STRAIGHT -> 0.0
}

enum class HandSize(val spacingFactor: Double) {
    COMPACT(0.93), AVERAGE(1.0), LARGE(1.07),
}

data class HoleShape(val key: String, val label: String, val icon: String, val desc: String, val acousticFactor: Double, val howTo: String)

val HOLE_SHAPES: Map<String, HoleShape> = mapOf(
    "round" to HoleShape(
        "round", "Round", "●",
        "Standard drilled hole — the baseline this calculator's diameters already assume.",
        1.0, "Drill straight down with a standard bit, sized to the diameter shown.",
    ),
    "oval" to HoleShape(
        "oval", "Oval", "⬭",
        "Elongated along the tube's length. Slightly larger perceived opening for the same drilled width, so the major (long) axis can run a bit smaller than an equivalent round hole while still reaching pitch.",
        0.93, "Drill a round pilot hole, then elongate along the tube axis with a round file — aim for a length-to-width ratio around 1.3-1.5:1.",
    ),
    "undercut" to HoleShape(
        "undercut", "Undercut", "◉",
        "The interior (bore-side) edge is beveled wider than the drilled surface opening. Acoustically closer to a larger hole than its surface diameter suggests.",
        0.90, "Drill the surface opening at the diameter shown, then use a small round file or undercutting tool angled into the bore from inside to bevel the inner edge — work gradually and check pitch often.",
    ),
    "countersunk" to HoleShape(
        "countersunk", "Countersunk", "◎",
        "The outer (finger-side) edge is chamfered for comfort — this is primarily ergonomic, not acoustic. Diameter stays essentially the same as round.",
        1.0, "Drill the standard round hole first, then lightly chamfer just the outer rim with a countersink bit or sanding — don't remove more than the outer 10-15% of wall thickness.",
    ),
)

fun holeShapeDiameter(baseDiam: Double, shapeKey: String): Double =
    baseDiam * (HOLE_SHAPES[shapeKey]?.acousticFactor ?: 1.0)

/** Base finger-hole diameter before overlap-clearance clamping. */
fun holeDiam(bore: Double, holeNum: Int, holeCount: Int): Double {
    val base = bore * 0.45
    val adj = if (holeNum >= holeCount) -0.02 else if (holeNum <= 2) 0.03 else 0.0
    return max(0.18, min(base + adj, bore * 0.58))
}

const val GEOMETRY_TOLERANCE = 0.005 // inches — floating point / rounding tolerance for cross-output comparisons
