package com.nafduduk.calculator.engine

import kotlin.math.max
import kotlin.math.min

data class FingerHole(
    val num: Int,
    val interval: String,
    val fromFootIn: Double,
    val fromTshIn: Double,
    val diameterIn: Double,
)

data class ChamberGeometry(
    val bore: Double,
    val freq: Double,
    val lengthIn: Double,
    val totalLenIn: Double?,
    val sacLenIn: Double,
    val mouthpieceMarginIn: Double,
    val soundHoleWidthIn: Double,
    val soundHoleLengthIn: Double,
    val holeCount: Int,
    val holes: List<FingerHole>,
    val theoreticalHoles: List<FingerHole>,
    val playable: Boolean,
)

data class ErgoOverride(val num: Int, val adjFromTshIn: Double, val adjDiameterIn: Double)

/**
 * ★ AUTHORITATIVE GEOMETRY BUILDER — SINGLE SOURCE OF TRUTH ★
 *
 * Ported 1:1 from buildChamberGeometry() in the web source. Builds ONE
 * chamber's complete geometry — melody or drone, playable or silent — from
 * its root inputs: tube length, SAC length, total length, sound-hole window
 * dimensions, and (if playable) the full finger-hole array with
 * overlap-safe diameters. This is the ONLY place these formulas should be
 * written, mirroring the web source's own comment.
 */
fun buildChamberGeometry(
    bore: Double,
    freq: Double,
    holeCount: Int = 0,
    handSize: HandSize = HandSize.AVERAGE,
    holeShapeKey: String = "round",
    ergoOverride: List<ErgoOverride>? = null,
    sacLenInOverride: Double? = null,
    mouthpieceMarginInOverride: Double? = null,
): ChamberGeometry {
    val r = bore / 2
    val length = max(0.0, tubeLen(freq, r))

    val sacLen = if (sacLenInOverride != null && sacLenInOverride > 0) {
        sacLenInOverride.coerceIn(0.8, 20.0)
    } else {
        FluteConst.autoSacLen(bore)
    }

    val mouthpieceMargin = if (mouthpieceMarginInOverride != null && mouthpieceMarginInOverride >= 0) {
        min(mouthpieceMarginInOverride, 6.0)
    } else {
        FluteConst.MOUTHPIECE_MARGIN
    }

    val totalLen = if (length > 0) length + sacLen + mouthpieceMargin else 0.0
    val shW = FluteConst.soundHoleWidth(bore)
    val shL = FluteConst.soundHoleLength(bore)

    var holes: List<FingerHole> = emptyList()
    var theoreticalHoles: List<FingerHole> = emptyList()

    val config = SCALE_CONFIGS[holeCount]
    if (holeCount > 0 && length > 0 && config != null) {
        val spacingFactor = handSize.spacingFactor

        data class RawPos(val num: Int, val interval: String, val ratio: Double, val fromFootNum: Double)
        val rawPositions = config.holes.map { h ->
            RawPos(h.num, h.interval, h.ratio, (length / h.ratio) * spacingFactor)
        }
        val sortedByPos = rawPositions.sortedBy { it.fromFootNum }
        val minGapByNum = HashMap<Int, Double>()
        sortedByPos.forEachIndexed { i, h ->
            val gaps = mutableListOf<Double>()
            if (i > 0) gaps.add(kotlin.math.abs(h.fromFootNum - sortedByPos[i - 1].fromFootNum))
            if (i < sortedByPos.size - 1) gaps.add(kotlin.math.abs(sortedByPos[i + 1].fromFootNum - h.fromFootNum))
            minGapByNum[h.num] = if (gaps.isNotEmpty()) gaps.min() else Double.POSITIVE_INFINITY
        }

        theoreticalHoles = rawPositions.map { h ->
            val rawDiam = holeShapeDiameter(holeDiam(bore, h.num, holeCount), holeShapeKey)
            val gapCap = (minGapByNum[h.num] ?: Double.POSITIVE_INFINITY) * FluteConst.HOLE_OVERLAP_CLEARANCE
            val diameter = if (gapCap.isFinite()) {
                min(rawDiam, max(FluteConst.HOLE_MIN_DIAMETER, gapCap))
            } else {
                rawDiam
            }
            FingerHole(
                num = h.num,
                interval = h.interval,
                fromFootIn = h.fromFootNum,
                fromTshIn = length - h.fromFootNum,
                diameterIn = diameter,
            )
        }

        holes = if (ergoOverride != null && ergoOverride.size == theoreticalHoles.size) {
            theoreticalHoles.map { th ->
                val ov = ergoOverride.find { it.num == th.num }
                if (ov != null) th.copy(fromTshIn = ov.adjFromTshIn, diameterIn = ov.adjDiameterIn) else th
            }
        } else {
            theoreticalHoles
        }
    }

    return ChamberGeometry(
        bore = bore,
        freq = freq,
        lengthIn = length,
        totalLenIn = if (length > 0) totalLen else null,
        sacLenIn = sacLen,
        mouthpieceMarginIn = mouthpieceMargin,
        soundHoleWidthIn = shW,
        soundHoleLengthIn = shL,
        holeCount = holeCount,
        holes = holes,
        theoreticalHoles = theoreticalHoles,
        playable = length > 0,
    )
}

// Cents-per-percent-diameter-change used for the compensation estimate — a commonly
// cited rule-of-thumb rate for small hole/bore ratios, not a precise acoustic derivation.
const val DIAM_CENTS_PER_PCT = 10.0

data class ErgoAdjustedHole(
    val hole: FingerHole,
    val adjFromTshIn: Double,
    val adjDiameterIn: Double,
    val centsShift: Int,
)

/**
 * ergonomicAdjustHoles(): blends theoretical hole positions toward even
 * spacing by `blend` (0..1), reporting the resulting pitch drift and a
 * suggested diameter compensation. First/last holes never move.
 */
fun ergonomicAdjustHoles(holes: List<FingerHole>, blend: Double): List<ErgoAdjustedHole> {
    val ordered = holes.sortedBy { it.fromTshIn }
    val n = ordered.size
    if (n < 3) {
        return ordered.map { ErgoAdjustedHole(it, it.fromTshIn, it.diameterIn, 0) }
    }

    val first = ordered[0].fromTshIn
    val last = ordered[n - 1].fromTshIn

    return ordered.mapIndexed { i, h ->
        if (i == 0 || i == n - 1) {
            return@mapIndexed ErgoAdjustedHole(h, h.fromTshIn, h.diameterIn, 0)
        }
        val orig = h.fromTshIn
        val even = first + (last - first) * (i.toDouble() / (n - 1))
        val adj = orig * (1 - blend) + even * blend

        val origFreqRel = 1 / orig
        val newFreqRel = 1 / adj
        val centsShift = 1200 * ln2(newFreqRel / origFreqRel)

        val pctChange = -centsShift / DIAM_CENTS_PER_PCT
        val adjDiam = max(0.12, h.diameterIn * (1 + pctChange / 100))

        ErgoAdjustedHole(h, adj, adjDiam, Math.round(centsShift).toInt())
    }
}
