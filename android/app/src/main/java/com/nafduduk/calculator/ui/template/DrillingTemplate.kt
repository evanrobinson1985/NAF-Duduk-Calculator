package com.nafduduk.calculator.ui.template

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.unit.dp
import com.nafduduk.calculator.engine.Curve
import androidx.compose.ui.graphics.toArgb
import com.nafduduk.calculator.util.jsFmt
import kotlin.math.PI
import kotlin.math.atan

/**
 * The on-screen drilling template — the diagram a maker actually works from,
 * showing the SAC, the wall/plug, the sound hole and every finger hole at
 * true relative scale with its measurement from the TSH.
 *
 * A port of the web source's DrillingTemplate SVG. Compose has no SVG, so
 * this draws to a Canvas; the layout maths lives in TemplateGeometry.kt,
 * where it can be tested, and only the painting is here. The canvas is scaled
 * so the drawing's 820-unit coordinate space maps to whatever width it gets,
 * which keeps every ported coordinate literal meaningful.
 */
private val Gold = Color(0xFFF59E0B)
private val Green = Color(0xFF7ACC44)
private val BoneText = Color(0xFFE5D5B8)
private val Tan = Color(0xFFC4A97D)
private val Rim = Color(0xFFC17D1A)
private val Body = Color(0xFF1A1208)
private val BodyEdge = Color(0xFF5A3A18)
private val Back = Color(0xFF0C0600)
private val Hairline = Color(0xFF3A2A14)
private val Footer = Color(0xFF6B5D4A)
private val Breath = Color(0xFF7DD3FC)

@Composable
fun DrillingTemplate(chambers: List<TemplateChamber>, curve: Curve, modifier: Modifier = Modifier) {
    if (chambers.isEmpty()) return
    val l = FluteTemplateLayout(chambers, curve)

    Box(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(TemplateLayout.WIDTH / l.height)
            .border(1.dp, Hairline),
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val k = size.width / TemplateLayout.WIDTH
            drawRect(Back, Offset.Zero, size)
            scale(k, k, pivot = Offset.Zero) { drawFluteTemplate(l) }
        }
    }
}

private fun DrawScope.drawFluteTemplate(l: FluteTemplateLayout) {
    label(l.title, TemplateLayout.WIDTH / 2, 24f, Gold, 14f, bold = true, center = true)

    l.chambers.forEachIndexed { idx, c ->
        val th = l.bandHeight(c)
        val rowBase = l.rowBaseY(idx)
        val sacX0 = TemplateLayout.MARGIN_L - 22f
        val tshX = l.tshX(c)
        val footX = l.footX(c)
        val color = if (c.playable) Gold else Green
        fun cy(absX: Float) = l.centerY(idx, absX)

        if (idx > 0) {
            drawLine(Hairline, Offset(TemplateLayout.MARGIN_L, rowBase - th / 2 - 22f), Offset(TemplateLayout.WIDTH - TemplateLayout.MARGIN_R, rowBase - th / 2 - 22f), 1f)
        }

        val holeCountText = if (c.playable) "(${c.holes.size}-hole)" else "(no finger holes)"
        label(
            "▶ ${c.label} — ${c.note?.name ?: ""} $holeCountText · ${jsFmt(c.boreIn, 3)}\" bore",
            TemplateLayout.MARGIN_L, cy(TemplateLayout.MARGIN_L) - th / 2 - 8f - if (l.isCurved) l.bowAmpPx * 0.5f else 0f,
            color, 11f, bold = true,
        )

        if (l.isCurved) {
            // One continuous antler-like outline for SAC + body, then a
            // darker overlay from the TSH to the foot so the two still read
            // as different sections.
            val outline = tubeOutline(sacX0, footX, th, ::cy)
            drawPath(outline, BodyEdge.copy(alpha = 0.55f))
            drawPath(outline, Rim, style = Stroke(2f))
            drawPath(tubeOutline(tshX, footX, th, ::cy), Body.copy(alpha = 0.85f))
            drawPath(tubeOutline(tshX, footX, th, ::cy), BodyEdge, style = Stroke(1.5f))
        } else {
            val sacTop = cy(TemplateLayout.MARGIN_L) - th / 2
            drawRect(BodyEdge.copy(alpha = 0.55f), Offset(sacX0, sacTop), Size((c.sacLenIn * l.scale).toFloat() + 22f, th))
            drawRect(Rim, Offset(sacX0, sacTop), Size((c.sacLenIn * l.scale).toFloat() + 22f, th), style = Stroke(2f))
            drawRect(Body, Offset(tshX, sacTop), Size(footX - tshX, th))
            drawRect(BodyEdge, Offset(tshX, sacTop), Size(footX - tshX, th), style = Stroke(6f))
        }

        val sacMidX = TemplateLayout.MARGIN_L + (c.sacLenIn * l.scale).toFloat() / 2
        label("SAC", sacMidX - 10f, cy(sacMidX) - th / 2 - 1f, Gold, 9f, center = true)

        // The wall/plug is a real, solid partition (a hardwood dowel in a
        // built flute), so it gets a bold bar of its own rather than being
        // confused with the TSH cut beside it.
        rotateAt(-l.curveSlope(tshX - TemplateLayout.MARGIN_L).toDegrees(), tshX, cy(tshX)) {
            drawRect(Color(0xFF3A2410), Offset(tshX - 3f, cy(tshX) - th / 2 - 3f), Size(6f, th + 6f))
            drawRect(Gold, Offset(tshX - 3f, cy(tshX) - th / 2 - 3f), Size(6f, th + 6f), style = Stroke(1.5f))
        }
        label("WALL/PLUG", tshX, cy(tshX) + th / 2 + 16f, Gold, 8f, center = true)

        rotateAt(-l.curveSlope(tshX - TemplateLayout.MARGIN_L).toDegrees(), tshX, cy(tshX) - th / 2) {
            drawRect(Color(0xFF120A00), Offset(tshX - 9f, cy(tshX) - th / 2 - 16f), Size(24f, 12f))
            drawRect(color, Offset(tshX - 9f, cy(tshX) - th / 2 - 16f), Size(24f, 12f), style = Stroke(2f))
        }
        label("TSH", tshX + 3f, cy(tshX) - th / 2 - 21f, color, 9f, center = true)

        rotateAt(-l.curveSlope(footX - TemplateLayout.MARGIN_L).toDegrees(), footX, cy(footX)) {
            drawRect(Color(0xFF0A0500), Offset(footX - 3f, cy(footX) - th / 2), Size(6f, th))
            drawRect(Tan, Offset(footX - 3f, cy(footX) - th / 2), Size(6f, th), style = Stroke(1.5f))
        }

        c.breathHoleWidthIn?.let { bhw ->
            val bx = sacX0 + 9f
            val br = minOf(th * 0.35f, maxOf(2.5f, (bhw * l.scale).toFloat() / 2))
            drawCircle(Color(0xFF0C0600), br, Offset(bx, cy(bx)))
            drawCircle(Breath, br, Offset(bx, cy(bx)), style = Stroke(1.5f))
            label("BREATH ${jsFmt(bhw, 2)}\"", bx, cy(bx) + th / 2 + 12f, Breath, 8f, center = true)
        }

        if (c.playable) {
            for (h in c.holes) {
                val hx = l.holeX(c, h)
                val hy = cy(hx)
                val hr = l.holeRadius(c, h)
                drawCircle(Color(0xFF0A0500), hr, Offset(hx, hy))
                drawCircle(Gold, hr, Offset(hx, hy), style = Stroke(3.5f))
                label("H${h.num}", hx, hy + th / 2 + 15f, BoneText, 11f, bold = true, center = true)
                label("${jsFmt(h.fromTshIn, 2)}\"", hx, hy + th / 2 + 28f, Tan, 9f, center = true)
            }
        } else {
            val midX = (tshX + footX) / 2
            label("${jsFmt(c.lengthIn, 2)}\" tube — open, no holes", midX, cy(midX) + th / 2 + 18f, Tan, 10f, center = true)
        }
    }

    drawLine(Footer, Offset(TemplateLayout.MARGIN_L, l.height - 22f), Offset(TemplateLayout.WIDTH - TemplateLayout.MARGIN_R, l.height - 22f), 2f)
    label(l.footer, TemplateLayout.WIDTH / 2, l.height - 8f, Footer, 10f, center = true)
}

@Composable
fun DudukDrillingTemplate(layout: DudukTemplateLayout, rootNoteName: String, reedDiamIn: Double, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(TemplateLayout.WIDTH / DudukTemplateLayout.HEIGHT)
            .border(1.dp, Hairline),
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val k = size.width / TemplateLayout.WIDTH
            drawRect(Back, Offset.Zero, size)
            scale(k, k, pivot = Offset.Zero) { drawDudukTemplate(layout, rootNoteName, reedDiamIn) }
        }
    }
}

private fun DrawScope.drawDudukTemplate(l: DudukTemplateLayout, rootNoteName: String, reedDiamIn: Double) {
    val ty = DudukTemplateLayout.BAND_TOP
    val th = DudukTemplateLayout.BAND_HEIGHT
    val h = DudukTemplateLayout.HEIGHT

    label(
        "DUDUK DRILLING TEMPLATE — Root $rootNoteName — ${jsFmt(l.bodyLenIn, 2)}\" body",
        TemplateLayout.WIDTH / 2, 26f, Gold, 14f, bold = true, center = true,
    )

    drawRect(BodyEdge.copy(alpha = 0.4f), Offset(l.reedX0, ty - 6f), Size(l.reedX1 - l.reedX0, th + 12f))
    drawRect(Rim, Offset(l.reedX0, ty - 6f), Size(l.reedX1 - l.reedX0, th + 12f), style = Stroke(2f))
    label("REED SEAT", (l.reedX0 + l.reedX1) / 2, ty - 14f, Gold, 10f, center = true)
    label(
        "${jsFmt(l.reedLenIn, 2)}\" deep · Ø${jsFmt(reedDiamIn, 3)}\"",
        (l.reedX0 + l.reedX1) / 2, ty + th + 24f, Tan, 9f, center = true,
    )

    // The step down from the reed seat to the bore.
    drawLine(Gold, Offset(l.reedX1, ty - 10f), Offset(l.reedX1, ty + th + 10f), 1.5f)

    drawRect(Body, Offset(l.reedX1, ty), Size(l.footX - l.reedX1, th))
    drawRect(BodyEdge, Offset(l.reedX1, ty), Size(l.footX - l.reedX1, th), style = Stroke(6f))

    drawRect(Color(0xFF0A0500), Offset(l.footX - 3f, ty), Size(6f, th))
    drawRect(Tan, Offset(l.footX - 3f, ty), Size(6f, th), style = Stroke(1.5f))
    label("FOOT", l.footX, ty + th + 24f, Tan, 9f, center = true)

    for (hole in l.holes.filter { !it.thumb }) {
        val hx = l.holeX(hole)
        val hr = l.holeRadius(hole)
        drawCircle(Color(0xFF0A0500), hr, Offset(hx, ty + th / 2))
        drawCircle(Gold, hr, Offset(hx, ty + th / 2), style = Stroke(3.2f))
        label("H${hole.num}", hx, ty - 10f, BoneText, 10f, bold = true, center = true)
        label("${jsFmt(hole.fromReedIn, 2)}\"", hx, ty + th + 14f, Tan, 8.5f, center = true)
    }

    // The thumb hole is on the BACK of the tube, so it is drawn offset below
    // with a leader rather than inline with the front holes.
    for (hole in l.holes.filter { it.thumb }) {
        val hx = l.holeX(hole)
        val hr = l.holeRadius(hole)
        val hy = ty + th + 46f
        drawLine(Green, Offset(hx, ty + th), Offset(hx, hy - hr - 2f), 1f)
        drawCircle(Color(0xFF0A0500), hr, Offset(hx, hy))
        drawCircle(Green, hr, Offset(hx, hy), style = Stroke(3f))
        label("Thumb (back)", hx, hy + hr + 13f, Green, 9f, bold = true, center = true)
        label("${jsFmt(hole.fromReedIn, 2)}\"", hx, hy + hr + 25f, Green, 8.5f, center = true)
    }

    drawLine(Footer, Offset(DudukTemplateLayout.MARGIN_L, h - 20f), Offset(TemplateLayout.WIDTH - DudukTemplateLayout.MARGIN_R, h - 20f), 2f)
    label("MEASUREMENTS IN INCHES FROM THE TOP OF THE REED SEAT", TemplateLayout.WIDTH / 2, h - 6f, Footer, 10f, center = true)
}

// ── drawing helpers ──────────────────────────────────────────────────

private fun Float.toDegrees(): Float = (atan(this.toDouble()) * 180.0 / PI).toFloat()

private inline fun DrawScope.rotateAt(degrees: Float, px: Float, py: Float, block: DrawScope.() -> Unit) {
    if (degrees == 0f) block() else rotate(degrees, Offset(px, py)) { block() }
}

/** A tube band that follows the bowed centerline, as one closed outline. */
private fun tubeOutline(x0: Float, x1: Float, bandHeight: Float, cy: (Float) -> Float): Path {
    val steps = 24
    val path = Path()
    for (i in 0..steps) {
        val x = x0 + (x1 - x0) * (i.toFloat() / steps)
        val y = cy(x) - bandHeight / 2
        if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
    }
    for (i in steps downTo 0) {
        val x = x0 + (x1 - x0) * (i.toFloat() / steps)
        path.lineTo(x, cy(x) + bandHeight / 2)
    }
    path.close()
    return path
}

private fun DrawScope.label(
    text: String,
    x: Float,
    y: Float,
    color: Color,
    sizePx: Float,
    bold: Boolean = false,
    center: Boolean = false,
) {
    val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
        this.color = color.toArgb()
        textSize = sizePx
        textAlign = if (center) android.graphics.Paint.Align.CENTER else android.graphics.Paint.Align.LEFT
        typeface = android.graphics.Typeface.create(
            android.graphics.Typeface.SANS_SERIF,
            if (bold) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL,
        )
    }
    drawContext.canvas.nativeCanvas.drawText(text, x, y, paint)
}
