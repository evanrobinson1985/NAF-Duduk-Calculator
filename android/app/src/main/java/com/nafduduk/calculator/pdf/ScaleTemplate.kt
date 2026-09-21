package com.nafduduk.calculator.pdf

import java.util.Locale
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.round

enum class ScaleTemplateMode { CUT, DRILL }

private fun fmt(n: Double, dec: Int = 2): String = String.format(Locale.US, "%.${dec}f", n)

/**
 * Ported 1:1 from drawScaleTemplate() in the web source: a true-scale
 * (print-at-100%) cutting or drilling guide, one row per chamber, tiled
 * across as many landscape-letter pages as the longest chamber needs, with
 * a 1" calibration box on every page so a mis-scaled print is obvious
 * before it wastes stock.
 */
fun drawScaleTemplate(doc: NafPdfDocument, chambers: List<PdfChamber>, mode: ScaleTemplateMode) {
    val pageW = 11f
    val pageH = 8.5f
    val margin = 0.5f
    val usableW = pageW - margin * 2
    val top = 1.0f
    val rowGap = 1.3f
    val tubeH = 0.5f

    val grandTotal = max(chambers.maxOfOrNull { (it.sacLenIn + it.lengthIn).toFloat() } ?: 1f, 1f)
    val nPages = max(1, ceil(grandTotal / usableW).toInt())

    val rowColors = listOf(
        Triple(200, 120, 0), Triple(80, 150, 40), Triple(100, 120, 220), Triple(200, 60, 140),
    )
    val titleWord = if (mode == ScaleTemplateMode.CUT) "Cutting" else "Drilling"

    for (p in 0 until nPages) {
        val c = doc.addPage(PdfPageSize.LETTER_LANDSCAPE)

        val segStart = p * usableW
        val segEnd = min(grandTotal, segStart + usableW)

        c.setFont(bold = true)
        c.setFontSize(12f)
        c.text("$titleWord Template — Page ${p + 1} of $nPages — PRINT AT 100% SCALE (no \"fit to page\")", margin, 0.45f)
        c.setFont(bold = false)
        c.setFontSize(8f)
        c.text(
            "Segment shows ${fmt(segStart.toDouble())}\" to ${fmt(segEnd.toDouble())}\" measured from the mouthpiece end. Tape pages together at the alignment marks if multi-page.",
            margin, 0.65f,
        )

        c.setDrawColor(150, 150, 150)
        c.setLineWidth(0.01f)
        var i = ceil(segStart * 4) / 4
        while (i <= segEnd) {
            val x = margin + (i - segStart)
            val isInch = kotlin.math.abs(i - round(i)) < 0.001f
            val tickH = if (isInch) 0.12f else 0.06f
            c.line(x, top - tickH, x, top)
            if (isInch) {
                c.setFontSize(7f)
                c.text(fmt(i.toDouble(), 0) + "\"", x, top - tickH - 0.04f, TextAlign.CENTER)
            }
            i += 0.25f
        }

        fun drawChamber(yPos: Float, chSac: Float, chL: Float, chHoles: List<com.nafduduk.calculator.engine.FingerHole>, chLabel: String, chColor: Triple<Int, Int, Int>) {
            val chTotal = chSac + chL
            val visStart = max(0f, segStart)
            val visEnd = min(chTotal, segEnd)
            if (visEnd <= visStart) return

            c.setFont(bold = true)
            c.setFontSize(9f)
            c.setTextColor(chColor.first, chColor.second, chColor.third)
            c.text(chLabel, margin, yPos - 0.18f)
            c.setTextColor(0, 0, 0)

            c.setDrawColor(80, 50, 20)
            c.setLineWidth(0.02f)
            val bodyX1 = margin + (visStart - segStart)
            val bodyX2 = margin + (visEnd - segStart)
            c.rect(bodyX1, yPos, bodyX2 - bodyX1, tubeH)

            val sacVisStart = max(visStart, 0f)
            val sacVisEnd = min(visEnd, chSac)
            if (sacVisEnd > sacVisStart) {
                c.setFillColor(230, 200, 150)
                val sx1 = margin + (sacVisStart - segStart)
                val sx2 = margin + (sacVisEnd - segStart)
                c.filledRectOnly(sx1, yPos, sx2 - sx1, tubeH)
                c.rect(if (bodyX1 <= sx1) sx1 else bodyX1, yPos, sx2 - sx1, tubeH)
            }

            if (chSac in visStart..visEnd) {
                val tshX = margin + (chSac - segStart)
                c.setDrawColor(200, 120, 0)
                c.setLineWidth(if (mode == ScaleTemplateMode.CUT) 0.035f else 0.025f)
                c.line(tshX, yPos - 0.08f, tshX, yPos + tubeH + 0.08f)
                c.setFontSize(7f)
                c.setTextColor(160, 90, 0)
                c.text("TSH", tshX, yPos - 0.10f, TextAlign.CENTER)
                c.setTextColor(0, 0, 0)

                c.setFillColor(60, 36, 16)
                c.filledRectOnly(tshX - 0.035f, yPos - 0.03f, 0.07f, tubeH + 0.06f)
                c.setFontSize(6f)
                c.setTextColor(60, 36, 16)
                c.text("WALL/PLUG", tshX, yPos + tubeH + 0.16f, TextAlign.CENTER)
                c.setTextColor(0, 0, 0)
            }

            if (chTotal in visStart..visEnd) {
                val footX = margin + (chTotal - segStart)
                c.setDrawColor(0, 0, 0)
                c.setLineWidth(if (mode == ScaleTemplateMode.CUT) 0.045f else 0.03f)
                c.line(footX, yPos, footX, yPos + tubeH)
                c.setFontSize(7f)
                c.text(if (mode == ScaleTemplateMode.CUT) "CUT HERE (foot)" else "FOOT", footX, yPos + tubeH + 0.14f, TextAlign.CENTER)
            }

            if (mode == ScaleTemplateMode.CUT && 0f in visStart..visEnd) {
                val mouthX = margin + (0f - segStart)
                c.setDrawColor(0, 0, 0)
                c.setLineWidth(0.045f)
                c.line(mouthX, yPos, mouthX, yPos + tubeH)
                c.setFontSize(7f)
                c.text("CUT HERE (mouth)", mouthX, yPos - 0.24f, TextAlign.CENTER)
            }

            if (mode == ScaleTemplateMode.DRILL) {
                chHoles.forEach { h ->
                    val holePos = chSac + h.fromTshIn.toFloat()
                    if (holePos < visStart - 0.01f || holePos > visEnd + 0.01f) return@forEach
                    val hx = margin + (holePos - segStart)
                    val hy = yPos + tubeH / 2
                    val rad = max(0.035f, h.diameterIn.toFloat() / 2)
                    c.setDrawColor(200, 120, 0)
                    c.setLineWidth(0.02f)
                    c.circle(hx, hy, rad)
                    c.setLineWidth(0.008f)
                    c.line(hx - rad - 0.04f, hy, hx + rad + 0.04f, hy)
                    c.line(hx, hy - rad - 0.04f, hx, hy + rad + 0.04f)
                    c.setFontSize(7f)
                    c.setFont(bold = true)
                    c.text("H${h.num}", hx, yPos - 0.02f, TextAlign.CENTER)
                    c.setFont(bold = false)
                    c.setFontSize(6f)
                    c.text("Ø${fmt(h.diameterIn, 3)}\"", hx, yPos + tubeH + 0.13f, TextAlign.CENTER)
                }
            }
        }

        chambers.forEachIndexed { idx, ch ->
            val yPos = top + 0.5f + idx * rowGap
            val label = if (ch.playable) {
                "CHAMBER ${idx + 1} (PLAYABLE) — Root ${ch.note?.name ?: ""} — ${ch.holes.size}-Hole"
            } else {
                "CHAMBER ${idx + 1} (DRONE) — ${ch.note?.name ?: ""} — no finger holes"
            }
            drawChamber(yPos, ch.sacLenIn.toFloat(), ch.lengthIn.toFloat(), if (ch.playable) ch.holes else emptyList(), label, rowColors[idx % rowColors.size])
        }

        if (nPages > 1) {
            c.setFontSize(7f)
            c.setTextColor(120, 120, 120)
            if (p > 0) c.text("◄ align with previous page's right edge", margin, pageH - margin)
            if (p < nPages - 1) c.text("align with next page's left edge ►", pageW - margin, pageH - margin, TextAlign.RIGHT)
            c.setTextColor(0, 0, 0)
        }

        c.setDrawColor(0, 0, 0)
        c.setLineWidth(0.015f)
        c.rect(pageW - margin - 1.0f, pageH - margin - 0.35f, 1.0f, 0.25f)
        c.setFontSize(7f)
        c.text("1.00\" exactly →", pageW - margin - 1.0f - 0.05f, pageH - margin - 0.20f, TextAlign.RIGHT)
        c.text("Measure this box with a ruler before drilling. If it's not exactly 1\", reprint without page scaling.", margin, pageH - margin + 0.12f)
    }
}
