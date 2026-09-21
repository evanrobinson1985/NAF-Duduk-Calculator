package com.nafduduk.calculator.pdf

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument

/**
 * A thin jsPDF-style shim over android.graphics.pdf.PdfDocument, so the
 * page-drawing functions ported from the web source (drawScaleTemplate,
 * drawCoverPage, etc.) can be transcribed near-verbatim instead of
 * redesigned. All coordinates are in INCHES, matching the web source's
 * `new jsPDF({ unit: "in" })` — this class converts to points (1in = 72pt)
 * internally, since that's what PdfDocument pages are measured in and
 * Android's Canvas then draws in those same units 1:1.
 *
 * jsPDF quirks preserved on purpose: setFontSize() is always in POINTS
 * regardless of document unit (so it's passed straight through, not
 * scaled by DPI); text() draws at a baseline y, same as Canvas.drawText.
 */
const val PDF_DPI = 72f

enum class TextAlign { LEFT, CENTER, RIGHT }

class PdfCanvas(private val canvas: Canvas) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 1f
        color = Color.BLACK
    }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.BLACK
        textSize = 11f
        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
    }
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.BLACK
    }

    private var bold = false
    private var italic = false

    fun setFont(bold: Boolean = this.bold, italic: Boolean = this.italic) {
        this.bold = bold
        this.italic = italic
        val style = when {
            bold && italic -> Typeface.BOLD_ITALIC
            bold -> Typeface.BOLD
            italic -> Typeface.ITALIC
            else -> Typeface.NORMAL
        }
        textPaint.typeface = Typeface.create(Typeface.SANS_SERIF, style)
    }

    fun setFontSize(pt: Float) {
        textPaint.textSize = pt
    }

    fun setDrawColor(r: Int, g: Int, b: Int) {
        paint.color = Color.rgb(r, g, b)
    }

    fun setFillColor(r: Int, g: Int, b: Int) {
        fillPaint.color = Color.rgb(r, g, b)
    }

    fun setTextColor(r: Int, g: Int, b: Int) {
        textPaint.color = Color.rgb(r, g, b)
    }

    /** jsPDF setLineWidth() is in the document's unit (inches here). */
    fun setLineWidth(widthIn: Float) {
        paint.strokeWidth = widthIn * PDF_DPI
    }

    fun line(x1: Float, y1: Float, x2: Float, y2: Float) {
        canvas.drawLine(x1 * PDF_DPI, y1 * PDF_DPI, x2 * PDF_DPI, y2 * PDF_DPI, paint)
    }

    fun rect(x: Float, y: Float, w: Float, h: Float, fill: Boolean = false) {
        val l = x * PDF_DPI
        val t = y * PDF_DPI
        val r = (x + w) * PDF_DPI
        val b = (y + h) * PDF_DPI
        if (fill) canvas.drawRect(l, t, r, b, fillPaint)
        canvas.drawRect(l, t, r, b, paint)
    }

    fun filledRectOnly(x: Float, y: Float, w: Float, h: Float) {
        val l = x * PDF_DPI
        val t = y * PDF_DPI
        val r = (x + w) * PDF_DPI
        val b = (y + h) * PDF_DPI
        canvas.drawRect(l, t, r, b, fillPaint)
    }

    fun circle(cx: Float, cy: Float, r: Float, fill: Boolean = false) {
        val cxp = cx * PDF_DPI
        val cyp = cy * PDF_DPI
        val rp = r * PDF_DPI
        if (fill) canvas.drawCircle(cxp, cyp, rp, fillPaint)
        canvas.drawCircle(cxp, cyp, rp, paint)
    }

    /**
     * text(): mirrors jsPDF's doc.text(str, x, y, {align, maxWidth}). x/y in
     * inches, y is the baseline (same convention as Canvas.drawText). When
     * maxWidth is given and the string is wider, it wraps onto additional
     * lines below, each offset by ~1.15x the current font size — jsPDF's
     * own approximate line-height multiple.
     */
    fun text(str: String, x: Float, y: Float, align: TextAlign = TextAlign.LEFT, maxWidthIn: Float? = null) {
        val lines = if (maxWidthIn != null) wrap(str, maxWidthIn * PDF_DPI) else listOf(str)
        val lineHeightPt = textPaint.textSize * 1.15f
        lines.forEachIndexed { i, line ->
            val ty = y * PDF_DPI + i * lineHeightPt
            val tx = x * PDF_DPI
            val oldAlign = textPaint.textAlign
            textPaint.textAlign = when (align) {
                TextAlign.LEFT -> Paint.Align.LEFT
                TextAlign.CENTER -> Paint.Align.CENTER
                TextAlign.RIGHT -> Paint.Align.RIGHT
            }
            canvas.drawText(line, tx, ty, textPaint)
            textPaint.textAlign = oldAlign
        }
    }

    private fun wrap(str: String, maxWidthPt: Float): List<String> {
        if (textPaint.measureText(str) <= maxWidthPt) return listOf(str)
        val words = str.split(" ")
        val lines = mutableListOf<String>()
        var current = StringBuilder()
        for (w in words) {
            val candidate = if (current.isEmpty()) w else "${current} $w"
            if (textPaint.measureText(candidate) > maxWidthPt && current.isNotEmpty()) {
                lines.add(current.toString())
                current = StringBuilder(w)
            } else {
                current = StringBuilder(candidate)
            }
        }
        if (current.isNotEmpty()) lines.add(current.toString())
        return lines
    }
}

enum class PdfPageSize(val widthIn: Float, val heightIn: Float) {
    LETTER_PORTRAIT(8.5f, 11f),
    LETTER_LANDSCAPE(11f, 8.5f),
}

/**
 * A minimal multi-page PDF builder wrapping PdfDocument. Each addPage()
 * call mirrors jsPDF's `doc.addPage(...)` — draw into the returned
 * PdfCanvas, then move on; finish() closes every page and returns the
 * assembled PdfDocument for the caller to write to a file/stream.
 */
class NafPdfDocument {
    val document = PdfDocument()
    private var currentPage: PdfDocument.Page? = null

    fun addPage(size: PdfPageSize): PdfCanvas {
        currentPage?.let { document.finishPage(it) }
        val widthPt = (size.widthIn * PDF_DPI).toInt()
        val heightPt = (size.heightIn * PDF_DPI).toInt()
        val pageInfo = PdfDocument.PageInfo.Builder(widthPt, heightPt, document.pages.size + 1).create()
        val page = document.startPage(pageInfo)
        currentPage = page
        return PdfCanvas(page.canvas)
    }

    fun finish(): PdfDocument {
        currentPage?.let { document.finishPage(it) }
        currentPage = null
        return document
    }
}
