package com.nafduduk.calculator.ui.gcodeviewer

import com.nafduduk.calculator.gcode.GcodeBounds
import com.nafduduk.calculator.gcode.GcodePoint
import com.nafduduk.calculator.gcode.GcodeSegment
import com.nafduduk.calculator.gcode.ParsedGcode
import com.nafduduk.calculator.gcode.SegmentType
import kotlin.math.max
import kotlin.math.min

/**
 * Turns a parsed program into something drawable, and works out where the
 * tool is at a given point in the playback.
 *
 * Separate from the drawing so it can be tested: a viewer that frames the
 * job wrongly, or puts the tool in the wrong place at a given step, is worse
 * than no viewer — it is a wrong answer that looks authoritative.
 */

/** One drawable run of the toolpath, already flattened (arcs included). */
data class PathRun(val cutting: Boolean, val points: List<GcodePoint>)

/**
 * Splits the program into drawable runs, merging consecutive moves of the
 * same kind so a long contour is one polyline rather than hundreds of
 * two-point segments.
 */
fun toolpathRuns(parsed: ParsedGcode): List<PathRun> {
    val runs = mutableListOf<PathRun>()
    var current: MutableList<GcodePoint>? = null
    var currentCutting = false

    fun flush() {
        current?.let { if (it.size >= 2) runs.add(PathRun(currentCutting, it.toList())) }
        current = null
    }

    for (seg in parsed.segments) {
        if (!seg.isMotion) continue
        val cutting = seg.type == SegmentType.FEED
        val from = seg.from ?: continue
        val pts = if (seg.points.isNotEmpty()) seg.points else listOfNotNull(seg.to)
        if (pts.isEmpty()) continue

        val continues = current != null && currentCutting == cutting && current!!.last().sameAs(from)
        if (!continues) {
            flush()
            current = mutableListOf(from)
            currentCutting = cutting
        }
        current!!.addAll(pts)
    }
    flush()
    return runs
}

private fun GcodePoint.sameAs(o: GcodePoint): Boolean =
    kotlin.math.abs(x - o.x) < 1e-9 && kotlin.math.abs(y - o.y) < 1e-9 && kotlin.math.abs(z - o.z) < 1e-9

/** Every motion segment, in order — the unit playback steps through. */
fun motionSegments(parsed: ParsedGcode): List<GcodeSegment> = parsed.segments.filter { it.isMotion }

/**
 * Where the tool is partway through a program.
 *
 * `progress` runs 0..1 over the motion segments. Within the segment being
 * executed the position is interpolated, so scrubbing reads as continuous
 * travel rather than snapping from endpoint to endpoint.
 */
fun toolPositionAt(motions: List<GcodeSegment>, progress: Double): GcodePoint? {
    if (motions.isEmpty()) return null
    val p = progress.coerceIn(0.0, 1.0)
    val exact = p * motions.size
    val idx = exact.toInt().coerceIn(0, motions.size - 1)
    val within = (exact - idx).coerceIn(0.0, 1.0)
    val seg = motions[idx]
    val from = seg.from ?: return seg.to
    val to = seg.to ?: return from
    // An arc's real path is its polyline, so follow that rather than the chord.
    if (seg.points.size >= 2) {
        val t = within * (seg.points.size - 1)
        val i = t.toInt().coerceIn(0, seg.points.size - 2)
        return lerp(seg.points[i], seg.points[i + 1], t - i)
    }
    return lerp(from, to, within)
}

private fun lerp(a: GcodePoint, b: GcodePoint, t: Double) = GcodePoint(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
)

/** How many motion segments have completed at this progress. */
fun completedMotionCount(motions: List<GcodeSegment>, progress: Double): Int =
    (progress.coerceIn(0.0, 1.0) * motions.size).toInt().coerceIn(0, motions.size)

/**
 * Maps program X/Y onto a canvas, preserving aspect ratio and flipping Y —
 * G-code Y runs up the table, screen Y runs down. Getting that backwards
 * mirrors the part, which on an asymmetric flute body is not obvious by eye.
 */
class ToolpathProjection(
    bounds: GcodeBounds,
    private val canvasWidth: Float,
    private val canvasHeight: Float,
    private val padding: Float = 12f,
) {
    private val minX = bounds.min.x
    private val minY = bounds.min.y
    private val spanX = max(bounds.sizeX, 1e-9)
    private val spanY = max(bounds.sizeY, 1e-9)

    /** One scale for both axes: a stretched toolpath is a lie about the part. */
    val scale: Float = min(
        (canvasWidth - 2 * padding) / spanX.toFloat(),
        (canvasHeight - 2 * padding) / spanY.toFloat(),
    ).let { if (it.isFinite() && it > 0f) it else 1f }

    private val drawnW = spanX.toFloat() * scale
    private val drawnH = spanY.toFloat() * scale
    private val offsetX = (canvasWidth - drawnW) / 2
    private val offsetY = (canvasHeight - drawnH) / 2

    fun x(px: Double): Float = offsetX + ((px - minX).toFloat() * scale)

    fun y(py: Double): Float = offsetY + drawnH - ((py - minY).toFloat() * scale)
}
