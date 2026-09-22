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

private data class PinPlan(
    val ok: Boolean,
    val reason: String?,
    val stations: List<Double> = emptyList(),
    val edges: List<Double> = emptyList(),
    val pinDiameter: Double = 0.0,
    val topDepth: Double = 0.0,
    val bottomDepth: Double = 0.0,
)

/**
 * SYMMETRIC SPLIT AT THE BORE AXIS — "basic drilled layout, hand-finish
 * mode". Ported 1:1 from the (default) branch of generateSplitBlockGCode()
 * in the web source, taken when `splitStyle !== "nest-insert"`.
 *
 * The seam plane runs through the bore axis — the tube's widest line — so
 * each half is exactly (bore radius + wall) thick and the two blanks are
 * IDENTICAL. Only what's reproducible by machine at TRUE design size is
 * cut (the SAC and the full-round bore); every other feature (blow hole,
 * finger holes, flue, air-exit hole, TSH) is a LOCATING cut,
 * HAND_FINISH_UNDERSIZE_IN smaller than designed, left for hand-fitting.
 * The ramp and the splitting edge (bevel, tip, relief) are NOT machined at
 * all — entirely hand-carved and tuned by ear. There is no proud block and
 * no receiving trough: the "block" is simply the solid wall left between
 * the SAC and the sound chamber when both halves stop their bore channels.
 */
internal fun generateSymmetricSplitGCode(
    p: SplitBlockParams,
    chambers: List<GcodeChamber>,
    nest: List<NestCalc>,
    bowAmp: Double,
    lines: MutableList<String>,
    maxLen: Double,
    oneBlank: Boolean,
    yOffs: List<Double>,
    blankWidth: Double,
    blankLen: Double,
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
    val droneBody = p.droneBody
    val alignPins = p.alignPins
    val outlinePass = p.outlinePass
    val only = p.only

    val wantHalves = only != "nest"
    val wantNest = only != "halves"

    val blankThick = nest.maxOf { it.r + it.wallT }
    val tableGap = 0.6
    val yTableShift = blankWidth + tableGap

    val yMid = if (oneBlank) (yOffs.min() + yOffs.max()) / 2 else 0.0
    val yBlankMinBottom = yOffs.indices.minOf { i -> yOffs[i] - chambers[i].boreIn / 2 } - stockMarginY
    val yBlankMinTop = (2 * yMid - (yBlankMinBottom + blankWidth)) + yTableShift

    // ── BASIC DRILLED LAYOUT — hand-finish undersizing ─────────────────
    val HFU = FluteConst.HAND_FINISH_UNDERSIZE_IN
    fun under(v: Double, floor: Double = 0.015): Double = max(floor, v - HFU)

    // ── DRONE MOUTHPIECE: converging blow-air channels ────────────────
    val bhWs = chambers.map { c -> c.breathHoleWidthIn ?: FluteConst.breathHoleWidth(c.boreIn) }.toMutableList()
    val bhLs = chambers.map { c -> c.breathHoleLengthIn ?: FluteConst.breathHoleLength(c.boreIn) }
    val MOUTH_EDGE_GAP = 0.10
    val converge = oneBlank && chambers.size > 1
    var bhScaleNote: String? = null
    if (converge) {
        var f = 1.0
        for (i in 0 until chambers.size - 1) {
            val centerDist = abs(yOffs[i + 1] - yOffs[i])
            val need = (bhWs[i] + bhWs[i + 1]) / 2
            val avail = centerDist - 0.06
            if (avail > 0.02 && need > avail) f = min(f, avail / need)
        }
        if (f < 0.999) {
            for (i in bhWs.indices) bhWs[i] = max(0.12, bhWs[i] * f)
            bhScaleNote = "BREATH HOLES AUTO-REDUCED x${fmt(f, 2)} (to Ø${bhWs.joinToString("/") { fmt(toUnits(it, units), 3) }}$units) so adjacent blow channels keep a solid wood web — every chamber breathes through its OWN separate channel, nothing intersects."
        }
    }
    val mouthYs: List<Double> = if (!converge) {
        chambers.indices.map { i -> yOffs[i] }
    } else {
        val rank = chambers.indices.sortedBy { yOffs[it] }
        val spread = bhWs.sum() + MOUTH_EDGE_GAP * (chambers.size - 1)
        val slots = DoubleArray(chambers.size)
        var yCur = yMid - spread / 2
        rank.forEach { i -> slots[i] = yCur + bhWs[i] / 2; yCur += bhWs[i] + MOUTH_EDGE_GAP }
        slots.toList()
    }
    val convergeRun = chambers.indices.map { i ->
        val c = chambers[i]
        val dy = abs(yOffs[i] - mouthYs[i])
        min(max(bhLs[i], dy * 2.75), max(bhLs[i], c.sacLenIn * 0.45))
    }

    // ── MOUTHPIECE (plan outline) ─────────────────────────────────────
    val mpR = nest.maxOf { it.r + it.wallT }
    val mpHalfW = if (oneBlank) (yOffs.max() - yOffs.min()) / 2 + mpR else mpR
    val mpDomeLen = max(0.5, mpR * 1.5)
    val mpCapLen = mpDomeLen * 0.3
    val mpSpreadHalf = (if (converge) mouthYs.maxOf { abs(it - yMid) } else 0.0) + bhWs.max() * 0.5
    val mpTipW = min(0.92, max(0.4, (mpSpreadHalf + 0.05) / mpHalfW)) // never narrower than the blow holes
    fun mpProf(t: Double): Double = Math.pow(cos(t * PI / 2), 0.62)
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
    val mpDoRough = !(chambers.size > 1 && droneBody == "separate")

    val ballR = if (channelStyle == "round") toolDiameter / 2 else 0.0
    val stepover = max(0.01, toolDiameter * 0.4)

    lines.addAll(
        gcodeHeader(
            dialect, units,
            title = when (only) {
                "halves" -> "Split-Block SETUP 1/2 — HALVES: both blanks, seam face up"
                "nest" -> "Split-Block SETUP 2/2 — NEST: top blank turned over, outer face up"
                else -> "Split-Block — ALL OPERATIONS (halves, then the top blank turned over for the nest)"
            },
            notes = buildList {
                add(
                    "TABLE LAYOUT: clamp BOTH blanks down. They are the SAME size: ${fmt(toUnits(blankLen, units), 2)} × " +
                        "${fmt(toUnits(blankWidth, units), 2)} × ${fmt(toUnits(blankThick, units), 2)} $units (= bore radius + wall). " +
                        "The seam plane runs through the BORE AXIS — the tube's widest line — so the halves are mirror " +
                        "images and each carries exactly half the bore. BOTTOM blank at the program's native Y; TOP " +
                        "blank alongside at +Y, ${fmt(toUnits(tableGap, units), 2)}$units clear.",
                )
                add(
                    "Z ZERO: on the blanks' TOP faces (both are the same thickness, so one Z zero serves both). That " +
                        "face IS the glue seam — plane the stock to ${fmt(toUnits(blankThick, units), 3)}$units and it needs no facing.",
                )
                add(
                    "BASIC DRILLED LAYOUT — HAND-FINISH MODE: this program cuts only what's reproducible by machine at " +
                        "its TRUE design size — the SAC and the full-round bore. Every other feature (blow hole, finger " +
                        "holes, flue, air-exit hole, TSH) is a LOCATING cut, ${fmt(toUnits(HFU, units), 3)}$units SMALLER than " +
                        "the true design dimension in every direction, leaving stock to hand-fit, ream, or file to final " +
                        "size. The RAMP and the SPLITTING EDGE (bevel, tip, relief) are NOT machined at all — no shaped " +
                        "surface, undersized or otherwise — they are carved entirely by hand and tuned by ear, using the " +
                        "SAC bore's stopping point and the air-exit/TSH holes as position references.",
                )
                add(
                    "THE \"BLOCK\" IS NOT MACHINED — it is the SOLID WALL left standing between the SAC and the sound " +
                        "chamber when both halves stop their bore channels.",
                )
                if (chambers.size > 1) {
                    add(
                        if (oneBlank) {
                            "DRONE FLUTE, ONE SOLID BODY: all ${chambers.size} chambers are milled side-by-side in each " +
                                "blank. EVERY chamber gets its OWN SAC, exit hole, flue and TSH (each undersized as " +
                                "above); the blow channels angle inward to ONE shared mouthpiece, inlets " +
                                "${fmt(toUnits(MOUTH_EDGE_GAP, units), 2)}$units (~${fmt(MOUTH_EDGE_GAP * 25.4, 1)} mm) apart edge-to-edge."
                        } else {
                            "DRONE FLUTE, SEPARATE PIPES: the program PAUSES (M0) between chambers — swap in the next " +
                                "chamber's blank pair, re-zero, resume."
                        },
                    )
                }
                add(
                    "Tool: ${fmt(toUnits(toolDiameter, units), 3)} $units diameter " +
                        "${if (channelStyle == "round") "BALL-NOSE (required — the bore is a true half-round, swept with lateral stepover passes)" else "flat end mill (the half-round bore is approximated by stepped Z levels — a ball-nose gives a far better bore)"}.",
                )
                if (wantHalves) {
                    add(
                        "OPERATION 1A (bottom blank, seam face up) and 1B (top blank, seam face up, Y-mirrored) cut the " +
                            "SAME shape: the (undersized) blow-air passage, the full-round SAC bore stopping at the " +
                            "air-exit hole's start, and the full-round sound chamber — leaving the block wall solid and " +
                            "the ramp entirely uncut. 1B also bores the (undersized) finger holes through.",
                    )
                }
                if (wantNest) {
                    add(
                        "OPERATION 1C${if (only == "all") "" else " (THIS PROGRAM)"}: the TOP BLANK IS TURNED OVER about " +
                            "its long axis so its OUTER face is up, and Z is re-zeroed on it. It cuts the (undersized) " +
                            "air-exit hole, flue, and TSH starting hole. Those live on the face OPPOSITE the bore and " +
                            "cannot be reached from the seam side — the flip is unavoidable. While the blank is up, it " +
                            "also re-cuts the FINGER HOLES from this side: Op 1B broke out through this face, and it is " +
                            "the face the player's fingers seal against, so the second pass cleans those edges.",
                    )
                }
                if (only == "halves") add("THIS PROGRAM IS SETUP 1 OF 2. When it finishes, turn the top blank over, re-zero Z on its outer face, and run the NEST program.")
                if (only == "nest") add("THIS PROGRAM IS SETUP 2 OF 2. Run the HALVES program first — this one assumes the bores are already cut and the top blank has been turned over.")
                add(
                    "THE SPLITTING EDGE AND THE RAMP ARE ENTIRELY HAND WORK — no bevel, tip, relief, or ramp surface is " +
                        "machined anywhere in this mode. Carve the ramp from the SAC bore's stopping point up into the " +
                        "air-exit hole and flue floor; carve and hone the splitting edge at the TSH starting hole; tune " +
                        "both by ear. Design reference numbers for each are printed as comments at the matching station " +
                        "in the G-code below.",
                )
                if (wantNest) {
                    add(
                        "AFTER GLUE-UP: round the outside to the finished tube. Then hand-carve the ramp, the flue to " +
                            "its full depth and length, the air-exit opening to its full size, and the splitting edge " +
                            "— fit the bird over the flue last.",
                    )
                }
                bhScaleNote?.let { add(it) }
                if (wantNest && outlinePass == "scribe") {
                    add(
                        "BODY-OUTLINE SCRIBE ENABLED: the job's very last pass traces a deep reference groove of the " +
                            "finished body's plan silhouette on the flipped blank's outer face — saw and round the " +
                            "glued body to it. Cut on the waste side; the groove IS the finished outline.",
                    )
                }
                if (wantNest && outlinePass == "cutout") {
                    add(
                        "BODY-OUTLINE FULL CUTOUT ENABLED: the job ends by profile-cutting the finished body's plan " +
                            "silhouette clear THROUGH BOTH blanks (bottom, then the flipped top), tool-radius " +
                            "compensated so the edge lands exactly on the outline. 6 tabs per half are left standing to " +
                            "keep each body half attached to the waste rails carrying the alignment pins — registration " +
                            "survives glue-up; break or saw the tabs off afterwards.",
                    )
                }
                if (alignPins) {
                    add(
                        "ALIGNMENT PINS: matching holes in the land beside the bore; dowel auto-sized from " +
                            "${SplitFit.pinSizes.joinToString(", ") { "$it\"" }}. Bottom on-size (glued), top " +
                            "+${fmt(toUnits(SplitFit.slipClearance, units), 4)}$units/side slip fit.",
                    )
                }
            },
        ),
    )

    // NOTE — the header note above deliberately shows the ORIGINAL blankLen
    // (maxLen + 2*stockMarginX, from the shared preamble); the stock blocks
    // below use the mouthpiece-adjusted length instead, exactly as the web
    // source does (blankLen is reassigned there AFTER the header is built).
    val xBlank0 = if (mpDoRough) -mpFront else -stockMarginX
    val blankLenActual = maxLen + (-xBlank0) + stockMarginX
    if (wantHalves) lines.add(stockLine("bottom-half", xBlank0, yBlankMinBottom, -blankThick, blankLenActual, blankWidth, blankThick, units))
    lines.add(stockLine("top-half", xBlank0, yBlankMinTop, -blankThick, blankLenActual, blankWidth, blankThick, units))

    lines.add("S${spindleSpeed.roundToInt()} M3 ( spindle on )")

    val retractForPins = min(0.15, max(0.05, safeHeight / 3))
    val singleBlank = !(chambers.size > 1 && droneBody == "separate")
    val pinPlan: PinPlan = run {
        if (!alignPins) return@run PinPlan(false, null)
        if (!singleBlank) return@run PinPlan(false, "separate-pipe drone: pin each glued tube by hand")
        fun marginNeedFor(pSize: Double) = pSize + 2 * SplitFit.slipClearance + SplitFit.landClearance
        val chosen = SplitFit.pinSizes.firstOrNull { toolDiameter <= it && stockMarginY >= marginNeedFor(it) }
        if (chosen == null) {
            val smallest = SplitFit.pinSizes.last()
            if (toolDiameter > smallest) return@run PinPlan(false, "tool Ø${fmt(toUnits(toolDiameter, units), 3)}$units too large to bore even a Ø$smallest\" pin hole")
            return@run PinPlan(false, "stock margin Y (${fmt(toUnits(stockMarginY, units), 3)}$units) too small for even Ø$smallest\" pins")
        }
        val xa = SplitFit.endInset; val xb = maxLen - SplitFit.endInset
        val stations = mutableListOf<Double>()
        if (xb <= xa) {
            stations.add(maxLen / 2)
        } else {
            val span = xb - xa
            val n = max(2, ceil(span / SplitFit.maxSpacing).toInt() + 1)
            for (i in 0 until n) stations.add(xa + span * (i.toDouble() / (n - 1)))
        }
        val yLow = (if (oneBlank) yOffs.indices.minOf { i -> yOffs[i] - chambers[i].boreIn / 2 } else -chambers[0].boreIn / 2) - stockMarginY * 0.5
        val yHigh = (if (oneBlank) yOffs.indices.maxOf { i -> yOffs[i] + chambers[i].boreIn / 2 } else chambers[0].boreIn / 2) + stockMarginY * 0.5
        val engage = min(SplitFit.maxPinDepth, min(max(SplitFit.minPinDepth, chosen * 1.25), blankThick - SplitFit.landClearance))
        if (engage < 0.12) return@run PinPlan(false, "blanks only ${fmt(toUnits(blankThick, units), 3)}$units thick — too thin to seat Ø$chosen\" pins")
        PinPlan(true, null, stations, listOf(yLow, yHigh), chosen, engage, engage)
    }
    val chosenPin = if (pinPlan.ok) pinPlan.pinDiameter else SplitFit.pinSizes.last()
    val pinDiaBottom = chosenPin + 2 * SplitFit.snugClearance
    val pinDiaTop = chosenPin + 2 * SplitFit.slipClearance

    fun millAlignmentPins(half: Int) {
        if (!pinPlan.ok) return
        lines.add("")
        lines.add(
            if (half == 1) {
                "( -- ALIGNMENT PINS — BOTTOM HALF: Ø${fmt(toUnits(pinDiaBottom, units), 4)}$units on-size; glue Ø$chosenPin\" dowels in here -- )"
            } else {
                "( -- ALIGNMENT PINS — TOP HALF: Ø${fmt(toUnits(pinDiaTop, units), 4)}$units slip-fit (+${fmt(toUnits(SplitFit.slipClearance, units), 4)}$units/side) -- )"
            },
        )
        pinPlan.stations.forEachIndexed { si, px ->
            pinPlan.edges.forEachIndexed { ei, edgeY ->
                val y = if (half == 1) edgeY else (2 * yMid - edgeY) + yTableShift
                drillRoundHole(
                    lines,
                    DrillRoundHoleParams(
                        label = "pin ${si + 1}${if (ei == 0) "L" else "R"}", x = px, y = y,
                        holeDia = if (half == 1) pinDiaBottom else pinDiaTop, depth = if (half == 1) pinPlan.bottomDepth else pinPlan.topDepth,
                        toolDiameter = toolDiameter, units = units, feedRate = feedRate, plungeRate = plungeRate,
                        safeHeight = safeHeight, retractHeight = retractForPins, zTop = 0.0,
                    ),
                )
            }
        }
    }

    // ── Rough the mouthpiece's plan outline through the blank ═════════
    fun millMouthpieceRough(half: Int) {
        if (!mpDoRough) {
            lines.add("( NOTE — mouthpiece rough-cut skipped: separate-pipe drones get one mouthpiece per tube, shape them by hand. )")
            return
        }
        val yShift = if (half == 1) 0.0 else yTableShift
        fun mapY(yRaw: Double): Double = (if (half == 2) 2 * yMid - yRaw else yRaw) + yShift
        val toolR = toolDiameter / 2

        val raw = mutableListOf<DoubleArray>() // [x, w]
        val NT = 40; val NC = 12
        for (i in 0..NT) { val x = -(i.toDouble() / NT) * mpDomeLen; raw.add(doubleArrayOf(x, mpWidthAt(x))) }
        for (i in 1..NC) { val x = -mpDomeLen - (i.toDouble() / NC) * mpCapLen; raw.add(doubleArrayOf(x, mpWidthAt(x))) }
        val sideHi = raw.map { doubleArrayOf(it[0], yMid + it[1]) }
        val sideLo = raw.reversed().map { doubleArrayOf(it[0], yMid - it[1]) }
        val path = sideHi + sideLo

        // Offset every point OUTWARD along the local normal, so the cutter
        // rides beside the line rather than on it — a flat Y offset would
        // eat into the tip, where the outline turns through ninety degrees.
        val off = path.mapIndexed { i, pt ->
            val a = path[max(0, i - 1)]; val b = path[min(path.size - 1, i + 1)]
            var tx = b[0] - a[0]; var ty = b[1] - a[1]
            val L = hypot(tx, ty).let { if (it == 0.0) 1.0 else it }
            tx /= L; ty /= L
            var nx = ty; var ny = -tx // right-hand normal
            if ((pt[1] - yMid) * ny < 0) { nx = -nx; ny = -ny } // force it to point away from the centreline
            if (abs(pt[1] - yMid) < 1e-6) { nx = -1.0; ny = 0.0 } // at the very tip, straight ahead
            doubleArrayOf(pt[0] + nx * toolR, pt[1] + ny * toolR)
        }

        lines.add("")
        lines.add("( -- MOUTHPIECE ROUGH — plan outline, ${fmt(toUnits(mpDomeLen + mpCapLen, units), 3)}$units ahead of the mouth face -- )")
        lines.add("( Tapers ${fmt(toUnits(mpHalfW * 2, units), 3)} → ${fmt(toUnits(mpHalfW * mpTipW * 2, units), 3)}$units wide. Cut THROUGH the blank, so both halves )")
        lines.add("( match at glue-up. The HEIGHT taper is on the round outside — carve that after glue-up, )")
        lines.add("( working around the blow channels: they already run through the outline and their open )")
        lines.add("( ends emerge from the rounded tip — that is what the player blows into. )")
        lines.add("( ⚠ The waste either side comes free on the last pass: tape it down or leave tabs. -- )")
        val levels = max(1, ceil((blankThick + 0.04) / stepdown).toInt())
        for (lv in 1..levels) {
            val z = -min(blankThick + 0.04, lv * stepdown)
            val p0 = off[0]
            lines.add("G0 X${fmt(toUnits(p0[0], units), 3)} Y${fmt(toUnits(mapY(p0[1]), units), 3)} Z${fmt(toUnits(retractForPins, units), 3)}")
            lines.add("G1 Z${fmt(toUnits(z, units), 3)} F${fmt(toUnits(plungeRate, units), 1)}")
            off.forEach { pt -> lines.add("G1 X${fmt(toUnits(pt[0], units), 3)} Y${fmt(toUnits(mapY(pt[1]), units), 3)} F${fmt(toUnits(feedRate, units), 1)}") }
            lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
        }
    }

    // ══ Seam-side milling of one chamber in one half ══════════════════
    fun millChamberChannel(c: GcodeChamber, ci: Int, half: Int) {
        val n = nest[ci]
        val r = n.r
        val yOff = yOffs[ci]
        val totalLen = c.sacLenIn + c.lengthIn
        val zRef = 0.0 // both blanks' top face = the seam
        val yShift = if (half == 1) 0.0 else yTableShift
        fun mapY(yRaw: Double): Double = (if (half == 2) 2 * yMid - yRaw else yRaw) + yShift
        fun centerY(x: Double): Double = mapY(yOff + (if (bowAmp == 0.0) 0.0 else bowAmp * sin((x / totalLen) * PI)))

        if (ci > 0 && !oneBlank) lines.add("M0 ( PAUSE — swap in the half-$half blank for chamber ${ci + 1}, re-zero, resume )")

        lines.add("( ── Chamber ${ci + 1}${if (c.label.isNotEmpty()) " — ${c.label}" else ""}: bore ${fmt(toUnits(c.boreIn, units), 3)}$units, length ${fmt(toUnits(totalLen, units), 2)}$units${if (oneBlank) " at Y ${fmt(toUnits(yOff, units), 3)}$units" else ""} ── )")
        lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")

        // ── RAMP PROFILE ───────────────────────────────────────────────
        // The SAC floor climbs from the bore floor at xRampBase to the seam
        // at xExit1, sealing the chamber at the flue entrance. With the
        // nest's ramp-curve dialled up this face is a QUADRATIC BEZIER
        // sagging toward the downstream-bottom corner, built with exactly
        // the same construction the 3D preview uses.
        val rampLUT: List<DoubleArray>? = if (n.rampCurve <= 0.01) {
            null
        } else {
            val x0 = n.xRampBase; val x1 = n.xExit1; val z0 = -r; val z1 = 0.0
            val mx = (x0 + x1) / 2; val mz = (z0 + z1) / 2
            val cx = mx + n.rampCurve * (x1 - mx) // → downstream corner
            val cz = mz + n.rampCurve * (z0 - mz) // → bottom corner
            (0..96).map { i ->
                val t = i / 96.0; val u = 1 - t
                doubleArrayOf(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * z0 + 2 * u * t * cz + t * t * z1)
            } // monotonic in both x and z
        }
        // Deepest X reachable at a given Z level, given the ramp climbs ahead.
        fun xLimitAt(zRel: Double): Double {
            if (zRel >= 0) return n.xExit1
            if (zRel <= -r) return n.xRampBase
            if (rampLUT == null) return n.xRampBase + (zRel + r) * (n.xExit1 - n.xRampBase) / max(1e-6, r)
            for (i in 1 until rampLUT.size) {
                val a = rampLUT[i - 1]; val b = rampLUT[i]
                if (zRel <= b[1]) return a[0] + (b[0] - a[0]) * ((zRel - a[1]) / max(1e-9, b[1] - a[1]))
            }
            return n.xExit1
        }

        // ── TRUE HALF-ROUND CHANNEL ────────────────────────────────────
        // Sweeps the full bore width with lateral stepover passes at each Z
        // level — NOT a single centre-line slot.
        fun millHalfRound(x0: Double, x1: Double, rad: Double, label: String? = null, rampToSeal: Boolean = false) {
            if (x1 <= x0 + 1e-6) return
            if (label != null) lines.add("( -- $label -- )")
            val levels = max(1, ceil(rad / stepdown).toInt())
            for (lv in 1..levels) {
                val d = min(rad, lv * (rad / levels)) // depth below seam
                val zRel = -d
                val w = sqrt(max(0.0, rad * rad - d * d)) // bore half-width here
                val reach = max(0.0, w - toolDiameter / 2) // tool-centre range
                val xEnd = if (rampToSeal) min(x1, xLimitAt(zRel)) else x1
                if (xEnd <= x0 + 1e-6) continue
                val passes = max(1, ceil((2 * reach) / stepover).toInt() + 1)
                for (pI in 0 until passes) {
                    val yo = if (passes == 1) 0.0 else -reach + (2 * reach) * (pI.toDouble() / (passes - 1))
                    lines.add("G0 X${fmt(toUnits(x0, units), 3)} Y${fmt(toUnits(centerY(x0) + yo, units), 3)} Z${fmt(toUnits(zRef + retractForPins, units), 3)}")
                    lines.add("G1 Z${fmt(toUnits(zRef + zRel, units), 3)} F${fmt(toUnits(plungeRate, units), 1)}")
                    val steps = max(2, Math.round(40 * (xEnd - x0) / max(1e-6, totalLen)).toInt() + 2)
                    for (s in 1..steps) {
                        val x = x0 + (xEnd - x0) * (s.toDouble() / steps)
                        lines.add("G1 X${fmt(toUnits(x, units), 3)} Y${fmt(toUnits(centerY(x) + yo, units), 3)} F${fmt(toUnits(feedRate, units), 1)}")
                    }
                    lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
                }
            }
            // Ball-nose finish: ride the true half-round profile.
            if (ballR > 0 && rad > ballR) {
                lines.add("( finish: ball-nose profile passes on the true ${fmt(toUnits(rad, units), 3)}$units radius )")
                val arcs = max(3, ceil((PI * rad) / stepover).toInt())
                for (a in 0..arcs) {
                    val th = -PI / 2 + PI * (a.toDouble() / arcs)
                    val yo = (rad - ballR) * sin(th)
                    val zRel = -((rad - ballR) * cos(th) + ballR)
                    val xEnd = if (rampToSeal) min(x1, xLimitAt(zRel)) else x1
                    if (xEnd <= x0 + 1e-6) continue
                    lines.add("G0 X${fmt(toUnits(x0, units), 3)} Y${fmt(toUnits(centerY(x0) + yo, units), 3)} Z${fmt(toUnits(zRef + retractForPins, units), 3)}")
                    lines.add("G1 Z${fmt(toUnits(zRef + zRel, units), 3)} F${fmt(toUnits(plungeRate, units), 1)}")
                    val steps = max(2, Math.round(40 * (xEnd - x0) / max(1e-6, totalLen)).toInt() + 2)
                    for (s in 1..steps) {
                        val x = x0 + (xEnd - x0) * (s.toDouble() / steps)
                        lines.add("G1 X${fmt(toUnits(x, units), 3)} Y${fmt(toUnits(centerY(x) + yo, units), 3)} F${fmt(toUnits(feedRate, units), 1)}")
                    }
                    lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
                }
            }
        }

        // ── BLOW-AIR passage: half-round, mouth inlet → chamber centreline ──
        run {
            val bhW = bhWs[ci]
            val bhWcut = under(bhW, 0.06)
            val rad = bhWcut / 2
            val xConvWant = min(convergeRun[ci], max(0.05, c.sacLenIn * 0.6))
            val xConv = min(xConvWant, n.xRampBase)
            if (xConv < xConvWant - 1e-4) {
                lines.add("( NOTE — blow-air passage shortened from ${fmt(toUnits(xConvWant, units), 3)} to ${fmt(toUnits(xConv, units), 3)}$units: )")
                lines.add("( the ramp foot is at X${fmt(toUnits(n.xRampBase, units), 3)} and the passage must not run into the ramp. )")
            }
            val yIn = mapY(mouthYs[ci]); val yOut = centerY(xConv)
            val xInlet = if (mpDoRough) max(xBlank0 + 0.02, -(mpDomeLen + mpCapLen) - max(0.1, toolDiameter / 2)) else 0.0
            lines.add("( -- BLOW-AIR passage — Ø${fmt(toUnits(bhWcut, units), 3)}$units half-round (design Ø${fmt(toUnits(bhW, units), 3)}$units, ${fmt(toUnits(HFU, units), 3)}$units undersized for hand-reaming), inlet Y${fmt(toUnits(yIn, units), 3)}${if (converge) " (shared mouthpiece)" else ""} → SAC Y${fmt(toUnits(yOut, units), 3)} -- )")
            if (xInlet < -1e-6) {
                lines.add("( Runs from X${fmt(toUnits(xInlet, units), 3)} — clear THROUGH the mouthpiece nipple — so the channel's )")
                lines.add("( open end sticks out of the rounded tip once the outline rough-cut frees it. )")
            }
            val levels = max(1, ceil(rad / stepdown).toInt())
            for (lv in 1..levels) {
                val d = min(rad, lv * (rad / levels))
                val w = sqrt(max(0.0, rad * rad - d * d))
                val reach = max(0.0, w - toolDiameter / 2)
                val passes = max(1, ceil((2 * reach) / stepover).toInt() + 1)
                for (pI in 0 until passes) {
                    val yo = if (passes == 1) 0.0 else -reach + (2 * reach) * (pI.toDouble() / (passes - 1))
                    lines.add("G0 X${fmt(toUnits(xInlet, units), 3)} Y${fmt(toUnits(yIn + yo, units), 3)} Z${fmt(toUnits(zRef + retractForPins, units), 3)}")
                    lines.add("G1 Z${fmt(toUnits(zRef - d, units), 3)} F${fmt(toUnits(plungeRate, units), 1)}")
                    if (xInlet < -1e-6) lines.add("G1 X0.000 Y${fmt(toUnits(yIn + yo, units), 3)} F${fmt(toUnits(feedRate, units), 1)}")
                    lines.add("G1 X${fmt(toUnits(xConv, units), 3)} Y${fmt(toUnits(yOut + yo, units), 3)} F${fmt(toUnits(feedRate, units), 1)}")
                    lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
                }
            }
            millHalfRound(
                if (chambers.size == 1) 0.0 else xConv, n.xExit0, r,
                label = "SAC — half-round bore, full depth, up to the air-exit hole at X${fmt(toUnits(n.xExit0, units), 3)}",
            )
            lines.add("( -- RAMP: left UNCUT — hand-carve the climb from the SAC bore floor up into the air-exit hole and flue floor. -- )")
            lines.add("( Design reference (not machined): ${fmt(n.rampDeg, 0)}°${if (n.rampCurve > 0.01) " CURVED (scoop ${fmt(n.rampCurve, 2)})" else ""} from X${fmt(toUnits(n.xRampBase, units), 3)} to X${fmt(toUnits(n.xExit1, units), 3)}. -- )")
        }

        lines.add("( BLOCK WALL: X${fmt(toUnits(n.xExit1, units), 3)} → ${fmt(toUnits(n.xBlockEnd, units), 3)}$units left SOLID — this is the block. Do NOT cut. )")

        // ── SOUND CHAMBER: half-round bore, block's downstream face → foot ──
        millHalfRound(
            n.xBlockEnd, totalLen, r,
            label = "sound chamber — half-round bore, block face (backset ${fmt(toUnits(n.backset, units), 3)}$units) → foot",
        )

        // ── SPLITTING EDGE — NOT MACHINED in this mode ─────────────────
        if (half == 2) {
            lines.add("( -- SPLITTING EDGE: left UNCUT — hand-carve the bevel, tip, and relief; tune by ear. )")
            lines.add("( Design reference (not machined): ${fmt(n.fippleDeg, 1)}° bevel, tip ${fmt(toUnits(n.tipHeight, units), 4)}$units above the flue floor, ${fmt(toUnits(n.tipFlat, units), 4)}$units tip flat, at X${fmt(toUnits(n.xTsh1, units), 3)}. -- )")
        }

        // ── FINGER HOLES (top half only) — drilled UNDERSIZED ──────────
        if (half == 2) {
            if (c.playable && c.holes.isNotEmpty()) {
                lines.add("( -- FINGER HOLES — bored from the seam face through the wall (spoilboard under the blank), each ${fmt(toUnits(HFU, units), 3)}$units undersized for hand tuning -- )")
                c.holes.sortedBy { it.fromTshIn }.forEach { h ->
                    val hx = c.sacLenIn + h.fromTshIn
                    drillRoundHole(
                        lines,
                        DrillRoundHoleParams(
                            label = "HOLE H${h.num} (${h.interval}) — design Ø${fmt(toUnits(h.diameterIn, units), 3)}$units", x = hx, y = centerY(hx),
                            holeDia = under(h.diameterIn, 0.05), depth = r + n.wallT + 0.05,
                            toolDiameter = toolDiameter, units = units, feedRate = feedRate, plungeRate = plungeRate,
                            safeHeight = safeHeight, retractHeight = retractForPins, zTop = 0.0,
                        ),
                    )
                }
            } else {
                lines.add("( (chamber ${ci + 1} is a drone — no finger holes) )")
            }
        }
    }

    // ══ Op 1C — the nest's OUTER-face features on the flipped top blank ══
    fun millNestOuter(c: GcodeChamber, ci: Int) {
        val n = nest[ci]
        val totalLen = c.sacLenIn + c.lengthIn
        val yOff = yOffs[ci]
        val yTopCenter = yBlankMinTop + blankWidth / 2
        val yRawTop = (2 * yMid - yOff) + yTableShift
        val yc = 2 * yTopCenter - yRawTop
        fun bowFn(x: Double): Double = if (bowAmp == 0.0) 0.0 else bowAmp * sin((x / totalLen) * PI)
        fun centerY(x: Double): Double = yc - bowFn(x) // bow mirrors with the flip

        lines.add("( ── Chamber ${ci + 1}${if (c.label.isNotEmpty()) " — ${c.label}" else ""} nest, outer face at Y${fmt(toUnits(yc, units), 3)} ── )")

        fun pocket(x0: Double, x1: Double, wide: Double, depth: Double, label: String) {
            if (x1 <= x0 + 1e-6 || depth <= 0) return
            lines.add("( -- $label: X${fmt(toUnits(x0, units), 3)}→${fmt(toUnits(x1, units), 3)}, ${fmt(toUnits(wide, units), 3)}$units wide, ${fmt(toUnits(depth, units), 3)}$units deep -- )")
            val reach = max(0.0, wide / 2 - toolDiameter / 2)
            val passes = max(1, ceil((2 * reach) / stepover).toInt() + 1)
            val levels = max(1, ceil(depth / stepdown).toInt())
            for (lv in 1..levels) {
                val z = -min(depth, lv * (depth / levels))
                for (pI in 0 until passes) {
                    val yo = if (passes == 1) 0.0 else -reach + (2 * reach) * (pI.toDouble() / (passes - 1))
                    lines.add("G0 X${fmt(toUnits(x0, units), 3)} Y${fmt(toUnits(centerY(x0) + yo, units), 3)} Z${fmt(toUnits(retractForPins, units), 3)}")
                    lines.add("G1 Z${fmt(toUnits(z, units), 3)} F${fmt(toUnits(plungeRate, units), 1)}")
                    val steps = max(2, Math.round((x1 - x0) / 0.06).toInt() + 1)
                    for (s in 1..steps) {
                        val x = x0 + (x1 - x0) * (s.toDouble() / steps)
                        lines.add("G1 X${fmt(toUnits(x, units), 3)} Y${fmt(toUnits(centerY(x) + yo, units), 3)} F${fmt(toUnits(feedRate, units), 1)}")
                    }
                    lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
                }
            }
        }

        // Every pocket below is UNDERSIZED for hand-finishing: width and
        // depth shrink by HFU, and the span (length) shrinks by HFU too,
        // trimmed evenly off both ends so the true edges stay centered on
        // the design opening.
        fun shrinkSpan(x0: Double, x1: Double): DoubleArray {
            val trim = min(HFU / 2, max(0.0, (x1 - x0) / 2 - 0.02))
            return doubleArrayOf(x0 + trim, x1 - trim)
        }

        // 1. AIR EXIT HOLE — through the wall into the tapering SAC. Undersized.
        run {
            val (x0, x1) = shrinkSpan(n.xExit0, n.xExit1)
            pocket(
                x0, x1, under(n.shW), under(n.tshCutDepth),
                "AIR EXIT HOLE — design ${fmt(toUnits(n.shW, units), 3)}×${fmt(toUnits(n.tshCutDepth, units), 3)}$units, cut ${fmt(toUnits(HFU, units), 3)}$units undersized in every dimension for hand-fitting",
            )
        }
        // 2. FLUE — shallow channel over the block; the bird roofs it.
        run {
            val (x0, x1) = shrinkSpan(n.xFlue0, n.xTsh0)
            pocket(
                x0, x1, under(n.shW), under(n.flueD),
                "FLUE — design ${fmt(toUnits(n.flueL, units), 3)}$units long × ${fmt(toUnits(n.flueD, units), 3)}$units deep, cut ${fmt(toUnits(HFU, units), 3)}$units undersized in every dimension; hand-carve to final shape, the bird roofs it",
            )
        }
        // 3. TSH STARTING HOLE — the window, roughed into the sound chamber.
        run {
            val (x0, x1) = shrinkSpan(n.xTsh0, n.xTsh1)
            pocket(
                x0, x1, under(n.shW), under(n.tshCutDepth),
                "TSH STARTING HOLE — design ${fmt(toUnits(n.shW, units), 3)}$units wide, cut ${fmt(toUnits(HFU, units), 3)}$units undersized; hand-carve out to the true window and shape the splitting edge (bevel, tip, relief — none of it machined here)",
            )
        }

        // 5. FINGER HOLES — SECOND PASS, from the outer face ──────────────
        if (c.playable && c.holes.isNotEmpty()) {
            val depth = n.wallT + n.overshoot
            lines.add("")
            lines.add("( -- FINGER HOLES — SECOND PASS from the OUTER face, ${fmt(toUnits(depth, units), 3)}$units deep, same ${fmt(toUnits(HFU, units), 3)}$units undersize as the first pass -- )")
            lines.add("( (wall ${fmt(toUnits(n.wallT, units), 3)} + ${fmt(toUnits(n.overshoot, units), 3)}$units through into the bore). Op 1B broke OUT through this )")
            lines.add("( face; cutting the same holes from this side cleans those edges where the fingers seal. -- )")
            c.holes.sortedBy { it.fromTshIn }.forEach { h ->
                val hx = c.sacLenIn + h.fromTshIn
                drillRoundHole(
                    lines,
                    DrillRoundHoleParams(
                        label = "HOLE H${h.num} (${h.interval}) — 2nd pass, outer face", x = hx, y = centerY(hx),
                        holeDia = under(h.diameterIn, 0.05), depth = depth,
                        toolDiameter = toolDiameter, units = units, feedRate = feedRate, plungeRate = plungeRate,
                        safeHeight = safeHeight, retractHeight = retractForPins, zTop = 0.0,
                    ),
                )
            }
        }
    }

    // ══ OPERATIONS ════════════════════════════════════════════════════
    if (wantHalves) {
        for (half in 1..2) {
            lines.add("")
            lines.add("( ══════════ OPERATION 1${if (half == 1) "A — BOTTOM HALF: seam face up — blow-air, half-round bore, ramp, sound chamber" else "B — TOP HALF: seam face up at +Y, Y-mirrored — same shape, plus finger holes"} ══════════ )")
            if (half == 2) lines.add("( Y-mirrored about the layout centreline, then shifted +Y${fmt(toUnits(yTableShift, units), 3)}$units onto its own blank — flip it onto the bottom half and every feature lines up. )")
            chambers.forEachIndexed { ci, c -> millChamberChannel(c, ci, half) }
            millMouthpieceRough(half)
            millAlignmentPins(half)
            if (alignPins && !pinPlan.ok && pinPlan.reason != null) lines.add("( NOTE — alignment pins skipped: ${pinPlan.reason} )")
        }
    }

    if (wantNest) {
        lines.add("")
        lines.add("( ══════════ OPERATION 1C — TOP HALF, FLIPPED: the nest's outer face + finger-hole cleanup ══════════ )")
        if (only == "all") {
            // Machine-readable marker: the viewer flips this blank's
            // simulated stock here, so the whole four-step process
            // animates in one run.
            lines.add("( STOCK-FLIP label=top-half axis=x )")
            lines.add("M0 ( PAUSE — FLIP THE TOP BLANK OVER about its LONG axis, so its OUTER face is now up. )")
            lines.add("( RE-ZERO Z on the flipped blank's top (outer) face, then resume. )")
        } else {
            lines.add("( STOCK-FLIP label=top-half axis=x preflipped=1 )")
            lines.add("( STANDALONE NEST PROGRAM — run this AFTER the halves program. )")
            lines.add("( SETUP: the TOP blank only, FLIPPED over about its LONG axis so its OUTER face is up. )")
            lines.add("( Leave it in the same X/Y position on the table; re-zero Z on the now-up outer face. )")
        }
        lines.add("( Y mirrors about the top blank's own centreline Y${fmt(toUnits(yBlankMinTop + blankWidth / 2, units), 3)} — the program does that for you. )")
        lines.add("( The flue, SAC exit hole and TSH are on the face OPPOSITE the bore — no setup reaches both, )")
        lines.add("( so this flip is unavoidable. Everything is still cut before glue-up. )")
        chambers.forEachIndexed { ci, c -> millNestOuter(c, ci) }

        // ── OPTIONAL: BODY OUTLINE — the very last pass(es) of the job ─────
        if (outlinePass != null) {
            val outlineMode = if (outlinePass == "cutout") "cutout" else "scribe"
            val SCRIBE_DEPTH = 0.072 // deep, unmissable reference groove
            val yTopCenter = yBlankMinTop + blankWidth / 2
            fun mapFlipY(yRaw: Double): Double = 2 * yTopCenter - ((2 * yMid - yRaw) + yTableShift)
            fun chamberFoot(ci: Int): Double = chambers[ci].sacLenIn + chambers[ci].lengthIn
            // Outer silhouette flank at station x (raw flute coords).
            fun flankAt(x: Double, side: Int): Double? {
                if (mpDoRough && x < -1e-9) {
                    val halfW = mpWidthAt(x)
                    return if (halfW > 1e-6) yMid + side * halfW else null
                }
                var best: Double? = null
                for (ci in chambers.indices) {
                    val tl = chamberFoot(ci)
                    if (x > tl + 1e-9) continue // this chamber has ended
                    val b = if (bowAmp == 0.0) 0.0 else bowAmp * sin((min(x, tl) / tl) * PI)
                    val y = yOffs[ci] + b + side * (nest[ci].r + nest[ci].wallT)
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
                if (mpDoRough) {
                    val NM = max(16, ceil((mpDomeLen + mpCapLen) / 0.12).toInt())
                    for (i in 0..NM) xs.add(mpTipX * (1 - i.toDouble() / NM))
                }
                val N = max(24, ceil(maxLen / 0.25).toInt())
                for (i in 0..N) xs.add(maxLen * (i.toDouble() / N))
                // straddle every intermediate foot so the silhouette's inward
                // STEP is drawn as a step, not smeared across a sample interval
                feet.forEach { f -> if (f > 1e-4 && f < maxLen - 1e-4) { xs.add(f - 1e-4); xs.add(f + 1e-4) } }
                return xs.sorted()
            }
            var pts = mutableListOf<DoubleArray>()
            buildXs().forEach { x -> flankAt(x, 1)?.let { y -> pts.add(doubleArrayOf(x, y)) } } // mouth → foot, high flank
            buildXs().reversed().forEach { x -> flankAt(x, -1)?.let { y -> pts.add(doubleArrayOf(x, y)) } } // foot → mouth, low flank
            if (outlineMode == "cutout") {
                // Cutter compensation: SEGMENT offset with mitered joins — see
                // the nest-insert emitter's comment for why the averaged-
                // normal approach was replaced.
                val toolR = toolDiameter / 2
                val nPts = pts.size
                if (nPts >= 2) {
                    val MITER_LIMIT = 6.0
                    data class Seg(val dx: Double, val dy: Double, val nx: Double, val ny: Double, val px: Double, val py: Double)
                    val seg = mutableListOf<Seg>()
                    for (i in 0 until nPts - 1) {
                        var dx = pts[i + 1][0] - pts[i][0]; var dy = pts[i + 1][1] - pts[i][1]
                        val L = hypot(dx, dy).let { if (it == 0.0) 1.0 else it }
                        dx /= L; dy /= L
                        val nx = -dy; val ny = dx // left normal of this segment
                        seg.add(Seg(dx, dy, nx, ny, pts[i][0] + nx * toolR, pts[i][1] + ny * toolR))
                    }
                    val off = mutableListOf(doubleArrayOf(seg[0].px, seg[0].py))
                    for (i in 1 until nPts - 1) {
                        val a = seg[i - 1]; val b = seg[i]
                        val den = a.dx * b.dy - a.dy * b.dx
                        var jx: Double; var jy: Double
                        if (abs(den) < 1e-9) {
                            jx = pts[i][0] + b.nx * toolR; jy = pts[i][1] + b.ny * toolR
                        } else {
                            val t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / den
                            jx = a.px + t * a.dx; jy = a.py + t * a.dy
                            val mx = jx - pts[i][0]; val my = jy - pts[i][1]; val ml = hypot(mx, my)
                            if (ml > MITER_LIMIT * toolR) {
                                val k = (MITER_LIMIT * toolR) / (if (ml == 0.0) 1.0 else ml)
                                jx = pts[i][0] + mx * k; jy = pts[i][1] + my * k
                            }
                        }
                        off.add(doubleArrayOf(jx, jy))
                    }
                    val lastSeg = seg[nPts - 2]
                    off.add(doubleArrayOf(pts[nPts - 1][0] + lastSeg.nx * toolR, pts[nPts - 1][1] + lastSeg.ny * toolR))
                    pts = off
                }
            }
            fun tracePath(z: Double) {
                val p0 = pts[0]
                lines.add("G0 X${fmt(toUnits(p0[0], units), 3)} Y${fmt(toUnits(mapFlipY(p0[1]), units), 3)} Z${fmt(toUnits(retractForPins, units), 3)}")
                lines.add("G1 Z${fmt(toUnits(z, units), 3)} F${fmt(toUnits(plungeRate, units), 1)}")
                pts.forEach { pt -> lines.add("G1 X${fmt(toUnits(pt[0], units), 3)} Y${fmt(toUnits(mapFlipY(pt[1]), units), 3)} F${fmt(toUnits(feedRate, units), 1)}") }
                lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
            }
            lines.add("")
            if (outlineMode == "scribe") {
                lines.add("( -- BODY-OUTLINE SCRIBE (optional, LAST pass) — ${fmt(toUnits(SCRIBE_DEPTH, units), 3)}$units deep reference groove -- )")
                lines.add("( The finished body's plan silhouette, traced dead-centre on the outer face: outer flanks, )")
                lines.add("( drone-foot steps, and across the foot. Saw / round the glued body to this line — cut on )")
                lines.add("( the WASTE side of it, the scribed groove itself IS the finished outline. )")
                tracePath(-SCRIBE_DEPTH)
            } else {
                // ── FULL CUTOUT — BOTH HALVES, WITH REGISTRATION TABS ──────────
                val cutDepth = blankThick + 0.04 // clear through, same as the mouthpiece rough
                val levels = max(1, ceil(cutDepth / stepdown).toInt())
                val TABS = 6
                val tabH = min(0.12, max(0.06, blankThick * 0.18)) // material left under each tab
                val tabTopZ = -(blankThick - tabH)
                val tabLen = 0.32 + toolDiameter
                val cum = mutableListOf(0.0)
                for (i in 1 until pts.size) cum.add(cum[i - 1] + hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
                val totalOutlineLen = cum.last()
                val tabCenters = (0 until TABS).map { k -> ((k + 0.5) / TABS) * totalOutlineLen }
                fun inTab(d: Double): Boolean = tabCenters.any { abs(d - it) < tabLen / 2 }
                // pin-swath safety: the cutter's outer edge must clear the pins
                val swath = nest.maxOf { it.wallT } + toolDiameter
                val pinInset = stockMarginY * 0.5
                val pinClear = pinInset > swath + 0.1
                lines.add("( -- BODY-OUTLINE FULL CUTOUT (optional, LAST passes) — BOTH halves, profile cut THROUGH -- )")
                lines.add("( The finished body's plan silhouette, tool-radius compensated OUTWARD, stepped down in )")
                lines.add("( $levels passes to ${fmt(toUnits(cutDepth, units), 3)}$units on the BOTTOM blank, then the flipped TOP blank. )")
                lines.add("( $TABS TABS per half (${fmt(toUnits(tabLen, units), 2)}$units long, ${fmt(toUnits(tabH, units), 3)}$units of material) are left on the deep passes: they )")
                lines.add("( hold each body half to the waste rails that carry the ALIGNMENT PINS, so the pin )")
                lines.add("( registration survives handling and glue-up. Break or saw the tabs off afterwards. )")
                if (!pinClear) {
                    lines.add("( ⚠⚠ PIN CLEARANCE: the cut swath (wall ${fmt(toUnits(nest.maxOf { it.wallT }, units), 3)} + cutter ${fmt(toUnits(toolDiameter, units), 3)}) reaches within )")
                    lines.add("( ${fmt(toUnits(max(0.0, pinInset - swath), units), 3)}$units of the pin stations — increase stock margin Y or use a smaller cutter, )")
                    lines.add("( or the cutout may graze the alignment pin holes. )")
                }
                data class Half(val name: String, val mapY: (Double) -> Double)
                val halvesToCut = listOf(
                    Half("BOTTOM half (seam side up, native Y)", { yRaw -> yRaw }),
                    Half("TOP half (flipped, outer face up)", { yRaw -> mapFlipY(yRaw) }),
                )
                halvesToCut.forEach { hf ->
                    lines.add("( -- outline cutout: ${hf.name} -- )")
                    for (lv in 1..levels) {
                        val z = -min(cutDepth, lv * stepdown)
                        val tabsActive = z < tabTopZ
                        lines.add("( pass $lv/$levels — Z${fmt(toUnits(z, units), 3)}${if (tabsActive) " — riding over the $TABS tabs" else ""} )")
                        val p0 = pts[0]
                        lines.add("G0 X${fmt(toUnits(p0[0], units), 3)} Y${fmt(toUnits(hf.mapY(p0[1]), units), 3)} Z${fmt(toUnits(retractForPins, units), 3)}")
                        lines.add("G1 Z${fmt(toUnits(if (tabsActive && inTab(0.0)) tabTopZ else z, units), 3)} F${fmt(toUnits(plungeRate, units), 1)}")
                        pts.forEachIndexed { pi, pt ->
                            val zi = if (tabsActive && inTab(cum[pi])) tabTopZ else z
                            lines.add("G1 X${fmt(toUnits(pt[0], units), 3)} Y${fmt(toUnits(hf.mapY(pt[1]), units), 3)} Z${fmt(toUnits(zi, units), 3)} F${fmt(toUnits(feedRate, units), 1)}")
                        }
                        lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
                    }
                }
            }
        }
    }

    lines.add("")
    if (only == "halves") {
        lines.add("( ══════════ HALVES DONE — now run the NEST program ══════════ )")
        lines.add("( Bores, ramps, blow-air, the solid block wall, finger holes and pins are cut. )")
        lines.add("( Next: flip the TOP blank over about its long axis, re-zero Z on its outer )")
        lines.add("( face, and run the nest program to cut the SAC exit hole, flue and TSH. )")
    } else {
        lines.add("( ══════════ DONE — every feature machined before glue-up ══════════ )")
        lines.add("( Glue the halves seam-to-seam on the pins, then round the outside. )")
        lines.add("( The splitting edge is machined: its bevel from the seam side (Op 1B), its )")
        lines.add("( tip flat and relief from the outer side (Op 1C). The finger holes were cut )")
        lines.add("( from both faces, so their outer edges are clean. Hone the tip and fit the bird. )")
    }

    lines.addAll(gcodeFooter(dialect))
    return lines.joinToString("\n")
}
