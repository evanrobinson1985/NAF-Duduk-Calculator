package com.nafduduk.calculator.mesh

import java.util.Locale

/** Fan-triangulates a polygon from vertex 0 — valid since every polygon this app builds (box faces, tube rings, CSG-clipped fragments of those) is convex. */
private fun Polygon.triangles(): List<Triple<Vertex, Vertex, Vertex>> {
    val tris = mutableListOf<Triple<Vertex, Vertex, Vertex>>()
    for (i in 1 until vertices.size - 1) {
        tris.add(Triple(vertices[0], vertices[i], vertices[i + 1]))
    }
    return tris
}

private fun fmt(v: Double): String = String.format(Locale.US, "%.6f", v)

/** ASCII STL — one facet per triangle, in the mesh's own coordinate units (inches, matching the rest of the app). */
fun exportStl(solid: CsgSolid, name: String = "naf_flute"): String {
    val sb = StringBuilder()
    sb.append("solid $name\n")
    for (poly in solid.polygons) {
        for ((a, b, c) in poly.triangles()) {
            val n = poly.plane.normal
            sb.append("  facet normal ${fmt(n.x)} ${fmt(n.y)} ${fmt(n.z)}\n")
            sb.append("    outer loop\n")
            sb.append("      vertex ${fmt(a.pos.x)} ${fmt(a.pos.y)} ${fmt(a.pos.z)}\n")
            sb.append("      vertex ${fmt(b.pos.x)} ${fmt(b.pos.y)} ${fmt(b.pos.z)}\n")
            sb.append("      vertex ${fmt(c.pos.x)} ${fmt(c.pos.y)} ${fmt(c.pos.z)}\n")
            sb.append("    endloop\n")
            sb.append("  endfacet\n")
        }
    }
    sb.append("endsolid $name\n")
    return sb.toString()
}

/** Wavefront OBJ — shares vertices by exact-position dedup (keeps file size sane for a dense mesh). */
fun exportObj(solid: CsgSolid, name: String = "naf_flute"): String {
    val sb = StringBuilder()
    sb.append("# $name — exported by NAF Flute & Duduk Calculator (Android)\n")
    sb.append("o $name\n")

    // OBJ needs all `v` lines before any `f` line, so build faces into a separate buffer first.
    val vertexLines = StringBuilder()
    val faceLines = StringBuilder()
    val idx = LinkedHashMap<Vec3, Int>()
    var nextIdx = 1
    for (poly in solid.polygons) {
        val ids = poly.vertices.map { vert ->
            idx.getOrPut(vert.pos) {
                vertexLines.append("v ${fmt(vert.pos.x)} ${fmt(vert.pos.y)} ${fmt(vert.pos.z)}\n")
                nextIdx++
            }
        }
        faceLines.append("f ${ids.joinToString(" ")}\n")
    }

    sb.append(vertexLines)
    sb.append(faceLines)
    return sb.toString()
}

/** Stanford PLY (ASCII) — triangulated, one vertex per triangle-corner (simplest correct encoding, larger file). */
fun exportPly(solid: CsgSolid): String {
    val allTris = solid.polygons.flatMap { it.triangles() }
    val header = StringBuilder()
    header.append("ply\n")
    header.append("format ascii 1.0\n")
    header.append("comment exported by NAF Flute & Duduk Calculator (Android)\n")
    header.append("element vertex ${allTris.size * 3}\n")
    header.append("property float x\nproperty float y\nproperty float z\n")
    header.append("property float nx\nproperty float ny\nproperty float nz\n")
    header.append("element face ${allTris.size}\n")
    header.append("property list uchar int vertex_indices\n")
    header.append("end_header\n")

    val body = StringBuilder()
    var i = 0
    for ((a, b, c) in allTris) {
        for (v in listOf(a, b, c)) {
            body.append("${fmt(v.pos.x)} ${fmt(v.pos.y)} ${fmt(v.pos.z)} ${fmt(v.normal.x)} ${fmt(v.normal.y)} ${fmt(v.normal.z)}\n")
        }
    }
    for (t in allTris.indices) {
        body.append("3 ${i} ${i + 1} ${i + 2}\n")
        i += 3
    }

    return header.toString() + body.toString()
}
