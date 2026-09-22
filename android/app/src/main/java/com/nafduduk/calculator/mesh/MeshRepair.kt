package com.nafduduk.calculator.mesh

import kotlin.math.floor
import kotlin.math.roundToLong

/**
 * Makes a CSG result safe to export as a solid.
 *
 * A slicer (and glTF's own validator) wants a closed manifold: every edge
 * shared by exactly two triangles. Raw output from Csg.kt is neither, for two
 * independent reasons:
 *
 *  - **T-junctions.** BSP CSG splits polygons against whole planes, so a plane
 *    that ends partway along a neighbouring face leaves the long edge on one
 *    side meeting two short edges on the other. The surface is closed
 *    geometrically but not combinatorially. This accounts for most of it: a
 *    straight chamber arrives with 2,066 single-use edges out of 13,901.
 *  - **Dropped polygons.** The classic csg.js-lineage algorithm this follows
 *    is not numerically robust. Chained through the ten booleans
 *    buildChamberSolid performs, a handful of slivers fall below its
 *    `Plane.EPSILON` and vanish, leaving real holes — axial strips on the
 *    outer wall far from any cutter, where nothing should have been touched at
 *    all. Splitting cannot fix those; the missing facets have to be rebuilt.
 *
 * So four stages:
 *   1. WELD  — merge vertices that are closer together than the CSG's own
 *              coplanarity epsilon, so coordinates differing only by float
 *              drift become one vertex, and drop triangles that collapses.
 *              The merge uses a real distance test against a spatial grid,
 *              and the representative is compared by index. Neither a *hash*
 *              of the coordinates nor a plain lattice snap works as an
 *              identity here: hash collisions silently fuse unrelated
 *              vertices (an XOR hash fused 7 of the 19 corners of a
 *              box-minus-box the first time round), and a snap both refuses
 *              to merge across a cell boundary and displaces what it keeps.
 *   2. DEDUPE — discard exact repeats of the same welded triangle, which
 *              otherwise show up as edges used four times.
 *   3. SPLIT — for every triangle, insert *every* welded vertex that lies on
 *              one of its edges, then re-fan the triangle from its centroid.
 *              Inserting all of them at once converges in a single pass even
 *              when one long edge is crossed by many cuts, and the neighbour
 *              across each edge inserts the same vertices, so the two sides
 *              agree. The centroid is strictly interior, so every fan triangle
 *              has real area — a corner fan would instead be collinear with
 *              the points inserted on its own two edges, and the zero-area
 *              slivers that produces would have to be either kept or dropped,
 *              and dropping them re-opens the edge.
 *   4. FILL  — whatever edges are still used once bound the holes left by the
 *              dropped polygons. Walk them into oriented loops and fan each
 *              loop from its centroid, wound to match the surrounding surface.
 *              A centroid fan closes a loop of any shape, planar or not.
 *
 * Output is triangles only, which is what STL, PLY and glTF want anyway.
 */

/**
 * Merge radius. Csg.kt calls a point coplanar when it is within
 * `Plane.EPSILON` (1e-5in) of the plane, so the CSG cannot itself tell
 * features finer than that apart: anything closer together than this is float
 * noise, not geometry. 1e-5in is 0.25 micron — three orders of magnitude
 * below a 3D printer's layer height and far below any machining tolerance.
 */
private const val WELD_TOL = 1e-5
/** Max distance from an edge for a vertex to count as lying on it. */
private const val ON_EDGE_EPS = 1e-5
private const val BUCKET_SIZE = 0.05   // inches — spatial hash cell for the on-edge search

/** A lattice cell, sized to the merge radius, for the weld's neighbour search. */
private data class Cell(val x: Long, val y: Long, val z: Long)

private fun cellOf(v: Vec3) = Cell(
    floor(v.x / WELD_TOL).toLong(),
    floor(v.y / WELD_TOL).toLong(),
    floor(v.z / WELD_TOL).toLong(),
)

private data class Bucket(val x: Long, val y: Long, val z: Long)

private fun bucketOf(v: Vec3) = Bucket(
    floor(v.x / BUCKET_SIZE).toLong(),
    floor(v.y / BUCKET_SIZE).toLong(),
    floor(v.z / BUCKET_SIZE).toLong(),
)

/** Position along a-b of the point on the segment closest to p, plus that distance. */
private class OnEdge(val t: Double, val distance: Double)

private fun projectOntoSegment(p: Vec3, a: Vec3, b: Vec3): OnEdge? {
    val ab = b - a
    val lenSq = ab.dot(ab)
    if (lenSq < 1e-18) return null
    val len = kotlin.math.sqrt(lenSq)
    val t = (p - a).dot(ab) / lenSq
    // Keep clear of both endpoints by the merge radius: an insertion that
    // lands on top of a corner would only produce a sliver.
    if (t * len <= WELD_TOL || (1 - t) * len <= WELD_TOL) return null
    return OnEdge(t, (p - (a + ab * t)).length())
}

/** An indexed triangle plus the CSG plane normal of the polygon it came from. */
private class Tri(val a: Int, val b: Int, val c: Int, val normal: Vec3)

/**
 * Welds, T-junction-repairs, hole-fills and cleans `solid`, returning a
 * triangle-only solid whose every edge is shared by exactly two triangles.
 * Call this before any export that represents a physical part —
 * mesh/MeshExporters.kt and mesh/GltfExporter.kt already do.
 */
fun exportableSolid(solid: CsgSolid): CsgSolid {
    val verts = ArrayList<Vec3>()
    val cells = HashMap<Cell, MutableList<Int>>()

    /**
     * A tolerance weld, not a snap: the first vertex seen in a neighbourhood
     * becomes its representative at its own exact position, and anything
     * within WELD_TOL of it reuses that index. Snapping to a lattice instead
     * would leave two problems this avoids — points either side of a cell
     * boundary never merge however close they are, and every surviving vertex
     * moves by up to half a cell, which is enough to shift a T-junction
     * vertex off the edge it is supposed to lie on.
     */
    fun vertexIndex(p: Vec3): Int {
        val c = cellOf(p)
        for (dx in -1..1) for (dy in -1..1) for (dz in -1..1) {
            val near = cells[Cell(c.x + dx, c.y + dy, c.z + dz)] ?: continue
            for (i in near) if ((verts[i] - p).length() <= WELD_TOL) return i
        }
        verts.add(p)
        cells.getOrPut(c) { mutableListOf() }.add(verts.size - 1)
        return verts.size - 1
    }

    /** A vertex guaranteed distinct from `avoid`, for fan apexes. */
    fun apexIndex(p: Vec3, avoid: Set<Int>): Int {
        val i = vertexIndex(p)
        if (i !in avoid) return i
        verts.add(p) // deliberately unregistered: nothing may weld onto it
        return verts.size - 1
    }

    // ── 1. weld ──────────────────────────────────────────────────────
    val welded = ArrayList<Tri>()
    for (poly in solid.polygons) {
        val n = poly.plane.normal
        for ((va, vb, vc) in poly.triangulate()) {
            val ia = vertexIndex(va.pos)
            val ib = vertexIndex(vb.pos)
            val ic = vertexIndex(vc.pos)
            if (ia == ib || ib == ic || ia == ic) continue // collapsed by the weld
            welded.add(Tri(ia, ib, ic, n))
        }
    }

    // ── 2. dedupe exact repeats ──────────────────────────────────────
    val tris = ArrayList<Tri>(welded.size)
    val seen = HashSet<Triple<Int, Int, Int>>()
    for (t in welded) {
        // Canonical form: rotate so the smallest index leads, keeping winding,
        // so (a,b,c) and (b,c,a) are one triangle but (a,c,b) stays distinct.
        val key = when {
            t.a <= t.b && t.a <= t.c -> Triple(t.a, t.b, t.c)
            t.b <= t.c -> Triple(t.b, t.c, t.a)
            else -> Triple(t.c, t.a, t.b)
        }
        if (seen.add(key)) tris.add(t)
    }

    // ── 3. insert every on-edge vertex, then re-fan ──────────────────
    val buckets = HashMap<Bucket, MutableList<Int>>()
    verts.forEachIndexed { i, v -> buckets.getOrPut(bucketOf(v)) { mutableListOf() }.add(i) }

    fun candidatesAlong(a: Vec3, b: Vec3): Set<Int> {
        val out = HashSet<Int>()
        val steps = maxOf(1, ((b - a).length() / BUCKET_SIZE).toInt() + 1)
        for (s in 0..steps) {
            val p = a + (b - a) * (s.toDouble() / steps)
            val c = bucketOf(p)
            for (dx in -1..1) for (dy in -1..1) for (dz in -1..1) {
                buckets[Bucket(c.x + dx, c.y + dy, c.z + dz)]?.let { out.addAll(it) }
            }
        }
        return out
    }

    val out = ArrayList<Tri>(tris.size)
    fun emit(ia: Int, ib: Int, ic: Int, normal: Vec3) {
        if (ia == ib || ib == ic || ia == ic) return
        val pa = verts[ia]
        val cross = (verts[ib] - pa).cross(verts[ic] - pa)
        // The weld leaves distinct vertices a lattice cell apart, so a real
        // triangle's |cross| is far above this; only the exactly collinear,
        // whose facet normal would come out NaN, are rejected.
        if (cross.length() < 1e-18) return
        // Keep the CSG plane's facing; a weld can flip a sliver's winding.
        if (cross.dot(normal) >= 0) out.add(Tri(ia, ib, ic, normal)) else out.add(Tri(ia, ic, ib, normal))
    }

    for (t in tris) {
        val corners = intArrayOf(t.a, t.b, t.c)
        // For each edge, the vertices lying strictly inside it, in order.
        val inserted = Array(3) { e ->
            val i0 = corners[e]
            val i1 = corners[(e + 1) % 3]
            val p0 = verts[i0]
            val p1 = verts[i1]
            val hits = ArrayList<Pair<Double, Int>>()
            for (vi in candidatesAlong(p0, p1)) {
                if (vi == i0 || vi == i1) continue
                val proj = projectOntoSegment(verts[vi], p0, p1) ?: continue
                if (proj.distance > ON_EDGE_EPS) continue
                hits.add(proj.t to vi)
            }
            hits.sortBy { it.first }
            hits.map { it.second }
        }

        if (inserted.all { it.isEmpty() }) {
            emit(t.a, t.b, t.c, t.normal)
            continue
        }

        // Boundary loop with the extra vertices spliced in, fanned from the centroid.
        val loop = ArrayList<Int>(3 + inserted.sumOf { it.size })
        for (e in 0..2) {
            loop.add(corners[e])
            loop.addAll(inserted[e])
        }
        val apex = apexIndex(
            Vec3(
                (verts[t.a].x + verts[t.b].x + verts[t.c].x) / 3,
                (verts[t.a].y + verts[t.b].y + verts[t.c].y) / 3,
                (verts[t.a].z + verts[t.b].z + verts[t.c].z) / 3,
            ),
            loop.toSet(),
        )
        for (i in loop.indices) emit(loop[i], loop[(i + 1) % loop.size], apex, t.normal)
    }

    // ── 4. fill whatever is still open ───────────────────────────────
    fillBoundaryLoops(out, verts, ::apexIndex)

    return CsgSolid(out.map { t -> Polygon(listOf(t.a, t.b, t.c).map { Vertex(verts[it], t.normal) }) })
}

/**
 * Closes the holes left by polygons the CSG dropped. An edge used by a single
 * triangle is on a hole's rim; because the surface is consistently wound, the
 * rim's directed edges (reversed from the triangle's own direction) chain into
 * closed loops, and fanning each loop from its centroid seals it with
 * matching orientation. A centroid fan closes a loop of any shape, planar or
 * not, and adds no rim of its own: each loop edge ends up used twice (once by
 * the triangle that was already there, once by the fill) and each spoke twice
 * (by the two fan triangles either side of it).
 *
 * The walk needs to backtrack. Where the surface also pinches — two sheets
 * meeting along one edge, which the CSG leaves a handful of on a curved body
 * — a rim vertex can have more than one way out, and a greedy walk that
 * guesses wrong strands the rest of that loop. So each rim edge gets a
 * depth-first search for a simple cycle back to its own start, bounded so a
 * pathological rim cannot hang the export. Edges no cycle reaches are left
 * open rather than filled wrongly.
 */
private fun fillBoundaryLoops(
    tris: MutableList<Tri>,
    verts: MutableList<Vec3>,
    apexIndex: (Vec3, Set<Int>) -> Int,
) {
    fun key(a: Int, b: Int): Long = a.toLong() * 0x1_0000_0000L + b.toLong()

    val directed = HashMap<Long, Int>()
    for (t in tris) for ((a, b) in listOf(t.a to t.b, t.b to t.c, t.c to t.a)) {
        directed[key(a, b)] = (directed[key(a, b)] ?: 0) + 1
    }

    // Rim edges, wound the way the fill must traverse them (opposite to the
    // single triangle that already uses them).
    val rim = HashMap<Int, MutableList<Int>>()
    var rimCount = 0
    for (t in tris) for ((a, b) in listOf(t.a to t.b, t.b to t.c, t.c to t.a)) {
        if ((directed[key(b, a)] ?: 0) == 0 && (directed[key(a, b)] ?: 0) == 1) {
            rim.getOrPut(b) { mutableListOf() }.add(a)
            rimCount++
        }
    }
    if (rimCount == 0) return

    val used = HashSet<Long>()
    var budget = 40_000 + rimCount * 40 // total DFS steps allowed across all loops

    /** A simple cycle from `at` back to `target` over unused rim edges, or null. */
    fun search(target: Int, at: Int, path: MutableList<Int>, onPath: MutableSet<Int>): List<Int>? {
        if (budget-- <= 0) return null
        for (next in rim[at] ?: return null) {
            val e = key(at, next)
            if (e in used) continue
            if (next == target) {
                used.add(e)
                return path.toList()
            }
            if (next in onPath) continue
            used.add(e)
            path.add(next)
            onPath.add(next)
            val found = search(target, next, path, onPath)
            if (found != null) return found
            onPath.remove(next)
            path.removeAt(path.size - 1)
            used.remove(e)
        }
        return null
    }

    val loops = ArrayList<List<Int>>()
    for ((from, tos) in rim.entries.toList()) {
        for (to in tos.toList()) {
            val first = key(from, to)
            if (first in used) continue
            used.add(first)
            val path = mutableListOf(from, to)
            val onPath = mutableSetOf(from, to)
            val loop = search(from, to, path, onPath)
            if (loop != null && loop.size >= 3) loops.add(loop) else used.remove(first)
        }
    }

    for (loop in loops) {
        val c = loop.fold(Vec3.ZERO) { acc, i -> acc + verts[i] } * (1.0 / loop.size)
        val apex = apexIndex(c, loop.toSet())
        // Newell's normal is stable for a loop of any shape, unlike a single
        // corner's cross product on a near-degenerate rim.
        var n = Vec3.ZERO
        for (i in loop.indices) {
            val p = verts[loop[i]]
            val q = verts[loop[(i + 1) % loop.size]]
            n += Vec3((p.y - q.y) * (p.z + q.z), (p.z - q.z) * (p.x + q.x), (p.x - q.x) * (p.y + q.y))
        }
        val normal = if (n.length() < 1e-18) Vec3(0.0, 0.0, 1.0) else n.normalized()
        for (i in loop.indices) {
            val a = loop[i]
            val b = loop[(i + 1) % loop.size]
            if (a == b || a == apex || b == apex) continue
            tris.add(Tri(a, b, apex, normal))
        }
    }
}

/** Diagnostics for the repair pass — used by the unit tests, and worth logging if a slicer complains. */
data class MeshTopologyReport(
    val triangles: Int,
    val vertices: Int,
    val edges: Int,
    /** Edges used by exactly one triangle: holes. Fatal for a slicer. */
    val openEdges: Int,
    /** Edges used by three or more triangles: sheets meeting along a seam. */
    val nonManifoldEdges: Int,
    /**
     * Vertices where two otherwise-separate sheets touch at a single point.
     * Every edge around one is still used exactly twice, so the surface is
     * watertight and a slicer takes it; it is only a defect in the strict
     * sense that the vertex has no disc neighbourhood. A tolerance weld on
     * CSG output whose own epsilon is the same size cannot rule these out —
     * the alternative is a finer weld, which leaves real holes instead — so
     * this is counted and reported rather than pretended away. It also
     * explains an odd Euler characteristic, which is otherwise impossible for
     * a closed orientable surface.
     */
    val pinchVertices: Int,
) {
    val eulerCharacteristic: Int get() = vertices - edges + triangles

    /** The criterion that actually decides whether an STL slices. */
    val isClosedManifold: Boolean get() = openEdges == 0 && nonManifoldEdges == 0
}

/**
 * Rounded key for reporting only. `cellOf` floors, which is right for a
 * neighbourhood search but wrong for an identity: two points a hair either
 * side of a cell boundary would be reported as separate vertices. Rounding at
 * a scale below the weld radius keeps the report's identity consistent with
 * what the weld actually merged.
 */
private fun reportKey(v: Vec3) = Cell(
    (v.x / (WELD_TOL / 4)).roundToLong(),
    (v.y / (WELD_TOL / 4)).roundToLong(),
    (v.z / (WELD_TOL / 4)).roundToLong(),
)

fun topologyReport(solid: CsgSolid): MeshTopologyReport {
    val edges = HashMap<Pair<Cell, Cell>, Int>()
    val verts = HashSet<Cell>()
    var tris = 0
    for (poly in solid.polygons) {
        for ((a, b, c) in poly.triangulate()) {
            val ka = reportKey(a.pos)
            val kb = reportKey(b.pos)
            val kc = reportKey(c.pos)
            if (ka == kb || kb == kc || ka == kc) continue
            tris++
            verts.add(ka); verts.add(kb); verts.add(kc)
            for ((p, q) in listOf(ka to kb, kb to kc, kc to ka)) {
                val e = if (compareCells(p, q) <= 0) p to q else q to p
                edges[e] = (edges[e] ?: 0) + 1
            }
        }
    }
    return MeshTopologyReport(
        triangles = tris,
        vertices = verts.size,
        edges = edges.size,
        openEdges = edges.values.count { it == 1 },
        nonManifoldEdges = edges.values.count { it > 2 },
        pinchVertices = countPinchVertices(solid),
    )
}

/**
 * A vertex is a pinch point when the triangles around it fall into more than
 * one fan. Each incident triangle contributes the edge between its other two
 * corners to the vertex's "link"; on a proper manifold vertex that link is a
 * single cycle, so one connected component.
 */
private fun countPinchVertices(solid: CsgSolid): Int {
    val link = HashMap<Cell, ArrayList<Pair<Cell, Cell>>>()
    for (poly in solid.polygons) {
        for ((a, b, c) in poly.triangulate()) {
            val ka = reportKey(a.pos)
            val kb = reportKey(b.pos)
            val kc = reportKey(c.pos)
            if (ka == kb || kb == kc || ka == kc) continue
            link.getOrPut(ka) { ArrayList() }.add(kb to kc)
            link.getOrPut(kb) { ArrayList() }.add(kc to ka)
            link.getOrPut(kc) { ArrayList() }.add(ka to kb)
        }
    }
    var pinched = 0
    val parent = HashMap<Cell, Cell>()
    fun find(x: Cell): Cell {
        var r = x
        while (parent[r] != r) {
            parent[r] = parent[parent[r]]!!
            r = parent[r]!!
        }
        return r
    }
    for ((_, ring) in link) {
        parent.clear()
        for ((p, q) in ring) {
            parent.putIfAbsent(p, p)
            parent.putIfAbsent(q, q)
        }
        for ((p, q) in ring) parent[find(p)] = find(q)
        if (parent.keys.map { find(it) }.toSet().size > 1) pinched++
    }
    return pinched
}

private fun compareCells(a: Cell, b: Cell): Int =
    when {
        a.x != b.x -> a.x.compareTo(b.x)
        a.y != b.y -> a.y.compareTo(b.y)
        else -> a.z.compareTo(b.z)
    }
