@file:Suppress("unused")

// Kotlin half of the differential test (tools/parity/run.sh). Drives the
// ported engine + CAM with exactly the inputs js-driver.mjs feeds the original
// JSX, and prints the results as JSON for compare.mjs. Keep the two drivers in
// lockstep: same test cases, same key names, same rounding.
package auditdriver

import com.nafduduk.calculator.engine.*
import com.nafduduk.calculator.gcode.*
import kotlin.math.abs
import kotlin.math.sin
import kotlin.math.PI

// ── tiny JSON writer (keeps the harness dependency-free) ─────────────
private val sb = StringBuilder()
private var first = true

private fun esc(s: String): String {
    val b = StringBuilder()
    for (c in s) when (c) {
        '"' -> b.append("\\\"")
        '\\' -> b.append("\\\\")
        '\n' -> b.append("\\n")
        '\r' -> b.append("\\r")
        '\t' -> b.append("\\t")
        else -> if (c < ' ') b.append(String.format("\\u%04x", c.code)) else b.append(c)
    }
    return b.toString()
}

/** Matches the JS driver's r6(): 6-decimal rounding, dropping trailing zeros like JSON.stringify does. */
private fun n6(x: Double): String {
    if (x.isNaN() || x.isInfinite()) return "null"
    // Rounds like JS Number(x.toFixed(6)) — BigDecimal(double) sees the exact
    // binary value, which is what toFixed rounds (see GcodeCore.fmt).
    val r = java.math.BigDecimal(x).setScale(6, java.math.RoundingMode.HALF_UP).toDouble()
    return if (r == Math.floor(r) && abs(r) < 1e15) r.toLong().toString() else r.toString()
}

private fun jsonOf(v: Any?): String = when (v) {
    null -> "null"
    is String -> "\"${esc(v)}\""
    is Boolean -> v.toString()
    is Int -> v.toString()
    is Long -> v.toString()
    is Double -> n6(v)
    is List<*> -> v.joinToString(",", "[", "]") { jsonOf(it) }
    is Map<*, *> -> v.entries.joinToString(",", "{", "}") { "\"${esc(it.key.toString())}\":${jsonOf(it.value)}" }
    else -> "\"${esc(v.toString())}\""
}

private fun put(k: String, v: Any?) {
    if (!first) sb.append(",\n")
    first = false
    sb.append("\"${esc(k)}\":").append(jsonOf(v))
}

/** JS `fmt(n, dec)` / parseFloat round-trip, so geometry values compare like-for-like. */
private fun pf(x: Double, dec: Int): Double = java.math.BigDecimal(x).setScale(dec, java.math.RoundingMode.HALF_UP).toDouble()

fun main() {
    val notes440 = getNotes(440.0)

    // ── notes ────────────────────────────────────────────────────────
    put("notes.count", ALL_NOTES.size)
    put("notes.440", notes440.map { "${it.name}:${n6(it.freq)}:${it.family}:${if (it.advanced) 1 else 0}" })
    put("notes.432", getNotes(432.0).take(12).map { "${it.name}:${n6(it.freq)}" })
    put("noteNameFromFreq", listOf(220.0, 261.63, 370.0, 441.5, 1000.0).map { val p = noteNameFromFreq(it); "${p.name}:${p.cents}" })
    put("nearestNote", listOf(220.0, 300.0, 370.0, 441.5).map { val p = nearestNote(it, notes440); "${p.name}:${p.cents}" })

    // ── basic formulas ───────────────────────────────────────────────
    put("SPEED", SPEED_IN_PER_SEC)
    put("tubeLen", listOf(220.0 to 0.3125, 370.0 to 0.375, 440.0 to 0.25, 110.0 to 0.5).map { (f, r) -> tubeLen(f, r) })
    put("holeDiam", listOf(Triple(0.625, 1, 6), Triple(0.625, 3, 6), Triple(0.625, 6, 6), Triple(1.25, 2, 5), Triple(0.375, 4, 4))
        .map { (b, n, c) -> holeDiam(b, n, c) })
    put("holeShapeDiameter", listOf("round", "oval", "undercut", "countersunk").map { holeShapeDiameter(0.3, it) })
    put("curveBowAmplitudeIn", listOf(Curve.STRAIGHT, Curve.SLIGHT, Curve.HEAVY).map { curveBowAmplitudeIn(it) })
    put("FLUTE_CONST", linkedMapOf<String, Any?>(
        "SAC_LEN_RATIO" to FluteConst.SAC_LEN_RATIO, "SAC_LEN_MIN" to FluteConst.SAC_LEN_MIN,
        "HAND_FINISH_UNDERSIZE_IN" to FluteConst.HAND_FINISH_UNDERSIZE_IN, "MOUTHPIECE_MARGIN" to FluteConst.MOUTHPIECE_MARGIN,
        "SAC_EXIT_RAMP_ANGLE_DEG" to FluteConst.SAC_EXIT_RAMP_ANGLE_DEG, "FLUE_RAMP_FRACTION" to FluteConst.FLUE_RAMP_FRACTION,
        "HOLE_OVERLAP_CLEARANCE" to FluteConst.HOLE_OVERLAP_CLEARANCE, "HOLE_MIN_DIAMETER" to FluteConst.HOLE_MIN_DIAMETER,
        "INTERNAL_WALL_THICKNESS_RATIO" to FluteConst.INTERNAL_WALL_THICKNESS_RATIO,
        "INTERNAL_WALL_THICKNESS_MIN" to FluteConst.INTERNAL_WALL_THICKNESS_MIN,
        "INTERNAL_WALL_THICKNESS_MAX" to FluteConst.INTERNAL_WALL_THICKNESS_MAX,
        "CURVE_BOW_HEAVY_IN" to FluteConst.CURVE_BOW_HEAVY_IN, "CURVE_BOW_SLIGHT_IN" to FluteConst.CURVE_BOW_SLIGHT_IN,
    ))
    put("FLUTE_CONST.fns", listOf(0.5, 0.625, 0.75, 1.0, 1.5).flatMap { b ->
        val bs = if (b == Math.floor(b)) b.toInt().toString() else b.toString()
        listOf(
            "shW$bs:${n6(FluteConst.soundHoleWidth(b))}", "shL$bs:${n6(FluteConst.soundHoleLength(b))}",
            "flueD$bs:${n6(FluteConst.flueDepth(b))}", "flueL$bs:${n6(FluteConst.flueLength(b))}",
            "sac$bs:${n6(FluteConst.autoSacLen(b))}", "bhW$bs:${n6(FluteConst.breathHoleWidth(b))}",
            "bhL$bs:${n6(FluteConst.breathHoleLength(b))}",
        )
    })

    // ── bores / scale configs ────────────────────────────────────────
    put("BORES", BORES.map { "${it.label}:${n6(it.valIn)}:${n6(it.mm)}" })
    put("SCALE_CONFIGS", SCALE_CONFIGS.keys.sortedBy { it.toString() }.map { k ->
        val c = SCALE_CONFIGS.getValue(k)
        "$k:${c.name}:" + c.holes.joinToString(",") { "${it.num}/${it.interval}/${n6(it.ratio)}" }
    })
    put("DRONE_INTERVALS", DRONE_INTERVALS.map { "${it.label}:${n6(it.ratio)}" })
    put("HARMONY_PRESETS", HARMONY_PRESETS.map { "${it.id}:${it.name}:${it.intervals.joinToString("/")}" })
    fun recDump(f: Double): Map<String, Any?> {
        val rec = recommendedBores(f)
        return linkedMapOf(
            "best" to "${rec.best.bore.label}:${n6(rec.best.tubeLenIn)}:${if (rec.best.inHardRange) 1 else 0}:${if (rec.best.inSweetSpot) 1 else 0}",
            "reachesSweetSpot" to rec.reachesSweetSpot, "extreme" to rec.extreme,
            "extremeTooLong" to rec.extremeTooLong, "extremeTooShort" to rec.extremeTooShort,
            "options" to rec.options.map { "${it.bore.label}:${n6(it.tubeLenIn)}:${if (it.inHardRange) 1 else 0}:${if (it.inSweetSpot) 1 else 0}" },
        )
    }
    put("recommendedBores.370", recDump(370.0))
    put("recommendedBores.110", recDump(110.0))
    put("recommendedBores.1000", recDump(1000.0))

    // ── chamber geometry ─────────────────────────────────────────────
    data class GC(val bore: Double, val freq: Double, val holeCount: Int, val hand: HandSize,
                  val shape: String = "round", val sac: Double? = null, val mp: Double? = null)
    val geomCases = listOf(
        GC(0.625, 440.0, 6, HandSize.AVERAGE),
        GC(0.75, 369.99, 6, HandSize.AVERAGE),
        GC(0.75, 369.99, 5, HandSize.COMPACT),
        GC(1.0, 196.0, 6, HandSize.LARGE),
        GC(0.5, 587.33, 4, HandSize.AVERAGE),
        GC(0.75, 369.99, 0, HandSize.AVERAGE),
        GC(1.25, 146.83, 6, HandSize.AVERAGE, sac = 5.5),
        GC(0.75, 369.99, 6, HandSize.AVERAGE, shape = "oval"),
        GC(0.375, 1046.5, 3, HandSize.AVERAGE),
        GC(0.75, 369.99, 6, HandSize.AVERAGE, mp = 0.0),
    )
    geomCases.forEachIndexed { i, c ->
        val g = buildChamberGeometry(
            bore = c.bore, freq = c.freq, holeCount = c.holeCount, handSize = c.hand,
            holeShapeKey = c.shape, sacLenInOverride = c.sac, mouthpieceMarginInOverride = c.mp,
        )
        put("geom$i", linkedMapOf<String, Any?>(
            "L" to pf(g.lengthIn, 2), "sacLen" to pf(g.sacLenIn, 2),
            "totalLen" to (g.totalLenIn?.let { pf(it, 2) }), "mpMargin" to pf(g.mouthpieceMarginIn, 2),
            "shW" to pf(g.soundHoleWidthIn, 2), "shL" to pf(g.soundHoleLengthIn, 2),
            "holeCount" to g.holeCount, "playable" to g.playable,
            "holes" to g.holes.map { "${it.num}/${it.interval}/${n6(pf(it.fromFootIn, 2))}/${n6(pf(it.fromTshIn, 2))}/${n6(pf(it.diameterIn, 3))}" },
        ))
    }

    // ── ergonomic adjust + finger reach ─────────────────────────────
    // JS feeds the ROUNDED geometry holes into these; mirror that so the
    // comparison isolates formulas from the geometry rounding boundary.
    val rawBase = buildChamberGeometry(bore = 0.75, freq = 369.99, holeCount = 6).holes
    val baseHoles = rawBase.map { it.copy(fromFootIn = pf(it.fromFootIn, 2), fromTshIn = pf(it.fromTshIn, 2), diameterIn = pf(it.diameterIn, 3)) }
    listOf(0.0, 0.25, 0.5, 0.75, 1.0).forEach { b ->
        val key = "ergo" + (if (b == Math.floor(b)) b.toInt().toString() else b.toString())
        put(key, ergonomicAdjustHoles(baseHoles, b).map { "${it.hole.num}/${n6(pf(it.adjFromTshIn, 2))}/${n6(pf(it.adjDiameterIn, 3))}/${it.centsShift}" })
    }
    fun rounded(holes: List<FingerHole>) = holes.map { it.copy(fromFootIn = pf(it.fromFootIn, 2), fromTshIn = pf(it.fromTshIn, 2), diameterIn = pf(it.diameterIn, 3)) }
    fun reachDump(holes: List<FingerHole>): Map<String, Any?> {
        val a = analyzeFingerReach(holes)
        return linkedMapOf(
            "hasProblem" to a.hasProblem, "hasWarning" to a.hasWarning,
            "worst" to a.worst?.let { "${it.fromNum}-${it.toNum}:${n6(it.gapIn)}:${it.status.name.lowercase()}" },
            "gaps" to a.gaps.map { "${it.fromNum}-${it.toNum}:${n6(it.gapIn)}:${it.status.name.lowercase()}" },
        )
    }
    put("fingerReach.mid", reachDump(baseHoles))
    put("fingerReach.wide", reachDump(rounded(buildChamberGeometry(bore = 1.25, freq = 130.81, holeCount = 6).holes)))
    put("fingerReach.tight", reachDump(rounded(buildChamberGeometry(bore = 0.375, freq = 880.0, holeCount = 6).holes)))

    // ── antler fit ──────────────────────────────────────────────────
    listOf(
        listOf(20.0, 1.4, 0.95, 1.0), listOf(24.0, 1.6, 1.1, 0.0), listOf(14.0, 1.1, 0.85, 2.0),
        listOf(9.0, 0.8, 0.8, 0.0), listOf(14.0, 1.1, 0.55, 0.0), listOf(0.0, 1.0, 1.0, 0.0),
    ).forEachIndexed { i, p ->
        val curve = when (p[3].toInt()) { 1 -> Curve.SLIGHT; 2 -> Curve.HEAVY; else -> Curve.STRAIGHT }
        val a = analyzeAntlerFit(p[0], p[1], p[2], curve, notes440, 6)
        put("antler$i", if (a == null) null else linkedMapOf<String, Any?>(
            "fits" to a.fits, "reason" to a.reason, "maxUsableBore" to a.maxUsableBoreIn,
            "bore" to a.boreIn, "usableTubeLen" to a.usableTubeLenIn, "sacLen" to a.sacLenIn, "scaleName" to a.scaleName,
            "bestMatches" to a.bestMatches.map { "${it.name}/${n6(it.freq)}/${n6(it.idealLenIn)}/${n6(it.diffIn)}/${if (it.fitsExact) 1 else 0}/${if (it.fitsWithTrim) 1 else 0}/${if (it.tooLong) 1 else 0}" },
            "tooLongExamples" to a.tooLongExamples.map { "${it.name}/${n6(it.diffIn)}" },
        ))
    }

    // ── duduk ───────────────────────────────────────────────────────
    put("dudukTubeLen", listOf(Triple(220.0, 0.3, 1.5), Triple(293.66, 0.35, 2.0), Triple(174.61, 0.45, 2.5)).map { (f, r, e) -> dudukTubeLen(f, r, e) })
    put("dudukHoleDiam", listOf(0.6 to false, 0.6 to true, 0.9 to false, 0.35 to true).map { (b, t) -> dudukHoleDiam(b, t) })
    put("recommendedDudukBore", listOf(
        Triple(220.0, 0.4..0.9, 1.5), Triple(146.83, 0.4..1.1, 2.2), Triple(293.66, 0.55..0.85, 1.15),
    ).map { (f, range, e) ->
        val d = recommendedDudukBore(f, range, e)
        "${n6(d.boreIn)}:${n6(d.tubeLenIn)}:${if (d.reachesSweetSpot) 1 else 0}:${if (d.extreme) 1 else 0}:${if (d.extremeTooLong) 1 else 0}:${if (d.extremeTooShort) 1 else 0}"
    })
    put("DUDUK_STYLES", DUDUK_STYLES.keys.sorted().map { k ->
        val s = DUDUK_STYLES.getValue(k)
        "$k:${s.label}:${n6(s.boreRange.start)}-${n6(s.boreRange.endInclusive)}:${n6(s.reedLenRange.start)}-${n6(s.reedLenRange.endInclusive)}:${n6(s.reedExtRange.start)}-${n6(s.reedExtRange.endInclusive)}:${s.holeCount}"
    })
    put("DUDUK_HOLES_8", DUDUK_HOLES_8.map { "${it.num}/${it.interval}/${n6(it.ratio)}/${if (it.thumb) 1 else 0}" })

    // ── flow studio ─────────────────────────────────────────────────
    val fd = FLOW_DEFAULT_DESIGN
    put("FLOW_DEFAULT_DESIGN", linkedMapOf<String, Any?>(
        "rootFreq" to fd.rootFreq, "bore" to fd.bore, "L" to fd.lengthIn, "sacLen" to fd.sacLenIn,
        "shW" to fd.shW, "shL" to fd.shL, "flueDepthIn" to fd.flueDepthIn, "rampAngleDeg" to fd.rampAngleDeg,
        "fippleAngleDeg" to fd.fippleAngleDeg, "rampCurve" to fd.rampCurve,
        "breathHoleWidthIn" to fd.breathHoleWidthIn, "breathHoleLengthIn" to fd.breathHoleLengthIn,
        "wallThicknessIn" to fd.wallThicknessIn, "backsetIn" to fd.backsetIn, "tipFlatIn" to fd.tipFlatIn,
        "chimneyIn" to fd.chimneyIn, "tipHeightIn" to fd.tipHeightIn, "holeCount" to fd.holeCount,
    ))
    put("FLOW_AIR", linkedMapOf<String, Any?>("rho" to FlowAir.RHO, "nu" to FlowAir.NU, "c" to FlowAir.C))
    listOf(200.0, 400.0, 700.0, 1200.0).forEach { P ->
        val m = computeFluteAeroacoustics(fd, P)
        val pk = if (P == Math.floor(P)) P.toInt().toString() else P.toString()
        put("aero$pk", linkedMapOf<String, Any?>(
            "U" to m.u, "Q" to m.q, "QLpm" to m.qLpm, "Re" to m.re, "theta" to m.theta, "thetaTop" to m.thetaTop,
            "f0" to m.f0, "fTop" to m.fTop, "cutupRatio" to m.cutupRatio, "f1pred" to m.f1pred, "cents" to m.cents,
            "hM" to m.hM, "lcM" to m.lcM, "phaseLagCoeff" to m.phaseLagCoeff, "flueLenIn" to m.flueLenIn,
            "flueDevRatio" to m.flueDevRatio, "edgeOffsetRatio" to m.edgeOffsetRatio, "rampSep" to m.rampSep,
            "chimRatio" to m.chimRatio, "supplyRatio" to m.supplyRatio, "bhFriction" to m.bhFriction,
            "fipDeg" to m.fipDeg, "backsetRatio" to m.backsetRatio,
        ))
        put("aero$pk.regimes", "${m.jetRegime.label}|${m.jetRegime.tone}|${m.flowRegime.label}|${m.flowRegime.tone}")
        val s = scoreFlowQuality(m)
        put("score$pk", "${s.total}:" + s.parts.joinToString(",") { "${it.key}/${it.value}/${it.weight}" })
    }
    put("optimizeNestForDesign", listOf(300.0, 700.0).map { P ->
        val n = optimizeNestForDesign(fd, P)
        "rampAngleDeg=${n6(n.rampAngleDeg)},fippleAngleDeg=${n6(n.fippleAngleDeg)},shL=${n6(n.shL)},flueDepthIn=${n6(n.flueDepthIn)}"
    })
    put("bestPressureForNest", bestPressureForNest(fd))
    put("optimizeEverything", optimizeEverything(fd).let { o ->
        "sc=${o.score},P=${n6(o.pressurePa)},flueDepthIn=${n6(o.flueDepthIn)},shL=${n6(o.shL)},flueLengthIn=${n6(o.flueLengthIn)}," +
            "tipHeightIn=${n6(o.tipHeightIn)},rampAngleDeg=${n6(o.rampAngleDeg)},rampCurve=${n6(o.rampCurve)}," +
            "chimneyIn=${n6(o.chimneyIn)},backsetIn=${n6(o.backsetIn)},fippleAngleDeg=${n6(o.fippleAngleDeg)}"
    })

    // ── gcode plumbing ──────────────────────────────────────────────
    put("snapToCommonBit", listOf(0.03, 0.1, 0.2, 0.26, 0.4, 0.51).map { snapToCommonBit(it) })
    put("COMMON_BIT_SIZES_IN", COMMON_BIT_SIZES_IN)
    put("toUnits", listOf(1.0 to "in", 1.0 to "mm", 2.5 to "mm").map { (v, u) -> toUnits(v, u) })
    put("fmt", listOf(1.23456 to 2, 1.23456 to 4, 10.0 to 0, -0.5 to 3, 0.0005 to 3, 2.675 to 2).map { (v, d) -> fmt(v, d) })
    put("CNC_DIALECTS", CNC_DIALECTS.keys.sorted().map { "$it:${CNC_DIALECTS.getValue(it).programEnd}:${if (CNC_DIALECTS.getValue(it).supportsCannedCycles) 1 else 0}" })
    put("SPLIT_FIT", linkedMapOf<String, Any?>(
        "pinSizes" to SplitFit.pinSizes, "landClearance" to SplitFit.landClearance, "slipClearance" to SplitFit.slipClearance,
        "snugClearance" to SplitFit.snugClearance, "minPinDepth" to SplitFit.minPinDepth, "maxPinDepth" to SplitFit.maxPinDepth,
        "endInset" to SplitFit.endInset, "maxSpacing" to SplitFit.maxSpacing,
    ))
    put("gcodeHeader", gcodeHeader("grbl", "in", title = "T", notes = listOf("n1", "n2")))
    put("gcodeFooter", listOf("grbl", "linuxcnc", "mach3", "generic").map { gcodeFooter(it).joinToString("|") })

    fun mk(bore: Double, sacLen: Double, L: Double, playable: Boolean, label: String, shW: Double, shL: Double,
           holes: List<List<Any>>) = GcodeChamber(
        lengthIn = L, sacLenIn = sacLen, boreIn = bore, playable = playable, label = label, shWIn = shW, shLIn = shL,
        holes = holes.map { h ->
            val fromTsh = (h[2] as Number).toDouble()
            FingerHole(num = h[0] as Int, interval = h[1] as String, fromFootIn = L - fromTsh,
                fromTshIn = fromTsh, diameterIn = (h[3] as Number).toDouble())
        },
    )
    val holes6 = listOf(
        listOf(1, "root", 6.2, 0.31), listOf(2, "M2", 7.4, 0.31), listOf(3, "m3", 8.35, 0.28),
        listOf(4, "P4", 9.55, 0.28), listOf(5, "P5", 10.6, 0.28), listOf(6, "m7", 11.8, 0.26),
    )
    val single = listOf(mk(0.75, 3.45, 15.1, true, "MELODY", 0.375, 0.219, holes6))
    val drone = listOf(
        mk(0.75, 3.45, 15.1, true, "MELODY", 0.375, 0.219, holes6),
        mk(0.625, 3.45, 11.3, false, "DRONE 1", 0.3125, 0.2, emptyList()),
        mk(0.875, 3.45, 18.9, true, "CHAMBER 3 (PLAYABLE)", 0.4375, 0.24,
            listOf(listOf(1, "root", 7.1, 0.36), listOf(2, "M3", 9.2, 0.33))),
    )
    fun emp(chambers: List<GcodeChamber>, method: GcodeMethod): Map<String, Any?> {
        val p = computeEasyModeParams(chambers, method)
        return linkedMapOf(
            "toolDiameter" to p.toolDiameter, "feedRate" to p.feedRate, "plungeRate" to p.plungeRate,
            "spindleSpeed" to p.spindleSpeed, "stepdown" to p.stepdown, "peckDepth" to p.peckDepth,
            "safeHeight" to p.safeHeight, "retractHeight" to p.retractHeight, "stockMarginX" to p.stockMarginX,
            "stockMarginY" to p.stockMarginY, "channelStyle" to p.channelStyle, "setupMode" to p.setupMode,
        )
    }
    put("computeEasyModeParams.tube.single", emp(single, GcodeMethod.TUBE))
    put("computeEasyModeParams.split.single", emp(single, GcodeMethod.SPLIT))
    put("computeEasyModeParams.split.drone", emp(drone, GcodeMethod.SPLIT))
    put("computeEasyModeParams.tube.drone", emp(drone, GcodeMethod.TUBE))
    put("chamberYOffsets.single", chamberYOffsets(single))
    put("chamberYOffsets.drone", chamberYOffsets(drone))

    fun tube(chambers: List<GcodeChamber>, setupMode: String = "fixed", droneBody: String = "separate", units: String = "in") =
        generateTubeDrillingGCode(TubeDrillingParams(
            chambers = chambers, units = units, toolDiameter = 0.125, feedRate = 27.0, plungeRate = 8.0,
            peckDepth = 0.06, safeHeight = 0.5, retractHeight = 0.12, dialect = "grbl", spindleSpeed = 21000.0,
            setupMode = setupMode, droneBody = droneBody,
        ))
    put("GCODE.tube.single", tube(single))
    put("GCODE.tube.drone.solid", tube(drone, droneBody = "solid"))
    put("GCODE.tube.drone.separate", tube(drone, droneBody = "separate"))
    put("GCODE.tube.rotary", tube(single, setupMode = "rotary"))
    put("GCODE.tube.mm", tube(single, units = "mm"))

    fun split(chambers: List<GcodeChamber>, style: String, only: String = "all", outlinePass: String? = null,
              channelStyle: String = "round", curve: Curve = Curve.STRAIGHT, droneBody: String = "separate",
              alignPins: Boolean = true, units: String = "in") =
        generateSplitBlockGCode(SplitBlockParams(
            chambers = chambers, curve = curve, units = units, toolDiameter = 0.25, stepdown = 0.1,
            feedRate = 55.0, plungeRate = 17.0, safeHeight = 0.5, stockMarginX = 0.5, stockMarginY = 0.75,
            channelStyle = channelStyle, dialect = "grbl", spindleSpeed = 18000.0, droneBody = droneBody,
            alignPins = alignPins, outlinePass = outlinePass, splitStyle = style, only = only,
        ))
    for (style in listOf("nest-insert", "symmetric")) {
        for (only in listOf("halves", "nest", "all")) put("GCODE.split.$style.$only", split(single, style, only))
        put("GCODE.split.$style.cutout", split(single, style, outlinePass = "cutout"))
        put("GCODE.split.$style.scribe", split(single, style, outlinePass = "scribe"))
        put("GCODE.split.$style.flat", split(single, style, channelStyle = "flat"))
        put("GCODE.split.$style.curve", split(single, style, curve = Curve.SLIGHT))
        put("GCODE.split.$style.drone.solid", split(drone, style, droneBody = "solid"))
        put("GCODE.split.$style.nopins", split(single, style, alignPins = false))
        put("GCODE.split.$style.mm", split(single, style, units = "mm"))
    }

    // ── pitch detection ─────────────────────────────────────────────
    fun mkBuf(freq: Double, sr: Int, n: Int, amp: Double) = FloatArray(n) { i -> (amp * sin(2 * PI * freq * i / sr)).toFloat() }
    put("autoCorrelatePitch", listOf(
        autoCorrelatePitch(mkBuf(440.0, 44100, 2048, 0.5), 44100),
        autoCorrelatePitch(mkBuf(220.0, 44100, 2048, 0.5), 44100),
        autoCorrelatePitch(mkBuf(370.0, 48000, 4096, 0.3), 48000),
        autoCorrelatePitch(mkBuf(440.0, 44100, 2048, 0.001), 44100),
        autoCorrelatePitch(mkBuf(880.0, 44100, 4096, 0.4), 44100),
    ))

    println("{\n$sb\n}")
}
