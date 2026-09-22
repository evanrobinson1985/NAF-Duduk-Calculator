package com.nafduduk.calculator.mesh

import com.nafduduk.calculator.engine.ChamberGeometry
import com.nafduduk.calculator.engine.Curve
import com.nafduduk.calculator.engine.FluteConst
import com.nafduduk.calculator.engine.NestOverrides
import com.nafduduk.calculator.engine.ResolvedNest
import com.nafduduk.calculator.engine.curveBowAmplitudeIn
import kotlin.math.PI
import kotlin.math.max
import kotlin.math.min
import kotlin.math.tan

/**
 * Builds one chamber's solid body via CSG — a from-scratch but exact port
 * of buildChamberMesh()'s real anatomy: a hollow tube, the SAC-exit/flue/
 * TSH air-space cut and its internal ramp block (the exact swept 2D
 * profile, not a box approximation — see the "channel"/"block" point
 * lists below, each checked against the matching `THREE.Shape` in the jsx
 * point-for-point), shape-aware finger holes, the internal wall/plug
 * (unioned in LAST, matching the source's own verified-safe CSG ordering
 * note), and a mouthpiece plug with its blow hole bored through.
 *
 * Two intentional differences from the web source, both because this app
 * has no nest-override UI yet (android/README.md): every nest dimension
 * below uses the bore-derived FLUTE_CONST *auto* formula (equivalent to
 * every override being unset in the jsx), and the result is one unioned
 * watertight solid — including the mouthpiece plug and internal block,
 * which the web source keeps as separate Three.js meshes in the same
 * scene — since this app's CsgSolid models one exportable part rather
 * than a multi-mesh scene graph, and a single part is what you want for
 * STL/3D printing anyway. The bird block (birdKey === "default") isn't
 * built at all: this app has no bird-style picker.
 */
fun buildChamberSolid(
    geom: ChamberGeometry,
    curve: Curve,
    holeShapeKey: String = "round",
    nest: NestOverrides = NestOverrides(),
    radialSegments: Int = 0,
): CsgSolid {
    val bowAmp = curveBowAmplitudeIn(curve)
    val totalLen = geom.sacLenIn + geom.lengthIn

    // The body is ALWAYS built on a straight centerline and bent at the end
    // (mesh/SineBend.kt). Sweeping the CSG along the bow instead gives every
    // segment its own plane, which both blows up BSP cost and leaves holes and
    // pinched edges the repair pass cannot honestly close; bending a finished
    // straight body is an isometry per cross-section, so it preserves the
    // topology and every dimension. A straight tube's side walls are coplanar
    // station to station, so the BSP collapses them and extra segments are
    // nearly free — which is why the counts below are flat rather than traded
    // off against the bow.
    val segments = 20
    val radial = if (radialSegments > 0) radialSegments else 18

    val pathPoints = (0..segments).map { Vec3(it.toDouble() / segments * totalLen, 0.0, 0.0) }

    val bore = geom.bore
    val r = bore / 2
    // Override-or-formula, resolved by the SAME helper the split-block CAM
    // uses (engine/NestOverrides.kt), so the preview cannot show one nest
    // while the machine cuts another.
    val n = ResolvedNest(bore, geom.soundHoleWidthIn, nest)
    val wallT = n.wallThicknessIn
    val outerR = r + wallT
    val tTsh = (geom.sacLenIn / totalLen).coerceIn(0.0, 1.0)

    var body = buildCappedTube(pathPoints, outerR, radial)
        .subtract(buildCappedTube(pathPoints, r, radial))

    val shW = geom.soundHoleWidthIn
    val shL = geom.soundHoleLengthIn

    // nestBlockSolid: the internal ramp/flue-floor plug, built alongside the
    // channel cut below but unioned into the body LAST — the web source
    // found (and left a detailed comment on) that union-then-subtract at
    // the same location corrupts this specific CSG algorithm, so every
    // subtraction below happens first and this union happens at the very
    // end of the function, mirroring that ordering exactly.
    var nestBlockSolid: CsgSolid? = null

    val fluteChannelBoreLimit = 2.0
    if (bore <= fluteChannelBoreLimit) {
        val flueDepth = n.flueDepthIn
        val flueLength = n.flueLengthIn
        val overshoot = max(0.03, r * 0.08)
        val tshCutDepth = wallT + overshoot
        val fippleAngleDeg = n.fippleAngleDeg
        val rampAngleDegEffective = n.rampAngleDeg
        val rampRad = max(0.1, rampAngleDegEffective * PI / 180)

        val xTsh0 = 0.0
        val xTsh1 = shL
        val xFlue0 = -flueLength
        val xExit1 = xFlue0
        val xExit0 = xExit1 - shL

        val tipHeight = n.tipHeightIn
        val tipY = -flueDepth + tipHeight
        val tipFlat = n.tipFlatIn
        val tipYLow = tipY - tipFlat / 2
        val tipYHigh = tipY + tipFlat / 2
        val fippleRad = max(4.0, fippleAngleDeg) * PI / 180
        val bevRun = max(0.01, (tshCutDepth + tipYLow) / tan(fippleRad))
        val topRun = (-tipYHigh) / tan(15 * PI / 180)
        val backset = n.backsetIn

        val ceilRun = tshCutDepth / tan(rampRad)

        // The "channel" (air-space) profile — point-for-point the same
        // shape.moveTo/lineTo sequence as buildChamberMesh's `shape`
        // (verified CCW by hand-computing its signed area).
        val channelPoints = listOf(
            Vec3(xExit0, 0.15, 0.0),
            Vec3(xExit0, 0.0, 0.0),
            Vec3(xExit0 - ceilRun, -tshCutDepth, 0.0),
            Vec3(xTsh1 + bevRun, -tshCutDepth, 0.0),
            Vec3(xTsh1, tipYLow, 0.0),
            Vec3(xTsh1, tipYHigh, 0.0),
            Vec3(xTsh1 + topRun, 0.0, 0.0),
            Vec3(xTsh1 + topRun, 0.15, 0.0),
        )

        val basis = nestFrameAt(pathPoints, tTsh, outerR)
        val channelSolid = buildExtrudedProfile(channelPoints, shW, basis)
        body = body.subtract(channelSolid)

        // The "block" (internal ramp/flue-floor plug) profile — same
        // moveTo/lineTo/quadraticCurveTo sequence as buildChamberMesh's
        // `blockShape` (verified CW by hand; buildExtrudedProfile
        // normalizes winding internally so this doesn't need reversing
        // here).
        val yBot = -(wallT + 2 * r + 0.02)
        val rampRise = (-flueDepth) - yBot
        val rampRun = min(rampRise / tan(rampRad), max(0.1, geom.sacLenIn * 0.7))
        val xRampBase = xExit1 - rampRun
        val rampCurveK = n.rampCurve

        val blockPoints = mutableListOf(Vec3(xRampBase, yBot, 0.0))
        if (rampCurveK > 0.01) {
            val mx = (xRampBase + xExit1) / 2
            val my = (yBot + (-flueDepth)) / 2
            val cx = mx + rampCurveK * (xExit1 - mx)
            val cy = my + rampCurveK * (yBot - my)
            val p0 = Vec3(xRampBase, yBot, 0.0)
            val p2 = Vec3(xExit1, -flueDepth, 0.0)
            val steps = 12
            for (s in 1..steps) {
                val u = s.toDouble() / steps
                val x = (1 - u) * (1 - u) * p0.x + 2 * (1 - u) * u * cx + u * u * p2.x
                val y = (1 - u) * (1 - u) * p0.y + 2 * (1 - u) * u * cy + u * u * p2.y
                blockPoints.add(Vec3(x, y, 0.0))
            }
        } else {
            blockPoints.add(Vec3(xExit1, -flueDepth, 0.0))
        }
        blockPoints.add(Vec3(xTsh0 - backset, -flueDepth, 0.0))
        blockPoints.add(Vec3(xTsh0 - backset, yBot, 0.0))

        val blockW = 2 * (r + wallT) + 0.1
        val blockRaw = buildExtrudedProfile(blockPoints, blockW, basis)
        val clipTube = buildCappedTube(pathPoints, outerR, radial)
        nestBlockSolid = blockRaw.intersect(clipTube)
    } else {
        // Large-bore fallback (verified unreliable above 2in bore for the
        // flue-channel cutter, same limit the web source found): a plain
        // elliptical TSH cut, no flue/ramp. The web source rotates a
        // Y-axis cylinder to the tube's local `up` via a shortest-arc
        // quaternion, which leaves the ellipse's roll around that axis
        // unconstrained; this uses this app's own forward/right frame
        // directly instead, an equivalent (and better-defined) elliptical
        // cut, positioned and sized identically.
        val overshoot = max(0.03, r * 0.08)
        val cutDepth = wallT + overshoot
        val cutCenterDist = outerR - cutDepth / 2
        val basis = nestFrameAt(pathPoints, tTsh, outerR)
        val cutOrigin = basis.origin - basis.up * (outerR - cutCenterDist)
        val ellipseBasis = LocalBasis(origin = cutOrigin, forward = basis.forward, up = basis.right, right = basis.up)
        val ellipsePoints = (0 until 24).map { i ->
            val a = 2 * PI * i / 24
            Vec3((shL / 2) * kotlin.math.cos(a), (shW / 2) * kotlin.math.sin(a), 0.0)
        }
        val cutter = buildExtrudedProfile(ellipsePoints, cutDepth, ellipseBasis)
        body = body.subtract(cutter)
    }

    // ── Finger holes: real through-cuts, shape-aware (round/oval/
    // undercut/countersunk), exactly as buildChamberMesh cuts them. ──
    for (hole in geom.holes) {
        val t = ((geom.sacLenIn + hole.fromTshIn) / totalLen).coerceIn(0.0, 1.0)
        val center = pointAt(pathPoints, t)
        val tangent = tangentAt(pathPoints, t)
        val up = localUpAt(tangent)
        val holeR = max(0.02, hole.diameterIn / 2)

        val throughMargin = max(0.15, r * 0.5)
        val cutDepth = (outerR - r) + throughMargin
        val cutCenterDist = outerR - cutDepth / 2

        val forward = (tangent - up * tangent.dot(up)).let { if (it.length() < 1e-8) Vec3(1.0, 0.0, 0.0) else it.normalized() }
        val zAxis = forward.cross(up).normalized()
        val cutCenter = center + up * cutCenterDist

        val cutterSolid = when (holeShapeKey) {
            "oval" -> {
                // Major axis (listed diameter) runs ALONG the tube; minor
                // axis (diameter/1.4) runs across it — extruded along the
                // real cut axis `up`, so the basis maps profile-x -> forward,
                // profile-y -> zAxis (across), and depth (basis.right) -> up.
                val n = 24
                val pts = (0 until n).map { i ->
                    val a = 2 * PI * i / n
                    Vec3(holeR * kotlin.math.cos(a), (holeR / 1.4) * kotlin.math.sin(a), 0.0)
                }
                val ovalBasis = LocalBasis(origin = cutCenter, forward = forward, up = zAxis, right = up)
                buildExtrudedProfile(pts, cutDepth, ovalBasis)
            }
            "undercut" -> {
                // Frustum: surface opening at holeR, bore-side edge flared to holeR*1.35.
                buildFrustumAlong(cutCenter, up, cutDepth, topRadius = holeR, bottomRadius = holeR * 1.35, radialSegments = 16)
            }
            else -> buildCylinderAlong(cutCenter, up, cutDepth, holeR, radialSegments = 16)
        }
        body = body.subtract(cutterSolid)

        if (holeShapeKey == "countersunk") {
            val chamferDepth = max(0.02, min(wallT * 0.3, holeR * 0.8))
            val above = 0.03
            val coneH = chamferDepth + above
            val slope = (0.5 * holeR) / chamferDepth
            val topR = holeR * 1.5 + slope * above
            val chamferCenter = center + up * (outerR - chamferDepth + coneH / 2)
            // A thou under the hole radius, not exactly on it: the bore cutter
            // above already took everything inside holeR, so the chamfer's
            // narrow end removes nothing either way, but a rim landing exactly
            // on the bore wall makes the two cut surfaces coincident, and
            // coincident surfaces are where a BSP CSG leaves pinched edges.
            val chamferBottomR = max(holeR * 0.5, holeR - 0.001)
            val chamferCutter = buildFrustumAlong(chamferCenter, up, coneH, topRadius = topR, bottomRadius = chamferBottomR, radialSegments = 16)
            body = body.subtract(chamferCutter)
        }
    }

    // ── Internal wall/plug — union LAST (see the note above). ──
    body = if (nestBlockSolid != null) {
        body.union(nestBlockSolid)
    } else {
        val wallThickness = FluteConst.INTERNAL_WALL_THICKNESS_RATIO.let { ratio ->
            (bore * ratio).coerceIn(FluteConst.INTERNAL_WALL_THICKNESS_MIN, FluteConst.INTERNAL_WALL_THICKNESS_MAX)
        }
        val wallCenter = pointAt(pathPoints, tTsh)
        val wallTangent = tangentAt(pathPoints, tTsh)
        val wallSolid = buildCylinderAlong(wallCenter, wallTangent, wallThickness, r * 1.02, radialSegments = 20)
        var withWall = body.union(wallSolid)

        val exitHoleR = max(0.06, r * 0.35)
        val exitDepth = wallThickness + 0.03
        val exitUp = localUpAt(wallTangent)
        val exitCutter = buildCylinderAlong(wallCenter, exitUp, exitDepth, exitHoleR, radialSegments = 16)
        withWall = withWall.subtract(exitCutter)
        withWall
    }

    // ── Mouthpiece plug with the blow hole bored through it. ──
    run {
        val bhW = FluteConst.breathHoleWidth(bore)
        val bhL = FluteConst.breathHoleLength(bore)
        val tangent0 = tangentAt(pathPoints, 0.001)
        val rampDeg = FluteConst.SAC_EXIT_RAMP_ANGLE_DEG
        val flueLc = 2 * shW
        val rampRun = min(r / tan(rampDeg * PI / 180), max(0.15, geom.sacLenIn * 0.7))
        val xRampBase = max(0.0, (geom.sacLenIn - flueLc) - rampRun)
        val wantRun = bhL
        val plugRun = max(0.12, min(min(wantRun, max(0.05, geom.sacLenIn * 0.6)), if (xRampBase > 0) xRampBase else wantRun))

        val mouthCenter = pointAt(pathPoints, 0.0)
        val plugCenter = mouthCenter + tangent0 * (plugRun / 2)
        val plugSolid = buildCylinderAlong(plugCenter, tangent0, plugRun, outerR, radial)

        val a = mouthCenter + tangent0 * (-0.1)
        val b = mouthCenter + tangent0 * (plugRun + 0.04)
        val holeDir = b - a
        val holeLen = holeDir.length()
        val mid = (a + b) * 0.5
        val boreHoleSolid = buildCylinderAlong(mid, holeDir, holeLen, bhW / 2, radialSegments = 20)

        val plugWithHole = plugSolid.subtract(boreHoleSolid)
        body = body.union(plugWithHole)
    }

    return if (bowAmp == 0.0) body else bendAlongSineBow(body, totalLen, bowAmp)
}

/** A capped frustum (different top/bottom radii) standing along `axis`, `center` at its midpoint. */
private fun buildFrustumAlong(center: Vec3, axis: Vec3, length: Double, topRadius: Double, bottomRadius: Double, radialSegments: Int = 20): CsgSolid {
    val fwd = axis.normalized()
    var right = fwd.cross(Vec3(0.0, 1.0, 0.0))
    if (right.length() < 1e-6) right = fwd.cross(Vec3(1.0, 0.0, 0.0))
    right = right.normalized()
    val up = right.cross(fwd).normalized()
    val a = center - fwd * (length / 2)
    val b = center + fwd * (length / 2)

    val polys = mutableListOf<Polygon>()
    val ringA = (0 until radialSegments).map { s ->
        val th = 2 * PI * s / radialSegments
        a + right * (bottomRadius * kotlin.math.cos(th)) + up * (bottomRadius * kotlin.math.sin(th))
    }
    val ringB = (0 until radialSegments).map { s ->
        val th = 2 * PI * s / radialSegments
        b + right * (topRadius * kotlin.math.cos(th)) + up * (topRadius * kotlin.math.sin(th))
    }
    for (s in 0 until radialSegments) {
        val sNext = (s + 1) % radialSegments
        val p1 = ringA[s]; val p2 = ringB[s]; val p3 = ringB[sNext]; val p4 = ringA[sNext]
        val n = (p2 - p1).cross(p4 - p1).normalized()
        polys.add(Polygon(listOf(Vertex(p1, n), Vertex(p2, n), Vertex(p3, n), Vertex(p4, n))))
    }
    polys.add(Polygon(ringA.map { Vertex(it, -fwd) }))
    polys.add(Polygon(ringB.reversed().map { Vertex(it, fwd) }))
    return CsgSolid(polys)
}
