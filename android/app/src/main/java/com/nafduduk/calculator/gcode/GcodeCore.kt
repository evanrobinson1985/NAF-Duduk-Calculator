package com.nafduduk.calculator.gcode

import com.nafduduk.calculator.engine.FingerHole
import com.nafduduk.calculator.engine.FluteConst
import com.nafduduk.calculator.engine.NestOverrides
import com.nafduduk.calculator.engine.ResolvedNest
import com.nafduduk.calculator.util.jsFmt
import java.time.LocalDate
import kotlin.math.max
import kotlin.math.min

/** The web source's `fmt(n, dec)`; see util/JsNumberFormat.kt for why this is not String.format. */
internal fun fmt(n: Double, dec: Int = 2): String = jsFmt(n, dec)

/**
 * Dialect note (ported verbatim from the web source): canned drilling
 * cycles (G81/G83) are NOT supported by GRBL, the most common hobby/DIY
 * controller — only by LinuxCNC, Mach3/4, Fanuc, and Siemens controls. To
 * guarantee the output actually runs on every dialect offered (including
 * GRBL), every drilling operation is generated as explicit rapid/feed move
 * sequences (peck drilling done by hand as repeated G0/G1 pairs) rather
 * than G81/G83 canned cycles.
 */
data class CncDialect(val label: String, val programEnd: String, val supportsCannedCycles: Boolean)

val CNC_DIALECTS: Map<String, CncDialect> = mapOf(
    "grbl" to CncDialect("GRBL (Shapeoko, X-Carve, most hobby routers)", "M30", false),
    "linuxcnc" to CncDialect("LinuxCNC / EMC2", "M2", true),
    "mach3" to CncDialect("Mach3 / Mach4", "M30", true),
    "generic" to CncDialect("Generic RS-274 (most hobby/prosumer CNC)", "M30", false),
)

fun gcodeHeader(dialect: String, units: String, title: String? = null, notes: List<String> = emptyList()): List<String> {
    val d = LocalDate.now().toString()
    val lines = mutableListOf<String>()
    lines.add("( ${title ?: "NAF Flute Calculator — CNC Program"} )")
    lines.add("( Generated $d — dialect: ${CNC_DIALECTS.getValue(dialect).label} )")
    notes.forEach { n -> lines.add("( $n )") }
    lines.add("( ⚠ SIMULATE THIS PROGRAM AND VERIFY ALL OFFSETS BEFORE CUTTING — )")
    lines.add("( ⚠ confirm stock size, work zero, and tool length by hand first. )")
    lines.add("G17 G90 G94") // XY plane, absolute distance, feed-per-minute
    lines.add(if (units == "mm") "G21" else "G20")
    lines.add("G54") // default work coordinate system
    return lines
}

fun gcodeFooter(dialect: String): List<String> = listOf(
    "M5 ( spindle off )",
    "G0 Z25 ( retract )",
    CNC_DIALECTS.getValue(dialect).programEnd,
)

fun toUnits(inches: Double, units: String): Double = if (units == "mm") inches * 25.4 else inches

/**
 * chamberYOffsets(): lateral (Y) offsets for multi-chamber (drone) flutes
 * in one blank — same wall-merged spacing as the 3D solid body — adjacent
 * walls merged by the wall-thickness dimension.
 */
fun chamberYOffsets(chambers: List<GcodeChamber>): List<Double> {
    fun wallTFor(cc: GcodeChamber): Double = ResolvedNest(cc.boreIn, cc.effShW, cc.nestOverrides).wallThicknessIn
    fun outerRFor(cc: GcodeChamber): Double = cc.boreIn / 2 + wallTFor(cc)

    val ys = mutableListOf<Double>()
    var y = 0.0
    chambers.forEachIndexed { i, cc ->
        if (i > 0) y += outerRFor(chambers[i - 1]) + outerRFor(cc) - max(wallTFor(chambers[i - 1]), wallTFor(cc))
        ys.add(y)
    }
    return ys
}

// Common fractional/numbered end mill and drill bit sizes (inches) — used to
// snap auto-computed tool diameters to something a person can actually buy/chuck.
val COMMON_BIT_SIZES_IN: List<Double> = listOf(
    0.03125, 0.046875, 0.0625, 0.078125, 0.09375, 0.109375, 0.125, 0.140625,
    0.15625, 0.171875, 0.1875, 0.203125, 0.21875, 0.25, 0.28125, 0.3125,
    0.34375, 0.375, 0.4375, 0.5,
)

fun snapToCommonBit(diameterIn: Double): Double =
    COMMON_BIT_SIZES_IN.reduce { a, b -> if (kotlin.math.abs(b - diameterIn) < kotlin.math.abs(a - diameterIn)) b else a }

data class EasyModeParams(
    val toolDiameter: Double,
    val feedRate: Double,
    val plungeRate: Double,
    val spindleSpeed: Double,
    val stepdown: Double,
    val peckDepth: Double,
    val safeHeight: Double = 0.5,
    val retractHeight: Double,
    val stockMarginX: Double = 0.5,
    val stockMarginY: Double,
    val channelStyle: String = "round",
    val setupMode: String = "rotary",
)

enum class GcodeMethod { SPLIT, TUBE }

/**
 * computeEasyModeParams(): derives a full parameter set from the flute's
 * own real dimensions rather than fixed defaults — "best options for the
 * most accurate result" for THIS specific build. Ported 1:1.
 */
fun computeEasyModeParams(chambers: List<GcodeChamber>, method: GcodeMethod): EasyModeParams {
    val bores = chambers.map { it.boreIn }
    val minBore = bores.min()
    val maxBore = bores.max()

    val allHoleDiams = chambers.flatMap { if (it.playable) it.holes.map { h -> h.diameterIn } else emptyList() }
    val allTsh = chambers.flatMap { listOf(it.shWIn, it.shLIn) }.filter { it > 0 }
    val smallestFeature = min(
        if (allHoleDiams.isNotEmpty()) allHoleDiams.min() else Double.POSITIVE_INFINITY,
        if (allTsh.isNotEmpty()) allTsh.min() else Double.POSITIVE_INFINITY,
    )

    val toolDiameter = if (method == GcodeMethod.SPLIT) {
        snapToCommonBit(max(0.03125, (minBore / 2) * 0.6))
    } else {
        snapToCommonBit(max(0.03125, smallestFeature * 0.65))
    }

    val feedRate = Math.round(max(15.0, min(80.0, toolDiameter * 220))).toDouble()
    val plungeRate = Math.round(feedRate * 0.3).toDouble()
    val spindleSpeed = Math.round(max(10000.0, min(24000.0, 24000 - toolDiameter * 24000))).toDouble()

    val stepdown = if (method == GcodeMethod.SPLIT) max(0.02, Math.round(toolDiameter * 0.4 * 1000) / 1000.0) else 0.06
    val peckDepth = if (method == GcodeMethod.TUBE) max(0.02, Math.round(smallestFeature * 0.35 * 1000) / 1000.0) else 0.05

    return EasyModeParams(
        toolDiameter = toolDiameter, feedRate = feedRate, plungeRate = plungeRate, spindleSpeed = spindleSpeed,
        stepdown = stepdown, peckDepth = peckDepth, retractHeight = max(0.05, peckDepth * 2),
        stockMarginY = max(0.25, maxBore),
    )
}

/** One chamber's G-code-export data — mirrors the fields the web source's generators read off `chambers`. */
data class GcodeChamber(
    val lengthIn: Double,
    val sacLenIn: Double,
    val boreIn: Double,
    val holes: List<FingerHole>,
    val playable: Boolean,
    val label: String,
    val shWIn: Double,
    val shLIn: Double,
    /** Nest voicing overrides; every field null means "use the bore-derived default". */
    val nestOverrides: NestOverrides = NestOverrides(),
    val breathHoleWidthIn: Double? = null,
    val breathHoleLengthIn: Double? = null,
) {
    val effShW get() = if (shWIn > 0) shWIn else FluteConst.soundHoleWidth(boreIn)
    val effShL get() = if (shLIn > 0) shLIn else FluteConst.soundHoleLength(boreIn)
    val effFlueLen get() = ResolvedNest(boreIn, effShW, nestOverrides).flueLengthIn
    val effFlueDepth get() = ResolvedNest(boreIn, effShW, nestOverrides).flueDepthIn
    val effBreathW get() = breathHoleWidthIn ?: FluteConst.breathHoleWidth(boreIn)
    val effBreathL get() = breathHoleLengthIn ?: FluteConst.breathHoleLength(boreIn)
}
