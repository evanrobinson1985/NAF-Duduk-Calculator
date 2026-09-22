package com.nafduduk.calculator.gcode

import com.nafduduk.calculator.engine.FluteConst
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tan

private data class NiRamp(
    val xBase: Double,
    val rise: Double,
    val zTopRel: Double,
    val relAt: (Double) -> Double,
    val xAtRel: (Double) -> Double,
    val seamX: Double,
    val steepened: Boolean,
    val actualDeg: Double,
    val blowReserve: Double,
)

/**
 * NEST-INSERT ARCHITECTURE (acoustic-nest split) — single-piece body.
 * Ported 1:1 from the `splitStyle === "nest-insert"` branch of
 * generateSplitBlockGCode() in the web source.
 *
 * A TALL lower half carries the whole nest; a thin upper SHELL carries a
 * rectangular through-window whose downstream edge is the splitting edge.
 * Section along the flute (mouth left):
 *
 *    UPPER SHELL  (r+wall)   top-half bore + finger holes + WINDOW ────┐
 *    == seam @ bore axis ==========================   (through)  labium┘
 *    LOWER NEST   (2r+wall)  bottom-half bore + ramp + flue + SAC-exit
 *                            nest ridge follows the roof radius
 *
 * Lower half, Z0 = the roof (nest peak):  roof 0 · axis -r · floor -2r
 * Upper half, Z0 = the seam (bore axis):  axis 0 · roof -r · outer -(r+wall)
 * No flip: each blank is cut in ONE face-up setup.
 */
internal fun generateNestInsertGCode(
    p: SplitBlockParams,
    chambers: List<GcodeChamber>,
    nest: List<NestCalc>,
    bowAmp: Double,
    lines: MutableList<String>,
): String {
    val units = p.units
    val toolDiameter = p.toolDiameter
    val stepdown = p.stepdown
    val feedRate = p.feedRate
    val plungeRate = p.plungeRate
    val safeHeight = p.safeHeight
    val stockMarginX = p.stockMarginX
    val stockMarginY = p.stockMarginY
    val channelStyle = p.channelStyle
    val dialect = p.dialect
    val spindleSpeed = p.spindleSpeed
    val alignPins = p.alignPins
    val outlinePass = p.outlinePass
    val only = p.only

    // ── LANES ── chambers sit side-by-side in the SAME two blanks (one-piece
    // body), each on its own Y lane, mirrored in-span exactly like the
    // symmetric one-blank layout so the assembly matches the 3D model.
    val laneAsc = chamberYOffsets(chambers)
    val lane = laneAsc.map { laneAsc.last() - it }
    val rMax = nest.maxOf { it.r }
    val dropMax = nest.maxOf { it.r + it.wallT }
    val zSeam = -rMax // the bore-axis plane in LOWER-blank Z (Z0 = tallest ridge peak)
    val Tlow = rMax + dropMax // lower/nest blank thickness (single chamber: 2r + wall)
    val Tup = dropMax // upper/shell blank thickness (single chamber: r + wall)
    val yMinB = lane.indices.minOf { i -> lane[i] - chambers[i].boreIn / 2 } - stockMarginY
    val yMaxB = lane.indices.maxOf { i -> lane[i] + chambers[i].boreIn / 2 } + stockMarginY
    val bw = yMaxB - yMinB
    val yMidLanes = (lane.min() + lane.max()) / 2
    val tableGap = 0.6
    val yTableShift = (yMaxB - yMinB) + tableGap // shell blank sits this far up in +Y
    val wantLower = only != "nest" // Operation A — lower nest blank
    val wantUpper = only != "halves" // Operation B — upper shell blank
    fun totalLenOf(cc: GcodeChamber) = cc.sacLenIn + cc.lengthIn
    val maxLenNI = chambers.maxOf { totalLenOf(it) }
    val step = max(0.01, toolDiameter * 0.4)
    val toolR = toolDiameter / 2
    val ballR = if (channelStyle == "round") toolR else 0.0
    val retract = min(0.15, max(0.05, safeHeight / 3))
    fun bow(x: Double): Double = if (bowAmp == 0.0) 0.0 else bowAmp * sin((x / maxLenNI) * PI)

    // ── SHARED MOUTHPIECE / CONVERGING BLOW CHANNELS ── same rules as the
    // symmetric layout: every chamber breathes through its OWN channel from
    // its inlet slot to its SAC lane; inlets are assigned by SAC Y rank so
    // the fan never crosses itself; adjacent holes are auto-reduced if they'd
    // meet with less than a wood web between them.
    val bhWs = chambers.map { c -> c.breathHoleWidthIn ?: FluteConst.breathHoleWidth(c.boreIn) }.toMutableList()
    val bhLs = chambers.map { c -> c.breathHoleLengthIn ?: FluteConst.breathHoleLength(c.boreIn) }
    val MOUTH_EDGE_GAP = 0.10
    val converge = chambers.size > 1
    var bhScaleNote: String? = null
    if (converge) {
        var f = 1.0
        for (i in 0 until chambers.size - 1) {
            val centerDist = abs(lane[i + 1] - lane[i])
            val need = (bhWs[i] + bhWs[i + 1]) / 2
            val avail = centerDist - 0.06
            if (avail > 0.02 && need > avail) f = min(f, avail / need)
        }
        if (f < 0.999) {
            for (i in bhWs.indices) bhWs[i] = max(0.12, bhWs[i] * f)
            bhScaleNote = "BREATH HOLES AUTO-REDUCED x${fmt(f, 2)} (to Ø${bhWs.joinToString("/") { fmt(toUnits(it, units), 3) }}$units) so adjacent blow channels keep a solid wood web — every chamber breathes through its OWN separate channel."
        }
    }
    val mouthYs: List<Double> = if (!converge) {
        chambers.indices.map { i -> lane[i] }
    } else {
        val rank = chambers.indices.sortedBy { lane[it] }
        val spread = bhWs.sum() + MOUTH_EDGE_GAP * (chambers.size - 1)
        val slots = DoubleArray(chambers.size)
        var yCur = yMidLanes - spread / 2
        rank.forEach { i -> slots[i] = yCur + bhWs[i] / 2; yCur += bhWs[i] + MOUTH_EDGE_GAP }
        slots.toList()
    }
    val convergeRun = chambers.indices.map { i ->
        val c = chambers[i]
        val dy = abs(lane[i] - mouthYs[i])
        min(max(bhLs[i], dy * 2.75), max(bhLs[i], c.sacLenIn * 0.45))
    }
    // mouthpiece plan outline: wide enough to span every lane AND every inlet
    val mpR = dropMax
    val mpHalfW = (lane.max() - lane.min()) / 2 + mpR
    val mpSpreadHalf = (if (converge) mouthYs.maxOf { abs(it - yMidLanes) } else 0.0) + bhWs.max() * 0.5
    val mpTipW = min(0.92, max(0.4, (mpSpreadHalf + 0.05) / mpHalfW)) // never narrower than the blow holes
    fun mpProf(t: Double): Double = Math.pow(cos(t * PI / 2), 0.62)
    val mpDomeLen = max(0.5, mpR * 1.5)
    val mpCapLen = mpDomeLen * 0.3
    fun mpWidthAt(x: Double): Double {
        val d = -x
        return when {
            d <= 0 -> mpHalfW
            d <= mpDomeLen -> mpHalfW * (mpTipW + (1 - mpTipW) * mpProf(d / mpDomeLen))
            d <= mpDomeLen + mpCapLen -> mpHalfW * mpTipW * cos(asin(min(1.0, (d - mpDomeLen) / mpCapLen)))
            else -> 0.0
        }
    }
    val mpFront = mpDomeLen + mpCapLen + max(0.15, toolDiameter)
    val xBlank0 = -mpFront
    val blankLenNI = maxLenNI + mpFront + stockMarginX
    val xInlet = -(mpDomeLen + mpCapLen) - max(0.1, toolDiameter / 2)
    // Y mappers. Lower lanes as laid out. The shell is turned over ONCE at
    // glue-up — a physical flip mirrors about the BLANK's own midline (not
    // the lane midline: with unequal bores those differ), so the shell's
    // features must be pre-mirrored about the blank midline to land on the
    // lower lanes after the flip.
    val yMirror = (yMinB + yMaxB) / 2
    fun yLowAt(ci: Int, x: Double): Double = lane[ci] + bow(x)
    fun yUpAt(ci: Int, x: Double): Double = yTableShift + 2 * yMirror - lane[ci] - bow(x)

    // ── NEST-INSERT RAMP GEOMETRY, per chamber ── see the web source's
    // comment on niRamp: the ramp climbs from the SAC BORE FLOOR all the way
    // UP TO THE FLUE FLOOR (rise = 2r − flueD). Above the seam it narrows to
    // a throat-width tongue. A straight ramp is linear; a CURVED ramp uses
    // the same scoop bezier the 3D preview lofts, scaled to the full rise —
    // and its inverse drives the level clipping, so the bore sweep hugs the
    // true scoop, not a chord. The ramp must NEVER consume the room the
    // blow-channel convergence needs upstream of it, so it will steepen
    // (same rise, less run) rather than crowd that room.
    val niRamp: List<NiRamp> = chambers.mapIndexed { ci, c2 ->
        val n2 = nest[ci]
        val r2 = n2.r
        val rise = 2 * r2 - n2.flueD
        val zTopRel = r2 - n2.flueD
        val runWant = rise / tan(max(4.0, n2.rampDeg) * PI / 180)
        val blowReserve = max(0.25, FluteConst.breathHoleLength(c2.boreIn) * 0.6)
        val maxRun = max(0.05, n2.xExit1 - blowReserve)
        val run = min(runWant, min(max(0.15, c2.sacLenIn * 0.7), maxRun))
        val steepened = run < runWant - 1e-4
        val xBase = max(0.0, n2.xExit1 - run)
        val lut: List<DoubleArray>? = if (n2.rampCurve <= 0.01) {
            null
        } else {
            val x0b = xBase; val x1b = n2.xExit1; val z0b = -r2; val z1b = zTopRel
            val mxb = (x0b + x1b) / 2; val mzb = (z0b + z1b) / 2
            val cxb = mxb + n2.rampCurve * (x1b - mxb) // → downstream corner
            val czb = mzb + n2.rampCurve * (z0b - mzb) // → bottom corner (concave scoop)
            (0..96).map { i ->
                val t = i / 96.0; val u = 1 - t
                doubleArrayOf(u * u * x0b + 2 * u * t * cxb + t * t * x1b, u * u * z0b + 2 * u * t * czb + t * t * z1b)
            } // monotonic in x and z
        }
        fun relAt(x: Double): Double { // seam-relative: -r → (r − flueD)
            if (x <= xBase) return -r2
            if (x >= n2.xExit1) return zTopRel
            if (lut == null) return -r2 + (x - xBase) * (rise / max(1e-6, n2.xExit1 - xBase))
            for (i in 1 until lut.size) {
                val a = lut[i - 1]; val b = lut[i]
                if (x <= b[0]) return a[1] + (b[1] - a[1]) * ((x - a[0]) / max(1e-9, b[0] - a[0]))
            }
            return zTopRel
        }
        fun xAtRel(zRel: Double): Double { // deepest X reachable at a level
            if (zRel >= zTopRel) return n2.xExit1
            if (zRel <= -r2) return xBase
            if (lut == null) return xBase + (zRel + r2) * (n2.xExit1 - xBase) / max(1e-6, rise)
            for (i in 1 until lut.size) {
                val a = lut[i - 1]; val b = lut[i]
                if (zRel <= b[1]) return a[0] + (b[0] - a[0]) * ((zRel - a[1]) / max(1e-9, b[1] - a[1]))
            }
            return n2.xExit1
        }
        val actualDeg = Math.atan(rise / max(1e-6, run)) * 180 / PI
        NiRamp(xBase, rise, zTopRel, ::relAt, ::xAtRel, xAtRel(0.0), steepened, actualDeg, blowReserve)
    }

    lines.addAll(
        gcodeHeader(
            dialect, units,
            title = when (only) {
                "halves" -> "Split-Body NEST INSERT — SETUP 1/2: LOWER NEST blank (nest face up)"
                "nest" -> "Split-Body NEST INSERT — SETUP 2/2: UPPER SHELL blank (seam face up)"
                else -> "Split-Body NEST INSERT — tall lower nest + upper shell window (no flip)"
            },
            notes = buildList {
                add(
                    "TABLE LAYOUT: two DIFFERENT-size blanks. LOWER (nest): ${fmt(toUnits(blankLenNI, units), 2)} × " +
                        "${fmt(toUnits(bw, units), 2)} × ${fmt(toUnits(Tlow, units), 2)} $units (bore-axis plane + tallest nest " +
                        "ridge, ~twice a symmetric half). UPPER (shell): ${fmt(toUnits(blankLenNI, units), 2)} × " +
                        "${fmt(toUnits(bw, units), 2)} × ${fmt(toUnits(Tup, units), 2)} $units at +Y${fmt(toUnits(yTableShift, units), 2)}$units.",
                )
                add(
                    "Z ZERO: each blank on its OWN top face. Each blank is machined FACE-UP in ONE setup — NO flip " +
                        "during machining. The upper shell is turned over ONCE at glue-up to seat on the lower nest.",
                )
                add(
                    "LOWER NEST HALF: the whole top is FACED DOWN to the seam (bore-axis) plane, ${fmt(toUnits(rMax, units), 3)}$units " +
                        "below the stock top — only the nest ridge islands are left standing, one per chamber, shaped to " +
                        "each chamber's inner roof radius. It carries the bottom-half bores, ramps, flue floors and SAC exits.",
                )
                add(
                    "UPPER SHELL HALF: top-half bores, finger holes, and one FULL rectangular THROUGH-WINDOW per chamber " +
                        "— the whole nest opening, SAC exit → splitting edge. The nest ridge rises through it from below: " +
                        "the plateau (flue floor) sits exposed in the window, and the BIRD straps over the opening to roof " +
                        "the flue — classic NAF anatomy with the nest carried by the lower half. The window's DOWNSTREAM " +
                        "edge is the SPLITTING EDGE with its bevel; the jet leaves the flue under the bird, crosses the " +
                        "sound-window gap, and splits on that edge.",
                )
                if (chambers.size > 1) {
                    add(
                        "MULTI-CHAMBER: ${chambers.size} chambers side-by-side in the SAME two blanks — nest-insert builds " +
                            "a ONE-PIECE body (the separate-pipes drone option applies to the other layouts). The blow " +
                            "channels angle inward to ONE shared mouthpiece, inlets ${fmt(toUnits(MOUTH_EDGE_GAP, units), 2)}$units " +
                            "apart edge-to-edge, fanned by SAC rank so no channel ever crosses another.",
                    )
                }
                if (niRamp.any { it.steepened }) {
                    val list = niRamp.mapIndexedNotNull { i, nr ->
                        if (nr.steepened) "chamber ${i + 1} (~${fmt(nr.actualDeg, 1)}°, requested ${fmt(nest[i].rampDeg, 1)}°)" else null
                    }.joinToString(", ")
                    add(
                        "⚠ RAMP STEEPENED on $list: the design-angle run would have crowded the blow channel's convergence " +
                            "room (or run past X0). The ramp still climbs the full bore-floor→flue-floor rise, just over less " +
                            "horizontal run — steeper, not shorter. Lengthen the SAC (the slider on the Flute page) or lower " +
                            "the ramp angle if you want the requested angle back exactly.",
                    )
                }
                bhScaleNote?.let { add(it) }
                if (outlinePass == "cutout") {
                    add(
                        "BODY-OUTLINE FULL CUTOUT ENABLED: the job ends by profile-cutting the finished body's plan " +
                            "silhouette clear THROUGH BOTH blanks (mitered cutter compensation), with 6 tabs per blank " +
                            "keeping each half attached to the pin-bearing waste rails through glue-up.",
                    )
                }
                if (outlinePass == "scribe") {
                    add(
                        "BODY-OUTLINE SCRIBE requested but NOT APPLICABLE to the nest-insert split (both machined faces " +
                            "are glue faces, so a scribed groove would be hidden inside the glue-up) — switch to FULL " +
                            "CUTOUT for a machined outline.",
                    )
                }
                if (only == "all") {
                    add(
                        "THIS COMBINED FILE cuts both blanks in one stream for the viewer. To run it as one job, SHIM " +
                            "the upper (shell) blank up by ${fmt(toUnits(Tlow - Tup, units), 3)}$units so both top faces are " +
                            "coplanar — OR run the two setup files instead, each zeroed on its own blank.",
                    )
                }
                if (only == "halves") add("SETUP 1 OF 2 — the LOWER NEST blank only. Run the UPPER SHELL file next.")
                if (only == "nest") add("SETUP 2 OF 2 — the UPPER SHELL blank only. Zero Z on its own top face.")
                add(
                    "Tool: ${fmt(toUnits(toolDiameter, units), 3)} $units " +
                        "${if (channelStyle == "round") "BALL-NOSE (the bores and the curved nest ridges want it)" else "flat end mill"}.",
                )
                add(
                    "VERIFY IN THE VIEWER before cutting stock — confirm the faced seam plane, the standing ridge " +
                        "islands, and each ramp→flue→window relationship in the material simulation.",
                )
            },
        ),
    )

    if (wantLower) lines.add(stockLine("lower-nest", xBlank0, yMinB, -Tlow, blankLenNI, bw, Tlow, units))
    if (wantUpper) lines.add(stockLine("upper-shell", xBlank0, yMinB + yTableShift, -Tup, blankLenNI, bw, Tup, units))
    lines.add("S${spindleSpeed.roundToInt()} M3 ( spindle on )")

    // ── helpers ──
    fun sweepHalfRound(x0: Double, x1: Double, rad: Double, zCeil: Double, yCof: (Double) -> Double, xLimitFn: ((Double) -> Double)? = null) {
        if (x1 <= x0 + 1e-6 || rad <= 0) return
        val levels = max(1, ceil(rad / stepdown).toInt())
        for (lv in 1..levels) {
            val d = min(rad, lv * (rad / levels))
            val w = sqrt(max(0.0, rad * rad - d * d))
            val reach = max(0.0, w - toolR)
            val xEnd = if (xLimitFn != null) min(x1, xLimitFn(-d)) else x1
            if (xEnd <= x0 + 1e-6) continue
            val passes = max(1, ceil((2 * reach) / step).toInt() + 1)
            for (pI in 0 until passes) {
                val yo = if (passes == 1) 0.0 else -reach + (2 * reach) * (pI.toDouble() / (passes - 1))
                lines.add("G0 X${fmt(toUnits(x0, units), 3)} Y${fmt(toUnits(yCof(x0) + yo, units), 3)} Z${fmt(toUnits(retract, units), 3)}")
                lines.add("G1 Z${fmt(toUnits(zCeil - d, units), 3)} F${fmt(toUnits(plungeRate, units), 1)}")
                val steps = max(2, Math.round(40 * (xEnd - x0) / max(1e-6, maxLenNI)).toInt() + 2)
                for (s in 1..steps) {
                    val x = x0 + (xEnd - x0) * (s.toDouble() / steps)
                    lines.add("G1 X${fmt(toUnits(x, units), 3)} Y${fmt(toUnits(yCof(x) + yo, units), 3)} F${fmt(toUnits(feedRate, units), 1)}")
                }
                lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
            }
        }
        if (ballR > 0 && rad > ballR) {
            val arcs = max(3, ceil((PI * rad) / step).toInt())
            for (a in 0..arcs) {
                val th = -PI / 2 + PI * (a.toDouble() / arcs)
                val yo = (rad - ballR) * sin(th)
                val zr = zCeil - ((rad - ballR) * cos(th) + ballR)
                val xEnd = if (xLimitFn != null) min(x1, xLimitFn(zr - zCeil)) else x1
                if (xEnd <= x0 + 1e-6) continue
                lines.add("G0 X${fmt(toUnits(x0, units), 3)} Y${fmt(toUnits(yCof(x0) + yo, units), 3)} Z${fmt(toUnits(retract, units), 3)}")
                lines.add("G1 Z${fmt(toUnits(zr, units), 3)} F${fmt(toUnits(plungeRate, units), 1)}")
                val steps = max(2, Math.round(40 * (xEnd - x0) / max(1e-6, maxLenNI)).toInt() + 2)
                for (s in 1..steps) {
                    val x = x0 + (xEnd - x0) * (s.toDouble() / steps)
                    lines.add("G1 X${fmt(toUnits(x, units), 3)} Y${fmt(toUnits(yCof(x) + yo, units), 3)} F${fmt(toUnits(feedRate, units), 1)}")
                }
                lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
            }
        }
    }
    fun pocket(x0: Double, x1: Double, wide: Double, zTop: Double, zBot: Double, yCof: (Double) -> Double, label: String? = null) {
        if (x1 <= x0 + 1e-6 || zBot >= zTop - 1e-6) return
        if (label != null) lines.add("( -- $label -- )")
        val reach = max(0.0, wide / 2 - toolR)
        val passes = max(1, ceil((2 * reach) / step).toInt() + 1)
        val depth = zTop - zBot
        val levels = max(1, ceil(depth / stepdown).toInt())
        for (lv in 1..levels) {
            val z = zTop - min(depth, lv * (depth / levels))
            for (pI in 0 until passes) {
                val yo = if (passes == 1) 0.0 else -reach + (2 * reach) * (pI.toDouble() / (passes - 1))
                lines.add("G0 X${fmt(toUnits(x0, units), 3)} Y${fmt(toUnits(yCof(x0) + yo, units), 3)} Z${fmt(toUnits(retract, units), 3)}")
                lines.add("G1 Z${fmt(toUnits(z, units), 3)} F${fmt(toUnits(plungeRate, units), 1)}")
                val steps = max(2, Math.round((x1 - x0) / 0.06).toInt() + 1)
                for (s in 1..steps) {
                    val x = x0 + (x1 - x0) * (s.toDouble() / steps)
                    lines.add("G1 X${fmt(toUnits(x, units), 3)} Y${fmt(toUnits(yCof(x) + yo, units), 3)} F${fmt(toUnits(feedRate, units), 1)}")
                }
                lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
            }
        }
    }

    // ══ OPERATION A — LOWER NEST BLANK (Z0 = stock top = tallest ridge peak) ══
    if (wantLower) {
        lines.add("")
        lines.add("( ══════════ OPERATION A — LOWER NEST BLANK (tall blank, nest face up) ══════════ )")
        // A1. FACE the whole top down to the seam (bore-axis) plane, leaving one
        //     rectangular ridge island per chamber over its nest zone — PLUS the
        //     ramp TONGUE: where the ramp has climbed above the seam upstream of
        //     the ridge front, a throat-width strip is left standing too.
        lines.add("( -- FACE to the seam plane Z${fmt(toUnits(zSeam, units), 3)} — nest ridge islands + ramp tongues left standing -- )")
        run {
            data class Keep(val x0: Double, val x1: Double, val yHalf: Double, val yC: Double, val topZ: Double)
            val keeps = chambers.indices.flatMap { ci ->
                listOf(
                    Keep(
                        x0 = nest[ci].xExit0 - toolR, x1 = nest[ci].xTsh0 + toolR,
                        yHalf = nest[ci].r + toolR, yC = lane[ci],
                        topZ = zSeam + nest[ci].r, // this chamber's roof peak
                    ),
                    // the ramp tongue: above-seam climb upstream of the ridge front,
                    // throat width only (its flanks were faced; the ramped slot
                    // clearing shapes its top)
                    Keep(
                        x0 = niRamp[ci].seamX - toolR, x1 = nest[ci].xExit0,
                        yHalf = nest[ci].shW / 2 + toolR, yC = lane[ci],
                        topZ = zSeam + niRamp[ci].zTopRel,
                    ),
                )
            }.filter { it.x1 > it.x0 + 1e-6 }
            val levels = max(1, ceil(rMax / stepdown).toInt())
            val yScan0 = yMinB + toolR * 0.5
            val yScan1 = yMaxB - toolR * 0.5
            val nScan = max(2, ceil((yScan1 - yScan0) / step).toInt() + 1)
            for (lv in 1..levels) {
                val z = -min(rMax, lv * (rMax / levels))
                for (sy in 0 until nScan) {
                    val y = yScan0 + (yScan1 - yScan0) * (sy.toDouble() / (nScan - 1))
                    // blocked X spans at this (y, z): ridge islands whose lane the
                    // scanline crosses AND whose material this level would bite into
                    val blocks = keeps
                        .filter { abs(y - it.yC) < it.yHalf && z <= it.topZ + 1e-6 }
                        .map { doubleArrayOf(it.x0, it.x1) }
                        .sortedBy { it[0] }
                    // Stop at the flute's own downstream end (maxLenNI), NOT the
                    // stock's full length — same reasoning upstream (the mouthpiece
                    // dome/cap, not the clamping margin). See the web source's
                    // comment: both halves leave the stock margin equally untouched,
                    // ready to be trimmed off together after glue-up.
                    var segs = mutableListOf(doubleArrayOf(max(xBlank0, -(mpDomeLen + mpCapLen)), min(xBlank0 + blankLenNI, maxLenNI)))
                    blocks.forEach { blk ->
                        val b0 = blk[0]; val b1 = blk[1]
                        val out = mutableListOf<DoubleArray>()
                        segs.forEach { seg ->
                            val s0 = seg[0]; val s1 = seg[1]
                            if (b1 <= s0 || b0 >= s1) {
                                out.add(seg)
                            } else {
                                if (b0 > s0) out.add(doubleArrayOf(s0, b0))
                                if (b1 < s1) out.add(doubleArrayOf(b1, s1))
                            }
                        }
                        segs = out
                    }
                    segs.forEach { seg ->
                        val s0 = seg[0]; val s1 = seg[1]
                        if (s1 - s0 >= toolDiameter * 0.5) {
                            lines.add("G0 X${fmt(toUnits(s0, units), 3)} Y${fmt(toUnits(y, units), 3)} Z${fmt(toUnits(retract, units), 3)}")
                            lines.add("G1 Z${fmt(toUnits(z, units), 3)} F${fmt(toUnits(plungeRate, units), 1)}")
                            lines.add("G1 X${fmt(toUnits(s1, units), 3)} F${fmt(toUnits(feedRate, units), 1)}")
                            lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
                        }
                    }
                }
            }
        }
        // A2..A6 per chamber
        chambers.forEachIndexed { ci, c ->
            val n = nest[ci]; val r = n.r
            val yC: (Double) -> Double = { x -> yLowAt(ci, x) }
            val totalLen = totalLenOf(c)
            val zRoof = zSeam + r // this chamber's inner-roof peak
            val bhW = bhWs[ci] // may be auto-reduced so channels never touch
            lines.add("")
            lines.add("( ── Chamber ${ci + 1}${if (c.label.isNotEmpty()) " — ${c.label}" else ""}: bore ${fmt(toUnits(c.boreIn, units), 3)}$units at lane Y${fmt(toUnits(lane[ci], units), 3)}$units ── )")
            // blow-air passage: from its inlet slot in the shared mouthpiece,
            // through the nipple, converging onto this chamber's SAC lane. The
            // convergence must finish before the ramp foot.
            val xConv = min(convergeRun[ci], min(max(0.05, c.sacLenIn * 0.6), niRamp[ci].xBase))
            val yIn = mouthYs[ci] // lower blank: lanes in native Y
            lines.add("( -- blow-air Ø${fmt(toUnits(bhW, units), 3)}$units half-round: inlet Y${fmt(toUnits(yIn, units), 3)}${if (converge) " (shared mouthpiece)" else ""} → SAC lane by X${fmt(toUnits(xConv, units), 3)} -- )")
            run {
                val rad = bhW / 2
                val levels = max(1, ceil(rad / stepdown).toInt())
                for (lv in 1..levels) {
                    val d = min(rad, lv * (rad / levels))
                    val w = sqrt(max(0.0, rad * rad - d * d))
                    val reach = max(0.0, w - toolR)
                    val passes = max(1, ceil((2 * reach) / step).toInt() + 1)
                    for (pI in 0 until passes) {
                        val yo = if (passes == 1) 0.0 else -reach + (2 * reach) * (pI.toDouble() / (passes - 1))
                        lines.add("G0 X${fmt(toUnits(xInlet, units), 3)} Y${fmt(toUnits(yIn + yo, units), 3)} Z${fmt(toUnits(retract, units), 3)}")
                        lines.add("G1 Z${fmt(toUnits(zSeam - d, units), 3)} F${fmt(toUnits(plungeRate, units), 1)}")
                        // straight leg through the nipple, then the convergence sweep
                        lines.add("G1 X0.000 Y${fmt(toUnits(yIn + yo, units), 3)} F${fmt(toUnits(feedRate, units), 1)}")
                        lines.add("G1 X${fmt(toUnits(xConv, units), 3)} Y${fmt(toUnits(yC(xConv) + yo, units), 3)} F${fmt(toUnits(feedRate, units), 1)}")
                        lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
                    }
                }
            }
            // bottom-half bore. The full-round SAC bore starts where the blow
            // channel lands on the lane and STOPS at the ridge front (xExit0):
            // everything under the ridge is reached only through the SAC-exit
            // slot, at throat width, after that slot is opened. Every bore
            // level is CLIPPED where the ramp has risen above it, so the wedge
            // the ramp finish pass shapes is still standing when it runs.
            val niR = niRamp[ci]
            val xSac0 = if (chambers.size == 1) 0.0 else xConv
            if (chambers.size > 1) lines.add("( NOTE — drone lanes open full-bore at X${fmt(toUnits(xConv, units), 3)} (the blow-channel landing), not the mouth face: the converging channels need the wood upstream. The SAC ahead of it is the channel volume only. )")
            lines.add("( -- bottom-half bore: ceiling at the seam, floor Z${fmt(toUnits(zSeam - r, units), 3)}; full width stops at the ridge front, levels clipped at the ramp so it stays standing -- )")
            sweepHalfRound(xSac0, n.xExit0, r, zSeam, yC) { zRel -> min(n.xExit0, niR.xAtRel(zRel)) }
            if (n.xBlockEnd < n.xTsh0 - 1e-6) {
                lines.add("( NOTE — backset ${fmt(toUnits(n.backset, units), 3)}$units: the bore's reach-back under the flue (X${fmt(toUnits(n.xBlockEnd, units), 3)}→${fmt(toUnits(n.xTsh0, units), 3)}) is an UNDERCUT )")
                lines.add("( beneath the standing ridge — unreachable in this no-flip architecture. The block face is cut at )")
                lines.add("( the window line; carve the backset by hand through the open window if the voicing needs it. )")
            }
            sweepHalfRound(max(n.xBlockEnd, n.xTsh0), totalLen, r, zSeam, yC)
            // SAC EXIT — a ramp-following slot clearing, NOT a flat pocket.
            lines.add("( -- SAC EXIT / ramp channel — throat-width clearing over the climbing ramp, X${fmt(toUnits(niR.seamX, units), 3)}→${fmt(toUnits(n.xExit1, units), 3)} -- )")
            run {
                val xs0 = max(niR.xBase, niR.seamX - 2 * toolR)
                val reach = max(0.0, n.shW / 2 - toolR)
                val passes = max(1, ceil((2 * reach) / step).toInt() + 1)
                val depth = zRoof - zSeam
                val levels = max(1, ceil(depth / stepdown).toInt())
                for (lv in 1..levels) {
                    val z = zRoof - min(depth, lv * (depth / levels))
                    val xEnd = min(n.xExit1, niR.xAtRel(z - zSeam))
                    if (xEnd <= xs0 + 1e-6) continue
                    for (pI in 0 until passes) {
                        val yo = if (passes == 1) 0.0 else -reach + (2 * reach) * (pI.toDouble() / (passes - 1))
                        lines.add("G0 X${fmt(toUnits(xs0, units), 3)} Y${fmt(toUnits(yC(xs0) + yo, units), 3)} Z${fmt(toUnits(retract, units), 3)}")
                        lines.add("G1 Z${fmt(toUnits(z, units), 3)} F${fmt(toUnits(plungeRate, units), 1)}")
                        val steps = max(2, Math.round((xEnd - xs0) / 0.05).toInt() + 1)
                        for (s in 1..steps) {
                            val x = xs0 + (xEnd - xs0) * (s.toDouble() / steps)
                            lines.add("G1 X${fmt(toUnits(x, units), 3)} Y${fmt(toUnits(yC(x) + yo, units), 3)} F${fmt(toUnits(feedRate, units), 1)}")
                        }
                        lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
                    }
                }
            }
            pocket(
                n.xFlue0, n.xTsh0, n.shW, zRoof, zRoof - n.flueD, yC,
                "FLUE — ${fmt(toUnits(n.flueL, units), 3)}$units windway floor, ${fmt(toUnits(n.flueD, units), 3)}$units under the roof; the bird roofs it. The ramp arrives dead level with this floor.",
            )
            // ramp finish, in two stages: full bore width for the below-seam
            // climb in the open SAC, then throat width riding the FULL rise —
            // bore floor to flue floor — up through the tongue and the slot.
            lines.add(
                if (n.rampCurve > 0.01) {
                    "( -- ramp finish: CURVED (scoop ${fmt(n.rampCurve, 2)}), ${fmt(n.rampDeg, 1)}° chord, SAC bore floor → FLUE FLOOR (rise ${fmt(toUnits(niR.rise, units), 3)}$units)${if (niR.steepened) " — STEEPENED to ~${fmt(niR.actualDeg, 1)}° to leave room for the blow channel" else ""} -- )"
                } else {
                    "( -- ramp finish: ${fmt(n.rampDeg, 1)}° straight face, SAC bore floor → FLUE FLOOR (rise ${fmt(toUnits(niR.rise, units), 3)}$units)${if (niR.steepened) " — STEEPENED to ~${fmt(niR.actualDeg, 1)}° to leave room for the blow channel" else ""} -- )"
                },
            )
            run {
                fun rampStage(xa: Double, xb: Double, reach: Double, zCap: Double) {
                    if (xb <= xa + 1e-6) return
                    val passes = max(1, ceil((2 * reach) / step).toInt() + 1)
                    val rSteps = max(2, ceil((xb - xa) / (if (n.rampCurve > 0.01) 0.012 else 0.05)).toInt())
                    for (pI in 0 until passes) {
                        val yo = if (passes == 1) 0.0 else -reach + (2 * reach) * (pI.toDouble() / (passes - 1))
                        val wallZ = zSeam - sqrt(max(0.0, r * r - yo * yo)) // bore wall floor at this offset
                        lines.add("G0 X${fmt(toUnits(xa, units), 3)} Y${fmt(toUnits(yC(xa) + yo, units), 3)} Z${fmt(toUnits(retract, units), 3)}")
                        for (s in 0..rSteps) {
                            val x = xa + (xb - xa) * (s.toDouble() / rSteps)
                            val z = min(zCap, max(zSeam + niR.relAt(x), wallZ))
                            lines.add("G1 X${fmt(toUnits(x, units), 3)} Y${fmt(toUnits(yC(x) + yo, units), 3)} Z${fmt(toUnits(z, units), 3)} F${fmt(toUnits(if (s == 0) plungeRate else feedRate, units), 1)}")
                        }
                        lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
                    }
                }
                // below-seam climb, full bore width — it MUST end where the ramp
                // crosses the seam, and never past the ridge front either
                rampStage(niR.xBase, min(n.xExit1, min(niR.seamX, n.xExit0)), max(0.0, r - toolR), zSeam)
                // the full rise at throat width: base → flue floor, through the
                // tongue and the slot (cap at the ramp top = the flue floor)
                rampStage(niR.xBase, n.xExit1, max(0.0, min(n.shW / 2, r) - toolR), zSeam + niR.zTopRel)
            }
            // ridge shoulders shaped to this chamber's inner roof radius, with
            // TRUE TOOL-OFFSET so the cut surface IS the arc, not the arc plus a
            // tool radius.
            lines.add("( -- nest ridge shoulders → inner roof radius (tool-offset ${if (channelStyle == "round") "ball centre on r+ball" else "flat: steps inside the arc"}), blending to the seam at ±bore-radius -- )")
            run {
                val x0 = n.xExit0; val x1 = n.xTsh0
                fun shoulderPass(yo: Double, z: Double) {
                    lines.add("G0 X${fmt(toUnits(x0, units), 3)} Y${fmt(toUnits(yC(x0) + yo, units), 3)} Z${fmt(toUnits(retract, units), 3)}")
                    lines.add("G1 Z${fmt(toUnits(z, units), 3)} F${fmt(toUnits(plungeRate, units), 1)}")
                    val steps = max(2, Math.round((x1 - x0) / 0.06).toInt() + 1)
                    for (s in 1..steps) {
                        val x = x0 + (x1 - x0) * (s.toDouble() / steps)
                        lines.add("G1 X${fmt(toUnits(x, units), 3)} Y${fmt(toUnits(yC(x) + yo, units), 3)} F${fmt(toUnits(feedRate, units), 1)}")
                    }
                    lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
                }
                if (ballR > 0) {
                    val th0 = asin(min(1.0, (n.shW / 2) / r)) // contact starts at the window wall
                    val arcs = max(3, ceil(((PI / 2 - th0) * (r + ballR)) / step).toInt())
                    for (side in intArrayOf(-1, 1)) {
                        for (a in 0..arcs) {
                            val th = th0 + (PI / 2 - th0) * (a.toDouble() / arcs)
                            val yo = side * (r + ballR) * sin(th)
                            val z = max(zSeam, zSeam + (r + ballR) * cos(th) - ballR)
                            shoulderPass(yo, z)
                        }
                    }
                } else {
                    val yStart = n.shW / 2 + toolR // inner edge of the flat lands at the window wall
                    val arcs = max(2, ceil(((r + toolR) - yStart) / step).toInt() + 1)
                    for (side in intArrayOf(-1, 1)) {
                        for (a in 0..arcs) {
                            val yoAbs = yStart + ((r + toolR) - yStart) * (a.toDouble() / arcs)
                            val contact = min(r, yoAbs + toolR) // floor from the OUTER edge: never proud of the arc
                            val z = max(zSeam, zSeam + sqrt(max(0.0, r * r - contact * contact)))
                            shoulderPass(side * yoAbs, z)
                        }
                    }
                }
            }
        }
    } // end wantLower (Operation A)

    // ══ OPERATION B — UPPER SHELL BLANK (Z0 = seam/bore-axis face) ══════
    if (wantUpper) {
        lines.add("")
        lines.add("( ══════════ OPERATION B — UPPER SHELL BLANK (thin blank, seam face up at +Y) ══════════ )")
        lines.add("( Y-mirrored about the lane midline — the shell is turned over ONCE onto the nest at glue-up. )")
        chambers.forEachIndexed { ci, c ->
            val n = nest[ci]; val r = n.r
            val yC: (Double) -> Double = { x -> yUpAt(ci, x) }
            val totalLen = totalLenOf(c)
            lines.add("")
            lines.add("( ── Chamber ${ci + 1}${if (c.label.isNotEmpty()) " — ${c.label}" else ""} (shell) ── )")
            val xConv = min(convergeRun[ci], min(max(0.05, c.sacLenIn * 0.6), niRamp[ci].xBase))
            val yInUp = yTableShift + 2 * yMirror - mouthYs[ci]
            lines.add("( -- blow-air top half Ø${fmt(toUnits(bhWs[ci], units), 3)}$units: inlet Y${fmt(toUnits(yInUp, units), 3)}${if (converge) " (shared mouthpiece, mirrored)" else ""} → lane by X${fmt(toUnits(xConv, units), 3)} -- )")
            run {
                val rad = bhWs[ci] / 2
                val levels = max(1, ceil(rad / stepdown).toInt())
                for (lv in 1..levels) {
                    val d = min(rad, lv * (rad / levels))
                    val w = sqrt(max(0.0, rad * rad - d * d))
                    val reach = max(0.0, w - toolR)
                    val passes = max(1, ceil((2 * reach) / step).toInt() + 1)
                    for (pI in 0 until passes) {
                        val yo = if (passes == 1) 0.0 else -reach + (2 * reach) * (pI.toDouble() / (passes - 1))
                        lines.add("G0 X${fmt(toUnits(xInlet, units), 3)} Y${fmt(toUnits(yInUp + yo, units), 3)} Z${fmt(toUnits(retract, units), 3)}")
                        lines.add("G1 Z${fmt(toUnits(-d, units), 3)} F${fmt(toUnits(plungeRate, units), 1)}")
                        lines.add("G1 X0.000 Y${fmt(toUnits(yInUp + yo, units), 3)} F${fmt(toUnits(feedRate, units), 1)}")
                        lines.add("G1 X${fmt(toUnits(xConv, units), 3)} Y${fmt(toUnits(yC(xConv) + yo, units), 3)} F${fmt(toUnits(feedRate, units), 1)}")
                        lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
                    }
                }
            }
            lines.add("( -- top-half bore: ceiling at the seam (Z0), floor Z${fmt(toUnits(-r, units), 3)} (this chamber's roof) -- )")
            sweepHalfRound(if (chambers.size == 1) 0.0 else xConv, totalLen, r, 0.0, yC)
            // rectangular THROUGH-WINDOW: the FULL NEST OPENING, SAC exit →
            // splitting edge, cut clear through the shell.
            pocket(
                n.xExit0, n.xTsh1, n.shW, 0.0, -(Tup + n.overshoot), yC,
                "NEST WINDOW — the full rectangular opening, SAC exit → splitting edge, clear THROUGH the shell (the bird seats over it and roofs the flue)",
            )
            // splitting edge: bevel the window's downstream wall.
            run {
                val zTip = -(r - n.flueD + n.tipHeight) // = flue floor + tipHeight, assembled
                val bevRise = -zTip
                val bevRun = max(0.02, bevRise / tan(max(6.0, n.fippleDeg) * PI / 180))
                val x0 = n.xTsh1; val xFlatEnd = x0 + n.tipFlat; val x1 = xFlatEnd + bevRun
                lines.add("( -- SPLITTING EDGE — tip at ${fmt(toUnits(n.tipHeight, units), 4)}$units above the flue floor (Z${fmt(toUnits(zTip, units), 3)}), ${fmt(toUnits(n.tipFlat, units), 3)}$units tip flat, then the ${fmt(n.fippleDeg, 1)}° bevel to the seam -- )")
                fun floorAt(x: Double): Double = if (x <= xFlatEnd) zTip else min(0.0, zTip + (x - xFlatEnd) * (bevRise / max(1e-6, bevRun)))
                val reach = max(0.0, n.shW / 2 - toolR)
                val passes = max(1, ceil((2 * reach) / step).toInt() + 1)
                val levels = max(1, ceil(bevRise / stepdown).toInt())
                for (lv in 1..levels) {
                    val zLev = -min(bevRise, lv * stepdown)
                    for (pI in 0 until passes) {
                        val yo = if (passes == 1) 0.0 else -reach + (2 * reach) * (pI.toDouble() / (passes - 1))
                        lines.add("G0 X${fmt(toUnits(x1, units), 3)} Y${fmt(toUnits(yC(x1) + yo, units), 3)} Z${fmt(toUnits(retract, units), 3)}")
                        lines.add("G1 Z${fmt(toUnits(max(zLev, floorAt(x1)), units), 3)} F${fmt(toUnits(plungeRate, units), 1)}")
                        val st2 = max(2, ceil((x1 - x0) / 0.01).toInt())
                        for (s in 0..st2) {
                            val x = x1 - (x1 - x0) * (s.toDouble() / st2)
                            val z = max(zLev, floorAt(x))
                            lines.add("G1 X${fmt(toUnits(x, units), 3)} Y${fmt(toUnits(yC(x) + yo, units), 3)} Z${fmt(toUnits(z, units), 3)} F${fmt(toUnits(feedRate, units), 1)}")
                        }
                        lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
                    }
                }
            }
            // finger holes — through the shell (playable chambers only)
            if (c.playable && c.holes.isNotEmpty()) {
                lines.add("( -- FINGER HOLES — through the shell (${fmt(toUnits(Tup + n.overshoot, units), 3)}$units) -- )")
                c.holes.sortedBy { it.fromTshIn }.forEach { h ->
                    val hx = c.sacLenIn + h.fromTshIn
                    drillRoundHole(
                        lines,
                        DrillRoundHoleParams(
                            label = "HOLE H${h.num} (${h.interval})", x = hx, y = yC(hx),
                            holeDia = h.diameterIn, depth = Tup + n.overshoot,
                            toolDiameter = toolDiameter, units = units, feedRate = feedRate, plungeRate = plungeRate,
                            safeHeight = safeHeight, retractHeight = retract, zTop = 0.0,
                        ),
                    )
                }
            }
        }
    } // end wantUpper (Operation B)

    // ── MOUTHPIECE plan-outline rough ──
    fun millMouth(yCof: (Double) -> Double, zThick: Double) {
        val raw = mutableListOf<DoubleArray>() // [x, w]
        val NT = 32; val NCp = 10
        for (i in 0..NT) { val x = -(i.toDouble() / NT) * mpDomeLen; raw.add(doubleArrayOf(x, mpWidthAt(x))) }
        for (i in 1..NCp) { val x = -mpDomeLen - (i.toDouble() / NCp) * mpCapLen; raw.add(doubleArrayOf(x, mpWidthAt(x))) }
        fun cut(sgn: Int) {
            val levels = max(1, ceil((zThick + 0.04) / stepdown).toInt())
            for (lv in 1..levels) {
                val z = -min(zThick + 0.04, lv * stepdown)
                val p0 = raw[0]
                lines.add("G0 X${fmt(toUnits(p0[0], units), 3)} Y${fmt(toUnits(yCof(p0[0]) + sgn * (p0[1] + toolR), units), 3)} Z${fmt(toUnits(retract, units), 3)}")
                lines.add("G1 Z${fmt(toUnits(z, units), 3)} F${fmt(toUnits(plungeRate, units), 1)}")
                raw.forEach { pt -> lines.add("G1 X${fmt(toUnits(pt[0], units), 3)} Y${fmt(toUnits(yCof(pt[0]) + sgn * (pt[1] + toolR), units), 3)} F${fmt(toUnits(feedRate, units), 1)}") }
                lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
            }
        }
        cut(1); cut(-1)
    }
    lines.add("")
    lines.add("( -- MOUTHPIECE ROUGH — plan outline around the lane midline; round the height by hand after glue-up -- )")
    if (wantLower) millMouth({ x -> yMidLanes + bow(x) }, Tlow)
    if (wantUpper) millMouth({ x -> yTableShift + 2 * yMirror - yMidLanes - bow(x) }, Tup)

    // ── ALIGNMENT PINS — two rails outside the outermost bores. LOWER pins
    //    drill from the FACED seam plane (the shell seats there); UPPER pins
    //    from the shell's seam face. Same X/Y grid on both so they mate.
    if (alignPins) {
        val pin = SplitFit.pinSizes.firstOrNull { toolDiameter <= it && stockMarginY >= it + 2 * SplitFit.slipClearance + SplitFit.landClearance }
            ?: SplitFit.pinSizes.last()
        val railLo = yMinB + stockMarginY * 0.5
        val railHi = yMaxB - stockMarginY * 0.5
        val xa = SplitFit.endInset; val xb = maxLenNI - SplitFit.endInset
        val stations = mutableListOf<Double>()
        if (xb <= xa) {
            stations.add(maxLenNI / 2)
        } else {
            val span = xb - xa
            val nP = max(2, ceil(span / SplitFit.maxSpacing).toInt() + 1)
            for (i in 0 until nP) stations.add(xa + span * (i.toDouble() / (nP - 1)))
        }
        val depLow = min(SplitFit.maxPinDepth, min(max(SplitFit.minPinDepth, pin * 1.25), (Tlow - rMax) - SplitFit.landClearance))
        val depUp = min(SplitFit.maxPinDepth, min(max(SplitFit.minPinDepth, pin * 1.25), Tup - SplitFit.landClearance))
        if (depUp >= 0.12 && depLow >= 0.12) {
            lines.add("")
            lines.add("( -- ALIGNMENT PINS — Ø${pin}\" dowels; lower on-size from the faced seam (glued), upper +${fmt(toUnits(SplitFit.slipClearance, units), 4)}$units/side slip -- )")
            stations.forEachIndexed { si, px ->
                listOf(railLo, railHi).forEachIndexed { ei, ry ->
                    if (wantLower) {
                        drillRoundHole(
                            lines,
                            DrillRoundHoleParams(
                                label = "pin ${si + 1}${if (ei == 0) "L" else "R"} (lower, from the seam plane)", x = px, y = ry,
                                holeDia = pin, depth = depLow, toolDiameter = toolDiameter, units = units, feedRate = feedRate,
                                plungeRate = plungeRate, safeHeight = safeHeight, retractHeight = retract, zTop = zSeam,
                            ),
                        )
                    }
                    if (wantUpper) {
                        drillRoundHole(
                            lines,
                            DrillRoundHoleParams(
                                label = "pin ${si + 1}${if (ei == 0) "L" else "R"} (upper)", x = px, y = yTableShift + (railLo + railHi) - ry,
                                holeDia = pin + 2 * SplitFit.slipClearance, depth = depUp, toolDiameter = toolDiameter, units = units,
                                feedRate = feedRate, plungeRate = plungeRate, safeHeight = safeHeight, retractHeight = retract, zTop = 0.0,
                            ),
                        )
                    }
                }
            }
        }
    }

    // ── OPTIONAL: BODY OUTLINE — the very last passes of the job ──────
    if (outlinePass == "scribe") {
        lines.add("")
        lines.add("( -- BODY-OUTLINE SCRIBE requested, NOT APPLICABLE to the nest-insert split: both machined -- )")
        lines.add("( faces are GLUE faces (lower: the faced seam plane; shell: the seam side), so a scribed -- )")
        lines.add("( groove would be hidden inside the glue-up. Use the FULL CUTOUT option instead. -- )")
    }
    if (outlinePass == "cutout") {
        fun chamberFoot(ci: Int): Double = chambers[ci].sacLenIn + chambers[ci].lengthIn
        // Flank position (Y-edge of the finished silhouette) at a given X and
        // side (+1/-1). For x<0 that's the mouthpiece dome/cap.
        fun flankAt(x: Double, side: Int): Double? {
            if (x < -1e-9) {
                val halfW = mpWidthAt(x)
                return if (halfW > 1e-6) yMidLanes + side * halfW else null
            }
            var best: Double? = null
            for (ci in chambers.indices) {
                val tl = chamberFoot(ci)
                if (x > tl + 1e-9) continue
                val b = if (bowAmp == 0.0) 0.0 else bowAmp * sin((min(x, tl) / tl) * PI)
                val y = lane[ci] + b + side * (nest[ci].r + nest[ci].wallT)
                val cur = best
                best = when {
                    cur == null -> y
                    side > 0 -> if (y > cur) y else cur
                    else -> if (y < cur) y else cur
                }
            }
            return best
        }
        val feet = chambers.indices.map { Math.round(chamberFoot(it) * 1e6) / 1e6 }.distinct().sorted()
        val mpTipX = -(mpDomeLen + mpCapLen) // where the dome/cap tapers to zero width
        fun buildXs(): List<Double> {
            val xs = mutableListOf<Double>()
            val NM = max(16, ceil((mpDomeLen + mpCapLen) / 0.12).toInt())
            for (i in 0..NM) xs.add(mpTipX * (1 - i.toDouble() / NM))
            val N = max(24, ceil(maxLenNI / 0.25).toInt())
            for (i in 0..N) xs.add(maxLenNI * (i.toDouble() / N))
            feet.forEach { f -> if (f > 1e-4 && f < maxLenNI - 1e-4) { xs.add(f - 1e-4); xs.add(f + 1e-4) } }
            return xs.sorted()
        }
        var pts = mutableListOf<DoubleArray>() // [x, y]
        buildXs().forEach { x -> flankAt(x, 1)?.let { y -> pts.add(doubleArrayOf(x, y)) } }
        buildXs().reversed().forEach { x -> flankAt(x, -1)?.let { y -> pts.add(doubleArrayOf(x, y)) } }
        // cutter compensation: SEGMENT offset with mitered joins (the averaged-
        // normal version gouged a triangle into the wall at every drone-foot
        // step — see the symmetric emitter for the full story).
        run {
            val nPts = pts.size
            if (nPts >= 2) {
                val toolR2 = toolDiameter / 2
                val MITER_LIMIT = 6.0
                data class Seg(val dx: Double, val dy: Double, val nx: Double, val ny: Double, val px: Double, val py: Double)
                val seg = mutableListOf<Seg>()
                for (i in 0 until nPts - 1) {
                    var dx = pts[i + 1][0] - pts[i][0]; var dy = pts[i + 1][1] - pts[i][1]
                    val L = hypot(dx, dy).let { if (it == 0.0) 1.0 else it }
                    dx /= L; dy /= L
                    val nx = -dy; val ny = dx
                    seg.add(Seg(dx, dy, nx, ny, pts[i][0] + nx * toolR2, pts[i][1] + ny * toolR2))
                }
                val off = mutableListOf(doubleArrayOf(seg[0].px, seg[0].py))
                for (i in 1 until nPts - 1) {
                    val a = seg[i - 1]; val b = seg[i]
                    val den = a.dx * b.dy - a.dy * b.dx
                    var jx: Double; var jy: Double
                    if (abs(den) < 1e-9) {
                        jx = pts[i][0] + b.nx * toolR2; jy = pts[i][1] + b.ny * toolR2
                    } else {
                        val t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / den
                        jx = a.px + t * a.dx; jy = a.py + t * a.dy
                        val mx = jx - pts[i][0]; val my = jy - pts[i][1]; val ml = hypot(mx, my)
                        if (ml > MITER_LIMIT * toolR2) {
                            val k = (MITER_LIMIT * toolR2) / (if (ml == 0.0) 1.0 else ml)
                            jx = pts[i][0] + mx * k; jy = pts[i][1] + my * k
                        }
                    }
                    off.add(doubleArrayOf(jx, jy))
                }
                val lastSeg = seg[nPts - 2]
                off.add(doubleArrayOf(pts[nPts - 1][0] + lastSeg.nx * toolR2, pts[nPts - 1][1] + lastSeg.ny * toolR2))
                pts = off
            }
        }
        val TABS = 6
        val cum = mutableListOf(0.0)
        for (i in 1 until pts.size) cum.add(cum[i - 1] + hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
        val loopLen = cum.last()
        val tabCenters = (0 until TABS).map { k -> ((k + 0.5) / TABS) * loopLen }
        val tabLen = 0.32 + toolDiameter
        fun inTab(d2: Double): Boolean = tabCenters.any { abs(d2 - it) < tabLen / 2 }
        val swath = nest.maxOf { it.wallT } + toolDiameter
        val pinInset = stockMarginY * 0.5
        lines.add("")
        lines.add("( -- BODY-OUTLINE FULL CUTOUT (LAST passes) — BOTH blanks, profile cut THROUGH -- )")
        lines.add("( Silhouette tool-radius compensated OUTWARD with mitered corners; $TABS tabs per blank hold )")
        lines.add("( each body half to the waste rails carrying the ALIGNMENT PINS, so registration survives )")
        lines.add("( glue-up. Break or saw the tabs off afterwards. )")
        if (!(pinInset > swath + 0.1)) {
            lines.add("( ⚠⚠ PIN CLEARANCE: the cut swath (wall + cutter = ${fmt(toUnits(swath, units), 3)}$units) reaches near the pin rails — )")
            lines.add("( increase stock margin Y or use a smaller cutter, or the cutout may graze the pin holes. )")
        }
        data class CutJob(val name: String, val mapYo: (Double) -> Double, val thick: Double)
        val cutJobs = buildList {
            if (wantLower) add(CutJob("LOWER NEST blank (native Y)", { yv -> yv }, Tlow))
            if (wantUpper) add(CutJob("UPPER SHELL blank (mirrored at +Y)", { yv -> yTableShift + 2 * yMirror - yv }, Tup))
        }
        cutJobs.forEach { job ->
            val cutDepth = job.thick + 0.04
            val levels = max(1, ceil(cutDepth / stepdown).toInt())
            val tabH = min(0.12, max(0.06, job.thick * 0.18))
            val tabTopZ = -(job.thick - tabH)
            lines.add("( -- outline cutout: ${job.name} — through ${fmt(toUnits(cutDepth, units), 3)}$units in $levels passes -- )")
            for (lv in 1..levels) {
                val z = -min(cutDepth, lv * stepdown)
                val tabsActive = z < tabTopZ
                lines.add("( pass $lv/$levels — Z${fmt(toUnits(z, units), 3)}${if (tabsActive) " — riding over the $TABS tabs" else ""} )")
                val p0 = pts[0]
                lines.add("G0 X${fmt(toUnits(p0[0], units), 3)} Y${fmt(toUnits(job.mapYo(p0[1]), units), 3)} Z${fmt(toUnits(retract, units), 3)}")
                lines.add("G1 Z${fmt(toUnits(if (tabsActive && inTab(0.0)) tabTopZ else z, units), 3)} F${fmt(toUnits(plungeRate, units), 1)}")
                pts.forEachIndexed { pi, pt ->
                    val zi = if (tabsActive && inTab(cum[pi])) tabTopZ else z
                    lines.add("G1 X${fmt(toUnits(pt[0], units), 3)} Y${fmt(toUnits(job.mapYo(pt[1]), units), 3)} Z${fmt(toUnits(zi, units), 3)} F${fmt(toUnits(feedRate, units), 1)}")
                }
                lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
            }
        }
    }

    lines.add("")
    lines.add("( ══════════ DONE — both blanks cut single-sided, no flip ══════════ )")
    lines.add("( Turn the upper shell over onto the faced seam plane, register on the pins, and glue. )")
    lines.add("( Strap each BIRD over its window: it seats on the exposed nest plateau and roofs the flue. )")
    lines.add("( Each jet then splits on its window's downstream edge. Round the outside after glue-up. )")
    lines.addAll(gcodeFooter(dialect))
    return lines.joinToString("\n")
}
