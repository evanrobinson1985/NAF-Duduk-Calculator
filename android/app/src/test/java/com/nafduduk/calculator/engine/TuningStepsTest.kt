package com.nafduduk.calculator.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * The tuning walk's order is the part that is easy to get backwards, and
 * getting it backwards would have a maker drill the largest jump first —
 * cutting the hole that is hardest to correct before the easy ones exist.
 * Hole 1 sits closest to the FOOT but carries the LARGEST ratio, so the walk
 * runs from the highest hole number down.
 */
class TuningStepsTest {
    private val notes = getNotes(440.0)
    private val rootFreq = notes.first { it.name == "F#4" }.freq

    private fun geom(holes: Int = 6) = buildChamberGeometry(bore = 0.75, freq = rootFreq, holeCount = holes)

    private fun steps(holes: Int = 6) = tuningSteps(geom(holes).holes, holes, rootFreq, notes)

    @Test
    fun `the walk starts at the root and adds one hole per step`() {
        val s = steps()
        assertEquals("root plus one step per hole", 7, s.size)
        assertTrue("the first step covers everything", s.first().isRoot)
        assertNull(s.first().holeNum)
        assertEquals("the root step sounds the root", rootFreq, s.first().expectedFreq!!, 1e-9)
        assertTrue("every later step opens a hole", s.drop(1).none { it.isRoot })
    }

    @Test
    fun `holes open from the mouth end toward the foot, raising the pitch each step`() {
        val s = steps()
        val opened = s.drop(1).map { it.holeNum!! }
        assertEquals("highest hole number first", opened, opened.sortedDescending())
        assertEquals("every hole is walked exactly once", opened.toSet().size, opened.size)

        val freqs = s.map { it.expectedFreq!! }
        for (i in 0 until freqs.size - 1) {
            assertTrue(
                "step ${i + 1} must be higher than step $i: ${freqs[i]} -> ${freqs[i + 1]}",
                freqs[i + 1] > freqs[i],
            )
        }
    }

    @Test
    fun `expected pitch is the root times that hole's own placing ratio`() {
        // The same ratio that positioned the hole, so the assistant can never
        // disagree with the results table.
        val config = SCALE_CONFIGS.getValue(6)
        for (step in steps().drop(1)) {
            val ratio = config.holes.first { it.num == step.holeNum }.ratio
            assertEquals("H${step.holeNum}", rootFreq * ratio, step.expectedFreq!!, 1e-9)
            assertEquals("H${step.holeNum} interval", config.holes.first { it.num == step.holeNum }.interval, step.interval)
        }
    }

    @Test
    fun `the last step opens every hole and reaches the top of the scale`() {
        val s = steps()
        val last = s.last()
        assertEquals("the walk ends on the lowest-numbered hole", 1, last.holeNum)
        assertTrue("every hole is open at the end", geom().holes.all { last.isHoleOpen(it.num) })
        val topRatio = SCALE_CONFIGS.getValue(6).holes.maxOf { it.ratio }
        assertEquals(rootFreq * topRatio, last.expectedFreq!!, 1e-9)
    }

    @Test
    fun `opening a hole leaves every hole above it open too`() {
        // Covering works mouth-ward: opening H4 means H4, H5 and H6 are all
        // off the tube, and H1-H3 are still covered.
        val step = steps().first { it.holeNum == 4 }
        for (n in 4..6) assertTrue("H$n must be open", step.isHoleOpen(n))
        for (n in 1..3) assertFalse("H$n must still be covered", step.isHoleOpen(n))
        assertFalse("the root step has nothing open", steps().first().isHoleOpen(6))
    }

    @Test
    fun `every hole count the app offers produces a coherent walk`() {
        for (count in 1..7) {
            val s = steps(count)
            val holes = geom(count).holes
            assertEquals("$count-hole walk length", holes.size + 1, s.size)
            val freqs = s.mapNotNull { it.expectedFreq }
            assertEquals("$count: every step must have a pitch", s.size, freqs.size)
            for (i in 0 until freqs.size - 1) {
                assertTrue("$count-hole step $i does not rise", freqs[i + 1] > freqs[i])
            }
            assertTrue("$count: every step names a note", s.all { it.expectedNote != null })
        }
    }

    @Test
    fun `a chamber with no holes has nothing to walk through`() {
        assertTrue(tuningSteps(emptyList(), 0, rootFreq, notes).isEmpty())
    }

    @Test
    fun `an unknown root still lays out the steps, without pitches`() {
        val s = tuningSteps(geom().holes, 6, null, notes)
        assertEquals(7, s.size)
        assertTrue("no root means no expected pitch", s.all { it.expectedFreq == null && it.expectedNote == null })
        assertEquals("but the hole order still holds", listOf(6, 5, 4, 3, 2, 1), s.drop(1).map { it.holeNum })
    }

    @Test
    fun `cents against the expected pitch are signed the way a maker reads them`() {
        val expected = 440.0
        assertEquals("an octave up is +1200", 1200, centsOff(expected, 880.0))
        assertEquals("an octave down is -1200", -1200, centsOff(expected, 220.0))
        assertEquals("in tune is zero", 0, centsOff(expected, 440.0))
        assertTrue("sharp reads positive", centsOff(expected, 445.0)!! > 0)
        assertTrue("flat reads negative", centsOff(expected, 435.0)!! < 0)
        // A semitone is 100 cents, give or take rounding.
        assertTrue(abs(centsOff(expected, expected * Math.pow(2.0, 1 / 12.0))!! - 100) <= 1)
    }

    @Test
    fun `cents are undefined rather than wrong when there is nothing to compare`() {
        assertNull("silence is not flat", centsOff(440.0, 0.0))
        assertNull("no expected pitch, no reading", centsOff(null, 440.0))
        assertNull(centsOff(0.0, 440.0))
        assertNotNull(centsOff(440.0, 441.0))
    }
}
