package com.nafduduk.calculator.gcode

import com.nafduduk.calculator.engine.Curve
import com.nafduduk.calculator.engine.FluteConst
import com.nafduduk.calculator.engine.ResolvedNest
import com.nafduduk.calculator.engine.curveBowAmplitudeIn
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.tan

/**
 * Split-block mating fit — ported 1:1 from SPLIT_FIT in the web source. Two
 * milled halves only seal airtight if they register to each other, so every
 * split-block program bores a shared set of alignment-dowel holes: the
 * largest pin the tool and stock margin will allow, snug in the bottom half
 * (glued), a slip fit in the top (so it can still be removed/repositioned
 * before gluing).
 */
object SplitFit {
    val pinSizes: List<Double> = listOf(0.5, 0.375, 0.25) // 1/2", 3/8", 1/4" — tried LARGEST first
    const val landClearance = 0.06 // extra stock-margin wall the pin hole must leave, inches
    const val slipClearance = 0.004 // per-side clearance in the TOP half (slip fit)
    const val snugClearance = 0.0 // bottom half bored on-size (snug / glued seat)
    const val minPinDepth = 0.30 // hole depth floor; deeper for bigger pins (≈1.25×Ø)
    const val maxPinDepth = 0.55 // …capped here so it stays well inside the stock
    const val endInset = 0.75 // first/last pin this far from the blank ends, inches
    const val maxSpacing = 6.0 // add pins so no two adjacent are farther apart than this
}

internal data class DrillRoundHoleParams(
    val label: String,
    val x: Double,
    val y: Double,
    val holeDia: Double,
    val depth: Double,
    val toolDiameter: Double,
    val units: String,
    val feedRate: Double,
    val plungeRate: Double,
    val safeHeight: Double,
    val retractHeight: Double,
    val zTop: Double = 0.0,
)

/**
 * Bores a round hole to an EXACT diameter with a (smaller) end mill using a
 * two-arc-per-revolution helical ramp — no canned cycles, so it runs on any
 * dialect and the viewer's arc parser renders it cleanly. If the tool is as
 * big as the hole, it peck-plunges instead. The hole diameter is what sets
 * the mating fit, so it's honored precisely rather than left at tool size.
 * Ported 1:1 from drillRoundHole() in the web source — distinct from
 * TubeDrillingGcode.kt's simple peck-drill helper, which only ever drills at
 * tool diameter.
 */
internal fun drillRoundHole(lines: MutableList<String>, p: DrillRoundHoleParams) {
    val zTop = p.zTop
    lines.add(
        "( -- ${p.label}: Ø${fmt(toUnits(p.holeDia, p.units), 4)}${p.units} at X${fmt(toUnits(p.x, p.units), 3)} " +
            "Y${fmt(toUnits(p.y, p.units), 3)}, ${fmt(toUnits(p.depth, p.units), 3)}${p.units} deep" +
            "${if (zTop != 0.0) " from Z${fmt(toUnits(zTop, p.units), 3)}" else ""} -- )",
    )
    lines.add("G0 Z${fmt(toUnits(p.safeHeight, p.units), 3)}")
    val helixR = (p.holeDia - p.toolDiameter) / 2
    if (helixR <= 0.0005) {
        lines.add("G0 X${fmt(toUnits(p.x, p.units), 3)} Y${fmt(toUnits(p.y, p.units), 3)}")
        lines.add("G0 Z${fmt(toUnits(zTop + p.retractHeight, p.units), 3)}")
        val peck = max(0.02, p.retractHeight)
        val pecks = max(1, ceil(p.depth / peck).toInt())
        for (i in 1..pecks) {
            val z = zTop - min(p.depth, i * peck)
            lines.add("G1 Z${fmt(toUnits(z, p.units), 3)} F${fmt(toUnits(p.plungeRate, p.units), 1)}")
            if (i < pecks) lines.add("G0 Z${fmt(toUnits(zTop + p.retractHeight, p.units), 3)} ( chip clear )")
        }
        lines.add("G0 Z${fmt(toUnits(p.safeHeight, p.units), 3)}")
        return
    }
    val startX = p.x + helixR // enter at the hole wall, 3 o'clock
    val oppX = p.x - helixR // 9 o'clock
    lines.add("G0 X${fmt(toUnits(startX, p.units), 3)} Y${fmt(toUnits(p.y, p.units), 3)}")
    lines.add("G0 Z${fmt(toUnits(zTop + p.retractHeight, p.units), 3)}")
    val loops = max(2, ceil(p.depth / 0.03).toInt()) // ~0.03" of plunge per revolution
    val dz = p.depth / loops
    for (i in 1..loops) {
        val zMid = zTop - min(p.depth, (i - 0.5) * dz)
        val zEnd = zTop - min(p.depth, i * dz)
        // revolution = two 180° CCW arcs about (x,y), descending as it goes
        lines.add(
            "G3 X${fmt(toUnits(oppX, p.units), 3)} Y${fmt(toUnits(p.y, p.units), 3)} Z${fmt(toUnits(zMid, p.units), 3)} " +
                "I${fmt(-toUnits(helixR, p.units), 4)} J0 F${fmt(toUnits(p.feedRate, p.units), 1)}",
        )
        lines.add(
            "G3 X${fmt(toUnits(startX, p.units), 3)} Y${fmt(toUnits(p.y, p.units), 3)} Z${fmt(toUnits(zEnd, p.units), 3)} " +
                "I${fmt(toUnits(helixR, p.units), 4)} J0 F${fmt(toUnits(p.feedRate, p.units), 1)}",
        )
    }
    // one flat finishing revolution at full depth to clean the wall
    lines.add(
        "G3 X${fmt(toUnits(oppX, p.units), 3)} Y${fmt(toUnits(p.y, p.units), 3)} " +
            "I${fmt(-toUnits(helixR, p.units), 4)} J0 F${fmt(toUnits(p.feedRate, p.units), 1)}",
    )
    lines.add(
        "G3 X${fmt(toUnits(startX, p.units), 3)} Y${fmt(toUnits(p.y, p.units), 3)} " +
            "I${fmt(toUnits(helixR, p.units), 4)} J0 F${fmt(toUnits(p.feedRate, p.units), 1)}",
    )
    lines.add("G0 Z${fmt(toUnits(p.safeHeight, p.units), 3)}")
}

/** Parameters for generateSplitBlockGCode() — mirrors the web source's params object 1:1. */
data class SplitBlockParams(
    val chambers: List<GcodeChamber>,
    val curve: Curve,
    val units: String,
    val toolDiameter: Double,
    val stepdown: Double,
    val feedRate: Double,
    val plungeRate: Double,
    val safeHeight: Double,
    val stockMarginX: Double,
    val stockMarginY: Double,
    val channelStyle: String, // "round" (ball-nose) | "flat"
    val dialect: String,
    val spindleSpeed: Double,
    val droneBody: String = "separate", // "separate" | "solid"
    val alignPins: Boolean = true,
    val outlinePass: String? = null, // null (off) | "scribe" | "cutout"
    // "symmetric" — the classic split at the bore axis (two identical blanks, top flipped for the nest).
    // "nest-insert" — the acoustic-nest architecture: a TALL lower half that carries the whole nest up to
    //                 the inner roof, and a thin upper SHELL whose rectangular through-window's downstream
    //                 edge is the splitting edge. No flip: each blank is cut single-sided. Single chamber.
    val splitStyle: String = "symmetric",
    // Which program to emit: "halves" (both blanks, seam face up) | "nest" (top blank flipped, own work
    // zero) | "all" (everything in one file, with a STOCK-FLIP marker so the viewer can animate it).
    val only: String = "all",
)

internal data class NestCalc(
    val r: Double,
    val wallT: Double,
    val shW: Double,
    val shL: Double,
    val flueL: Double,
    val flueD: Double,
    val rampDeg: Double,
    val rampCurve: Double,
    val fippleDeg: Double,
    val backset: Double,
    val overshoot: Double,
    val tshCutDepth: Double,
    val tipHeight: Double,
    val tipFlat: Double,
    val xTsh0: Double,
    val xTsh1: Double,
    val xFlue0: Double,
    val xExit0: Double,
    val xExit1: Double,
    val xBlockEnd: Double,
    val xRampBase: Double,
    val rampRun: Double,
)

/**
 * Per-chamber nest dimensions. The override-or-formula resolution lives in
 * engine/NestOverrides.kt and is shared with the 3D preview
 * (mesh/ChamberMeshBuilder.kt) — it was written out twice before, which is
 * exactly how a preview starts showing one nest while the machine cuts
 * another. The X stations below are this generator's own.
 */
internal fun computeNest(c: GcodeChamber): NestCalc {
    val r = c.boreIn / 2
    val shW = if (c.shWIn > 0) c.shWIn else FluteConst.soundHoleWidth(c.boreIn)
    val shL = if (c.shLIn > 0) c.shLIn else FluteConst.soundHoleLength(c.boreIn)
    val n = ResolvedNest(c.boreIn, shW, c.nestOverrides)
    val wallT = n.wallThicknessIn
    val flueL = n.flueLengthIn
    val flueD = n.flueDepthIn
    val rampDeg = n.rampAngleDeg
    val rampCurve = n.rampCurve
    val fippleDeg = n.fippleAngleDeg
    val backset = n.backsetIn
    val overshoot = max(0.03, r * 0.08)
    val tshCutDepth = wallT + overshoot // from the outer apex, through the wall into the bore
    val tipHeight = n.tipHeightIn
    val tipFlat = n.tipFlatIn
    // ── Nest stations along X (0 = mouth end of the blank) ──────────
    //   ...SAC... [ramp ↗] [BLOCK: solid wall] | TSH window | ...bore...
    val xTsh0 = c.sacLenIn
    val xTsh1 = c.sacLenIn + shL
    val xFlue0 = xTsh0 - flueL // flue entrance = block leading edge
    val xExit1 = xFlue0 // SAC exit opening ends here
    val xExit0 = max(0.0, xExit1 - shL) // SAC ceiling stops one TSH-length before the bird
    val xBlockEnd = xTsh0 - backset // block's downstream face (bore reaches back under the flue)
    val rampRun = min(r / tan(rampDeg * PI / 180), max(0.15, c.sacLenIn * 0.7))
    val xRampBase = max(0.0, xExit1 - rampRun)
    return NestCalc(
        r, wallT, shW, shL, flueL, flueD, rampDeg, rampCurve, fippleDeg, backset, overshoot,
        tshCutDepth, tipHeight, tipFlat, xTsh0, xTsh1, xFlue0, xExit0, xExit1, xBlockEnd, xRampBase, rampRun,
    )
}

internal fun stockLine(label: String, x: Double, y: Double, z: Double, lx: Double, ly: Double, lz: Double, units: String): String =
    "( STOCK-BLOCK label=$label x=${fmt(toUnits(x, units), 3)} y=${fmt(toUnits(y, units), 3)} z=${fmt(toUnits(z, units), 3)} " +
        "lx=${fmt(toUnits(lx, units), 3)} ly=${fmt(toUnits(ly, units), 3)} lz=${fmt(toUnits(lz, units), 3)} )"

/**
 * Ported 1:1 from generateSplitBlockGCode() in the web source: mills the
 * full acoustic nest into two half-blanks that glue together into a solid
 * body, rather than drilling into an already-round tube (that's
 * TubeDrillingGcode.kt's job). Two independent architectures, selected by
 * `splitStyle`:
 *
 * - "nest-insert" (the default in the web app): a TALL lower blank carries
 *   the whole nest (ramp, flue floor, SAC exit) faced up to the inner roof,
 *   and a thin upper SHELL carries a rectangular through-window whose
 *   downstream edge is the splitting edge. No flip — each blank is cut
 *   single-sided.
 * - "symmetric": the classic split at the bore axis — two identical blanks,
 *   the top later flipped for the nest side. This mode is deliberately
 *   "basic drilled layout, hand-finish": only the SAC and the full bore are
 *   cut at true design size; every other feature (blow hole, finger holes,
 *   flue, air-exit hole, TSH) is cut HAND_FINISH_UNDERSIZE_IN smaller than
 *   designed as a locating reference; the ramp and the splitting edge are
 *   not machined at all.
 */
fun generateSplitBlockGCode(p: SplitBlockParams): String {
    val chambers = p.chambers
    val stockMarginX = p.stockMarginX
    val stockMarginY = p.stockMarginY
    val droneBody = p.droneBody
    val splitStyle = p.splitStyle

    val bowAmp = curveBowAmplitudeIn(p.curve)
    val lines = mutableListOf<String>()
    val maxLen = chambers.maxOf { it.sacLenIn + it.lengthIn }
    val oneBlank = chambers.size > 1 && droneBody == "solid"
    // ── HANDEDNESS ── The 3D model stacks chambers along +Z with the nest
    // facing +Y; the machined assembly ends nest-up on the table with its
    // layout along +Y. Viewed from the NEST side with the mouth to the
    // left, model +Z runs DOWN-screen but table +Y runs UP-screen — so
    // mapping the offsets with the same sign built the MIRROR of the
    // modelled flute (drone on the player's wrong side). The table layout
    // must run OPPOSITE to the model stack: mirror the offsets in-span.
    val yOffsAsc = if (oneBlank) chamberYOffsets(chambers) else chambers.map { 0.0 }
    val yOffs = yOffsAsc.map { yOffsAsc.last() - it }
    val blankWidth = if (oneBlank) {
        val maxV = yOffs.indices.maxOf { i -> yOffs[i] + chambers[i].boreIn / 2 }
        val minV = yOffs.indices.minOf { i -> yOffs[i] - chambers[i].boreIn / 2 }
        maxV - minV + 2 * stockMarginY
    } else {
        chambers.maxOf { it.boreIn } + 2 * stockMarginY
    }
    val blankLen = maxLen + 2 * stockMarginX // the symmetric branch grows its own copy to carry the mouthpiece

    val nest = chambers.map { computeNest(it) }

    // ══════════════════════════════════════════════════════════════════
    //  NEST-INSERT ARCHITECTURE (acoustic-nest split) — single chamber
    // ══════════════════════════════════════════════════════════════════
    if (splitStyle == "nest-insert") {
        return generateNestInsertGCode(p, chambers, nest, bowAmp, lines)
    }

    // ── SYMMETRIC SPLIT AT THE BORE AXIS ──────────────────────────────
    return generateSymmetricSplitGCode(p, chambers, nest, bowAmp, lines, maxLen, oneBlank, yOffs, blankWidth, blankLen)
}
