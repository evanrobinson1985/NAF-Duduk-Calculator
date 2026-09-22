package com.nafduduk.calculator.engine

import com.nafduduk.calculator.util.jsFmt
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.log2
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.round
import kotlin.math.sqrt

/** kg/m3, m2/s, m/s (20C air) — ported verbatim from FLOW_AIR. */
object FlowAir {
    const val RHO = 1.2
    const val NU = 1.5e-5
    const val C = 343.0
}

const val IN2M = 0.0254

/** A finger hole's position for the aeroacoustics model — only fromTSH matters here. */
data class FlowHole(val fromTshIn: Double)

/**
 * design: inches + Hz (bridge snapshot, possibly with nest overrides
 * applied). Ported from FLOW_DEFAULT_DESIGN / the design shape FlutePage
 * publishes to Flow Studio.
 */
data class FlowDesign(
    val rootFreq: Double,
    val bore: Double,
    val lengthIn: Double,
    val sacLenIn: Double,
    val shW: Double,
    val shL: Double,
    val flueDepthIn: Double,
    val rampAngleDeg: Double,
    val fippleAngleDeg: Double,
    val rampCurve: Double,
    val breathHoleWidthIn: Double,
    val breathHoleLengthIn: Double,
    val wallThicknessIn: Double,
    val backsetIn: Double,
    val tipFlatIn: Double,
    val chimneyIn: Double,
    val tipHeightIn: Double,
    val flueLengthIn: Double?,
    val holeCount: Int,
    val holes: List<FlowHole>,
)

/** Mid-range F#4 flute, FLUTE_CONST-consistent — the standalone default when no live design is available. */
val FLOW_DEFAULT_DESIGN = FlowDesign(
    rootFreq = 369.99, bore = 0.75, lengthIn = 15.1, sacLenIn = 3.45,
    shW = 0.375, shL = 0.219, flueDepthIn = 0.047,
    rampAngleDeg = 30.0, fippleAngleDeg = 35.0, rampCurve = 0.0,
    breathHoleWidthIn = 0.28, breathHoleLengthIn = 0.53,
    wallThicknessIn = 0.0875, backsetIn = 0.0, tipFlatIn = 0.01, chimneyIn = 0.0,
    tipHeightIn = 0.0078, flueLengthIn = null,
    holeCount = 0, holes = emptyList(),
)

/**
 * FLUTE CRAFTING DIMENSIONS reference — distilled from Flutopedia's "Flute
 * Crafting Dimensions" page (Clint Goss, aggregating Mike Prairie's "Many
 * Dimensions of the NAF", Russ Wolf's plans, and the flue-pipe literature).
 */
object CraftingDims {
    val breathHoleDias = listOf(0.25, 0.28125, 0.3125, 0.34375, 0.375) // 1/4 ... 3/8 in 1/32 steps

    data class BreathHoleRec(val diaIn: Double, val lenIn: Double)

    fun recommendBreathHole(bore: Double, rootFreq: Double): BreathHoleRec {
        val b = max(0.4, min(bore, 2.2))
        var dia = 0.3125 * (b / 0.75).pow(0.45)
        dia = max(0.25, min(dia, 0.375))
        dia = breathHoleDias.reduce { best, v -> if (abs(v - dia) < abs(best - dia)) v else best }
        val fAdj = if (rootFreq > 0) (392 / max(150.0, min(rootFreq, 900.0))).pow(0.25) else 1.0
        var len = 2.75 * (b / 0.75).pow(0.6) * fAdj
        len = round(max(1.25, min(len, 4.0)) * 8) / 8
        return BreathHoleRec(dia, len)
    }

    fun fractionLabel(v: Double): String = when (v) {
        0.25 -> "1/4″"
        0.28125 -> "9/32″"
        0.3125 -> "5/16″"
        0.34375 -> "11/32″"
        0.375 -> "3/8″"
        else -> jsFmt(v, 3) + "″"
    }
}

data class RegimeLabel(val label: String, val tone: String) // tone: "good" | "warn" | "bad"

data class AeroacousticsResult(
    val u: Double, val q: Double, val qLpm: Double, val re: Double, val theta: Double, val thetaTop: Double,
    val f0: Double, val fTop: Double, val cutupRatio: Double, val f1pred: Double, val cents: Double,
    val hM: Double, val lcM: Double, val jetRegime: RegimeLabel, val flowRegime: RegimeLabel, val phaseLagCoeff: Double,
    val flueLenIn: Double, val flueDevRatio: Double, val edgeOffsetRatio: Double, val rampSep: Double, val chimRatio: Double,
    val supplyRatio: Double, val bhFriction: Double, val fipDeg: Double, val backsetRatio: Double,
)

// Empirical ratio between the jet's mean exit velocity U and the convection speed of the
// instability wave riding it (u_c ~ kappa*U) — Fabre & Hirschberg 2000 / Verge et al. 1994
// consistently find kappa in 0.35-0.45; 0.4 is the commonly cited central value.
const val JET_KAPPA = 0.4

/** Ported 1:1 from computeFluteAeroacoustics(). */
fun computeFluteAeroacoustics(design: FlowDesign, pressurePa: Double): AeroacousticsResult {
    val d = design
    val u = sqrt(2 * max(1.0, pressurePa) / FlowAir.RHO)
    val h = max(1e-5, d.flueDepthIn * IN2M)
    val w = max(1e-4, d.shW * IN2M)
    val lc = max(1e-4, d.shL * IN2M)
    val q = u * h * w
    val re = u * h / FlowAir.NU
    val f0 = if (d.rootFreq > 0) d.rootFreq else 370.0

    val theta = u / (f0 * lc)

    var fTop = f0
    var thetaTop = theta
    if (d.holes.isNotEmpty() && d.lengthIn > 0) {
        val fromTshs = d.holes.map { it.fromTshIn }.filter { it.isFinite() && it > 0.5 }
        if (fromTshs.isNotEmpty()) {
            val minFromTsh = fromTshs.min()
            val dLc = 2 * 0.61 * (d.bore / 2)
            fTop = f0 * ((d.lengthIn + dLc) / (minFromTsh + dLc))
            thetaTop = u / (fTop * lc)
        }
    }

    val cutupRatio = d.shL / max(d.flueDepthIn, 1e-6)

    val a = (d.bore / 2) * IN2M
    val lm = max(0.01, d.lengthIn * IN2M)
    val f1pred = FlowAir.C / (2 * (lm + 2 * 0.61 * a))
    val cents = 1200 * log2(f1pred / f0)

    val jetRegime = when {
        theta < 3 -> RegimeLabel("Won't speak — underblown", "bad")
        theta < 5 -> RegimeLabel("Weak / airy", "warn")
        theta <= 10 -> RegimeLabel("Optimal fundamental", "good")
        theta <= 14 -> RegimeLabel("Edgy — overblow risk", "warn")
        else -> RegimeLabel("Overblows to octave", "bad")
    }
    val flowRegime = when {
        re < 500 -> RegimeLabel("Very low — weak drive", "warn")
        re <= 1200 -> RegimeLabel("Laminar — clean, pure tone", "good")
        re <= 3000 -> RegimeLabel("Transitional — breathy warmth", "warn")
        else -> RegimeLabel("Turbulent — hissy", "bad")
    }

    val flueLenIn = if (d.flueLengthIn != null && d.flueLengthIn > 0) d.flueLengthIn else 2 * d.shW
    val devLenIn = max(0.02, 0.04 * re * d.flueDepthIn)
    val flueDevRatio = flueLenIn / devLenIn

    val tipH = d.tipHeightIn
    val edgeOffsetRatio = (d.flueDepthIn / 2 - tipH) / max(1e-4, d.flueDepthIn)
    val rampDeg = d.rampAngleDeg
    val rampSep = max(0.0, (rampDeg - 32) / 28) * (1 - 0.5 * max(0.0, min(1.0, d.rampCurve)))
    val chimRatio = max(0.0, d.chimneyIn) / max(0.05, d.shL)
    val bhDia = max(0.05, d.breathHoleWidthIn)
    val bhLen = max(0.2, d.breathHoleLengthIn)
    val supplyRatio = (PI / 4 * bhDia * bhDia) / max(1e-5, d.flueDepthIn * d.shW)
    val bhFriction = bhLen / bhDia
    val fipDeg = d.fippleAngleDeg
    val backsetRatio = max(0.0, d.backsetIn) / max(1e-3, d.bore / 3)

    val phaseLagCoeff = (2 * PI / JET_KAPPA) / max(1.5, theta)

    return AeroacousticsResult(
        u = u, q = q, qLpm = q * 60000, re = re, theta = theta, thetaTop = thetaTop, f0 = f0, fTop = fTop,
        cutupRatio = cutupRatio, f1pred = f1pred, cents = cents, hM = h, lcM = lc,
        jetRegime = jetRegime, flowRegime = flowRegime, phaseLagCoeff = phaseLagCoeff,
        flueLenIn = flueLenIn, flueDevRatio = flueDevRatio, edgeOffsetRatio = edgeOffsetRatio, rampSep = rampSep,
        chimRatio = chimRatio, supplyRatio = supplyRatio, bhFriction = bhFriction, fipDeg = fipDeg, backsetRatio = backsetRatio,
    )
}

data class FlowScorePart(val key: String, val value: Int, val weight: Int)
data class FlowQualityScore(val total: Int, val parts: List<FlowScorePart>)

/** Ported 1:1 from scoreFlowQuality(). */
fun scoreFlowQuality(m: AeroacousticsResult): FlowQualityScore {
    // 100 inside [lo,hi], linear falloff to 0 at [lo0,hi0].
    fun band(x: Double, lo0: Double, lo: Double, hi: Double, hi0: Double): Double = when {
        x <= lo0 || x >= hi0 -> 0.0
        x < lo -> 100 * (x - lo0) / (lo - lo0)
        x > hi -> 100 * (hi0 - x) / (hi0 - hi)
        else -> 100.0
    }

    val driveRoot = band(m.theta, 1.0, 5.0, 10.0, 16.0)
    val driveTop = band(m.thetaTop, 1.0, 5.0, 10.0, 16.0)
    val turb = if (m.re <= 1400) 100.0 else if (m.re >= 3800) 0.0 else 100 * (3800 - m.re) / (3800 - 1400)
    val strength = if (m.re >= 500) 100.0 else max(0.0, (100 * m.re) / 500)
    val breath = min(turb, strength)
    val cutup = band(m.cutupRatio, 1.5, 3.5, 6.5, 10.0)
    val tuning = max(0.0, 100 - abs(m.cents) * 0.8)
    val edge = band(m.edgeOffsetRatio, -0.15, 0.08, 0.42, 0.7)
    val flueDev = band(m.flueDevRatio, 0.15, 0.55, 3.5, 9.0)
    val rampQ = max(0.0, 100 - 140 * m.rampSep)
    val chimQ = band(m.chimRatio, -1.0, -0.5, 0.18, 0.85)
    val supply = min(band(m.supplyRatio, 0.6, 1.6, 40.0, 90.0), band(m.bhFriction, 1.0, 3.0, 13.0, 26.0))
    val fipQ = band(m.fipDeg, 8.0, 22.0, 46.0, 62.0)
    val backQ = band(m.backsetRatio, -1.0, -0.5, 0.85, 1.6)

    val total = round(
        0.20 * driveRoot + 0.09 * driveTop + 0.14 * breath + 0.11 * cutup +
            0.10 * edge + 0.08 * flueDev + 0.06 * rampQ + 0.05 * chimQ +
            0.07 * supply + 0.03 * fipQ + 0.02 * backQ + 0.05 * tuning,
    ).toInt()

    return FlowQualityScore(
        total = total.coerceIn(0, 100),
        parts = listOf(
            FlowScorePart("Jet drive — root note", round(driveRoot).toInt(), 20),
            FlowScorePart("Jet drive — top note", round(driveTop).toInt(), 9),
            FlowScorePart("Breath / turbulence", round(breath).toInt(), 14),
            FlowScorePart("Cut-up geometry", round(cutup).toInt(), 11),
            FlowScorePart("Splitting-edge offset", round(edge).toInt(), 10),
            FlowScorePart("Flue jet development", round(flueDev).toInt(), 8),
            FlowScorePart("Ramp smoothness", round(rampQ).toInt(), 6),
            FlowScorePart("Bird chimney voicing", round(chimQ).toInt(), 5),
            FlowScorePart("Breath-hole supply", round(supply).toInt(), 7),
            FlowScorePart("Fipple bevel", round(fipQ).toInt(), 3),
            FlowScorePart("Backset", round(backQ).toInt(), 2),
            FlowScorePart("Chamber tuning", round(tuning).toInt(), 5),
        ),
    )
}

data class NestSuggestion(val rampAngleDeg: Double, val fippleAngleDeg: Double, val shL: Double, val flueDepthIn: Double)

/**
 * Physics-driven nest optimizer: for this key + breath pressure, put the
 * jet-drive parameter mid-optimal (theta = 7) and the flue in the
 * clean-laminar Reynolds band, then nudge to keep the cut-up ratio inside
 * 3.5-6.5. Ported 1:1 from optimizeNestForDesign().
 */
fun optimizeNestForDesign(design: FlowDesign, pressurePa: Double): NestSuggestion {
    val u = sqrt(2 * max(1.0, pressurePa) / FlowAir.RHO)
    val f0 = if (design.rootFreq > 0) design.rootFreq else 370.0
    var shL = max(0.15, min((u / (7 * f0)) / IN2M, 0.5))
    var flue = max(0.02, min((950 * FlowAir.NU / u) / IN2M, 0.09))
    val ratio = shL / flue
    if (ratio > 6.5) flue = shL / 6.5 else if (ratio < 3.5) flue = shL / 3.5
    flue = max(0.02, min(flue, 0.09))
    return NestSuggestion(rampAngleDeg = 30.0, fippleAngleDeg = 35.0, shL = shL, flueDepthIn = flue)
}

data class OptimizeEverythingResult(
    val score: Int,
    val pressurePa: Double,
    val flueDepthIn: Double,
    val shL: Double,
    val flueLengthIn: Double,
    val tipHeightIn: Double,
    val rampAngleDeg: Double,
    val rampCurve: Double,
    val chimneyIn: Double,
    val backsetIn: Double,
    val fippleAngleDeg: Double,
)

private data class OptDim(val key: String, val lo: Double, val hi: Double, val isPressure: Boolean = false)

/**
 * Best OVERALL settings for the current design: a coordinate-descent search
 * over every nest control — breath pressure, flue depth & length, cut-up,
 * splitting-edge tip height, ramp angle & scoop, bird chimney, backset and
 * fipple bevel — maximizing the composite quality score. Ported 1:1 from
 * optimizeEverything(), including its 3-sweep x 11-sample coarse search
 * plus a fine refinement pass per control.
 */
fun optimizeEverything(design: FlowDesign): OptimizeEverythingResult {
    val bore = if (design.bore > 0) design.bore else 0.75
    val dims = listOf(
        OptDim("P", 120.0, 900.0, isPressure = true),
        OptDim("flueDepthIn", 0.02, 0.09),
        OptDim("shL", 0.15, 0.5),
        OptDim("flueLengthIn", 0.2, 1.6),
        OptDim("tipHeightIn", 0.0, 0.03),
        OptDim("rampAngleDeg", 15.0, 60.0),
        OptDim("rampCurve", 0.0, 1.0),
        OptDim("chimneyIn", 0.0, 0.12),
        OptDim("backsetIn", 0.0, bore / 3),
        OptDim("fippleAngleDeg", 20.0, 50.0),
    )

    val cur = HashMap<String, Double>()
    cur["P"] = 350.0
    cur["flueDepthIn"] = design.flueDepthIn.coerceIn(0.02, 0.09)
    cur["shL"] = design.shL.coerceIn(0.15, 0.5)
    cur["flueLengthIn"] = (design.flueLengthIn ?: 0.9).coerceIn(0.2, 1.6)
    cur["tipHeightIn"] = design.tipHeightIn.coerceIn(0.0, 0.03)
    cur["rampAngleDeg"] = design.rampAngleDeg.coerceIn(15.0, 60.0)
    cur["rampCurve"] = design.rampCurve.coerceIn(0.0, 1.0)
    cur["chimneyIn"] = design.chimneyIn.coerceIn(0.0, 0.12)
    cur["backsetIn"] = design.backsetIn.coerceIn(0.0, bore / 3)
    cur["fippleAngleDeg"] = design.fippleAngleDeg.coerceIn(20.0, 50.0)

    fun applied(vals: Map<String, Double>): FlowDesign = design.copy(
        flueDepthIn = vals["flueDepthIn"] ?: design.flueDepthIn,
        shL = vals["shL"] ?: design.shL,
        flueLengthIn = vals["flueLengthIn"] ?: design.flueLengthIn,
        tipHeightIn = vals["tipHeightIn"] ?: design.tipHeightIn,
        rampAngleDeg = vals["rampAngleDeg"] ?: design.rampAngleDeg,
        rampCurve = vals["rampCurve"] ?: design.rampCurve,
        chimneyIn = vals["chimneyIn"] ?: design.chimneyIn,
        backsetIn = vals["backsetIn"] ?: design.backsetIn,
        fippleAngleDeg = vals["fippleAngleDeg"] ?: design.fippleAngleDeg,
    )

    fun evalAt(vals: Map<String, Double>): Int {
        val m = computeFluteAeroacoustics(applied(vals), vals["P"] ?: cur.getValue("P"))
        return scoreFlowQuality(m).total
    }

    var bestSc = evalAt(cur)
    repeat(3) {
        for (d in dims) {
            var bv = cur.getValue(d.key)
            for (s in 0..10) {
                val v = d.lo + (d.hi - d.lo) * (s / 10.0)
                val trial = HashMap(cur); trial[d.key] = v
                val sc = evalAt(trial)
                if (sc > bestSc) { bestSc = sc; bv = v }
            }
            cur[d.key] = bv
            val fine = (d.hi - d.lo) / 10
            for (s in -4..4) {
                val v = (bv + s * fine / 5).coerceIn(d.lo, d.hi)
                val trial = HashMap(cur); trial[d.key] = v
                val sc = evalAt(trial)
                if (sc > bestSc) { bestSc = sc; cur[d.key] = v }
            }
        }
    }

    return OptimizeEverythingResult(
        score = bestSc, pressurePa = cur.getValue("P"), flueDepthIn = cur.getValue("flueDepthIn"),
        shL = cur.getValue("shL"), flueLengthIn = cur.getValue("flueLengthIn"), tipHeightIn = cur.getValue("tipHeightIn"),
        rampAngleDeg = cur.getValue("rampAngleDeg"), rampCurve = cur.getValue("rampCurve"), chimneyIn = cur.getValue("chimneyIn"),
        backsetIn = cur.getValue("backsetIn"), fippleAngleDeg = cur.getValue("fippleAngleDeg"),
    )
}

/** Inverse of the theta condition: the breath pressure that puts theta = 7 for the CURRENT cut-up. P = rho/2 * (7*f*l_c)^2 */
fun bestPressureForNest(design: FlowDesign): Double {
    val f0 = if (design.rootFreq > 0) design.rootFreq else 370.0
    val u = 7 * f0 * max(1e-4, design.shL * IN2M)
    return round(max(80.0, min((FlowAir.RHO / 2) * u * u, 2000.0)))
}
