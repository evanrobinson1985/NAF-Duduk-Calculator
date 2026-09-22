package com.nafduduk.calculator.mesh

import kotlin.math.sqrt

/**
 * A from-scratch BSP-tree CSG (constructive solid geometry) engine — the
 * Android equivalent of the web app's `three-bvh-csg` library, which has
 * no Kotlin/JVM counterpart. Implements the classic algorithm (Naylor/
 * Amanatides/Thibault; the same algorithm popularized by Evan Wallace's
 * csg.js, which is itself the lineage most in-browser CSG libraries
 * descend from): build a binary space-partitioning tree from a solid's
 * polygons, then union/subtract/intersect two solids by clipping each
 * tree's polygons against the other and recombining.
 *
 * This is pure math with no Android/rendering dependency, so it's usable
 * from a plain JVM unit test independent of the Filament view.
 */
data class Vec3(val x: Double, val y: Double, val z: Double) {
    operator fun plus(o: Vec3) = Vec3(x + o.x, y + o.y, z + o.z)
    operator fun minus(o: Vec3) = Vec3(x - o.x, y - o.y, z - o.z)
    operator fun times(s: Double) = Vec3(x * s, y * s, z * s)
    operator fun unaryMinus() = Vec3(-x, -y, -z)
    fun dot(o: Vec3) = x * o.x + y * o.y + z * o.z
    fun cross(o: Vec3) = Vec3(y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x)
    fun length() = sqrt(dot(this))
    fun normalized(): Vec3 {
        val l = length()
        return if (l < 1e-12) this else Vec3(x / l, y / l, z / l)
    }
    fun lerp(o: Vec3, t: Double) = this + (o - this) * t

    companion object {
        val ZERO = Vec3(0.0, 0.0, 0.0)
    }
}

data class Vertex(val pos: Vec3, val normal: Vec3) {
    fun lerp(o: Vertex, t: Double) = Vertex(pos.lerp(o.pos, t), normal.lerp(o.normal, t).normalized())
    fun flip() = Vertex(pos, -normal)
}

/** A plane, represented as a normal + distance from origin (ax+by+cz=w). */
class Plane(val normal: Vec3, val w: Double) {
    companion object {
        const val EPSILON = 1e-5

        fun fromPoints(a: Vec3, b: Vec3, c: Vec3): Plane {
            val n = (b - a).cross(c - a).normalized()
            return Plane(n, n.dot(a))
        }
    }

    fun flip() = Plane(-normal, -w)

    /** Splits `polygon` by this plane into up to 4 output lists (coplanar polys go to front/back by orientation). */
    fun splitPolygon(
        polygon: Polygon,
        coplanarFront: MutableList<Polygon>,
        coplanarBack: MutableList<Polygon>,
        front: MutableList<Polygon>,
        back: MutableList<Polygon>,
    ) {
        val coplanar = 0
        val frontSide = 1
        val backSide = 2
        val spanning = 3

        val types = IntArray(polygon.vertices.size)
        var polygonType = 0
        for (i in polygon.vertices.indices) {
            val t = normal.dot(polygon.vertices[i].pos) - w
            val type = if (t < -EPSILON) backSide else if (t > EPSILON) frontSide else coplanar
            polygonType = polygonType or type
            types[i] = type
        }

        when (polygonType) {
            coplanar -> {
                if (normal.dot(polygon.plane.normal) > 0) coplanarFront.add(polygon) else coplanarBack.add(polygon)
            }
            frontSide -> front.add(polygon)
            backSide -> back.add(polygon)
            else -> {
                val f = mutableListOf<Vertex>()
                val b = mutableListOf<Vertex>()
                val n = polygon.vertices.size
                for (i in 0 until n) {
                    val j = (i + 1) % n
                    val ti = types[i]
                    val tj = types[j]
                    val vi = polygon.vertices[i]
                    val vj = polygon.vertices[j]
                    if (ti != backSide) f.add(vi)
                    if (ti != frontSide) b.add(if (ti != backSide) vi.copy() else vi)
                    if ((ti or tj) == spanning) {
                        val t = (w - normal.dot(vi.pos)) / normal.dot(vj.pos - vi.pos)
                        val vv = vi.lerp(vj, t)
                        f.add(vv)
                        b.add(vv)
                    }
                }
                if (f.size >= 3) front.add(Polygon(f))
                if (b.size >= 3) back.add(Polygon(b))
            }
        }
    }
}

class Polygon(val vertices: List<Vertex>) {
    val plane: Plane = Plane.fromPoints(vertices[0].pos, vertices[1].pos, vertices[2].pos)

    fun flip() = Polygon(vertices.reversed().map { it.flip() })
}

private class BspNode(initialPolygons: List<Polygon> = emptyList()) {
    var plane: Plane? = null
    var front: BspNode? = null
    var back: BspNode? = null
    val polygons: MutableList<Polygon> = mutableListOf()

    init {
        if (initialPolygons.isNotEmpty()) build(initialPolygons)
    }

    fun invert() {
        for (i in polygons.indices) polygons[i] = polygons[i].flip()
        plane = plane?.flip()
        front?.invert()
        back?.invert()
        val tmp = front
        front = back
        back = tmp
    }

    fun clipPolygons(input: List<Polygon>): List<Polygon> {
        val p = plane ?: return input.toList()
        var front = mutableListOf<Polygon>()
        var back = mutableListOf<Polygon>()
        for (poly in input) {
            p.splitPolygon(poly, front, back, front, back)
        }
        this.front?.let { front = it.clipPolygons(front).toMutableList() }
        back = if (this.back != null) this.back!!.clipPolygons(back).toMutableList() else mutableListOf()
        return front + back
    }

    fun clipTo(other: BspNode) {
        val newPolys = other.clipPolygons(polygons)
        polygons.clear()
        polygons.addAll(newPolys)
        front?.clipTo(other)
        back?.clipTo(other)
    }

    fun allPolygons(): List<Polygon> {
        val result = mutableListOf<Polygon>()
        result.addAll(polygons)
        front?.let { result.addAll(it.allPolygons()) }
        back?.let { result.addAll(it.allPolygons()) }
        return result
    }

    fun build(inputPolygons: List<Polygon>) {
        if (inputPolygons.isEmpty()) return
        if (plane == null) plane = inputPolygons[0].plane
        val curPlane = plane!!
        val frontP = mutableListOf<Polygon>()
        val backP = mutableListOf<Polygon>()
        for (poly in inputPolygons) {
            curPlane.splitPolygon(poly, polygons, polygons, frontP, backP)
        }
        if (frontP.isNotEmpty()) {
            if (front == null) front = BspNode()
            front!!.build(frontP)
        }
        if (backP.isNotEmpty()) {
            if (back == null) back = BspNode()
            back!!.build(backP)
        }
    }
}

/** A solid, represented as a soup of convex/near-planar polygons — the CSG operand type. */
class CsgSolid(val polygons: List<Polygon>) {
    private fun node(): BspNode = BspNode(polygons)

    fun union(other: CsgSolid): CsgSolid {
        val a = node()
        val b = other.node()
        a.clipTo(b)
        b.clipTo(a)
        b.invert()
        b.clipTo(a)
        b.invert()
        a.build(b.allPolygons())
        return CsgSolid(a.allPolygons())
    }

    fun subtract(other: CsgSolid): CsgSolid {
        val a = node()
        val b = other.node()
        a.invert()
        a.clipTo(b)
        b.clipTo(a)
        b.invert()
        b.clipTo(a)
        b.invert()
        a.build(b.allPolygons())
        a.invert()
        return CsgSolid(a.allPolygons())
    }

    fun intersect(other: CsgSolid): CsgSolid {
        val a = node()
        val b = other.node()
        a.invert()
        b.clipTo(a)
        b.invert()
        a.clipTo(b)
        b.clipTo(a)
        a.build(b.allPolygons())
        a.invert()
        return CsgSolid(a.allPolygons())
    }
}
