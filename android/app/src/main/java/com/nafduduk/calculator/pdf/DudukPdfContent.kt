package com.nafduduk.calculator.pdf

import com.nafduduk.calculator.engine.DUDUK_HOLES_8
import com.nafduduk.calculator.engine.DudukDesign
import com.nafduduk.calculator.engine.Note
import com.nafduduk.calculator.engine.nearestNote
import kotlin.math.min

/**
 * The parts of the duduk packet that are decisions rather than drawing.
 *
 * Kept free of android.graphics so they can be unit-tested: the drawing
 * itself cannot be, because android.graphics.pdf.PdfDocument is a
 * throwing stub outside an emulator. Everything here is what would
 * otherwise only be caught by printing a page and measuring it.
 */

/** Matches the web source's `duduk_${style}_${safeName}_${bore}bore.pdf`. */
fun dudukPdfFileName(design: DudukDesign): String {
    val safeName = design.rootNote.name.replace(Regex("[#/]"), "_")
    return "duduk_${design.style.id}_${safeName}_${design.boreIn}bore.pdf"
}

/**
 * Scale for the drilling template: true 1:1 when the instrument fits the
 * page, otherwise shrunk to fit and flagged. Printing a template at an
 * unannounced 94% is how you drill a flute a semitone flat, so a scale below
 * 1 has to be stated on the page.
 */
fun dudukTemplateScale(totalLenIn: Double, usableWidthIn: Double): Double =
    if (totalLenIn <= 0) 1.0 else min(1.0, usableWidthIn / totalLenIn)

/** True when the template is 1:1 and the ruler-check box should be drawn instead of the warning. */
fun isTrueScale(scale: Double): Boolean = scale >= 0.999

/** One column of the fingering chart: a note and how many front holes are open for it. */
data class DudukFingeringColumn(
    val note: String,
    val sub: String,
    val freq: Double?,
    val openCount: Int,
)

/** The front holes, foot-end first — the order the chart opens them in. */
fun dudukFrontHoles() = DUDUK_HOLES_8.filter { !it.thumb }.sortedByDescending { it.num }

/**
 * The chart's ladder: cover everything for the root, then open one more
 * front hole per column, mouth-ward first. Built straight from
 * DUDUK_HOLES_8's own ratios, so it cannot drift from the hole positions.
 * The thumbhole is deliberately not part of this sequence — its ratio (a
 * 2nd) does not fit it, and how it combines with partly-open front holes is
 * instrument-specific.
 */
fun dudukFingeringColumns(design: DudukDesign, notes: List<Note>): List<DudukFingeringColumn> {
    val rootFreq = notes.firstOrNull { it.name == design.rootNote.name }?.freq
    return listOf(DudukFingeringColumn(design.rootNote.name, "all closed", rootFreq, 0)) +
        dudukFrontHoles().mapIndexed { i, h ->
            DudukFingeringColumn(
                note = rootFreq?.let { nearestNote(it * h.ratio, notes).name } ?: "--",
                sub = h.interval,
                freq = rootFreq?.times(h.ratio),
                openCount = i + 1,
            )
        }
}
