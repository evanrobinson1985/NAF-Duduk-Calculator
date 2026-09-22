package com.nafduduk.calculator.gcode

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * A G-code reader, ported from the web source's parseGCode.
 *
 * This is what makes a program inspectable before it touches a machine: the
 * toolpath viewer draws what it returns, and the milled-blank export carves
 * from it. It reads the dialects these generators emit (and the common ones
 * they do not) rather than assuming its own output — a viewer that can only
 * read its own writing cannot catch its own mistakes.
 */

data class GcodePoint(val x: Double, val y: Double, val z: Double) {
    operator fun plus(o: GcodePoint) = GcodePoint(x + o.x, y + o.y, z + o.z)
}

enum class SegmentType {
    /** G0: a non-cutting positioning move. */
    RAPID,

    /** G1/G2/G3: a cutting move. */
    FEED,

    /** A comment-only line, kept because the generators use them as structure. */
    COMMENT,

    /** M0/M1: the program stops for the operator. */
    PAUSE,

    /** G4: a timed dwell. */
    DWELL,

    /** An M-code line that does not move the tool. */
    ANNOTATION,
}

data class GcodeSegment(
    val type: SegmentType,
    val lineIndex: Int,
    val raw: String,
    val comment: String,
    val from: GcodePoint? = null,
    val to: GcodePoint? = null,
    /** An arc's interpolated polyline, including helical travel; empty for a straight move. */
    val points: List<GcodePoint> = emptyList(),
    val isArc: Boolean = false,
    val feedRate: Double = 0.0,
    val spindleOn: Boolean = false,
    val at: GcodePoint? = null,
    val dwellSeconds: Double = 0.0,
) {
    val isMotion: Boolean get() = type == SegmentType.RAPID || type == SegmentType.FEED
}

data class GcodeBounds(val min: GcodePoint, val max: GcodePoint) {
    val sizeX get() = max.x - min.x
    val sizeY get() = max.y - min.y
    val sizeZ get() = max.z - min.z
    val isEmpty get() = sizeX <= 0.0 && sizeY <= 0.0 && sizeZ <= 0.0
}

/**
 * A machine-readable stock hint the generators emit, one per blank on the
 * table: `( STOCK-BLOCK label=bottom-half x=.. y=.. z=.. lx=.. ly=.. lz=.. )`.
 * The simulation builds every blank from these instead of guessing one box.
 */
data class StockBlock(
    val label: String,
    val x: Double, val y: Double, val z: Double,
    val lx: Double, val ly: Double, val lz: Double,
)

/**
 * `( STOCK-FLIP label=top-half axis=x [preflipped=1] )` — where the operator
 * turns a blank over, so the whole bottom → top → flip → nest sequence can be
 * shown in one run. `preflipped` marks a standalone nest program whose blank
 * starts already turned.
 */
data class StockFlip(
    val label: String,
    val axis: String,
    val preflipped: Boolean,
    val lineIndex: Int,
)

data class ParsedGcode(
    val segments: List<GcodeSegment>,
    /** Every point the tool visits, rapids included. */
    val bounds: GcodeBounds,
    /** Only the cutting moves — the part that is actually removed. */
    val cutBounds: GcodeBounds,
    val units: String,
    val lineCount: Int,
    val warnings: List<String>,
    val stockBlocks: List<StockBlock>,
    val stockFlips: List<StockFlip>,
)

internal data class GcodeWord(val letter: Char, val value: Double)

internal data class StrippedLine(val code: String, val comment: String)

/**
 * Splits a line into code and comment.
 *
 * A whole-line parenthetical runs from the first "(" to the LAST ")". G-code
 * comments do not nest, but these generators' banner comments contain literal
 * parentheses in their prose — "( OPERATION 1A (thick blank) )" — and a
 * non-greedy match would end the comment at the inner ")", leaving stray
 * prose that reads as code.
 */
internal fun stripComments(line: String): StrippedLine {
    val trimmed = line.trim()
    if (trimmed.startsWith("(")) {
        val close = trimmed.lastIndexOf(')')
        if (close > 0 && trimmed.substring(close + 1).isBlank()) {
            return StrippedLine("", trimmed.substring(1, close).trim())
        }
    }
    var comment = Regex("""\(([^)]*)\)""").find(line)?.groupValues?.get(1)?.trim() ?: ""
    var code = line.replace(Regex("""\([^)]*\)"""), "")
    val semi = code.indexOf(';')
    if (semi >= 0) {
        if (comment.isEmpty()) comment = code.substring(semi + 1).trim()
        code = code.substring(0, semi)
    }
    return StrippedLine(code.trim(), comment)
}

internal fun tokenizeWords(code: String): List<GcodeWord> =
    Regex("""([A-Za-z])\s*(-?\d*\.?\d+)""").findAll(code).mapNotNull { m ->
        m.groupValues[2].toDoubleOrNull()?.let { GcodeWord(m.groupValues[1].uppercase()[0], it) }
    }.toList()

/** Interpolates an arc into a polyline, including helical travel along the third axis. */
internal fun arcPoints(
    from: GcodePoint,
    to: GcodePoint,
    center: GcodePoint,
    ccw: Boolean,
    plane: String,
    steps: Int = 32,
): List<GcodePoint> {
    fun axis(p: GcodePoint, a: Char) = when (a) { 'x' -> p.x; 'y' -> p.y; else -> p.z }
    val (a, b) = when (plane) {
        "XZ" -> 'x' to 'z'
        "YZ" -> 'y' to 'z'
        else -> 'x' to 'y'
    }
    val third = when (plane) { "XZ" -> 'y'; "YZ" -> 'x'; else -> 'z' }

    val startAngle = atan2(axis(from, b) - axis(center, b), axis(from, a) - axis(center, a))
    val endAngle = atan2(axis(to, b) - axis(center, b), axis(to, a) - axis(center, a))
    val radius = hypot(axis(from, a) - axis(center, a), axis(from, b) - axis(center, b))

    var sweep = endAngle - startAngle
    if (ccw) {
        if (sweep > 0) sweep -= 2 * Math.PI
    } else {
        if (sweep < 0) sweep += 2 * Math.PI
    }
    // Start and end at the same angle means a full circle, not a zero move.
    if (abs(sweep) < 1e-9) sweep = if (ccw) -2 * Math.PI else 2 * Math.PI

    return (0..steps).map { i ->
        val t = i.toDouble() / steps
        val angle = startAngle + sweep * t
        val va = axis(center, a) + radius * cos(angle)
        val vb = axis(center, b) + radius * sin(angle)
        val vc = axis(from, third) + (axis(to, third) - axis(from, third)) * t
        when (plane) {
            "XZ" -> GcodePoint(va, vc, vb)
            "YZ" -> GcodePoint(vc, va, vb)
            else -> GcodePoint(va, vb, vc)
        }
    }
}

private fun parseHintFields(rest: String): Map<String, String> =
    Regex("""([a-zA-Z]+)\s*=\s*(\S+)""").findAll(rest)
        .associate { it.groupValues[1].lowercase() to it.groupValues[2] }

fun parseGcode(text: String): ParsedGcode {
    val lines = text.split(Regex("\r?\n"))
    val segments = mutableListOf<GcodeSegment>()
    val warnings = mutableListOf<String>()
    val stockBlocks = mutableListOf<StockBlock>()
    val stockFlips = mutableListOf<StockFlip>()

    fun tryStockHint(comment: String) {
        val m = Regex("""^STOCK-BLOCK\s+(.*)$""", RegexOption.IGNORE_CASE).find(comment) ?: return
        val kv = parseHintFields(m.groupValues[1])
        fun num(k: String) = kv[k]?.toDoubleOrNull()?.takeIf { it.isFinite() }
        val x = num("x"); val y = num("y"); val z = num("z")
        val lx = num("lx"); val ly = num("ly"); val lz = num("lz")
        if (x != null && y != null && z != null && lx != null && ly != null && lz != null &&
            lx > 0 && ly > 0 && lz > 0
        ) {
            stockBlocks.add(StockBlock(kv["label"] ?: "blank ${stockBlocks.size + 1}", x, y, z, lx, ly, lz))
        }
    }

    fun tryStockFlip(comment: String, lineIndex: Int) {
        val m = Regex("""^STOCK-FLIP\s+(.*)$""", RegexOption.IGNORE_CASE).find(comment) ?: return
        val kv = parseHintFields(m.groupValues[1])
        stockFlips.add(
            StockFlip(
                label = kv["label"] ?: "stock",
                axis = (kv["axis"] ?: "x").lowercase(),
                preflipped = kv["preflipped"] == "1" || kv["preflipped"] == "true",
                lineIndex = lineIndex,
            ),
        )
    }

    var units = "mm"
    var unitsExplicit = false
    var incremental = false
    var arcPlane = "XY"
    var position = GcodePoint(0.0, 0.0, 0.0)
    var feedRate = 0.0
    var spindleOn = false

    for ((li, raw) in lines.withIndex()) {
        val (code, comment) = stripComments(raw)
        if (code.isEmpty()) {
            if (comment.isNotEmpty()) {
                tryStockHint(comment)
                tryStockFlip(comment, li)
                segments.add(GcodeSegment(SegmentType.COMMENT, li, raw, comment))
            }
            continue
        }
        val words = tokenizeWords(code)
        if (words.isEmpty()) continue

        val gCodes = words.filter { it.letter == 'G' }.map { it.value }
        val mCodes = words.filter { it.letter == 'M' }.map { it.value }
        fun get(letter: Char): Double? = words.firstOrNull { it.letter == letter }?.value

        if (gCodes.contains(20.0)) { units = "in"; unitsExplicit = true }
        if (gCodes.contains(21.0)) { units = "mm"; unitsExplicit = true }
        if (gCodes.contains(90.0)) incremental = false
        if (gCodes.contains(91.0)) incremental = true
        if (gCodes.contains(17.0)) arcPlane = "XY"
        if (gCodes.contains(18.0)) arcPlane = "XZ"
        if (gCodes.contains(19.0)) arcPlane = "YZ"
        get('F')?.let { feedRate = it }
        if (mCodes.contains(3.0) || mCodes.contains(4.0)) spindleOn = true
        if (mCodes.contains(5.0)) spindleOn = false

        // G92 sets the work offset without moving, so it changes where the
        // tool thinks it is without drawing anything.
        if (gCodes.contains(92.0)) {
            position = GcodePoint(get('X') ?: position.x, get('Y') ?: position.y, get('Z') ?: position.z)
            continue
        }
        if (gCodes.contains(4.0)) {
            segments.add(
                GcodeSegment(
                    SegmentType.DWELL, li, raw, comment,
                    at = position, dwellSeconds = get('P') ?: 0.0,
                ),
            )
            continue
        }
        if (mCodes.contains(0.0) || mCodes.contains(1.0)) {
            segments.add(GcodeSegment(SegmentType.PAUSE, li, raw, comment, at = position))
            continue
        }

        // A line with axis words and no G-code repeats the last motion mode,
        // which these generators rely on.
        val hasMotionG = gCodes.any { it == 0.0 || it == 1.0 || it == 2.0 || it == 3.0 }
        val bareAxisMove = gCodes.isEmpty() && (get('X') != null || get('Y') != null || get('Z') != null)
        if (!hasMotionG && !bareAxisMove) {
            if (mCodes.isNotEmpty()) segments.add(GcodeSegment(SegmentType.ANNOTATION, li, raw, comment))
            continue
        }

        fun axisTarget(word: Char, current: Double): Double {
            val v = get(word) ?: return current
            return if (incremental) current + v else v
        }
        val target = GcodePoint(
            axisTarget('X', position.x),
            axisTarget('Y', position.y),
            axisTarget('Z', position.z),
        )

        if (gCodes.contains(2.0) || gCodes.contains(3.0)) {
            val ccw = gCodes.contains(3.0)
            val i = get('I'); val j = get('J'); val k = get('K'); val r = get('R')
            val center: GcodePoint? = when {
                i != null || j != null || k != null ->
                    GcodePoint(position.x + (i ?: 0.0), position.y + (j ?: 0.0), position.z + (k ?: 0.0))
                r != null -> centerFromRadius(position, target, r, ccw, arcPlane)
                else -> null
            }
            if (center == null) {
                warnings.add("Line ${li + 1}: arc (G2/G3) with no I/J/K or R — skipped.")
                position = target
                continue
            }
            segments.add(
                GcodeSegment(
                    SegmentType.FEED, li, raw, comment,
                    from = position, to = target, isArc = true,
                    points = arcPoints(position, target, center, ccw, arcPlane),
                    feedRate = feedRate, spindleOn = spindleOn,
                ),
            )
        } else {
            segments.add(
                GcodeSegment(
                    if (gCodes.contains(0.0)) SegmentType.RAPID else SegmentType.FEED,
                    li, raw, comment,
                    from = position, to = target, feedRate = feedRate, spindleOn = spindleOn,
                ),
            )
        }
        position = target
    }

    if (!unitsExplicit) {
        warnings.add("No G20/G21 units command found — assuming millimeters. Verify before trusting absolute dimensions.")
    }

    return ParsedGcode(
        segments = segments,
        bounds = boundsOf(segments) { true },
        cutBounds = boundsOf(segments) { it.type == SegmentType.FEED },
        units = units,
        lineCount = lines.size,
        warnings = warnings,
        stockBlocks = stockBlocks,
        stockFlips = stockFlips,
    ).let { p ->
        // An empty cut envelope falls back to the full one, so a caller
        // framing the view never gets a degenerate box.
        if (p.cutBounds.isEmpty && !p.bounds.isEmpty) p.copy(cutBounds = p.bounds) else p
    }
}

/** Arc centre from an R word: the chord's perpendicular bisector, offset by the sagitta. */
private fun centerFromRadius(
    from: GcodePoint,
    to: GcodePoint,
    r: Double,
    ccw: Boolean,
    plane: String,
): GcodePoint {
    fun axis(p: GcodePoint, a: Char) = when (a) { 'x' -> p.x; 'y' -> p.y; else -> p.z }
    val (a, b) = when (plane) {
        "XZ" -> 'x' to 'z'
        "YZ" -> 'y' to 'z'
        else -> 'x' to 'y'
    }
    val dx = axis(to, a) - axis(from, a)
    val dy = axis(to, b) - axis(from, b)
    val chord = hypot(dx, dy)
    val rad = abs(r)
    val h = sqrt(max(0.0, rad * rad - (chord / 2) * (chord / 2)))
    val mx = (axis(from, a) + axis(to, a)) / 2
    val my = (axis(from, b) + axis(to, b)) / 2
    val perpX = -dy / (if (chord == 0.0) 1.0 else chord)
    val perpY = dx / (if (chord == 0.0) 1.0 else chord)
    // A negative R selects the major arc, which puts the centre on the far side.
    val sign = if ((r >= 0) == ccw) -1.0 else 1.0
    val ca = mx + perpX * h * sign
    val cb = my + perpY * h * sign
    return when (plane) {
        "XZ" -> GcodePoint(ca, from.y, cb)
        "YZ" -> GcodePoint(from.x, ca, cb)
        else -> GcodePoint(ca, cb, from.z)
    }
}

private fun boundsOf(segments: List<GcodeSegment>, include: (GcodeSegment) -> Boolean): GcodeBounds {
    var minX = Double.MAX_VALUE; var minY = Double.MAX_VALUE; var minZ = Double.MAX_VALUE
    var maxX = -Double.MAX_VALUE; var maxY = -Double.MAX_VALUE; var maxZ = -Double.MAX_VALUE
    var any = false
    fun expand(p: GcodePoint) {
        any = true
        minX = min(minX, p.x); maxX = max(maxX, p.x)
        minY = min(minY, p.y); maxY = max(maxY, p.y)
        minZ = min(minZ, p.z); maxZ = max(maxZ, p.z)
    }
    for (s in segments) {
        if (!include(s)) continue
        s.from?.let(::expand)
        s.to?.let(::expand)
        s.points.forEach(::expand)
    }
    val zero = GcodePoint(0.0, 0.0, 0.0)
    return if (!any) GcodeBounds(zero, zero) else GcodeBounds(GcodePoint(minX, minY, minZ), GcodePoint(maxX, maxY, maxZ))
}
