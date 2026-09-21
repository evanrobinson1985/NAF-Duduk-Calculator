package com.nafduduk.calculator.engine

/**
 * FINGER REACH ANALYZER — checks the gap between every pair of adjacent
 * finger holes against typical adult hand-span comfort ranges, flagging
 * both cramped (fingers overlap/collide) and overstretched (can't
 * comfortably span) spacing. Ported 1:1 from REACH_LIMITS/analyzeFingerReach().
 */
object ReachLimits {
    const val CRAMPED = 0.55 // below this, adjacent fingers physically collide
    const val TIGHT = 0.75 // below this, playable but tight for most adult hands
    const val COMFORT_MAX = 1.45 // up to this is a comfortable, relaxed span
    const val STRETCH_MAX = 1.75 // up to this is a stretch but generally reachable
    // above STRETCH_MAX = exceeds average hand reach
}

enum class ReachStatus { COMFORTABLE, TIGHT, STRETCH, CRAMPED, EXCEEDS }

data class ReachGap(val fromNum: Int, val toNum: Int, val gapIn: Double, val status: ReachStatus)
data class FingerReachAnalysis(val gaps: List<ReachGap>, val worst: ReachGap?, val hasProblem: Boolean, val hasWarning: Boolean)

/** holes must be orderable by fromTshIn for "adjacent on the instrument" to mean anything. */
fun analyzeFingerReach(holes: List<FingerHole>): FingerReachAnalysis {
    val ordered = holes.sortedBy { it.fromTshIn }

    val gaps = mutableListOf<ReachGap>()
    for (i in 0 until ordered.size - 1) {
        val a = ordered[i]
        val b = ordered[i + 1]
        val gap = b.fromTshIn - a.fromTshIn
        val status = when {
            gap < ReachLimits.CRAMPED -> ReachStatus.CRAMPED
            gap < ReachLimits.TIGHT -> ReachStatus.TIGHT
            gap <= ReachLimits.COMFORT_MAX -> ReachStatus.COMFORTABLE
            gap <= ReachLimits.STRETCH_MAX -> ReachStatus.STRETCH
            else -> ReachStatus.EXCEEDS
        }
        gaps.add(ReachGap(a.num, b.num, gap, status))
    }

    fun rank(s: ReachStatus) = when (s) {
        ReachStatus.COMFORTABLE -> 0
        ReachStatus.TIGHT -> 1
        ReachStatus.STRETCH -> 2
        ReachStatus.CRAMPED -> 3
        ReachStatus.EXCEEDS -> 3
    }
    val worst = gaps.maxByOrNull { rank(it.status) }

    val hasProblem = gaps.any { it.status == ReachStatus.CRAMPED || it.status == ReachStatus.EXCEEDS }
    val hasWarning = gaps.any { it.status == ReachStatus.TIGHT || it.status == ReachStatus.STRETCH }

    return FingerReachAnalysis(gaps, worst, hasProblem, hasWarning)
}
