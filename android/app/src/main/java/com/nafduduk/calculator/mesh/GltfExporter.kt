package com.nafduduk.calculator.mesh

import android.util.Base64
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Minimal, valid glTF 2.0 (ASCII .gltf, JSON with a base64-embedded binary
 * buffer — no separate .bin file to manage). Non-indexed triangle soup: one
 * POSITION/NORMAL pair per triangle corner, three corners per triangle,
 * which is valid per the glTF 2.0 spec (the "indices" accessor is
 * optional) and sidesteps any vertex-welding logic.
 *
 * An explicit material matters: glTF's default for a primitive with no
 * material is metallicFactor 1.0, and a fully metallic surface shows almost
 * nothing without an environment map to reflect — the preview came out black.
 * A dielectric (metallic 0) bone-coloured material reads correctly under the
 * directional + indirect light Viewer3DView installs.
 */
fun exportGltf(rawSolid: CsgSolid): String {
    val solid = exportableSolid(rawSolid)
    val positions = mutableListOf<Float>()
    val normals = mutableListOf<Float>()

    for (poly in solid.polygons) {
        for ((a, b, c) in poly.triangulate()) {
            for (v in listOf(a, b, c)) {
                positions.add(v.pos.x.toFloat())
                positions.add(v.pos.y.toFloat())
                positions.add(v.pos.z.toFloat())
                normals.add(v.normal.x.toFloat())
                normals.add(v.normal.y.toFloat())
                normals.add(v.normal.z.toFloat())
            }
        }
    }
    val vertexCount = positions.size / 3

    var minX = Float.MAX_VALUE; var minY = Float.MAX_VALUE; var minZ = Float.MAX_VALUE
    var maxX = -Float.MAX_VALUE; var maxY = -Float.MAX_VALUE; var maxZ = -Float.MAX_VALUE
    for (i in 0 until vertexCount) {
        val x = positions[i * 3]; val y = positions[i * 3 + 1]; val z = positions[i * 3 + 2]
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    }

    val posBytes = floatsToBytes(positions)
    val normBytes = floatsToBytes(normals)
    val combined = posBytes + normBytes
    val base64 = Base64.encodeToString(combined, Base64.NO_WRAP)

    val json = """
        {
          "asset": { "version": "2.0", "generator": "NAF Flute & Duduk Calculator (Android)" },
          "scene": 0,
          "scenes": [ { "nodes": [0] } ],
          "nodes": [ { "mesh": 0 } ],
          "meshes": [
            {
              "primitives": [
                {
                  "attributes": { "POSITION": 0, "NORMAL": 1 },
                  "material": 0,
                  "mode": 4
                }
              ]
            }
          ],
          "materials": [
            {
              "name": "antler",
              "pbrMetallicRoughness": {
                "baseColorFactor": [0.898, 0.835, 0.722, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.62
              },
              "doubleSided": true
            }
          ],
          "accessors": [
            {
              "bufferView": 0, "byteOffset": 0, "componentType": 5126, "count": $vertexCount, "type": "VEC3",
              "min": [${minX}, ${minY}, ${minZ}], "max": [${maxX}, ${maxY}, ${maxZ}]
            },
            {
              "bufferView": 1, "byteOffset": 0, "componentType": 5126, "count": $vertexCount, "type": "VEC3"
            }
          ],
          "bufferViews": [
            { "buffer": 0, "byteOffset": 0, "byteLength": ${posBytes.size}, "target": 34962 },
            { "buffer": 0, "byteOffset": ${posBytes.size}, "byteLength": ${normBytes.size}, "target": 34962 }
          ],
          "buffers": [
            { "byteLength": ${combined.size}, "uri": "data:application/octet-stream;base64,$base64" }
          ]
        }
    """.trimIndent()
    return json
}

private fun floatsToBytes(values: List<Float>): ByteArray {
    val buf = ByteBuffer.allocate(values.size * 4).order(ByteOrder.LITTLE_ENDIAN)
    for (f in values) buf.putFloat(f)
    return buf.array()
}
