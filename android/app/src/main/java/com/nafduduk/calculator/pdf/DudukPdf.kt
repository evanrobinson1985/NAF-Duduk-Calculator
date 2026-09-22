package com.nafduduk.calculator.pdf

import android.graphics.pdf.PdfDocument
import com.nafduduk.calculator.engine.DUDUK_HOLES_8
import com.nafduduk.calculator.engine.DudukDesign
import com.nafduduk.calculator.engine.Note
import com.nafduduk.calculator.engine.nearestNote
import com.nafduduk.calculator.util.jsFmt
import kotlin.math.max

private fun fmt(n: Double, dec: Int = 2): String = jsFmt(n, dec)

/**
 * The duduk's three-page workshop packet — a port of exportDudukPDF(), page
 * for page: the build sheet with the hole table, the true-scale drilling
 * template, and the fingering chart card.
 *
 * Figures are drawn from the same DudukDesign the screen displays, so the
 * printed numbers cannot disagree with the ones on screen.
 */
fun exportDudukPdf(design: DudukDesign, a4: Double, notes: List<Note>): PdfDocument {
    val doc = NafPdfDocument()
    drawDudukBuildSheet(doc.addPage(PdfPageSize.LETTER_PORTRAIT), design, a4)
    drawDudukTemplatePage(doc.addPage(PdfPageSize.LETTER_LANDSCAPE), design)
    drawDudukFingeringChartPage(doc.addPage(PdfPageSize.LETTER_PORTRAIT), design, notes)
    return doc.finish()
}

private fun drawDudukBuildSheet(c: PdfCanvas, d: DudukDesign, a4: Double) {
    c.setFont(bold = true)
    c.setFontSize(18f)
    c.text("Duduk Build Sheet — ${d.style.label}", 4.25f, 0.8f, TextAlign.CENTER)

    c.setFont(bold = false)
    c.setFontSize(11f)
    c.setDrawColor(200, 150, 50)
    c.setLineWidth(0.02f)
    c.line(0.8f, 1.0f, 7.7f, 1.0f)

    c.text("Tuning: A4 = ${jsFmt(a4, 0)} Hz    Bore: ${d.boreIn}\"    Root: ${d.rootNote.name}", 0.8f, 1.3f)
    c.text(
        "Body length: ${fmt(d.tubeLenIn)}\"    Reed seat depth: ${fmt(d.reedLenIn)}\"    Total: ${fmt(d.totalLenIn)}\"",
        0.8f, 1.65f,
    )
    c.text("Reed acoustic extension used in calculation: ${fmt(d.reedExtIn)}\"", 0.8f, 1.95f)

    c.setFont(bold = true)
    c.setFontSize(12f)
    c.text("Finger Holes (from top of reed seat):", 0.8f, 2.4f)
    c.setDrawColor(200, 150, 50)
    c.line(0.8f, 2.5f, 7.7f, 2.5f)

    val col = floatArrayOf(0.8f, 1.9f, 3.6f, 5.2f)
    c.setFont(bold = true)
    c.setFontSize(11f)
    c.text("Hole", col[0], 2.8f)
    c.text("Interval", col[1], 2.8f)
    c.text("From Reed Seat", col[2], 2.8f)
    c.text("Start Drill Ø", col[3], 2.8f)
    c.setFont(bold = false)

    var y = 3.1f
    for (h in d.holes) {
        c.text(if (h.thumb) "Thumb" else "H${h.num}", col[0], y)
        c.text(h.interval, col[1], y)
        c.text("${fmt(h.fromReedIn)}\"", col[2], y)
        c.text("${fmt(h.diameterIn)}\"", col[3], y)
        y += 0.32f
    }

    y += 0.15f
    c.setDrawColor(200, 150, 50)
    c.line(0.8f, y, 7.7f, y)
    y += 0.3f
    c.setFont(bold = false, italic = true)
    c.setFontSize(10f)
    for (line in listOf(
        "Reed seat is a stepped-down bore at the top of the tube sized to grip the reed shaft",
        "snugly. Carve/ream gradually and test-fit the reed often — too loose leaks air,",
        "too tight cracks the wood. The thumb hole sits on the back of the tube, opposite the",
        "front holes. Start finger holes small and enlarge gradually while checking pitch.",
    )) {
        c.text(line, 0.8f, y)
        y += 0.25f
    }
    y += 0.07f
    c.text("Traditional duduks use cane (ghamish) double reeds — pitch is highly adjustable by", 0.8f, y)
    y += 0.25f
    c.text("lip pressure and reed position, more so than Western reed instruments.", 0.8f, y)
    c.setFont(bold = false, italic = false)
}

private fun drawDudukTemplatePage(c: PdfCanvas, d: DudukDesign) {
    val pageW = PdfPageSize.LETTER_LANDSCAPE.widthIn
    val pageH = PdfPageSize.LETTER_LANDSCAPE.heightIn
    val margin = 0.5f

    c.setFont(bold = true)
    c.setFontSize(12f)
    c.text("Drilling Template — PRINT AT 100% SCALE (no \"fit to page\")", margin, 0.45f)
    c.setFont(bold = false)
    c.setFontSize(8f)
    c.text("Reed seat + body shown left to right. Verify the 1\" box with a ruler before drilling.", margin, 0.65f)

    val usableW = pageW - margin * 2
    val total = (d.reedLenIn + d.tubeLenIn).toFloat()
    val sc = dudukTemplateScale(total.toDouble(), usableW.toDouble()).toFloat()
    val ty = 1.6f
    val th = 0.5f
    val reedX0 = margin
    val reedX1 = margin + d.reedLenIn.toFloat() * sc
    val footX = margin + total * sc

    c.setDrawColor(80, 50, 20)
    c.setLineWidth(0.02f)
    c.setFillColor(230, 200, 150)
    c.rect(reedX0, ty, reedX1 - reedX0, th, fill = true)
    c.setFontSize(8f)
    c.setTextColor(160, 90, 0)
    c.text("REED SEAT", reedX0, ty - 0.08f)
    c.setTextColor(0, 0, 0)

    c.rect(reedX1, ty, footX - reedX1, th)

    for (h in d.holes.filter { !it.thumb }) {
        val hx = reedX1 + h.fromReedIn.toFloat() * sc
        val rad = max(0.035f, h.diameterIn.toFloat() / 2)
        c.setDrawColor(200, 120, 0)
        c.setLineWidth(0.02f)
        c.circle(hx, ty + th / 2, rad)
        c.setFontSize(7f)
        c.setFont(bold = true)
        c.text("H${h.num}", hx, ty - 0.05f, TextAlign.CENTER)
        c.setFont(bold = false)
        c.setFontSize(6f)
        c.text("Ø${fmt(h.diameterIn)}\"", hx, ty + th + 0.15f, TextAlign.CENTER)
    }

    d.holes.firstOrNull { it.thumb }?.let { t ->
        val hx = reedX1 + t.fromReedIn.toFloat() * sc
        val rad = max(0.03f, t.diameterIn.toFloat() / 2)
        c.setDrawColor(80, 180, 60)
        c.circle(hx, ty + th + 0.35f, rad)
        c.setFontSize(7f)
        c.text("Thumb (back)", hx, ty + th + 0.35f + rad + 0.12f, TextAlign.CENTER)
    }

    if (!isTrueScale(sc.toDouble())) {
        c.setFontSize(8f)
        c.setTextColor(200, 40, 40)
        c.text(
            "NOTE: instrument is longer than one page at 100% scale (scaled to ${jsFmt(sc * 100.0, 0)}% to fit). " +
                "Use the hole table on page 1 for exact measurements instead of this diagram.",
            margin, pageH - margin - 0.3f, maxWidthIn = usableW,
        )
        c.setTextColor(0, 0, 0)
    } else {
        c.setDrawColor(0, 0, 0)
        c.setLineWidth(0.015f)
        c.rect(pageW - margin - 1.0f, pageH - margin - 0.35f, 1.0f, 0.25f)
        c.setFontSize(7f)
        c.text("1.00\" exactly →", pageW - margin - 1.0f - 0.05f, pageH - margin - 0.20f, TextAlign.RIGHT)
        c.text("Measure this box with a ruler before drilling.", margin, pageH - margin + 0.12f)
    }
}

/**
 * The same "one page, every note" reference as the flute's fingering chart.
 * The seven front holes follow the cumulative mouth-ward-first opening rule,
 * straight from DUDUK_HOLES_8's own ratios. The thumbhole is shown separately
 * rather than folded into that ladder: its ratio (a 2nd) does not fit the
 * front-hole sequence, and how it combines with partly-open front holes is
 * instrument-specific, not something this app models.
 */
private fun drawDudukFingeringChartPage(c: PdfCanvas, d: DudukDesign, notes: List<Note>) {
    pageHeader(c, "Fingering Chart", "Cover = root note. Each note opens one more front hole, reed end toward foot.")

    val rootFreq = notes.firstOrNull { it.name == d.rootNote.name }?.freq
    val front = dudukFrontHoles()
    val thumb = DUDUK_HOLES_8.firstOrNull { it.thumb }
    val cols = dudukFingeringColumns(d, notes)

    val left = 0.9f
    val right = 7.6f
    val top = 1.75f
    val colW = (right - left) / cols.size
    val holeGap = 0.34f
    val holeRad = 0.09f
    val stackTop = top + 0.55f

    c.setFont(bold = false)
    c.setFontSize(8f)
    c.setTextColor(120, 120, 120)
    front.forEachIndexed { i, h -> c.text("H${h.num}", left - 0.28f, stackTop + i * holeGap + 0.03f, TextAlign.RIGHT) }
    c.setTextColor(0, 0, 0)

    cols.forEachIndexed { ci, col ->
        val cx = left + colW * ci + colW / 2

        c.setFont(bold = true)
        c.setFontSize(11.5f)
        c.text(col.note, cx, top, TextAlign.CENTER)
        c.setFont(bold = false)
        c.setFontSize(8f)
        c.setTextColor(120, 120, 120)
        c.text(col.sub, cx, top + 0.16f, TextAlign.CENTER)
        c.setTextColor(0, 0, 0)

        front.indices.forEach { ri ->
            val cy = stackTop + ri * holeGap
            c.setDrawColor(20, 20, 20)
            c.setLineWidth(0.014f)
            if (ri < col.openCount) {
                c.circle(cx, cy, holeRad)
            } else {
                c.setFillColor(20, 20, 20)
                c.circle(cx, cy, holeRad, fill = true)
            }
        }

        c.setFont(bold = false)
        c.setFontSize(7.5f)
        c.setTextColor(120, 120, 120)
        c.text(col.freq?.let { "${jsFmt(it, 0)} Hz" } ?: "--", cx, stackTop + front.size * holeGap + 0.22f, TextAlign.CENTER)
        c.setTextColor(0, 0, 0)
    }

    var y = stackTop + front.size * holeGap + 0.5f
    if (thumb != null) {
        c.setDrawColor(200, 150, 50)
        c.setLineWidth(0.01f)
        c.line(0.8f, y, 7.7f, y)
        y += 0.3f
        c.setFont(bold = true)
        c.setFontSize(11f)
        c.text("Thumbhole (back of tube)", 0.9f, y)
        val thumbNote = rootFreq?.let { nearestNote(it * thumb.ratio, notes).name } ?: "--"
        c.setFont(bold = false)
        c.text("with all front holes closed, gives $thumbNote  (${thumb.interval} above root)", 0.9f, y + 0.22f)
        y += 0.55f
    }

    c.setDrawColor(200, 150, 50)
    c.setLineWidth(0.015f)
    c.line(0.8f, y, 7.7f, y)
    y += 0.25f
    c.setFont(bold = false, italic = true)
    c.setFontSize(9f)
    c.setTextColor(90, 90, 90)
    c.text("Filled circle = hole covered. Open circle = hole open. Shown reed end (top) to foot end (bottom).", 0.8f, y, maxWidthIn = 6.9f)
    y += 0.2f
    c.text("Combining the thumbhole with partly-open front holes gives additional chromatic notes in practice,", 0.8f, y, maxWidthIn = 6.9f)
    y += 0.2f
    c.text("but the exact result is instrument-specific — find these by ear.", 0.8f, y, maxWidthIn = 6.9f)
    c.setTextColor(0, 0, 0)
    c.setFont(bold = false, italic = false)
}
