package com.nafduduk.calculator.gcode

import kotlin.math.max
import kotlin.math.min

data class TubeDrillingParams(
    val chambers: List<GcodeChamber>,
    val units: String, // "in" | "mm"
    val toolDiameter: Double,
    val feedRate: Double,
    val plungeRate: Double,
    val peckDepth: Double,
    val safeHeight: Double,
    val retractHeight: Double,
    val dialect: String,
    val spindleSpeed: Double,
    val setupMode: String, // "rotary" | "fixed"
    val droneBody: String = "separate", // "separate" | "solid"
)

private fun drillOneHole(
    lines: MutableList<String>,
    label: String,
    x: Double,
    y: Double?,
    diameter: Double,
    depth: Double,
    units: String,
    feedRate: Double,
    plungeRate: Double,
    peckDepth: Double,
    safeHeight: Double,
    retractHeight: Double,
    setupMode: String,
    angleDeg: Double,
    skipRotate: Boolean = false,
) {
    val rotateNote = if (setupMode == "fixed" && !skipRotate) ", rotate to ${fmt(angleDeg, 0)}° (top/12 o'clock)" else ""
    val yNote = if (y != null) ", Y ${fmt(toUnits(y, units), 3)}$units" else ""
    lines.add("( -- $label: Ø${fmt(toUnits(diameter, units), 3)}$units at ${fmt(toUnits(x, units), 2)}$units from mouth$yNote$rotateNote -- )")
    if (setupMode == "rotary") {
        lines.add("G0 A${fmt(angleDeg, 2)}")
    } else if (!skipRotate) {
        lines.add("M0 ( PAUSE — rotate tube to ${fmt(angleDeg, 0)}° and re-clamp, then resume )")
    }
    val yPart = if (y != null) " Y${fmt(toUnits(y, units), 3)}" else ""
    lines.add("G0 X${fmt(toUnits(x, units), 3)}$yPart Z${fmt(toUnits(safeHeight, units), 3)}")
    lines.add("G0 Z${fmt(toUnits(retractHeight, units), 3)}")

    // Explicit peck-drilling sequence (no G81/G83 — see CNC_DIALECTS note), so this runs identically on every dialect.
    val pecks = max(1, kotlin.math.ceil(depth / peckDepth).toInt())
    for (i in 1..pecks) {
        val z = -min(depth, i * peckDepth)
        lines.add("G1 Z${fmt(toUnits(z, units), 3)} F${fmt(toUnits(plungeRate, units), 1)}")
        if (i < pecks) lines.add("G0 Z${fmt(toUnits(retractHeight, units), 3)} ( chip clear )")
    }
    lines.add("G0 Z${fmt(toUnits(safeHeight, units), 3)}")
}

/**
 * Ported 1:1 from generateTubeDrillingGCode() in the web source: drills the
 * sound hole (TSH), SAC exit opening, flue channel, finger holes, and notes
 * the (hand-drilled) axial breath hole for each chamber into a tube that
 * already has its internal wall/plug installed. Explicit rapid/feed move
 * peck-drilling — no G81/G83 canned cycles — so it runs on GRBL too.
 */
fun generateTubeDrillingGCode(p: TubeDrillingParams): String {
    val oneBody = p.chambers.size > 1 && p.droneBody == "solid"
    val effSetup = if (oneBody) "fixed" else p.setupMode
    val yOffsAsc = if (oneBody) chamberYOffsets(p.chambers) else p.chambers.map { 0.0 }
    val yOffs = yOffsAsc.map { yOffsAsc.last() - it }

    val lines = mutableListOf<String>()
    val setupNotes = if (effSetup == "rotary") {
        listOf(
            "Tube is held in a rotary (4th-axis/A) fixture, centerline along X.",
            "A-axis rotates the tube to present each hole under a fixed vertical spindle; program work zero (X0) at the mouth end.",
            "Confirm your rotary fixture's A-axis direction matches this program (positive A = the direction noted per hole).",
        )
    } else {
        listOf(
            "3-axis setup: tube held in a V-block or fixture, centerline along X, NOT rotating under CNC control.",
            "Between each hole, ROTATE THE TUBE BY HAND to the angle noted in that hole's comment, then re-clamp before running that block.",
            "This program pauses (M0) before each hole so you can rotate/re-clamp safely — press cycle-start/resume when ready.",
            "All holes are assumed to be drilled straight down (12 o'clock / top of tube) once rotated into position.",
        )
    }
    val notes = mutableListOf(
        "PREREQUISITE: the internal wall/plug (separating the SAC from the sound chamber) must already be installed in the tube before running this program — see the build guide's \"Install the internal wall/plug\" step. This program does not create that wall; it only drills the sound hole and finger holes into a tube that already has it.",
    )
    if (oneBody && p.setupMode == "rotary") {
        notes.add("NOTE: rotary setup was selected, but a SOLID multi-chamber body cannot rotate in a fixture — this program was generated as a fixed 3-axis layout instead, with each chamber's ops at its own Y offset.")
    }
    notes.addAll(setupNotes)

    lines.addAll(
        gcodeHeader(
            p.dialect, p.units,
            title = "Tube Drilling — Finger Holes & Sound Hole (${if (effSetup == "rotary") "4th-axis rotary" else if (oneBody) "3-axis fixed — SOLID multi-chamber body, one clamping" else "3-axis fixed, manual rotation"})",
            notes = notes,
        ),
    )
    lines.add("S${Math.round(p.spindleSpeed)} M3 ( spindle on )")

    p.chambers.forEachIndexed { ci, c ->
        val r = c.boreIn / 2
        val yOff = if (oneBody) yOffs[ci] else null

        val yOffNote = if (yOff != null) " — Y offset ${fmt(toUnits(yOff, p.units), 3)}${p.units}" else ""
        lines.add("( ── Chamber ${ci + 1} — ${c.label}$yOffNote ── )")
        if (ci > 0 && !oneBody) {
            lines.add("M0 ( PAUSE — this chamber is a SEPARATE tube: unload the previous tube, fixture chamber ${ci + 1}'s tube, re-zero X0 at its mouth end, then resume )")
        }
        lines.add("G0 Z${fmt(toUnits(p.safeHeight, p.units), 3)}")

        // Sound hole (TSH) — at the SAC/body boundary, top of tube.
        drillOneHole(
            lines, "SOUND HOLE (TSH)", c.sacLenIn, yOff, max(c.effShW, c.effShL), r + 0.05,
            p.units, p.feedRate, p.plungeRate, p.peckDepth, p.safeHeight, p.retractHeight, effSetup, 0.0,
            skipRotate = oneBody,
        )
        // SAC exit opening — one TSH-length upstream of the flue.
        drillOneHole(
            lines, "SAC EXIT OPENING (elongate to the ramp by hand/undercut)",
            c.sacLenIn - c.effFlueLen - c.effShL / 2, yOff, c.effShW, r + 0.05,
            p.units, p.feedRate, p.plungeRate, p.peckDepth, p.safeHeight, p.retractHeight, effSetup, 0.0,
            skipRotate = true,
        )
        // FLUE channel — shallow milled slot from the exit opening to the TSH, widened with stepped-over passes.
        run {
            val passOver = max(1, kotlin.math.ceil((c.effShW - p.toolDiameter) / (p.toolDiameter * 0.6)).toInt() + 1)
            lines.add("( -- FLUE CHANNEL: ${fmt(toUnits(c.effFlueLen, p.units), 3)}${p.units} long × ${fmt(toUnits(c.effShW, p.units), 3)}${p.units} wide × ${fmt(toUnits(c.effFlueDepth, p.units), 3)}${p.units} deep -- )")
            for (pi in 0 until passOver) {
                val yo = (yOff ?: 0.0) + if (passOver == 1) 0.0 else -((c.effShW - p.toolDiameter) / 2) + pi * ((c.effShW - p.toolDiameter) / max(1, passOver - 1))
                lines.add("G0 X${fmt(toUnits(c.sacLenIn - c.effFlueLen, p.units), 3)} Y${fmt(toUnits(yo, p.units), 3)} Z${fmt(toUnits(p.retractHeight, p.units), 3)}")
                lines.add("G1 Z${fmt(-toUnits(c.effFlueDepth, p.units), 3)} F${fmt(toUnits(p.plungeRate, p.units), 1)}")
                lines.add("G1 X${fmt(toUnits(c.sacLenIn, p.units), 3)} F${fmt(toUnits(p.feedRate, p.units), 1)}")
                lines.add("G0 Z${fmt(toUnits(p.safeHeight, p.units), 3)}")
            }
        }

        // Finger holes, in physical order along the tube.
        if (c.playable) {
            val ordered = c.holes.sortedBy { it.fromTshIn }
            ordered.forEach { h ->
                drillOneHole(
                    lines, "HOLE H${h.num} (${h.interval})", c.sacLenIn + h.fromTshIn, yOff, h.diameterIn, r + 0.05,
                    p.units, p.feedRate, p.plungeRate, p.peckDepth, p.safeHeight, p.retractHeight, effSetup, 0.0,
                    skipRotate = oneBody,
                )
            }
        }

        // Blow-air (breath) hole — axial, separate setup.
        lines.add("( -- BLOW-AIR (BREATH) HOLE — chamber ${ci + 1}: Ø${fmt(toUnits(c.effBreathW, p.units), 3)}${p.units} × ${fmt(toUnits(c.effBreathL, p.units), 3)}${p.units} deep, AXIAL through the mouth face -- )")
        val yOffAxialNote = if (yOff != null) " (this chamber's centerline at Y ${fmt(toUnits(yOff, p.units), 3)}${p.units})" else ""
        lines.add("( This hole is drilled ALONG the tube axis into the mouth end$yOffAxialNote — )")
        lines.add("( it cannot be reached by the vertical spindle in this setup. Re-fixture the body )")
        lines.add("( vertically (mouth face up) or drill by hand/drill press, centered on the bore. )")
        lines.add("M0 ( PAUSE — drill the breath hole per the note above, then resume )")
    }

    lines.addAll(gcodeFooter(p.dialect))
    return lines.joinToString("\n")
}
