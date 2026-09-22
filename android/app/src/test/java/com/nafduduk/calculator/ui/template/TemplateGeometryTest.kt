package com.nafduduk.calculator.ui.template

import com.nafduduk.calculator.engine.Curve
import com.nafduduk.calculator.engine.NamedPitch
import com.nafduduk.calculator.engine.buildChamberGeometry
import com.nafduduk.calculator.engine.curveBowAmplitudeIn
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * The drilling template's layout maths. The thing worth guarding here is the
 * one the web source got wrong once and left a long comment about: a drawing
 * has ONE scale, pixels per real inch, and the hole radii and tube band must
 * come from it too. A separate constant for the vertical axis looks right on
 * a short tube and renders holes several times too large on a long one, which
 * is exactly the case a maker is most likely to be building.
 */
class TemplateGeometryTest {
    private fun chamber(bore: Double = 0.75, freq: Double = 369.99, holes: Int = 6, label: String = "MELODY"): TemplateChamber {
        val g = buildChamberGeometry(bore = bore, freq = freq, holeCount = holes)
        return TemplateChamber(
            label = label, boreIn = bore, sacLenIn = g.sacLenIn, lengthIn = g.lengthIn,
            holes = g.holes, playable = holes > 0, note = NamedPitch("F#4", 0),
        )
    }

    @Test
    fun `the drawing fills its width and holes land in tube order`() {
        val c = chamber()
        val l = FluteTemplateLayout(listOf(c), Curve.STRAIGHT)

        assertEquals(
            "the longest tube must reach the right margin",
            TemplateLayout.WIDTH - TemplateLayout.MARGIN_R, l.footX(c), 0.01f,
        )
        assertTrue("the TSH sits between the mouth and the foot", l.tshX(c) > TemplateLayout.MARGIN_L && l.tshX(c) < l.footX(c))

        val xs = c.holes.sortedBy { it.fromTshIn }.map { l.holeX(c, it) }
        assertEquals("hole order on the drawing must match hole order on the tube", xs, xs.sorted())
        assertTrue("every hole must fall inside the body", xs.all { it > l.tshX(c) && it < l.footX(c) })
    }

    @Test
    fun `hole radius and tube band use the same scale as hole spacing`() {
        // A long tube compresses the scale. If the radii came from a separate
        // constant they would stay put while the spacing shrank, and the holes
        // would visually overlap.
        val short = FluteTemplateLayout(listOf(chamber(bore = 0.5, freq = 880.0, holes = 6)), Curve.STRAIGHT)
        val long = FluteTemplateLayout(listOf(chamber(bore = 0.5, freq = 110.0, holes = 6)), Curve.STRAIGHT)
        assertTrue("a longer tube must compress the scale", long.scale < short.scale)

        for (l in listOf(short, long)) {
            val c = l.chambers[0]
            val sorted = c.holes.sortedBy { it.fromTshIn }
            for (i in 0 until sorted.size - 1) {
                val gap = l.holeX(c, sorted[i + 1]) - l.holeX(c, sorted[i])
                val radii = l.holeRadius(c, sorted[i]) + l.holeRadius(c, sorted[i + 1])
                assertTrue(
                    "H${sorted[i].num}/H${sorted[i + 1].num} drawn overlapping: gap=$gap radii=$radii",
                    radii <= gap,
                )
            }
        }
    }

    @Test
    fun `a hole can never be drawn wider than the tube it is drilled into`() {
        for (bore in listOf(0.375, 0.625, 1.0, 2.5)) {
            val c = chamber(bore = bore, freq = 220.0)
            val l = FluteTemplateLayout(listOf(c), Curve.STRAIGHT)
            val band = l.bandHeight(c)
            for (h in c.holes) {
                assertTrue("bore $bore H${h.num} spills outside the band", l.holeRadius(c, h) * 2 <= band)
            }
        }
    }

    @Test
    fun `the tube band stays readable at any bore`() {
        val thin = chamber(bore = 0.375, freq = 110.0)
        val fat = chamber(bore = 2.5, freq = 110.0)
        val lThin = FluteTemplateLayout(listOf(thin), Curve.STRAIGHT)
        val lFat = FluteTemplateLayout(listOf(fat), Curve.STRAIGHT)
        assertTrue("a thin bore must not vanish", lThin.bandHeight(thin) >= TemplateLayout.BAND_MIN)
        assertTrue("a huge bore must not blow out the row", lFat.bandHeight(fat) <= TemplateLayout.BAND_MAX)
    }

    @Test
    fun `the bow comes from the shared inch value, not a drawing constant`() {
        val c = chamber()
        val straight = FluteTemplateLayout(listOf(c), Curve.STRAIGHT)
        val slight = FluteTemplateLayout(listOf(c), Curve.SLIGHT)
        val heavy = FluteTemplateLayout(listOf(c), Curve.HEAVY)

        assertEquals("a straight body has no bow", 0f, straight.bowAmpPx, 0f)
        assertEquals(
            "the bow must be the shared inch value at this drawing's scale",
            (curveBowAmplitudeIn(Curve.SLIGHT) * slight.scale).toFloat(), slight.bowAmpPx, 1e-4f,
        )
        assertTrue("a heavier curve bows further", heavy.bowAmpPx > slight.bowAmpPx)

        // The bow peaks mid-tube and returns to the centerline at both ends.
        assertEquals(0f, slight.curveOffset(0f), 1e-4f)
        assertEquals(0f, slight.curveOffset(TemplateLayout.drawWidth), 1e-3f)
        assertEquals(slight.bowAmpPx, slight.curveOffset(TemplateLayout.drawWidth / 2), 1e-3f)
        assertEquals("the tilt is flat at the crown", 0f, slight.curveSlope(TemplateLayout.drawWidth / 2), 1e-4f)
    }

    @Test
    fun `a bowed drawing stays on the canvas`() {
        val c = chamber()
        val l = FluteTemplateLayout(listOf(c), Curve.HEAVY)
        val top = l.centerY(0, TemplateLayout.MARGIN_L + TemplateLayout.drawWidth / 2) - l.bandHeight(c) / 2
        assertTrue("the crown of the bow must not run off the top: $top", top > 0f)
        assertTrue("and the row must fit the canvas", l.rowBaseY(0) + l.bandHeight(c) / 2 < l.height)
    }

    @Test
    fun `every chamber of a drone flute shares one scale and gets its own row`() {
        val melody = chamber(label = "MELODY")
        val drone = chamber(bore = 0.625, freq = 246.94, holes = 0, label = "DRONE 1")
        val l = FluteTemplateLayout(listOf(melody, drone), Curve.STRAIGHT)

        // Whichever tube is longest reaches the margin; the other is shorter
        // by the same ratio it really is.
        val longest = listOf(melody, drone).maxByOrNull { it.sacLenIn + it.lengthIn }!!
        assertEquals(TemplateLayout.WIDTH - TemplateLayout.MARGIN_R, l.footX(longest), 0.01f)
        val realRatio = (drone.sacLenIn + drone.lengthIn) / (melody.sacLenIn + melody.lengthIn)
        val drawnRatio = ((l.footX(drone) - TemplateLayout.MARGIN_L) / (l.footX(melody) - TemplateLayout.MARGIN_L)).toDouble()
        assertEquals("the two tubes must stay in proportion", realRatio, drawnRatio, 1e-6)

        assertTrue("the second chamber gets its own row", l.rowBaseY(1) > l.rowBaseY(0))
        assertTrue("both rows fit", l.rowBaseY(1) + l.rowHeight / 2 < l.height)
    }

    @Test
    fun `the duduk template lays the reed seat before the bore`() {
        val holes = listOf(
            TemplateDudukHole(8, false, 1.9, 0.3),
            TemplateDudukHole(1, true, 1.2, 0.25),
        )
        val l = DudukTemplateLayout(bodyLenIn = 14.0, reedLenIn = 1.5, boreIn = 0.65, holes = holes)

        assertEquals(15.5, l.totalLenIn, 1e-12)
        assertEquals(DudukTemplateLayout.MARGIN_L, l.reedX0, 0f)
        assertTrue("the reed seat comes first", l.reedX1 > l.reedX0)
        assertEquals(
            "the body must reach the right margin",
            TemplateLayout.WIDTH - DudukTemplateLayout.MARGIN_R, l.footX, 0.01f,
        )
        // Holes are measured from the top of the reed seat, so they are
        // positioned from the seat's far edge, not the page margin.
        assertTrue(holes.all { l.holeX(it) >= l.reedX1 })
        assertTrue("a hole 1.9in down a 14in body sits well inside it", abs(l.holeX(holes[0]) - l.footX) > 1f)
    }

    @Test
    fun `a degenerate duduk does not divide by zero`() {
        val l = DudukTemplateLayout(bodyLenIn = 0.0, reedLenIn = 0.0, boreIn = 0.65, holes = emptyList())
        assertEquals(1f, l.scale, 0f)
        assertTrue(l.footX.isFinite())
    }
}
