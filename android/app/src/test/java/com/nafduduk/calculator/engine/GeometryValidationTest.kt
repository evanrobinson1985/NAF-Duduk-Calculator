package com.nafduduk.calculator.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * The validation pass exists to catch numbers that did NOT come straight out
 * of buildChamberGeometry — a SAC override, a dragged hole, an old library
 * entry. So each test here starts from a sound chamber, breaks one thing the
 * way the app could really break it, and checks that the flag fires, that the
 * fix lands on the canonical value, and that nothing else moved.
 */
class GeometryValidationTest {
    private val notes = getNotes(440.0)

    private fun sound() = buildChamberGeometry(bore = 0.75, freq = 369.99, holeCount = 6)

    @Test
    fun `a freshly built chamber passes every check`() {
        for (holes in 0..6) {
            for (bore in listOf(0.5, 0.75, 1.0, 2.5)) {
                val g = buildChamberGeometry(bore = bore, freq = 369.99, holeCount = holes)
                val r = validateChamberGeometry(g)
                assertTrue("bore=$bore holes=$holes flagged: ${r.issues}", r.valid)
            }
        }
    }

    @Test
    fun `a sound chamber is returned untouched by the fix`() {
        val g = sound()
        val fixed = fixChamberGeometry(g)
        assertTrue("nothing to fix", fixed.fixes.isEmpty())
        assertEquals(g, fixed.geometry)
    }

    @Test
    fun `an out-of-range SAC length is flagged and snapped to the auto value`() {
        val broken = sound().copy(sacLenIn = 42.0)
        assertFalse(validateChamberGeometry(broken).valid)
        val fixed = fixChamberGeometry(broken)
        assertEquals(FluteConst.autoSacLen(broken.bore), fixed.geometry.sacLenIn, 0.001)
        assertTrue(validateChamberGeometry(fixed.geometry).valid)
    }

    @Test
    fun `a SAC override inside the sane range is left alone`() {
        // The web source deliberately only flags broken values, not
        // deviations from the auto formula — the override is the point.
        val auto = FluteConst.autoSacLen(0.75)
        val overridden = buildChamberGeometry(bore = 0.75, freq = 369.99, holeCount = 6, sacLenInOverride = auto + 1.0)
        assertTrue(abs(overridden.sacLenIn - auto) > 0.5)
        assertTrue("an in-range override must not be flagged", validateChamberGeometry(overridden).valid)
    }

    @Test
    fun `sound-hole dimensions are snapped back to the shared formulas`() {
        val broken = sound().copy(soundHoleWidthIn = 0.9, soundHoleLengthIn = 0.1)
        assertEquals(2, validateChamberGeometry(broken).issues.size)
        val fixed = fixChamberGeometry(broken).geometry
        assertEquals(FluteConst.soundHoleWidth(broken.bore), fixed.soundHoleWidthIn, 0.001)
        assertEquals(FluteConst.soundHoleLength(broken.bore), fixed.soundHoleLengthIn, 0.001)
    }

    @Test
    fun `total length must equal L plus SAC plus mouthpiece margin`() {
        val broken = sound().copy(totalLenIn = 1.0)
        assertFalse(validateChamberGeometry(broken).valid)
        val fixed = fixChamberGeometry(broken).geometry
        assertEquals(broken.lengthIn + broken.sacLenIn + broken.mouthpieceMarginIn, fixed.totalLenIn!!, 0.001)
    }

    @Test
    fun `a hole whose two measurements disagree has fromFoot recomputed, not fromTSH`() {
        val g = sound()
        val target = g.holes.first()
        val broken = g.copy(holes = g.holes.map { if (it.num == target.num) it.copy(fromFootIn = it.fromFootIn + 1.0) else it })
        assertFalse(validateChamberGeometry(broken).valid)

        val fixed = fixChamberGeometry(broken).geometry
        val h = fixed.holes.first { it.num == target.num }
        // fromTSH is the number you actually drill to, so it is the one kept.
        assertEquals("fromTSH must be preserved", target.fromTshIn, h.fromTshIn, 1e-9)
        assertEquals("fromFoot recomputed from it", g.lengthIn - h.fromTshIn, h.fromFootIn, 0.001)
        assertTrue(validateChamberGeometry(fixed).valid)
    }

    @Test
    fun `overlapping holes are flagged and shrunk to fit the gap`() {
        val g = sound()
        // Blow both of the closest pair up until their edges cross.
        val sorted = g.holes.sortedBy { it.fromTshIn }
        val gap = sorted.zipWithNext().minOf { (a, b) -> b.fromTshIn - a.fromTshIn }
        val broken = g.copy(holes = g.holes.map { it.copy(diameterIn = gap * 1.5) })
        assertTrue("overlap must be flagged", validateChamberGeometry(broken).issues.isNotEmpty())

        val fixed = fixChamberGeometry(broken).geometry
        assertTrue("fix must resolve every overlap: ${validateChamberGeometry(fixed).issues}", validateChamberGeometry(fixed).valid)
        assertTrue(
            "shrinking must never go below the drillable floor",
            fixed.holes.all { it.diameterIn >= FluteConst.HOLE_MIN_DIAMETER - 1e-9 },
        )
    }

    @Test
    fun `the audit reports what it changed and leaves nothing unresolved`() {
        val broken = sound().copy(sacLenIn = 99.0, soundHoleWidthIn = 0.01)
        val audit = auditChambers(listOf(broken), listOf("Melody"))
        assertFalse(audit.wasValid)
        assertTrue(audit.didFix)
        assertTrue("fix must leave nothing behind: ${audit.remaining}", audit.remaining.isEmpty())
        assertTrue("every issue is labelled", audit.issues.all { it.label == "Melody" })
        assertTrue("every fix is labelled", audit.fixes.all { it.label == "Melody" })
    }

    @Test
    fun `a sound flute needs no correction and the audit passes it through`() {
        val melody = sound()
        val drones = buildDroneResults(
            drones = listOf(
                DroneChamber(boreIn = 0.625, intervalIdx = 0, playable = false, holeCount = 2),
                DroneChamber(boreIn = 0.875, intervalIdx = 0, playable = true, holeCount = 3, noteKey = "A3"),
            ),
            rootFreq = 369.99, notes = notes, handSize = HandSize.AVERAGE,
            holeShapeKey = "round", melodyGeom = melody,
        )
        val audit = auditFluteChambers(melody, drones)
        assertTrue("melody + drones flagged: ${audit.issues}", audit.wasValid)
        assertEquals(melody, audit.melody)
        assertEquals(drones, audit.drones)
    }

    @Test
    fun `drone chambers are audited too and keep their own identity`() {
        val melody = sound()
        val drones = buildDroneResults(
            drones = listOf(DroneChamber(boreIn = 0.875, intervalIdx = 0, playable = true, holeCount = 3, noteKey = "A3")),
            rootFreq = 369.99, notes = notes, handSize = HandSize.AVERAGE,
            holeShapeKey = "round", melodyGeom = melody,
        )
        val broken = drones.map { it.copy(shWIn = 0.02) }
        val audit = auditFluteChambers(melody, broken)

        assertFalse(audit.wasValid)
        assertTrue("the drone must be named, not called 'chamber'", audit.issues.all { it.label.isNotBlank() })
        assertEquals(FluteConst.soundHoleWidth(broken[0].boreIn), audit.drones[0].shWIn, 0.001)
        // Fields the audit has no business touching must survive it.
        assertEquals(broken[0].note, audit.drones[0].note)
        assertEquals(broken[0].droneInterval, audit.drones[0].droneInterval)
        assertEquals(broken[0].holeCount, audit.drones[0].holeCount)
        assertEquals(broken[0].boreIn, audit.drones[0].boreIn, 1e-9)
    }
}
