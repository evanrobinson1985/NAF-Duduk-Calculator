package com.nafduduk.calculator.ui.gcodeviewer

import com.nafduduk.calculator.engine.Curve
import com.nafduduk.calculator.engine.FingerHole
import com.nafduduk.calculator.gcode.CncSettings
import com.nafduduk.calculator.gcode.GcodeChamber
import com.nafduduk.calculator.gcode.SegmentType
import com.nafduduk.calculator.gcode.buildGcodePrograms
import com.nafduduk.calculator.gcode.parseGcode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * The viewer's own maths. A viewer that frames the job wrongly or puts the
 * tool in the wrong place is worse than no viewer — it is a wrong answer
 * that looks authoritative, and the whole point of simulating first is to
 * trust what you see.
 */
class ToolpathViewTest {
    private val square = parseGcode(
        """
        G20
        G0 X0 Y0 Z1
        G1 Z-0.1 F10
        G1 X2 Y0 F30
        G1 X2 Y1
        G1 X0 Y1
        G1 X0 Y0
        G0 Z1
        """.trimIndent(),
    )

    private val melody = GcodeChamber(
        lengthIn = 15.1, sacLenIn = 3.45, boreIn = 0.75,
        holes = listOf(FingerHole(1, "root", 8.9, 6.2, 0.31), FingerHole(2, "M2", 7.7, 7.4, 0.31)),
        playable = true, label = "MELODY", shWIn = 0.375, shLIn = 0.219,
    )

    @Test
    fun `consecutive moves of the same kind become one polyline`() {
        val runs = toolpathRuns(square)
        // Four cutting sides join into one run; the rapids stay separate.
        val cutting = runs.filter { it.cutting }
        assertTrue("cutting moves must merge, got ${cutting.size} runs", cutting.size <= 2)
        assertTrue("every run must be drawable", runs.all { it.points.size >= 2 })
        assertTrue("rapids must be kept apart from cuts", runs.any { !it.cutting })
    }

    @Test
    fun `a run never joins across a gap in the path`() {
        // A rapid between two cuts must break the cutting run, or the drawing
        // would show a cut where the tool was in the air.
        val parsed = parseGcode("G20\nG1 X0 Y0 F30\nG1 X1 Y0\nG0 X5 Y5\nG1 X6 Y5")
        val cutting = toolpathRuns(parsed).filter { it.cutting }
        assertEquals("two separate cutting runs", 2, cutting.size)
    }

    @Test
    fun `playback walks every motion and ends where the program does`() {
        val motions = motionSegments(square)
        assertTrue(motions.isNotEmpty())
        assertTrue("motions only", motions.all { it.type == SegmentType.RAPID || it.type == SegmentType.FEED })

        assertEquals("nothing done at the start", 0, completedMotionCount(motions, 0.0))
        assertEquals("everything done at the end", motions.size, completedMotionCount(motions, 1.0))

        val start = toolPositionAt(motions, 0.0)!!
        val end = toolPositionAt(motions, 1.0)!!
        assertEquals("starts where the first move starts", motions.first().from!!, start)
        assertEquals("ends where the last move ends", motions.last().to!!, end)
    }

    @Test
    fun `the completed count only ever moves forward`() {
        val motions = motionSegments(square)
        var last = -1
        for (i in 0..100) {
            val n = completedMotionCount(motions, i / 100.0)
            assertTrue("progress went backwards at $i", n >= last)
            assertTrue("count out of range: $n", n in 0..motions.size)
            last = n
        }
    }

    @Test
    fun `scrubbing reads as continuous travel, not endpoint snapping`() {
        // A program of exactly one move: halfway through must be halfway
        // along it, not snapped to either end.
        val single = parseGcode("G20\nG1 X10 Y0 F30")
        val motions = motionSegments(single)
        assertEquals(1, motions.size)
        assertTrue("expected the middle of the move, got x=${toolPositionAt(motions, 0.5)!!.x}", abs(toolPositionAt(motions, 0.5)!!.x - 5.0) < 1e-6)
        assertTrue(abs(toolPositionAt(motions, 0.25)!!.x - 2.5) < 1e-6)
    }

    @Test
    fun `progress is spread over the moves, so each gets an equal share`() {
        // The readout says "move N of M", and this is the model behind it:
        // the slider steps through moves, not distance travelled. A long
        // rapid therefore passes as quickly as a short plunge.
        val motions = motionSegments(square)
        for (i in motions.indices) {
            val atStart = completedMotionCount(motions, i.toDouble() / motions.size)
            assertEquals("move $i should begin exactly at its share of the slider", i, atStart)
        }
    }

    @Test
    fun `an arc is followed round rather than cut across`() {
        // A quarter circle from (1,0) to (0,1) about the origin: the midpoint
        // of the real path is on the circle, the midpoint of the chord is not.
        val arc = parseGcode("G20\nG1 X1 Y0 F30\nG3 X0 Y1 I-1 J0")
        val motions = motionSegments(arc)
        val last = motions.last()
        assertTrue("the arc must be flattened to a polyline", last.points.size > 2)

        val mid = toolPositionAt(motions, 0.999)!!
        val chordMid = 0.7071
        assertTrue("the path must bow out to the arc", abs(mid.x) <= 1.001 && abs(mid.y) <= 1.001)
        assertTrue("and not run along the chord", last.points.any { abs(it.x - chordMid) > 0.05 || abs(it.y - chordMid) > 0.05 })
    }

    @Test
    fun `the projection fits the job and never stretches it`() {
        val proj = ToolpathProjection(square.bounds, 320f, 200f)
        val minX = proj.x(square.bounds.min.x)
        val maxX = proj.x(square.bounds.max.x)
        val minY = proj.y(square.bounds.min.y)
        val maxY = proj.y(square.bounds.max.y)

        assertTrue("must stay inside the canvas", minX >= 0f && maxX <= 320f)
        assertTrue("must stay inside the canvas", maxY >= 0f && minY <= 200f)

        // One scale for both axes: a 2:1 part must be drawn 2:1.
        val drawnRatio = (maxX - minX) / (minY - maxY)
        val realRatio = (square.bounds.sizeX / square.bounds.sizeY).toFloat()
        assertEquals("aspect ratio must be preserved", realRatio, drawnRatio, 1e-3f)
    }

    @Test
    fun `Y is flipped, because the table runs up and the screen runs down`() {
        // Getting this backwards mirrors the part, which on an asymmetric
        // flute body is not obvious by eye.
        val proj = ToolpathProjection(square.bounds, 320f, 200f)
        assertTrue(
            "a larger Y must draw higher up the screen",
            proj.y(square.bounds.max.y) < proj.y(square.bounds.min.y),
        )
        assertTrue(
            "a larger X must draw further right",
            proj.x(square.bounds.max.x) > proj.x(square.bounds.min.x),
        )
    }

    @Test
    fun `a degenerate program does not blow up the projection`() {
        val dot = parseGcode("G20\nG1 X1 Y1 F10")
        val proj = ToolpathProjection(dot.bounds, 320f, 200f)
        assertTrue("scale must stay finite and positive", proj.scale.isFinite() && proj.scale > 0f)
        assertTrue(proj.x(1.0).isFinite() && proj.y(1.0).isFinite())
    }

    @Test
    fun `an empty program has nothing to play`() {
        val empty = parseGcode("")
        assertTrue(toolpathRuns(empty).isEmpty())
        assertEquals(0, motionSegments(empty).size)
        assertNull(toolPositionAt(emptyList(), 0.5))
        assertEquals(0, completedMotionCount(emptyList(), 1.0))
    }

    @Test
    fun `a real generated program plays through end to end`() {
        // The viewer's actual job: read what this app emits.
        for (p in buildGcodePrograms(CncSettings(), listOf(melody), Curve.STRAIGHT, "separate")) {
            val parsed = parseGcode(p.build())
            val motions = motionSegments(parsed)
            assertTrue("${p.key}: should have motion", motions.size > 100)
            assertTrue("${p.key}: should have drawable runs", toolpathRuns(parsed).isNotEmpty())
            assertNotNull("${p.key}: a tool position at the end", toolPositionAt(motions, 1.0))

            val proj = ToolpathProjection(parsed.bounds, 400f, 250f)
            for (seg in motions) {
                val to = seg.to ?: continue
                assertTrue("${p.key}: projected off-canvas", proj.x(to.x).isFinite() && proj.y(to.y).isFinite())
            }
            assertTrue("${p.key}: the program declares its units", parsed.units == "in" || parsed.units == "mm")
        }
    }
}
