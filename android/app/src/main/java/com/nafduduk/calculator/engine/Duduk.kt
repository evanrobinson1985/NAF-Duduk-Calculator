package com.nafduduk.calculator.engine

/**
 * Ported 1:1 from the "DUDUK ACOUSTICS" section of the web source.
 *
 * A duduk is a cylindrical, double-reed instrument that behaves acoustically
 * as a CLOSED-CLOSED pipe (the reed end is "closed" by the vibrating reed,
 * the far end is closed by the player's fingers/breath pressure at rest).
 * Resonant length = tube length + the reed's effective acoustic extension.
 */
data class DudukStyle(
    val id: String,
    val label: String,
    val desc: String,
    val boreRange: ClosedFloatingPointRange<Double>,
    val reedLenRange: ClosedFloatingPointRange<Double>,
    val reedExtRange: ClosedFloatingPointRange<Double>,
    val holeCount: Int,
)

val DUDUK_STYLES: Map<String, DudukStyle> = mapOf(
    "traditional" to DudukStyle(
        id = "traditional",
        label = "Traditional Armenian",
        desc = "Wide cylindrical bore (apricot wood), large soft double reed (ghamish), warm dark tone, microtonal pitch bending via lip pressure",
        boreRange = 0.55..0.85,
        reedLenRange = 1.3..1.9,
        reedExtRange = 0.95..1.35,
        holeCount = 8,
    ),
    "western" to DudukStyle(
        id = "western",
        label = "Western / Modern Variant",
        desc = "Narrower bore, smaller stiffer reed, brighter and more stable pitch, easier for beginners, closer-spaced holes",
        boreRange = 0.4..0.62,
        reedLenRange = 0.9..1.3,
        reedExtRange = 0.65..0.95,
        holeCount = 8,
    ),
)

data class DudukHoleSpec(val num: Int, val interval: String, val ratio: Double, val thumb: Boolean)

/**
 * Diatonic major-ish scale with one chromatic-leaning hole, expressed as
 * ratios from the root. Holes counted from the reed end (H8 nearest
 * reed/top) to the foot (H1). Approximates the traditional 7-front +
 * 1-thumb Armenian layout.
 */
val DUDUK_HOLES_8: List<DudukHoleSpec> = listOf(
    DudukHoleSpec(8, "Maj 2nd", 1.1225, false),
    DudukHoleSpec(7, "Maj 3rd", 1.2599, false),
    DudukHoleSpec(6, "Perf 4th", 1.3348, false),
    DudukHoleSpec(5, "Perf 5th", 1.4983, false),
    DudukHoleSpec(4, "Maj 6th", 1.6818, false),
    DudukHoleSpec(3, "Maj 7th", 1.8877, false),
    DudukHoleSpec(2, "Octave", 2.0000, false),
    DudukHoleSpec(1, "Thumb (back)", 1.0595, true),
)

/** Closed-closed pipe approximation; the reed's acoustic extension subtracts from physical bore length. */
fun dudukTubeLen(freq: Double, r: Double, reedExt: Double): Double =
    (SPEED_IN_PER_SEC / (2 * freq)) - reedExt - (0.3 * r)

const val DUDUK_SWEET_MIN = 8.0
const val DUDUK_SWEET_MAX = 16.0
const val DUDUK_HARD_MIN = 4.0
const val DUDUK_HARD_MAX = 22.0

data class DudukBoreRecommendation(
    val boreIn: Double,
    val tubeLenIn: Double,
    val reachesSweetSpot: Boolean,
    val extreme: Boolean,
    val extremeTooLong: Boolean,
    val extremeTooShort: Boolean,
)

/**
 * Duduk equivalent of recommendedBores(): the duduk's bore is a continuous
 * per-style range rather than the flute's fixed BORES list, and tube length
 * also depends on the reed's acoustic extension. Since dudukTubeLen is
 * linear in r, the ideal bore for a target length has a direct algebraic
 * solution — solve for it, then clamp to the style's own range.
 */
fun recommendedDudukBore(freq: Double, boreRange: ClosedFloatingPointRange<Double>, reedExt: Double): DudukBoreRecommendation {
    val bMin = boreRange.start
    val bMax = boreRange.endInclusive
    val mid = (DUDUK_SWEET_MIN + DUDUK_SWEET_MAX) / 2
    val rIdeal = ((SPEED_IN_PER_SEC / (2 * freq)) - reedExt - mid) / 0.3
    val bore = (2 * rIdeal).coerceIn(bMin, bMax)
    val tl = dudukTubeLen(freq, bore / 2, reedExt)
    val inSweetSpot = tl in DUDUK_SWEET_MIN..DUDUK_SWEET_MAX
    val inHardRange = tl in DUDUK_HARD_MIN..DUDUK_HARD_MAX
    val extreme = !inHardRange
    return DudukBoreRecommendation(
        boreIn = bore,
        tubeLenIn = tl,
        reachesSweetSpot = inSweetSpot,
        extreme = extreme,
        extremeTooLong = extreme && tl > DUDUK_HARD_MAX,
        extremeTooShort = extreme && tl < DUDUK_HARD_MIN,
    )
}

/** Thumb hole is traditionally a bit smaller and offset on the back of the tube. */
fun dudukHoleDiam(bore: Double, isThumb: Boolean): Double {
    val base = bore * (if (isThumb) 0.38 else 0.46)
    return base.coerceIn(0.16, bore * 0.6)
}

data class DudukHoleResult(
    val num: Int,
    val interval: String,
    val thumb: Boolean,
    val fromReedIn: Double,
    val diameterIn: Double,
)

data class DudukDesign(
    val style: DudukStyle,
    val boreIn: Double,
    val tubeLenIn: Double,
    val rootFreq: Double,
    val rootNote: NamedPitch,
    val holes: List<DudukHoleResult>,
    val reedLenIn: Double,
    val reedDiamIn: Double,
    val totalLenIn: Double,
    /** The reed's acoustic extension used in the length calculation — reported on the build sheet. */
    val reedExtIn: Double,
)

/**
 * Builds the full duduk design for a key-driven design (the DudukPage's
 * mode === "key" branch): root note -> tube length -> 8 finger holes placed
 * with the same "L - L/ratio" proportional method the flute page uses.
 */
fun buildDudukDesignForKey(
    style: DudukStyle,
    boreIn: Double,
    reedExtIn: Double,
    reedLenIn: Double,
    rootFreq: Double,
    notes: List<Note>,
): DudukDesign {
    val r = boreIn / 2
    val tubeLen = dudukTubeLen(rootFreq, r, reedExtIn)
    val rootNote = nearestNote(rootFreq, notes)
    val holes = DUDUK_HOLES_8.map { h ->
        DudukHoleResult(
            num = h.num,
            interval = h.interval,
            thumb = h.thumb,
            fromReedIn = tubeLen - (tubeLen / h.ratio),
            diameterIn = dudukHoleDiam(boreIn, h.thumb),
        )
    }
    val reedDiam = boreIn * 0.62
    return DudukDesign(
        style = style,
        boreIn = boreIn,
        tubeLenIn = tubeLen,
        rootFreq = rootFreq,
        rootNote = rootNote,
        holes = holes,
        reedLenIn = reedLenIn,
        reedDiamIn = reedDiam,
        totalLenIn = tubeLen + reedLenIn,
        reedExtIn = reedExtIn,
    )
}
