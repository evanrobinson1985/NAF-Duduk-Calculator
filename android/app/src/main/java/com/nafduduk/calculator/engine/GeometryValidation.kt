package com.nafduduk.calculator.engine

import com.nafduduk.calculator.util.jsFmt
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.round

/**
 * Cross-checks a chamber's numbers against the shared FLUTE_CONST formulas,
 * and snaps back whatever disagrees — a 1:1 port of the web source's
 * validateChamberGeometry / fixChamberGeometry pair.
 *
 * buildChamberGeometry derives everything from those formulas, so a freshly
 * built chamber always passes. What this catches is the values that arrive
 * from somewhere else: a SAC override, an ergonomic hole adjustment the
 * player dragged past its neighbour, or a library entry saved by an older
 * build. Every check has exactly one canonical answer, so every fix is just
 * "snap the flagged field to it".
 *
 * Run automatically before every export (see FluteScreen), so the G-code,
 * PDF, template and 3D preview all describe the same instrument — with the
 * corrections listed on screen and an undo, because a maker who deliberately
 * wants an odd number should be able to keep it.
 *
 * ONE DELIBERATE DIFFERENCE FROM THE WEB SOURCE. There, buildChamberGeometry
 * returns its dimensions as fmt()-rounded *strings* — "0.38" for a sound-hole
 * width of 0.375 — and the validator compares those against the
 * full-precision formulas. The rounding alone exceeds GEOMETRY_TOLERANCE, so
 * a chamber straight out of the builder is flagged every time: the web app's
 * panel permanently reads "4 geometry issues found & fixed", on every flute,
 * measuring nothing but its own display rounding. This port keeps the
 * geometry numeric and validates the real values, so a fresh chamber passes
 * and the checks fire only when something is actually wrong. The formulas,
 * the tolerance, the checks and the fixes are otherwise identical, and
 * tools/parity/run.sh pins them to the original by feeding both sides the
 * same rounded numbers.
 */
// Tolerance lives in FluteConst.kt (GEOMETRY_TOLERANCE), shared with every
// other cross-output comparison in the app.

/** One flagged value, in the wording the UI shows. */
data class GeometryIssue(val label: String, val message: String) {
    override fun toString(): String = "$label: $message"
}

data class GeometryReport(val issues: List<GeometryIssue>) {
    val valid: Boolean get() = issues.isEmpty()
}

/** A corrected chamber plus a human list of what moved. */
data class GeometryFix(val geometry: ChamberGeometry, val fixes: List<GeometryIssue>)

private fun round3(v: Double): Double = round(v * 1000) / 1000

private fun n(v: Double): String = jsFmt(v, 3)

fun validateChamberGeometry(c: ChamberGeometry, label: String = "chamber"): GeometryReport {
    val issues = mutableListOf<GeometryIssue>()
    fun flag(message: String) = issues.add(GeometryIssue(label, message))

    // SAC length is user-overridable, so only genuinely broken values are
    // flagged — non-finite or outside the physically sane window — not
    // deviations from the auto formula.
    if (!c.sacLenIn.isFinite() || c.sacLenIn < 0.8 || c.sacLenIn > 20) {
        flag("sacLen=${c.sacLenIn} is outside the sane range 0.8–20″ (auto for this bore: ${n(FluteConst.autoSacLen(c.bore))}″)")
    }
    val expectedShW = FluteConst.soundHoleWidth(c.bore)
    if (abs(c.soundHoleWidthIn - expectedShW) > GEOMETRY_TOLERANCE) {
        flag("shW=${c.soundHoleWidthIn} does not match soundHoleWidth(bore)=${n(expectedShW)}")
    }
    val expectedShL = FluteConst.soundHoleLength(c.bore)
    if (abs(c.soundHoleLengthIn - expectedShL) > GEOMETRY_TOLERANCE) {
        flag("shL=${c.soundHoleLengthIn} does not match soundHoleLength(bore)=${n(expectedShL)}")
    }
    val totalLen = c.totalLenIn
    if (totalLen != null) {
        val expectedTotal = c.lengthIn + c.sacLenIn + c.mouthpieceMarginIn
        if (abs(totalLen - expectedTotal) > GEOMETRY_TOLERANCE) {
            flag("totalLen=$totalLen does not match L+sacLen+mouthpieceMargin=${n(expectedTotal)}")
        }
    }

    if (c.playable && c.holes.isNotEmpty()) {
        for (h in c.holes) {
            val sum = h.fromTshIn + h.fromFootIn
            if (abs(sum - c.lengthIn) > GEOMETRY_TOLERANCE) {
                issues.add(
                    GeometryIssue(
                        "$label H${h.num}",
                        "fromTSH(${h.fromTshIn}) + fromFoot(${h.fromFootIn}) = ${n(sum)}, expected chamber length ${c.lengthIn}",
                    ),
                )
            }
        }
        val sorted = c.holes.sortedBy { it.fromTshIn }
        for (i in 0 until sorted.size - 1) {
            val gap = sorted[i + 1].fromTshIn - sorted[i].fromTshIn
            val d1 = sorted[i].diameterIn
            val d2 = sorted[i + 1].diameterIn
            // Edges touching is the absolute physical limit.
            if ((d1 + d2) / 2 > gap) {
                issues.add(
                    GeometryIssue(
                        "$label H${sorted[i].num}/H${sorted[i + 1].num}",
                        "hole diameters ($d1\"/$d2\") physically overlap at gap ${n(gap)}\"",
                    ),
                )
            }
        }
    }
    return GeometryReport(issues)
}

fun fixChamberGeometry(c: ChamberGeometry, label: String = "chamber"): GeometryFix {
    val fixes = mutableListOf<GeometryIssue>()
    fun note(message: String) = fixes.add(GeometryIssue(label, message))

    var sacLen = c.sacLenIn
    if (!sacLen.isFinite() || sacLen < 0.8 || sacLen > 20) {
        val autoSac = round3(FluteConst.autoSacLen(c.bore))
        note("SAC length ${c.sacLenIn}″ → $autoSac″ (capped auto; overrides in the sane range are left alone)")
        sacLen = autoSac
    }
    var shW = c.soundHoleWidthIn
    val expectedShW = round3(FluteConst.soundHoleWidth(c.bore))
    if (abs(shW - expectedShW) > GEOMETRY_TOLERANCE) {
        note("sound-hole width $shW″ → $expectedShW″")
        shW = expectedShW
    }
    var shL = c.soundHoleLengthIn
    val expectedShL = round3(FluteConst.soundHoleLength(c.bore))
    if (abs(shL - expectedShL) > GEOMETRY_TOLERANCE) {
        note("sound-hole length $shL″ → $expectedShL″")
        shL = expectedShL
    }
    var totalLen = c.totalLenIn
    if (totalLen != null) {
        val expectedTotal = round3(c.lengthIn + sacLen + c.mouthpieceMarginIn)
        if (abs(totalLen - expectedTotal) > GEOMETRY_TOLERANCE) {
            note("total length $totalLen″ → $expectedTotal″ (L + SAC + mouthpiece margin)")
            totalLen = expectedTotal
        }
    }

    var holes = c.holes
    if (c.playable && holes.isNotEmpty()) {
        // 1) fromTSH + fromFoot must equal the chamber length. Keep fromTSH —
        //    that is the position you actually drill to — and recompute
        //    fromFoot from it.
        holes = holes.map { h ->
            if (abs((h.fromTshIn + h.fromFootIn) - c.lengthIn) > GEOMETRY_TOLERANCE) {
                val newFoot = round3(c.lengthIn - h.fromTshIn)
                fixes.add(
                    GeometryIssue(
                        "$label H${h.num}",
                        "fromFoot ${h.fromFootIn}″ → $newFoot″ (so fromTSH + fromFoot = ${round3(c.lengthIn)}″)",
                    ),
                )
                h.copy(fromFootIn = newFoot)
            } else {
                h
            }
        }

        // 2) Neighbouring holes must not physically overlap: shrink whichever
        //    of an overlapping pair is too big down to its share of the gap,
        //    floored at the minimum drillable diameter.
        val shrunk = HashMap<Int, Double>()
        val sorted = holes.sortedBy { it.fromTshIn }
        for (i in 0 until sorted.size - 1) {
            val a = sorted[i]
            val b = sorted[i + 1]
            val gap = b.fromTshIn - a.fromTshIn
            val d1 = shrunk[a.num] ?: a.diameterIn
            val d2 = shrunk[b.num] ?: b.diameterIn
            if ((d1 + d2) / 2 > gap) {
                val maxEach = max(FluteConst.HOLE_MIN_DIAMETER, round3(gap * FluteConst.HOLE_OVERLAP_CLEARANCE))
                for ((hole, d) in listOf(a to d1, b to d2)) {
                    if (d > maxEach) {
                        fixes.add(
                            GeometryIssue(
                                "$label H${hole.num}",
                                "diameter $d″ → $maxEach″ (was overlapping its neighbour)",
                            ),
                        )
                        shrunk[hole.num] = maxEach
                    }
                }
            }
        }
        if (shrunk.isNotEmpty()) {
            holes = holes.map { h -> shrunk[h.num]?.let { h.copy(diameterIn = it) } ?: h }
        }
    }

    return GeometryFix(
        c.copy(
            sacLenIn = sacLen,
            soundHoleWidthIn = shW,
            soundHoleLengthIn = shL,
            totalLenIn = totalLen,
            holes = holes,
        ),
        fixes,
    )
}

/** The validate-then-fix cycle the UI runs on every upstream change. */
data class GeometryAudit(
    /** The geometry every export should use: corrected if anything was wrong. */
    val effective: List<ChamberGeometry>,
    /** What was wrong, in the original. Empty when the input was already sound. */
    val issues: List<GeometryIssue>,
    /** What the fix changed, one line per correction. */
    val fixes: List<GeometryIssue>,
    /** Whatever the fix could NOT resolve — should always be empty; shown if not. */
    val remaining: List<GeometryIssue>,
) {
    val wasValid: Boolean get() = issues.isEmpty()
    val didFix: Boolean get() = fixes.isNotEmpty()
}

fun auditChambers(chambers: List<ChamberGeometry>, labels: List<String>): GeometryAudit {
    fun labelAt(i: Int) = labels.getOrNull(i) ?: "Chamber ${i + 1}"

    val issues = chambers.flatMapIndexed { i, c -> validateChamberGeometry(c, labelAt(i)).issues }
    if (issues.isEmpty()) {
        return GeometryAudit(effective = chambers, issues = emptyList(), fixes = emptyList(), remaining = emptyList())
    }
    val fixed = chambers.mapIndexed { i, c -> fixChamberGeometry(c, labelAt(i)) }
    val effective = fixed.map { it.geometry }
    return GeometryAudit(
        effective = effective,
        issues = issues,
        fixes = fixed.flatMap { it.fixes },
        remaining = effective.flatMapIndexed { i, c -> validateChamberGeometry(c, labelAt(i)).issues },
    )
}

/**
 * A drone chamber carries the same measurements as a melody chamber under
 * different names, so it is validated as one. The mouthpiece margin is not
 * stored on the result because buildDroneResults equalizes it to the melody
 * chamber's; it has to be passed back in for the totalLen check to mean
 * anything.
 */
private fun DroneResult.asChamberGeometry(mouthpieceMarginIn: Double) = ChamberGeometry(
    bore = boreIn,
    // Neither freq nor theoreticalHoles is read by a check or a fix, and a
    // DroneResult does not carry its own frequency, so this stays unset.
    freq = 0.0,
    lengthIn = lengthIn,
    totalLenIn = totalLenIn,
    sacLenIn = sacLenIn,
    mouthpieceMarginIn = mouthpieceMarginIn,
    soundHoleWidthIn = shWIn,
    soundHoleLengthIn = shLIn,
    holeCount = holeCount,
    holes = holes,
    theoreticalHoles = holes,
    playable = playable,
)

private fun DroneResult.withCorrections(c: ChamberGeometry) = copy(
    lengthIn = c.lengthIn,
    sacLenIn = c.sacLenIn,
    totalLenIn = c.totalLenIn,
    shWIn = c.soundHoleWidthIn,
    shLIn = c.soundHoleLengthIn,
    holes = c.holes,
)

/** The audit as the Flute screen consumes it: corrected melody + drones, and the story. */
data class FluteGeometryAudit(
    val melody: ChamberGeometry,
    val drones: List<DroneResult>,
    val issues: List<GeometryIssue>,
    val fixes: List<GeometryIssue>,
    val remaining: List<GeometryIssue>,
) {
    val wasValid: Boolean get() = issues.isEmpty()
    val didFix: Boolean get() = fixes.isNotEmpty()
}

/**
 * Validates the melody chamber and every drone together, and returns the
 * corrected set. A playable drone borrows the melody tube's hole positions
 * and remaps them onto its own length and SAC, which is the one place in the
 * app where hole geometry is not computed straight from the formulas — so it
 * is also the one place these checks routinely earn their keep.
 */
fun auditFluteChambers(melody: ChamberGeometry, drones: List<DroneResult>): FluteGeometryAudit {
    val labels = listOf("Melody") + drones.mapIndexed { i, d ->
        if (d.playable) "Chamber ${i + 2} (playable)" else "Drone ${i + 1}"
    }
    val audit = auditChambers(
        listOf(melody) + drones.map { it.asChamberGeometry(melody.mouthpieceMarginIn) },
        labels,
    )
    return FluteGeometryAudit(
        melody = audit.effective.first(),
        drones = drones.mapIndexed { i, d -> d.withCorrections(audit.effective[i + 1]) },
        issues = audit.issues,
        fixes = audit.fixes,
        remaining = audit.remaining,
    )
}
