package com.nafduduk.calculator.pdf

import com.nafduduk.calculator.engine.DUDUK_HOLES_8
import com.nafduduk.calculator.engine.DUDUK_STYLES
import com.nafduduk.calculator.engine.buildDudukDesignForKey
import com.nafduduk.calculator.engine.getNotes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The duduk packet's derived content. The drawing itself has no test —
 * android.graphics.pdf.PdfDocument throws outside an emulator — so the
 * decisions it draws are pulled out into pure functions and checked here.
 */
class DudukPdfContentTest {
    private val notes = getNotes(440.0)
    private val style = DUDUK_STYLES.getValue("traditional")

    private fun design(bore: Double = 0.65, note: String = "A3", reedLen: Double = 1.5) =
        buildDudukDesignForKey(
            style = style,
            boreIn = bore,
            reedExtIn = 1.5,
            reedLenIn = reedLen,
            rootFreq = notes.first { it.name == note }.freq,
            notes = notes,
        )

    @Test
    fun `the file name matches the web source's pattern and is filesystem-safe`() {
        assertEquals("duduk_traditional_A3_0.65bore.pdf", dudukPdfFileName(design()))
        // A sharp would otherwise put a '#' in the name, and a slash would
        // read as a directory separator.
        val sharp = dudukPdfFileName(design(note = "C#3"))
        assertFalse("no '#' may survive into a file name", sharp.contains("#"))
        assertFalse("no '/' may survive into a file name", sharp.contains("/"))
        assertTrue(sharp.startsWith("duduk_traditional_C_3_"))
    }

    @Test
    fun `a template that fits the page is drawn at true scale`() {
        val usableW = (PdfPageSize.LETTER_LANDSCAPE.widthIn - 1.0f).toDouble() // 0.5in margin each side
        val sc = dudukTemplateScale(usableW - 0.5, usableW)
        assertEquals(1.0, sc, 1e-12)
        assertTrue(isTrueScale(sc))
    }

    @Test
    fun `a real duduk does not fit the page, so its template is always flagged`() {
        // The source's closed-pipe formula puts an A3 body near 29in — far
        // longer than a landscape page — so the scaled-to-fit warning is the
        // normal case here, not the exception, and the hole table on page 1
        // is what a maker measures from.
        val d = design()
        assertTrue("an A3 duduk body should be tens of inches, was ${d.totalLenIn}", d.totalLenIn > 20)
        val usableW = (PdfPageSize.LETTER_LANDSCAPE.widthIn - 1.0f).toDouble()
        assertFalse(isTrueScale(dudukTemplateScale(d.totalLenIn, usableW)))
    }

    @Test
    fun `a template too long for the page is scaled down and says so`() {
        val sc = dudukTemplateScale(totalLenIn = 30.0, usableWidthIn = 10.0)
        assertEquals(1.0 / 3, sc, 1e-12)
        assertFalse("a shrunk template must not claim to be true scale", isTrueScale(sc))
    }

    @Test
    fun `template scale never exceeds 1 and survives a degenerate length`() {
        assertEquals("a short instrument still prints 1:1, not magnified", 1.0, dudukTemplateScale(2.0, 10.0), 1e-12)
        assertEquals("a zero length must not divide by zero", 1.0, dudukTemplateScale(0.0, 10.0), 1e-12)
    }

    @Test
    fun `the fingering ladder opens one more front hole per column`() {
        val cols = dudukFingeringColumns(design(), notes)
        assertEquals("root plus one column per front hole", dudukFrontHoles().size + 1, cols.size)
        assertEquals("the first column is the root, everything covered", 0, cols.first().openCount)
        assertEquals("A3", cols.first().note)
        cols.forEachIndexed { i, c -> assertEquals("column $i opens $i holes", i, c.openCount) }
    }

    @Test
    fun `the ladder opens front holes foot-end first and rises in pitch`() {
        // DUDUK_HOLES_8 numbers holes from the mouth end down, so opening
        // "mouth-ward first" means descending hole number.
        val front = dudukFrontHoles()
        assertEquals(front.map { it.num }, front.map { it.num }.sortedDescending())
        assertTrue("front holes only", front.none { it.thumb })

        val freqs = dudukFingeringColumns(design(), notes).mapNotNull { it.freq }
        for (i in 0 until freqs.size - 1) {
            assertTrue("opening a hole must raise the pitch: ${freqs[i]} -> ${freqs[i + 1]}", freqs[i + 1] > freqs[i])
        }
    }

    @Test
    fun `every ladder column reports a real note and frequency`() {
        for (note in listOf("G3", "A3", "C4")) {
            val cols = dudukFingeringColumns(design(note = note), notes)
            assertTrue("$note: every column names a note", cols.none { it.note == "--" })
            cols.forEach { assertNotNull("$note: every column has a frequency", it.freq) }
        }
    }

    @Test
    fun `the thumbhole is kept out of the front-hole ladder`() {
        // Its ratio is a 2nd, which does not belong in the cumulative
        // sequence; the chart lists it separately.
        val thumb = DUDUK_HOLES_8.first { it.thumb }
        assertTrue(dudukFingeringColumns(design(), notes).none { it.sub == thumb.interval })
    }
}
