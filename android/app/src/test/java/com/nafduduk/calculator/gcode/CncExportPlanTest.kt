package com.nafduduk.calculator.gcode

import com.nafduduk.calculator.engine.Curve
import com.nafduduk.calculator.engine.FingerHole
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the CNC export panel decides before any G-code is generated. The panel
 * itself is a composable and untestable here, so everything that matters —
 * which programs a configuration produces, what Easy Mode overrides, and the
 * tool-safety check — lives in CncExportPlan.kt and is checked here.
 */
class CncExportPlanTest {
    private val melody = GcodeChamber(
        lengthIn = 15.1, sacLenIn = 3.45, boreIn = 0.75,
        holes = listOf(
            FingerHole(1, "root", 8.9, 6.2, 0.31),
            FingerHole(2, "M2", 7.7, 7.4, 0.31),
            FingerHole(3, "m3", 6.75, 8.35, 0.28),
        ),
        playable = true, label = "MELODY", shWIn = 0.375, shLIn = 0.219,
    )
    private val drone = GcodeChamber(
        lengthIn = 11.3, sacLenIn = 3.45, boreIn = 0.625, holes = emptyList(),
        playable = false, label = "DRONE 1", shWIn = 0.3125, shLIn = 0.2,
    )
    private val chambers = listOf(melody, drone)

    private fun programs(s: CncSettings) = buildGcodePrograms(s, chambers, Curve.STRAIGHT, "separate")

    @Test
    fun `easy mode replaces every numeric field but keeps the structural choices`() {
        val manual = CncSettings(
            easyMode = true, toolDiameter = 999.0, feedRate = 999.0, spindleSpeed = 1.0,
            // These are choices, not computed values, so Easy Mode must not touch them.
            dialect = "mach3", units = "mm", splitStyle = SplitStyle.SYMMETRIC,
            outlineMode = OutlineMode.CUTOUT, alignPins = false,
        )
        val r = manual.resolve(chambers)
        val easy = computeEasyModeParams(chambers, GcodeMethod.SPLIT)

        assertEquals(easy.toolDiameter, r.toolDiameter, 1e-12)
        assertEquals(easy.feedRate, r.feedRate, 1e-12)
        assertEquals(easy.spindleSpeed, r.spindleSpeed, 1e-12)
        assertEquals("mach3", r.dialect)
        assertEquals("mm", r.units)
        assertEquals(SplitStyle.SYMMETRIC, r.splitStyle)
        assertEquals(OutlineMode.CUTOUT, r.outlineMode)
        assertFalse(r.alignPins)
    }

    @Test
    fun `manual mode passes every field through untouched`() {
        val manual = CncSettings(easyMode = false, toolDiameter = 0.125, feedRate = 33.0, spindleSpeed = 12345.0)
        val r = manual.resolve(chambers)
        assertEquals(0.125, r.toolDiameter, 1e-12)
        assertEquals(33.0, r.feedRate, 1e-12)
        assertEquals(12345.0, r.spindleSpeed, 1e-12)
    }

    @Test
    fun `a split job ships one file per setup plus a combined program`() {
        for (style in SplitStyle.entries) {
            val p = programs(CncSettings(method = GcodeMethod.SPLIT, splitStyle = style))
            assertEquals("$style: two setups and a combined file", 3, p.size)
            assertEquals("the combined program comes last", "all", p.last().key)
            // Distinct files matter: running setup 2 against setup 1's work
            // zero wrecks the blank.
            assertEquals("file names must be distinct", p.size, p.map { it.fileName }.toSet().size)
            assertTrue("every program must be named", p.all { it.label.isNotBlank() && it.blurb.isNotBlank() })
        }
    }

    @Test
    fun `the two split setups really are different programs`() {
        val p = programs(CncSettings(method = GcodeMethod.SPLIT))
        val first = p[0].build()
        val second = p[1].build()
        assertNotEquals("the two setups must not emit identical G-code", first, second)
        assertTrue(first.isNotBlank())
        assertTrue(second.isNotBlank())
    }

    @Test
    fun `tube drilling is a single program`() {
        val p = programs(CncSettings(method = GcodeMethod.TUBE))
        assertEquals(1, p.size)
        assertTrue(p[0].fileName.startsWith("flute_tube_drilling."))
    }

    @Test
    fun `file extension follows the dialect`() {
        assertEquals("gcode", gcodeExtension("grbl"))
        for (d in CNC_DIALECTS.keys.filter { it != "grbl" }) {
            assertEquals("$d must not claim GRBL's extension", "nc", gcodeExtension(d))
        }
        assertTrue(programs(CncSettings(dialect = "grbl")).all { it.fileName.endsWith(".gcode") })
        assertTrue(programs(CncSettings(dialect = "linuxcnc")).all { it.fileName.endsWith(".nc") })
    }

    @Test
    fun `every panel choice reaches the generated program`() {
        val inches = programs(CncSettings(units = "in")).last().build()
        val mm = programs(CncSettings(units = "mm")).last().build()
        assertTrue("inch output declares G20", inches.contains("G20"))
        assertTrue("mm output declares G21", mm.contains("G21"))

        // A dialect that ends with M2 rather than M30 must actually do so.
        assertTrue(programs(CncSettings(dialect = "linuxcnc")).last().build().contains("M2"))

        val off = programs(CncSettings(outlineMode = OutlineMode.OFF)).last().build()
        val cutout = programs(CncSettings(outlineMode = OutlineMode.CUTOUT)).last().build()
        assertNotEquals("the outline pass must change the program", off, cutout)
        assertTrue("a cutout adds passes", cutout.lines().size > off.lines().size)

        val pins = programs(CncSettings(alignPins = true)).last().build()
        val noPins = programs(CncSettings(alignPins = false)).last().build()
        assertNotEquals("alignment pins must change the program", pins, noPins)

        val rotary = programs(CncSettings(method = GcodeMethod.TUBE, easyMode = false, setupMode = GcodeSetupMode.ROTARY))[0].build()
        val fixed = programs(CncSettings(method = GcodeMethod.TUBE, easyMode = false, setupMode = GcodeSetupMode.FIXED))[0].build()
        assertNotEquals("the setup mode must change the program", rotary, fixed)
        assertTrue("a manual-rotate job must pause for the operator", fixed.contains("M0"))
    }

    @Test
    fun `a tool at or above the bore is rejected`() {
        // The smallest bore is what a single program has to fit through.
        assertNotNull("a tool wider than the bore is unrunnable", toolSafetyWarning(1.0, chambers))
        assertNotNull("equal to the bore cannot cut it either", toolSafetyWarning(0.75, chambers))
        assertNull("a sane tool passes", toolSafetyWarning(0.25, chambers))
        assertNull("no chambers, nothing to check", toolSafetyWarning(9.0, emptyList()))
    }

    @Test
    fun `the default configuration produces a runnable program`() {
        val s = CncSettings()
        assertNull("the defaults must not trip the tool check", toolSafetyWarning(s.resolve(chambers).toolDiameter, chambers))
        for (p in programs(s)) {
            val g = p.build()
            assertTrue("${p.key} must start the spindle", g.contains("M3"))
            assertTrue("${p.key} must stop the spindle", g.contains("M5"))
            assertFalse("${p.key} must not emit a canned cycle", Regex("""\bG8[1-9]\b""").containsMatchIn(g))
            assertFalse("${p.key} must not emit a non-finite coordinate", Regex("""[XYZIJF](NaN|-?Infinity)""").containsMatchIn(g))
        }
    }

    @Test
    fun `nest overrides reach the generated G-code`() {
        // The panel, the 3D preview and the CAM all read the same resolver
        // (engine/NestOverrides.kt); if the CAM ignored the overrides the
        // preview would be advertising a nest the machine never cuts.
        val stock = buildGcodePrograms(CncSettings(), listOf(melody), Curve.STRAIGHT, "separate").last().build()
        val voiced = buildGcodePrograms(
            CncSettings(),
            listOf(
                melody.copy(
                    nestOverrides = com.nafduduk.calculator.engine.NestOverrides(
                        wallThicknessIn = 0.16, flueDepthIn = 0.05, flueLengthIn = 0.9,
                        rampAngleDeg = 14.0, fippleAngleDeg = 28.0,
                    ),
                ),
            ),
            Curve.STRAIGHT, "separate",
        ).last().build()

        assertNotEquals("an overridden nest must change the toolpaths", stock, voiced)
        assertFalse("and must not produce a non-finite coordinate", Regex("""[XYZIJF](NaN|-?Infinity)""").containsMatchIn(voiced))
        assertTrue(voiced.contains("M3"))
        assertTrue(voiced.contains("M5"))
    }
}
