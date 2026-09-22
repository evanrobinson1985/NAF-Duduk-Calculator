package com.nafduduk.calculator.gcode

import com.nafduduk.calculator.engine.Curve
import com.nafduduk.calculator.engine.FingerHole
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * CAM output properties that must hold for any design: no canned cycles (GRBL
 * compatibility), a spindle start, a program end, no NaN/Infinity leaking into
 * a coordinate, and JS-compatible number formatting.
 *
 * Exact agreement with the original JavaScript — including every toolpath
 * coordinate — is covered by tools/parity/run.sh.
 */
class GcodeTest {
    private fun holes(l: Double) = listOf(
        FingerHole(1, "root", l - 6.2, 6.2, 0.31),
        FingerHole(2, "M2", l - 7.4, 7.4, 0.31),
        FingerHole(3, "m3", l - 8.35, 8.35, 0.28),
        FingerHole(4, "P4", l - 9.55, 9.55, 0.28),
        FingerHole(5, "P5", l - 10.6, 10.6, 0.28),
        FingerHole(6, "m7", l - 11.8, 11.8, 0.26),
    )

    private val melody = GcodeChamber(
        lengthIn = 15.1, sacLenIn = 3.45, boreIn = 0.75, holes = holes(15.1),
        playable = true, label = "MELODY", shWIn = 0.375, shLIn = 0.219,
    )
    private val drone = GcodeChamber(
        lengthIn = 11.3, sacLenIn = 3.45, boreIn = 0.625, holes = emptyList(),
        playable = false, label = "DRONE 1", shWIn = 0.3125, shLIn = 0.2,
    )

    private fun split(
        chambers: List<GcodeChamber> = listOf(melody),
        style: String = "nest-insert",
        only: String = "all",
        units: String = "in",
        curve: Curve = Curve.STRAIGHT,
        outlinePass: String? = null,
        droneBody: String = "separate",
    ): String {
        val easy = computeEasyModeParams(chambers, GcodeMethod.SPLIT)
        return generateSplitBlockGCode(
            SplitBlockParams(
                chambers = chambers, curve = curve, units = units, toolDiameter = easy.toolDiameter,
                stepdown = easy.stepdown, feedRate = easy.feedRate, plungeRate = easy.plungeRate,
                safeHeight = easy.safeHeight, stockMarginX = easy.stockMarginX, stockMarginY = easy.stockMarginY,
                channelStyle = easy.channelStyle, dialect = "grbl", spindleSpeed = easy.spindleSpeed,
                droneBody = droneBody, alignPins = true, outlinePass = outlinePass, splitStyle = style, only = only,
            ),
        )
    }

    private fun tube(chambers: List<GcodeChamber> = listOf(melody), setupMode: String = "fixed"): String {
        val easy = computeEasyModeParams(chambers, GcodeMethod.TUBE)
        return generateTubeDrillingGCode(
            TubeDrillingParams(
                chambers = chambers, units = "in", toolDiameter = easy.toolDiameter, feedRate = easy.feedRate,
                plungeRate = easy.plungeRate, peckDepth = easy.peckDepth, safeHeight = easy.safeHeight,
                retractHeight = easy.retractHeight, dialect = "grbl", spindleSpeed = easy.spindleSpeed,
                setupMode = setupMode,
            ),
        )
    }

    private fun allPrograms(): Map<String, String> = buildMap {
        for (style in listOf("nest-insert", "symmetric")) {
            for (only in listOf("halves", "nest", "all")) put("split.$style.$only", split(style = style, only = only))
            put("split.$style.mm", split(style = style, units = "mm"))
            put("split.$style.curve", split(style = style, curve = Curve.SLIGHT))
            put("split.$style.cutout", split(style = style, outlinePass = "cutout"))
            put("split.$style.scribe", split(style = style, outlinePass = "scribe"))
            put("split.$style.drone", split(chambers = listOf(melody, drone), style = style, droneBody = "solid"))
        }
        put("tube.fixed", tube())
        put("tube.rotary", tube(setupMode = "rotary"))
        put("tube.drone", tube(chambers = listOf(melody, drone)))
    }

    @Test
    fun `no canned drilling cycles anywhere (GRBL has none)`() {
        val banned = Regex("""\bG8[1-9]\b""")
        for ((name, program) in allPrograms()) {
            val hit = program.lineSequence().firstOrNull { banned.containsMatchIn(it) }
            assertTrue("$name emits a canned cycle: $hit", hit == null)
        }
    }

    @Test
    fun `every program starts the spindle and ends the program`() {
        for ((name, program) in allPrograms()) {
            assertTrue("$name has no spindle start", program.contains("M3"))
            assertTrue("$name has no program end", program.contains("M30") || program.contains("M2"))
            assertTrue("$name has no spindle stop", program.contains("M5"))
        }
    }

    @Test
    fun `no coordinate is NaN or Infinity`() {
        val bad = Regex("""[XYZIJF](NaN|-?Infinity)""")
        for ((name, program) in allPrograms()) {
            val hit = program.lineSequence().firstOrNull { bad.containsMatchIn(it) }
            assertTrue("$name emits a non-finite coordinate: $hit", hit == null)
        }
    }

    @Test
    fun `every motion line carries a coordinate and units are declared`() {
        for ((name, program) in allPrograms()) {
            assertTrue("$name never declares units", program.contains("G20") || program.contains("G21"))
            program.lineSequence().filter { it.startsWith("G1 ") || it.startsWith("G0 ") }.forEach { line ->
                // A is the rotary axis: the 4th-axis setup emits a bare `G0 A0.00`,
                // which is a real move even though it touches no linear axis.
                assertTrue("$name motion line without an axis word: $line", Regex("""[XYZA]-?[\d.]""").containsMatchIn(line))
            }
        }
    }

    @Test
    fun `mm output declares G21 and inch output declares G20`() {
        assertTrue(split(units = "mm").contains("G21"))
        assertTrue(split(units = "in").contains("G20"))
    }

    @Test
    fun `fmt matches JS toFixed semantics on binary-boundary values`() {
        // These are exactly the cases where String.format("%.Nf") disagrees:
        // it rounds the shortest decimal repr, toFixed rounds the exact double.
        assertEquals("0.637", fmt(0.6375, 3))
        assertEquals("2.67", fmt(2.675, 2))
        assertEquals("0.85", fmt(0.855, 2))
        // True midpoints still round away from zero, like toFixed.
        assertEquals("0.13", fmt(0.125, 2))
        assertEquals("-1", fmt(-0.5, 0))
        assertEquals("1.23", fmt(1.23456, 2))
        assertEquals("10.0000", fmt(10.0, 4))
    }

    @Test
    fun `easy mode picks a real bit size and sane feeds`() {
        for (method in GcodeMethod.entries) {
            val p = computeEasyModeParams(listOf(melody, drone), method)
            assertTrue("tool must be a stock bit size", COMMON_BIT_SIZES_IN.any { kotlin.math.abs(it - p.toolDiameter) < 1e-9 })
            assertTrue("feed rate positive", p.feedRate > 0)
            assertTrue("plunge slower than feed", p.plungeRate < p.feedRate)
            assertTrue("stepdown positive", p.stepdown > 0)
            assertTrue("spindle in range", p.spindleSpeed in 10000.0..24000.0)
        }
    }

    @Test
    fun `drone lanes are laid out without overlapping bores`() {
        val chambers = listOf(melody, drone)
        val ys = chamberYOffsets(chambers)
        assertEquals(chambers.size, ys.size)
        val gap = kotlin.math.abs(ys[1] - ys[0])
        val minGap = (chambers[0].boreIn + chambers[1].boreIn) / 2
        assertTrue("lanes overlap: gap=$gap needs >= $minGap", gap >= minGap)
    }

    @Test
    fun `the two split styles produce genuinely different programs`() {
        val nest = split(style = "nest-insert")
        val sym = split(style = "symmetric")
        assertFalse("styles should not be identical", nest == sym)
        assertTrue("nest-insert names its operations", nest.contains("OPERATION A"))
        assertTrue("symmetric names its operations", sym.contains("OPERATION 1"))
    }

    @Test
    fun `halves and nest programs are strict subsets of the combined program's work`() {
        for (style in listOf("nest-insert", "symmetric")) {
            val all = split(style = style, only = "all").lines().size
            val halves = split(style = style, only = "halves").lines().size
            val nest = split(style = style, only = "nest").lines().size
            assertTrue("$style: combined should be the largest", all > halves && all > nest)
        }
    }
}
