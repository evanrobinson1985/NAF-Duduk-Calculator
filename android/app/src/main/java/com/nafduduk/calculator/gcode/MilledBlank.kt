package com.nafduduk.calculator.gcode

import com.nafduduk.calculator.mesh.CsgSolid
import com.nafduduk.calculator.mesh.Polygon
import com.nafduduk.calculator.mesh.Vec3
import com.nafduduk.calculator.mesh.Vertex
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Simulates material removal and hands back the milled blank as a solid.
 *
 * This is the part you can hold up against the stock on the bench: not what
 * the design says the flute should be, but what this particular program will
 * actually leave behind, tool shape and all. A ported version of the web
 * source's heightmap viewer plus its buildClippedBlankSolid.
 */

/**
 * Below this, a cell has no material left and is treated as a hole rather
 * than as an infinitely thin piece of wood. It is an order of magnitude above
 * the mesh repair's weld radius, so a surviving cell is one the exporter can
 * still tell has two distinct faces.
 */
private const val MIN_THICKNESS = 1e-4

/** The cutter's profile, which is what makes a drilled hole cone-bottomed and a ball-nose channel round. */
enum class ToolTip { FLAT, BALL, DRILL }

/**
 * One blank's surface, sampled on a grid.
 *
 * A blank has TWO faces. A single heightmap can only describe the one
 * pointing up, but a split-block blank is cut on its seam face, turned over,
 * and cut again on its outer face — so both surfaces are tracked and swapped
 * at the flip. Without that, the seam-side cuts vanish when the blank turns.
 */
class BlankHeightmap(
    val label: String,
    val x0: Double, val y0: Double,
    val nx: Int, val ny: Int,
    val cellX: Double, val cellY: Double,
    val top: Double, val bottom: Double,
) {
    val x1: Double get() = x0 + (nx - 1) * cellX
    val y1: Double get() = y0 + (ny - 1) * cellY

    /** Height of the up-facing surface at each grid point; starts at the top of the stock. */
    val up = DoubleArray(nx * ny) { top }

    /** Height of the down-facing surface; starts at the bottom of the stock. */
    val down = DoubleArray(nx * ny) { bottom }

    var flipped: Boolean = false
        private set

    fun cellXAt(i: Int) = x0 + i * cellX
    fun cellYAt(j: Int) = y0 + j * cellY

    /**
     * Turns the blank over: both surfaces reflect about the mid-plane and
     * swap, mirrored across Y. The bounding box is unchanged, so the result
     * already describes the turned-over board in table coordinates.
     */
    fun flip() {
        val sum = top + bottom
        val newUp = DoubleArray(nx * ny)
        val newDown = DoubleArray(nx * ny)
        for (j in 0 until ny) {
            val jm = ny - 1 - j
            for (i in 0 until nx) {
                newUp[j * nx + i] = sum - down[jm * nx + i]
                newDown[j * nx + i] = sum - up[jm * nx + i]
            }
        }
        up.indices.forEach { up[it] = newUp[it] }
        down.indices.forEach { down[it] = newDown[it] }
        flipped = !flipped
    }
}

/**
 * Builds a heightmap per blank from the program's STOCK-BLOCK hints.
 *
 * `resolution` is the target cell size in program units. Finer is more
 * faithful and quadratically more expensive, so it is capped by `maxCells`:
 * a phone should not be asked to allocate a hundred million doubles because
 * someone asked for a thousandth of an inch.
 */
fun buildHeightmaps(
    parsed: ParsedGcode,
    resolution: Double = 0.02,
    maxCells: Int = 400_000,
): List<BlankHeightmap> = parsed.stockBlocks.map { b ->
    var cell = max(resolution, 1e-6)
    var nx = (b.lx / cell).toInt() + 1
    var ny = (b.ly / cell).toInt() + 1
    if (nx.toLong() * ny > maxCells) {
        // Keep the aspect ratio; just coarsen until it fits.
        val shrink = sqrt(nx.toDouble() * ny / maxCells)
        cell *= shrink
        nx = (b.lx / cell).toInt() + 1
        ny = (b.ly / cell).toInt() + 1
    }
    BlankHeightmap(
        label = b.label,
        x0 = b.x, y0 = b.y,
        nx = max(2, nx), ny = max(2, ny),
        cellX = b.lx / max(1, nx - 1), cellY = b.ly / max(1, ny - 1),
        top = b.z + b.lz, bottom = b.z,
    )
}

/**
 * Runs every cutting move over the blanks, removing material as it goes.
 *
 * Rapids are ignored: the tool is above the stock. Each cutting move is
 * walked in steps smaller than a grid cell so the swept path is continuous
 * rather than a row of disconnected tool stamps.
 */
fun simulateCutting(
    parsed: ParsedGcode,
    heightmaps: List<BlankHeightmap>,
    toolDiameter: Double,
    tip: ToolTip = ToolTip.FLAT,
) {
    if (heightmaps.isEmpty()) return
    val r = toolDiameter / 2
    fun tipOffset(rd: Double): Double = when (tip) {
        ToolTip.FLAT -> 0.0
        ToolTip.BALL -> r - sqrt(max(0.0, r * r - rd * rd))
        // A twist drill's ~118 degree point.
        ToolTip.DRILL -> rd * 0.6
    }

    fun stamp(gx: Double, gy: Double, gz: Double) {
        for (hm in heightmaps) {
            // Quick reject: the tool's footprint is entirely off this blank.
            if (gx + r < hm.x0 || gx - r > hm.x1 || gy + r < hm.y0 || gy - r > hm.y1) continue
            val i0 = max(0, floor((gx - r - hm.x0) / hm.cellX).toInt())
            val i1 = min(hm.nx - 1, ceil((gx + r - hm.x0) / hm.cellX).toInt())
            val j0 = max(0, floor((gy - r - hm.y0) / hm.cellY).toInt())
            val j1 = min(hm.ny - 1, ceil((gy + r - hm.y0) / hm.cellY).toInt())
            for (j in j0..j1) {
                val cy = hm.cellYAt(j)
                for (i in i0..i1) {
                    val rd = hypot(hm.cellXAt(i) - gx, cy - gy)
                    if (rd > r) continue
                    // The cut can never go below the bottom of the stock.
                    val zCut = max(hm.bottom, gz + tipOffset(rd))
                    val k = j * hm.nx + i
                    if (zCut < hm.up[k]) hm.up[k] = zCut
                }
            }
        }
    }

    val step = heightmaps.minOf { min(it.cellX, it.cellY) } * 0.66
    val flipsByLine = parsed.stockFlips.groupBy { it.lineIndex }
    // A program for an already-turned blank starts it that way.
    parsed.stockFlips.filter { it.preflipped }.forEach { f ->
        heightmaps.filter { it.label.equals(f.label, ignoreCase = true) }.forEach { it.flip() }
    }
    val flippedAt = mutableSetOf<Int>()

    for (seg in parsed.segments) {
        // Turn a blank over exactly when the cutting reaches its flip point,
        // the way the operator does.
        flipsByLine[seg.lineIndex]?.forEach { f ->
            if (!f.preflipped && flippedAt.add(f.lineIndex)) {
                heightmaps.filter { it.label.equals(f.label, ignoreCase = true) }.forEach { it.flip() }
            }
        }
        if (seg.type != SegmentType.FEED) continue
        val path = if (seg.points.isNotEmpty()) seg.points else listOfNotNull(seg.from, seg.to)
        for (i in 0 until path.size - 1) {
            val a = path[i]
            val b = path[i + 1]
            val len = sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y) + (b.z - a.z) * (b.z - a.z))
            val n = max(1, ceil(len / step).toInt())
            for (s in 0..n) {
                val t = s.toDouble() / n
                stamp(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)
            }
        }
    }
}

/**
 * The true finished-part silhouette per blank, in program X/Y, taken from a
 * "BODY-OUTLINE FULL CUTOUT" pass.
 *
 * That pass is the only toolpath in the file that traces the actual flute
 * outline rather than the rectangular stock, which is what lets the export
 * trim away the clamping margin and the alignment-pin rails. Both generators
 * retrace the identical X/Y path at several Z levels, so points are
 * deduplicated in visitation order: the first lap is the polygon and the rest
 * just repeat it.
 */
fun extractOutlinePolygons(parsed: ParsedGcode): Map<String, List<Pair<Double, Double>>> {
    val polys = mutableMapOf<String, MutableList<Pair<Double, Double>>>()
    var current: String? = null
    var seen = mutableSetOf<String>()

    for (seg in parsed.segments) {
        if (seg.type == SegmentType.COMMENT && seg.comment.contains("outline cutout:", ignoreCase = true)) {
            // Match on "lower/bottom" vs "upper/top" rather than an exact
            // label, so either generator's naming works.
            val c = seg.comment.lowercase()
            current = when {
                c.contains("lower") || c.contains("bottom") -> "lower"
                c.contains("upper") || c.contains("top") -> "upper"
                else -> null
            }
            if (current != null) polys.getOrPut(current!!) { mutableListOf() }
            seen = mutableSetOf()
            continue
        }
        val key = current ?: continue
        if (!seg.isMotion) continue
        val pt = seg.to ?: continue
        val id = "%.4f,%.4f".format(pt.x, pt.y)
        if (seen.add(id)) polys.getValue(key).add(pt.x to pt.y)
    }
    // Anything short of a triangle is not a silhouette.
    return polys.filterValues { it.size >= 3 }
}

/** Ray-casting point-in-polygon, robust for a simple polygon of any vertex count. */
internal fun pointInPolygon(x: Double, y: Double, poly: List<Pair<Double, Double>>): Boolean {
    var inside = false
    var j = poly.size - 1
    for (i in poly.indices) {
        val (xi, yi) = poly[i]
        val (xj, yj) = poly[j]
        if ((yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
        j = i
    }
    return inside
}

/** Which blank a label refers to, for matching an outline to a heightmap. */
internal fun blockCategory(label: String): String? {
    val l = label.lowercase()
    return when {
        l.contains("lower") || l.contains("bottom") -> "lower"
        l.contains("upper") || l.contains("top") -> "upper"
        else -> null
    }
}

/**
 * Builds one blank's watertight solid straight from its heightmap: a top
 * face, a bottom face, and a side wall wherever an included cell borders an
 * excluded one. `poly` trims it to the finished silhouette; null keeps the
 * whole rectangular blank.
 *
 * This deliberately does NOT go through a mesh boolean. The web source tried
 * that first — intersecting the carved mesh against an extruded copy of the
 * outline — and it requires both operands to be exactly watertight at the
 * vertex level. A toolpath-derived polygon, traced by the tool and subject to
 * the G-code's own 3-decimal rounding, essentially never lines up bit for bit
 * with a heightmap built through a separate code path, and a boolean against
 * a near-but-not-quite-sealed seam silently misclassifies inside and outside.
 * Deciding inclusion per grid CELL sidesteps it entirely: a point-in-polygon
 * test against the heightmap's own coordinates, with nothing for a boolean to
 * get confused by.
 */
fun buildMilledBlankSolid(hm: BlankHeightmap, poly: List<Pair<Double, Double>>? = null): CsgSolid {
    val inside = BooleanArray(hm.nx * hm.ny) { k ->
        val i = k % hm.nx
        val j = k / hm.nx
        // Two ways a grid point is not part of the part: it falls outside the
        // finished silhouette, or the tool already took all the material
        // there. The second matters — a through-cut clamps the top surface
        // down onto the bottom one, and carrying those cells would export a
        // zero-thickness sheet lying inside every drilled hole rather than a
        // hole. Dropping them also builds the hole's walls for free, via the
        // bordering-cell test below.
        val hasMaterial = hm.up[k] - hm.down[k] > MIN_THICKNESS
        hasMaterial && (poly == null || pointInPolygon(hm.cellXAt(i), hm.cellYAt(j), poly))
    }
    fun cellSolid(i: Int, j: Int): Boolean {
        if (i < 0 || j < 0 || i >= hm.nx - 1 || j >= hm.ny - 1) return false
        return inside[j * hm.nx + i] && inside[j * hm.nx + i + 1] &&
            inside[(j + 1) * hm.nx + i] && inside[(j + 1) * hm.nx + i + 1]
    }
    fun topAt(i: Int, j: Int) = Vec3(hm.cellXAt(i), hm.cellYAt(j), hm.up[j * hm.nx + i])
    fun botAt(i: Int, j: Int) = Vec3(hm.cellXAt(i), hm.cellYAt(j), hm.down[j * hm.nx + i])

    val polys = ArrayList<Polygon>()
    fun tri(a: Vec3, b: Vec3, c: Vec3) {
        val n = (b - a).cross(c - a)
        if (n.length() < 1e-18) return
        val unit = n.normalized()
        polys.add(Polygon(listOf(Vertex(a, unit), Vertex(b, unit), Vertex(c, unit))))
    }

    for (j in 0 until hm.ny - 1) {
        for (i in 0 until hm.nx - 1) {
            if (!cellSolid(i, j)) continue
            val t00 = topAt(i, j); val t10 = topAt(i + 1, j)
            val t01 = topAt(i, j + 1); val t11 = topAt(i + 1, j + 1)
            tri(t00, t10, t11); tri(t00, t11, t01)

            val b00 = botAt(i, j); val b10 = botAt(i + 1, j)
            val b01 = botAt(i, j + 1); val b11 = botAt(i + 1, j + 1)
            tri(b00, b11, b10); tri(b00, b01, b11)

            // A wall wherever this cell borders one that is NOT included:
            // this is what forms the trimmed edge along the true outline,
            // cell by cell, without needing the polygon's exact edges.
            if (!cellSolid(i - 1, j)) {
                tri(topAt(i, j), topAt(i, j + 1), botAt(i, j + 1))
                tri(topAt(i, j), botAt(i, j + 1), botAt(i, j))
            }
            if (!cellSolid(i + 1, j)) {
                tri(topAt(i + 1, j), botAt(i + 1, j + 1), topAt(i + 1, j + 1))
                tri(topAt(i + 1, j), botAt(i + 1, j), botAt(i + 1, j + 1))
            }
            if (!cellSolid(i, j - 1)) {
                tri(topAt(i, j), botAt(i + 1, j), topAt(i + 1, j))
                tri(topAt(i, j), botAt(i, j), botAt(i + 1, j))
            }
            if (!cellSolid(i, j + 1)) {
                tri(topAt(i, j + 1), topAt(i + 1, j + 1), botAt(i + 1, j + 1))
                tri(topAt(i, j + 1), botAt(i + 1, j + 1), botAt(i, j + 1))
            }
        }
    }
    return CsgSolid(polys)
}

/** What a milled-blank export produced, and what it could not do. */
data class MilledBlankResult(
    val blanks: List<Pair<String, CsgSolid>>,
    /** True when an outline pass was found and the stock margin was trimmed away. */
    val trimmed: Boolean,
) {
    val isEmpty: Boolean get() = blanks.isEmpty()
}

/**
 * Simulates the program and returns the milled blanks.
 *
 * Without an outline-cutout pass in the file there is no toolpath anywhere
 * that traces the true silhouette, so the export falls back to the full
 * rectangular stock and says so rather than guessing an outline.
 */
fun millBlanksFromProgram(
    program: String,
    toolDiameter: Double,
    tip: ToolTip = ToolTip.FLAT,
    resolution: Double = 0.02,
): MilledBlankResult {
    val parsed = parseGcode(program)
    val heightmaps = buildHeightmaps(parsed, resolution)
    if (heightmaps.isEmpty()) return MilledBlankResult(emptyList(), trimmed = false)

    simulateCutting(parsed, heightmaps, toolDiameter, tip)
    val outlines = extractOutlinePolygons(parsed)

    var trimmedAny = false
    val blanks = heightmaps.map { hm ->
        val poly = blockCategory(hm.label)?.let { outlines[it] }
        if (poly != null) trimmedAny = true
        hm.label to buildMilledBlankSolid(hm, poly)
    }
    return MilledBlankResult(blanks, trimmed = trimmedAny)
}
