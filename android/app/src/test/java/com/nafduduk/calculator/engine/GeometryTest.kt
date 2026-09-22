package com.nafduduk.calculator.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * Invariants of the authoritative geometry builder. These are the properties
 * validateChamberGeometry() checks at runtime, asserted here over a spread of
 * real designs so a regression fails the build rather than reaching a maker's
 * drill press.
 *
 * Exact agreement with the original JavaScript is covered separately by
 * tools/parity/run.sh, which diffs both implementations value by value.
 */
class GeometryTest {
    private val notes = getNotes(440.0)

    private data class Case(val bore: Double, val freq: Double, val holes: Int, val hand: HandSize)

    private val cases = listOf(
        Case(0.625, 440.0, 6, HandSize.AVERAGE),
        Case(0.75, 369.99, 6, HandSize.AVERAGE),
        Case(0.75, 369.99, 5, HandSize.COMPACT),
        Case(1.0, 196.0, 6, HandSize.LARGE),
        Case(0.5, 587.33, 4, HandSize.AVERAGE),
        Case(1.25, 146.83, 6, HandSize.AVERAGE),
        Case(0.875, 220.0, 3, HandSize.AVERAGE),
    )

    @Test
    fun `totalLen is exactly tube plus SAC plus mouthpiece margin`() {
        for (c in cases) {
            val g = buildChamberGeometry(bore = c.bore, freq = c.freq, holeCount = c.holes, handSize = c.hand)
            val expected = g.lengthIn + g.sacLenIn + g.mouthpieceMarginIn
            assertEquals("totalLen for $c", expected, g.totalLenIn!!, GEOMETRY_TOLERANCE)
        }
    }

    @Test
    fun `each hole's distances from foot and TSH sum to the tube length`() {
        for (c in cases) {
            val g = buildChamberGeometry(bore = c.bore, freq = c.freq, holeCount = c.holes, handSize = c.hand)
            for (h in g.holes) {
                assertEquals(
                    "H${h.num} fromFoot+fromTSH for $c",
                    g.lengthIn, h.fromFootIn + h.fromTshIn, GEOMETRY_TOLERANCE,
                )
            }
        }
    }

    @Test
    fun `sound hole dimensions follow the shared FLUTE_CONST formulas`() {
        for (c in cases) {
            val g = buildChamberGeometry(bore = c.bore, freq = c.freq, holeCount = c.holes, handSize = c.hand)
            assertEquals(FluteConst.soundHoleWidth(c.bore), g.soundHoleWidthIn, GEOMETRY_TOLERANCE)
            assertEquals(FluteConst.soundHoleLength(c.bore), g.soundHoleLengthIn, GEOMETRY_TOLERANCE)
        }
    }

    @Test
    fun `adjacent finger holes never physically overlap`() {
        for (c in cases) {
            val g = buildChamberGeometry(bore = c.bore, freq = c.freq, holeCount = c.holes, handSize = c.hand)
            val sorted = g.holes.sortedBy { it.fromTshIn }
            for (i in 0 until sorted.size - 1) {
                val gap = sorted[i + 1].fromTshIn - sorted[i].fromTshIn
                val avgDiam = (sorted[i].diameterIn + sorted[i + 1].diameterIn) / 2
                assertTrue(
                    "H${sorted[i].num}/H${sorted[i + 1].num} overlap for $c: gap=$gap avgDiam=$avgDiam",
                    avgDiam <= gap + GEOMETRY_TOLERANCE,
                )
            }
        }
    }

    @Test
    fun `hole diameters respect the FLUTE_CONST floor`() {
        for (c in cases) {
            val g = buildChamberGeometry(bore = c.bore, freq = c.freq, holeCount = c.holes, handSize = c.hand)
            for (h in g.holes) {
                assertTrue("H${h.num} below floor for $c", h.diameterIn >= FluteConst.HOLE_MIN_DIAMETER - 1e-9)
            }
        }
    }

    @Test
    fun `hand size scales hole spacing monotonically`() {
        val compact = buildChamberGeometry(bore = 0.75, freq = 369.99, holeCount = 6, handSize = HandSize.COMPACT)
        val average = buildChamberGeometry(bore = 0.75, freq = 369.99, holeCount = 6, handSize = HandSize.AVERAGE)
        val large = buildChamberGeometry(bore = 0.75, freq = 369.99, holeCount = 6, handSize = HandSize.LARGE)
        fun span(g: ChamberGeometry) = g.holes.maxOf { it.fromTshIn } - g.holes.minOf { it.fromTshIn }
        assertTrue("compact span < average", span(compact) < span(average))
        assertTrue("average span < large", span(average) < span(large))
    }

    @Test
    fun `an unbuildable key yields a non-playable chamber instead of negative geometry`() {
        // 4 kHz through a 2.5in bore drives tubeLen below zero.
        val g = buildChamberGeometry(bore = 2.5, freq = 12000.0, holeCount = 6)
        assertEquals(0.0, g.lengthIn, 1e-12)
        assertTrue("no holes on an unbuildable tube", g.holes.isEmpty())
        assertTrue("not playable", !g.playable)
    }

    @Test
    fun `SAC and mouthpiece overrides are honoured and clamped`() {
        val custom = buildChamberGeometry(
            bore = 0.75, freq = 369.99, holeCount = 6,
            sacLenInOverride = 5.5, mouthpieceMarginInOverride = 1.25,
        )
        assertEquals(5.5, custom.sacLenIn, 1e-9)
        assertEquals(1.25, custom.mouthpieceMarginIn, 1e-9)

        val clampedLow = buildChamberGeometry(bore = 0.75, freq = 369.99, sacLenInOverride = 0.1)
        assertTrue("SAC clamped up to the sane floor", clampedLow.sacLenIn >= 0.8)
        val clampedHigh = buildChamberGeometry(bore = 0.75, freq = 369.99, sacLenInOverride = 99.0)
        assertTrue("SAC clamped down to the sane ceiling", clampedHigh.sacLenIn <= 20.0)
    }

    @Test
    fun `hole shape changes diameters by its acoustic factor only`() {
        val round = buildChamberGeometry(bore = 0.75, freq = 369.99, holeCount = 6, holeShapeKey = "round")
        val oval = buildChamberGeometry(bore = 0.75, freq = 369.99, holeCount = 6, holeShapeKey = "oval")
        assertEquals("positions must not move", round.holes.map { it.fromTshIn }, oval.holes.map { it.fromTshIn })
        val factor = HOLE_SHAPES.getValue("oval").acousticFactor
        for (i in round.holes.indices) {
            // Diameters are also gap-capped, so oval can only be <= round*factor.
            assertTrue(oval.holes[i].diameterIn <= round.holes[i].diameterIn * factor + 1e-9)
        }
    }

    @Test
    fun `drone chambers equalize SAC and align their holes with the melody tube`() {
        val melody = buildChamberGeometry(bore = 0.75, freq = 369.99, holeCount = 6)
        val results = buildDroneResults(
            drones = listOf(
                DroneChamber(boreIn = 0.625, intervalIdx = 0, playable = false, holeCount = 2),
                DroneChamber(boreIn = 0.875, intervalIdx = 0, playable = true, holeCount = 3, noteKey = "A3"),
            ),
            rootFreq = 369.99, notes = notes, handSize = HandSize.AVERAGE,
            holeShapeKey = "round", melodyGeom = melody,
        )
        assertEquals(2, results.size)
        for (r in results) {
            assertEquals("drone SAC equalized", melody.sacLenIn, r.sacLenIn, GEOMETRY_TOLERANCE)
        }
        assertTrue("a silent drone has no finger holes", results[0].holes.isEmpty())
        // "Silent" only suppresses the finger holes: the web source reports a
        // note whenever the chamber is a real tube (`playable ? nearestNote(..) : null`
        // where `playable` means L > 0), and a drone without holes still sounds
        // its fundamental.
        assertNotNull("a silent drone still sounds its fundamental", results[0].note)
        assertNotNull("a playable chamber reports its note", results[1].note)
        // Aligned holes: same axial position as the melody hole of that number.
        for (h in results[1].holes) {
            val melodyHole = melody.holes.first { it.num == h.num }
            assertTrue(
                "H${h.num} not aligned with the melody tube",
                abs(h.fromTshIn - melodyHole.fromTshIn) <= GEOMETRY_TOLERANCE,
            )
        }
    }

    @Test
    fun `the tuning reference moves every length and hole position`() {
        // 432 Hz is a lower A, so every tube is longer. Nothing about the
        // instrument itself changes — only what pitch it is cut to.
        val at440 = getNotes(440.0)
        val at432 = getNotes(432.0)
        val f440 = at440.first { it.name == "A4" }.freq
        val f432 = at432.first { it.name == "A4" }.freq
        assertTrue("A4 at 432 must be flatter than at 440", f432 < f440)

        val g440 = buildChamberGeometry(bore = 0.625, freq = f440, holeCount = 6)
        val g432 = buildChamberGeometry(bore = 0.625, freq = f432, holeCount = 6)
        assertTrue("a flatter root needs a longer tube", g432.lengthIn > g440.lengthIn)
        for (h in g440.holes) {
            val other = g432.holes.first { it.num == h.num }
            assertTrue(
                "H${h.num} must move with the tube",
                abs(other.fromTshIn - h.fromTshIn) > GEOMETRY_TOLERANCE,
            )
        }
    }

    @Test
    fun `a SAC override changes the blank length but never the pitch`() {
        val auto = buildChamberGeometry(bore = 0.75, freq = 369.99, holeCount = 6)
        val longer = buildChamberGeometry(bore = 0.75, freq = 369.99, holeCount = 6, sacLenInOverride = auto.sacLenIn + 2.0)

        assertEquals("the SAC is a plenum — it must not move the tube length", auto.lengthIn, longer.lengthIn, 1e-9)
        assertEquals("nor the holes", auto.holes.map { it.fromTshIn }, longer.holes.map { it.fromTshIn })
        assertEquals("but the blank gets longer", auto.totalLenIn!! + 2.0, longer.totalLenIn!!, 1e-9)
    }

    @Test
    fun `a mouthpiece margin override changes only the blank length`() {
        val auto = buildChamberGeometry(bore = 0.75, freq = 369.99, holeCount = 6)
        val trimmed = buildChamberGeometry(bore = 0.75, freq = 369.99, holeCount = 6, mouthpieceMarginInOverride = 0.0)
        assertEquals(auto.lengthIn, trimmed.lengthIn, 1e-9)
        assertEquals(auto.sacLenIn, trimmed.sacLenIn, 1e-9)
        assertEquals(auto.lengthIn + auto.sacLenIn, trimmed.totalLenIn!!, 1e-9)
    }
}
