package com.nafduduk.calculator.engine

import kotlin.math.abs
import kotlin.math.min

// inches of wall thickness reserved per side at the narrowest point (the tip)
const val ANTLER_WALL_MARGIN = 0.12
// inches lost to squaring up both cut ends (matches totalLen's +2.0)
const val ANTLER_TRIM_ALLOWANCE = 2.0

data class AntlerNoteFit(
    val name: String,
    val freq: Double,
    val idealLenIn: Double,
    val diffIn: Double, // positive = room to spare, trim to fit
    val fitsExact: Boolean,
    val fitsWithTrim: Boolean,
    val tooLong: Boolean,
)

data class AntlerFitResult(
    val fits: Boolean,
    val reason: String? = null, // "tip_too_narrow" | "too_short" | null
    val maxUsableBoreIn: Double,
    val boreIn: Double? = null,
    val usableTubeLenIn: Double? = null,
    val sacLenIn: Double? = null,
    val bestMatches: List<AntlerNoteFit> = emptyList(),
    val tooLongExamples: List<AntlerNoteFit> = emptyList(),
    val scaleName: String = "",
)

/**
 * Ported 1:1 from analyzeAntlerFit(): takes real physical measurements of a
 * specific antler section (length, widest diameter, tip diameter,
 * curvature) and reports which keys it can actually be built into — reusing
 * the same tube-length physics as the rest of the app (tubeLen, sacLen
 * formula, BORES list).
 */
fun analyzeAntlerFit(lengthIn: Double, widestDiamIn: Double, tipDiamIn: Double, curvature: Curve, notes: List<Note>, holeCount: Int): AntlerFitResult? {
    if (lengthIn <= 0 || widestDiamIn <= 0 || tipDiamIn <= 0) return null

    val maxUsableBore = min(widestDiamIn, tipDiamIn) - ANTLER_WALL_MARGIN * 2
    val usableBores = BORES.filter { it.valIn <= maxUsableBore }
    if (usableBores.isEmpty()) {
        return AntlerFitResult(fits = false, reason = "tip_too_narrow", maxUsableBoreIn = maxUsableBore)
    }
    val bore = usableBores.last().valIn

    val curveLossFactor = when (curvature) {
        Curve.HEAVY -> 0.88
        Curve.SLIGHT -> 0.95
        Curve.STRAIGHT -> 1.0
    }
    val sacLen = FluteConst.autoSacLen(bore)
    val usableTubeLen = (lengthIn * curveLossFactor) - sacLen - ANTLER_TRIM_ALLOWANCE

    if (usableTubeLen < BORE_HARD_MIN) {
        return AntlerFitResult(fits = false, reason = "too_short", maxUsableBoreIn = maxUsableBore, boreIn = bore, usableTubeLenIn = usableTubeLen)
    }

    val results = notes.map { n ->
        val idealLen = tubeLen(n.freq, bore / 2)
        val diff = usableTubeLen - idealLen
        AntlerNoteFit(
            name = n.name, freq = n.freq, idealLenIn = idealLen, diffIn = diff,
            fitsExact = diff >= 0 && diff <= 1.5, fitsWithTrim = diff > 1.5, tooLong = diff < 0,
        )
    }

    val buildable = results.filter { !it.tooLong }.sortedBy { abs(it.diffIn) }
    val bestMatches = buildable.take(5)
    val tooLongExamples = results.filter { it.tooLong }.sortedBy { it.diffIn }.take(3)

    val scaleName = SCALE_CONFIGS[holeCount]?.name ?: "$holeCount-Hole"

    return AntlerFitResult(
        fits = buildable.isNotEmpty(), maxUsableBoreIn = maxUsableBore, boreIn = bore, usableTubeLenIn = usableTubeLen,
        sacLenIn = sacLen, bestMatches = bestMatches, tooLongExamples = tooLongExamples, scaleName = scaleName,
    )
}
