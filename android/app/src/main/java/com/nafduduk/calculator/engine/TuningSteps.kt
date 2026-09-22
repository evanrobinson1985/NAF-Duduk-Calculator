package com.nafduduk.calculator.engine

/**
 * The step sequence behind the Progressive Tuning Assistant — drill and test
 * one hole at a time instead of cutting all six and hoping.
 *
 * The order matters and is not obvious. Hole 1 is closest to the FOOT but
 * carries the LARGEST scale-degree ratio (the biggest jump from the root);
 * the highest-numbered hole is closest to the mouth and carries the smallest.
 * So walking from the highest number down to 1 raises the pitch one step at a
 * time, which is also standard NAF fingering — lift the mouth-most finger
 * first and work toward the foot.
 *
 * The expected pitch at each step is the root times that hole's own ratio
 * from SCALE_CONFIGS — the same ratio that placed the hole in the first
 * place, so this can never disagree with the rest of the app.
 */
data class TuningStep(
    /** Null on the first step, where every hole is covered and the flute sounds its root. */
    val holeNum: Int?,
    val label: String,
    /** The scale degree this hole opens, e.g. "Perf 5th"; blank on the root step. */
    val interval: String,
    val expectedFreq: Double?,
    val expectedNote: NamedPitch?,
) {
    val isRoot: Boolean get() = holeNum == null
}

/**
 * Which holes are open at a step: every hole numbered at or above the one
 * this step opens. Covering works mouth-ward, so opening H4 means H4, H5 and
 * H6 are all off the tube.
 */
fun TuningStep.isHoleOpen(holeNum: Int): Boolean = this.holeNum != null && holeNum >= this.holeNum

/**
 * Builds the walk for one playable chamber. Returns an empty list for a
 * chamber with no finger holes — a drone has nothing to walk through.
 */
fun tuningSteps(
    holes: List<FingerHole>,
    holeCount: Int,
    rootFreq: Double?,
    notes: List<Note>,
): List<TuningStep> {
    if (holes.isEmpty()) return emptyList()

    val ratioByNum = (SCALE_CONFIGS[holeCount] ?: SCALE_CONFIGS[holes.size])
        ?.holes?.associate { it.num to it.ratio }
        .orEmpty()

    fun step(holeNum: Int?, label: String, interval: String, ratio: Double): TuningStep {
        val freq = rootFreq?.times(ratio)
        return TuningStep(holeNum, label, interval, freq, freq?.let { nearestNote(it, notes) })
    }

    return listOf(step(null, "Cover all holes", "", 1.0)) +
        holes.sortedByDescending { it.num }.map { h ->
            step(h.num, "Open Hole ${h.num}", h.interval, ratioByNum[h.num] ?: 1.0)
        }
}

/** Cents between a heard pitch and the expected one; null when either is missing. */
fun centsOff(expectedFreq: Double?, heardFreq: Double): Int? {
    if (expectedFreq == null || expectedFreq <= 0 || heardFreq <= 0) return null
    return Math.round(1200 * (Math.log(heardFreq / expectedFreq) / Math.log(2.0))).toInt()
}
