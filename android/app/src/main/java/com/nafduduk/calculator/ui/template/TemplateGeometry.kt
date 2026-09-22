package com.nafduduk.calculator.ui.template

import com.nafduduk.calculator.engine.Curve
import com.nafduduk.calculator.engine.FingerHole
import com.nafduduk.calculator.engine.NamedPitch
import com.nafduduk.calculator.engine.curveBowAmplitudeIn
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * The layout maths behind the on-screen drilling templates, kept apart from
 * the drawing so it can be tested. Ported from the web source's
 * DrillingTemplate / DudukTemplate SVG components.
 *
 * The important rule, and the one the source has a long comment about after
 * getting it wrong once: there is ONE scale for a drawing — pixels per real
 * inch, derived from fitting the longest tube into the available width — and
 * every other dimension (band height, hole radii, bow amplitude) is computed
 * from it. A second, independent constant for the vertical axis makes holes
 * and tube bands render several times too large relative to their real
 * spacing on a long tube, which looks fine on a short one and badly wrong on
 * a long one.
 */

/** One chamber as the template draws it. */
data class TemplateChamber(
    val label: String,
    val boreIn: Double,
    val sacLenIn: Double,
    val lengthIn: Double,
    val holes: List<FingerHole>,
    val playable: Boolean,
    val note: NamedPitch?,
    val breathHoleWidthIn: Double? = null,
)

/** Drawing-space constants, in the same units the web source's SVG used. */
object TemplateLayout {
    const val WIDTH = 820f
    const val MARGIN_L = 48f
    const val MARGIN_R = 48f
    const val TOP_PAD = 36f
    const val BAND_MIN = 14f
    const val BAND_MAX = 150f
    val drawWidth: Float get() = WIDTH - MARGIN_L - MARGIN_R
}

/** Everything a flute template needs, resolved for one particular set of chambers. */
class FluteTemplateLayout(val chambers: List<TemplateChamber>, val curve: Curve) {
    val isCurved: Boolean = curve != Curve.STRAIGHT

    private val maxCombined: Double = max(chambers.maxOfOrNull { it.sacLenIn + it.lengthIn } ?: 1.0, 1.0)
    private val maxBore: Double = max(chambers.maxOfOrNull { it.boreIn } ?: 0.375, 0.375)

    /** Pixels per real inch — the one true scale for this drawing. */
    val scale: Float = (TemplateLayout.drawWidth / maxCombined).toFloat()

    /** Bow amplitude in pixels, from the SAME inch value the 3D viewer and CAM use. */
    val bowAmpPx: Float = (curveBowAmplitudeIn(curve) * scale).toFloat()

    val rowHeight: Float =
        96f + max(0f, (maxBore * scale).toFloat() - 96f) * 1.15f + bowAmpPx * 1.4f

    val height: Float = TemplateLayout.TOP_PAD + chambers.size * rowHeight + 24f

    /** Tube band height for a chamber: true scale, with a readability floor and a ceiling. */
    fun bandHeight(c: TemplateChamber): Float =
        min(TemplateLayout.BAND_MAX, max(TemplateLayout.BAND_MIN, (c.boreIn * scale).toFloat()))

    fun rowBaseY(index: Int): Float = TemplateLayout.TOP_PAD + index * rowHeight + 28f + bowAmpPx

    /**
     * Centerline offset at a distance along the row. A single sine bow: antler
     * bends along one sweep from burr to tip, so this reads as antler without
     * needing real curvature data. A zero amplitude collapses it to flat.
     */
    fun curveOffset(xFromLeft: Float): Float =
        if (bowAmpPx == 0f) 0f else (bowAmpPx * sin((xFromLeft / TemplateLayout.drawWidth) * PI)).toFloat()

    /** Local tube tilt, for keeping markers perpendicular to the bore rather than vertical. */
    fun curveSlope(xFromLeft: Float): Float =
        if (bowAmpPx == 0f) {
            0f
        } else {
            (bowAmpPx * (PI / TemplateLayout.drawWidth) * cos((xFromLeft / TemplateLayout.drawWidth) * PI)).toFloat()
        }

    fun centerY(index: Int, absX: Float): Float = rowBaseY(index) - curveOffset(max(0f, absX - TemplateLayout.MARGIN_L))

    fun tshX(c: TemplateChamber): Float = TemplateLayout.MARGIN_L + (c.sacLenIn * scale).toFloat()

    fun footX(c: TemplateChamber): Float = TemplateLayout.MARGIN_L + ((c.sacLenIn + c.lengthIn) * scale).toFloat()

    fun holeX(c: TemplateChamber, h: FingerHole): Float = tshX(c) + (h.fromTshIn * scale).toFloat()

    /**
     * Hole radius at true scale, clamped so a hole can never visually spill
     * outside the tube band it is drilled into.
     */
    fun holeRadius(c: TemplateChamber, h: FingerHole): Float =
        max(2f, min((h.diameterIn / 2 * scale).toFloat(), bandHeight(c) / 2 - 2f))

    val title: String
        get() {
            val base = if (chambers.size > 1) "${chambers.size}-CHAMBER DRONE FLUTE — DRILLING TEMPLATE" else "DRILLING TEMPLATE"
            return if (isCurved) "$base (CURVED — MEASURE ALONG BORE CENTERLINE)" else base
        }

    val footer: String
        get() = if (isCurved) {
            "MEASUREMENTS IN INCHES, ALONG THE BORE CENTERLINE FROM THE SOUND HOLE (TSH)"
        } else {
            "MEASUREMENTS IN INCHES FROM THE SOUND HOLE (TSH)"
        }
}

/** One duduk hole as the template draws it. */
data class TemplateDudukHole(
    val num: Int,
    val thumb: Boolean,
    val fromReedIn: Double,
    val diameterIn: Double,
)

/** The duduk template's layout: reed seat, then the bore, holes measured from the seat. */
class DudukTemplateLayout(
    val bodyLenIn: Double,
    val reedLenIn: Double,
    val boreIn: Double,
    val holes: List<TemplateDudukHole>,
) {
    companion object {
        const val MARGIN_L = 60f
        const val MARGIN_R = 48f
        const val HEIGHT = 230f
        const val BAND_TOP = 90f
        const val BAND_HEIGHT = 36f
        val drawWidth: Float get() = TemplateLayout.WIDTH - MARGIN_L - MARGIN_R
    }

    val totalLenIn: Double = reedLenIn + bodyLenIn
    val scale: Float = if (totalLenIn <= 0) 1f else (drawWidth / totalLenIn).toFloat()

    val reedX0: Float = MARGIN_L
    val reedX1: Float = MARGIN_L + (reedLenIn * scale).toFloat()
    val footX: Float = MARGIN_L + (totalLenIn * scale).toFloat()

    fun holeX(h: TemplateDudukHole): Float = reedX1 + (h.fromReedIn * scale).toFloat()

    /**
     * The source sizes these from the bore rather than the hole's own
     * diameter, with a floor so a small bore stays visible; kept as-is so the
     * on-screen diagram matches the one makers are used to.
     */
    fun holeRadius(h: TemplateDudukHole): Float =
        if (h.thumb) max(4f, (boreIn * 9).toFloat()) else max(4.5f, (boreIn * 11).toFloat())
}
