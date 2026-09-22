package com.nafduduk.calculator.gcode

import com.nafduduk.calculator.engine.Curve

/**
 * What the CNC export panel decides, separated from how it is drawn.
 *
 * The split-block job is two SETUPS, not one program: the nest sits on the
 * face opposite the bore, so the top blank has to be turned over and
 * re-zeroed. Each setup therefore ships as its own file, so neither can be
 * run against the wrong work zero — this is the web source's own reasoning,
 * and getting it wrong wrecks a blank. Keeping the decision here (rather
 * than inside a composable) is what lets it be tested.
 */

enum class GcodeSetupMode(val id: String, val label: String) {
    ROTARY("rotary", "4th-Axis Rotary"),
    FIXED("fixed", "3-Axis, Manual Rotate"),
}

enum class ChannelStyle(val id: String, val label: String) {
    ROUND("round", "Round (ball-nose)"),
    FLAT("flat", "Flat-bottom"),
}

enum class OutlineMode(val id: String, val label: String) {
    OFF("off", "Off"),
    SCRIBE("scribe", "Scribe line"),
    CUTOUT("cutout", "Full cutout"),
}

enum class SplitStyle(val id: String, val label: String) {
    NEST_INSERT("nest-insert", "Embedded nest"),
    SYMMETRIC("symmetric", "Basic drilled layout"),
}

/** Every CNC setting the two generators accept, as the panel holds them. */
data class CncSettings(
    val method: GcodeMethod = GcodeMethod.SPLIT,
    val easyMode: Boolean = true,
    val dialect: String = "grbl",
    val units: String = "in",
    val toolDiameter: Double = 0.25,
    val feedRate: Double = 40.0,
    val plungeRate: Double = 12.0,
    val spindleSpeed: Double = 16000.0,
    val stepdown: Double = 0.06,
    val safeHeight: Double = 0.5,
    val retractHeight: Double = 0.1,
    val peckDepth: Double = 0.05,
    val stockMarginX: Double = 0.5,
    val stockMarginY: Double = 0.5,
    val channelStyle: ChannelStyle = ChannelStyle.ROUND,
    val setupMode: GcodeSetupMode = GcodeSetupMode.ROTARY,
    val alignPins: Boolean = true,
    val outlineMode: OutlineMode = OutlineMode.OFF,
    val splitStyle: SplitStyle = SplitStyle.NEST_INSERT,
)

/**
 * The settings actually handed to a generator. In Easy Mode every numeric
 * field comes from computeEasyModeParams — the flute's own bore and hole
 * sizes — and the rest keep the panel's choices, exactly as the web source
 * greys the fields out but still reads the toggles.
 */
fun CncSettings.resolve(chambers: List<GcodeChamber>): CncSettings {
    if (!easyMode) return this
    val e = computeEasyModeParams(chambers, method)
    return copy(
        toolDiameter = e.toolDiameter,
        feedRate = e.feedRate,
        plungeRate = e.plungeRate,
        spindleSpeed = e.spindleSpeed,
        stepdown = e.stepdown,
        peckDepth = e.peckDepth,
        safeHeight = e.safeHeight,
        retractHeight = e.retractHeight,
        stockMarginX = e.stockMarginX,
        stockMarginY = e.stockMarginY,
        channelStyle = ChannelStyle.entries.firstOrNull { it.id == e.channelStyle } ?: channelStyle,
        setupMode = GcodeSetupMode.entries.firstOrNull { it.id == e.setupMode } ?: setupMode,
    )
}

/** `.gcode` for GRBL, `.nc` for everything else — the web source's own rule. */
fun gcodeExtension(dialect: String): String = if (dialect == "grbl") "gcode" else "nc"

/** One downloadable program: what it is, why it is separate, and the file it becomes. */
data class GcodeProgram(
    val key: String,
    val label: String,
    val blurb: String,
    val fileName: String,
    val build: () -> String,
)

/**
 * A tool at or above the bore diameter cannot cut the bore at all, so the
 * program would be unrunnable. Returns the warning to show, or null.
 */
fun toolSafetyWarning(toolDiameter: Double, chambers: List<GcodeChamber>): String? {
    val maxBore = chambers.maxOfOrNull { it.boreIn } ?: return null
    if (toolDiameter >= maxBore) {
        return "⚠ Tool diameter (${toolDiameter}\") is larger than or equal to the bore (${maxBore}\") — " +
            "this program would not be safely runnable. Choose a smaller tool."
    }
    return null
}

/**
 * Every program this configuration produces, in the order they are run: the
 * per-setup files for a split-block job, then the combined all-operations
 * program (which carries the STOCK-FLIP marker) or, for tube drilling, the
 * single program.
 */
fun buildGcodePrograms(
    settings: CncSettings,
    chambers: List<GcodeChamber>,
    curve: Curve,
    droneBody: String,
): List<GcodeProgram> {
    val s = settings.resolve(chambers)
    val ext = gcodeExtension(s.dialect)

    if (s.method == GcodeMethod.TUBE) {
        return listOf(
            GcodeProgram(
                key = "tube",
                label = "Tube drilling",
                blurb = "Drills the sound hole, SAC exit, flue channel and finger holes into stock already cut to length and rounded.",
                fileName = "flute_tube_drilling.$ext",
                build = {
                    generateTubeDrillingGCode(
                        TubeDrillingParams(
                            chambers = chambers, units = s.units, toolDiameter = s.toolDiameter,
                            feedRate = s.feedRate, plungeRate = s.plungeRate, peckDepth = s.peckDepth,
                            safeHeight = s.safeHeight, retractHeight = s.retractHeight, dialect = s.dialect,
                            spindleSpeed = s.spindleSpeed, setupMode = s.setupMode.id, droneBody = droneBody,
                        ),
                    )
                },
            ),
        )
    }

    fun split(only: String) = SplitBlockParams(
        chambers = chambers, curve = curve, units = s.units, toolDiameter = s.toolDiameter,
        stepdown = s.stepdown, feedRate = s.feedRate, plungeRate = s.plungeRate, safeHeight = s.safeHeight,
        stockMarginX = s.stockMarginX, stockMarginY = s.stockMarginY, channelStyle = s.channelStyle.id,
        dialect = s.dialect, spindleSpeed = s.spindleSpeed, droneBody = droneBody, alignPins = s.alignPins,
        outlinePass = if (s.outlineMode == OutlineMode.OFF) null else s.outlineMode.id,
        splitStyle = s.splitStyle.id, only = only,
    )

    val setups = if (s.splitStyle == SplitStyle.NEST_INSERT) {
        listOf(
            GcodeProgram(
                "lower", "1 · Lower nest",
                "Tall lower blank (roof face up): bottom-half bore, ramp, flue floor, SAC exit, and the nest " +
                    "ridge shaped to the roof radius. Zero Z on its own top face.",
                "flute_nest_insert_1_lower.$ext",
            ) { generateSplitBlockGCode(split("halves")) },
            GcodeProgram(
                "upper", "2 · Upper shell",
                "Thin upper blank (seam face up): top-half bore, finger holes, the rectangular through-window, " +
                    "and the splitting-edge bevel on its downstream wall. Separate setup — zero Z on its own top face.",
                "flute_nest_insert_2_upper.$ext",
            ) { generateSplitBlockGCode(split("nest")) },
        )
    } else {
        listOf(
            GcodeProgram(
                "halves", "1 · Halves",
                "Both blanks, seam face up: blow-air (undersized) and full-round SAC + sound-chamber bore " +
                    "(exact size) — no ramp cut, block wall left solid, finger holes (undersized), pins.",
                "flute_split_block_1_halves.$ext",
            ) { generateSplitBlockGCode(split("halves")) },
            GcodeProgram(
                "nest", "2 · Nest (top half flipped)",
                "Top blank turned over, outer face up, re-zero Z: air-exit hole, flue, TSH starting hole — all " +
                    "undersized locating cuts — plus a second finger-hole pass. No splitting edge is machined.",
                "flute_split_block_2_nest.$ext",
            ) { generateSplitBlockGCode(split("nest")) },
        )
    }

    return setups + GcodeProgram(
        key = "all",
        label = "Combined (all operations)",
        blurb = "Every operation in one file, with a STOCK-FLIP marker where the top blank turns over. " +
            "For simulating the whole job — run the two setup files above on the machine.",
        fileName = "flute_split_block_all_ops.$ext",
        build = { generateSplitBlockGCode(split("all")) },
    )
}
