package com.nafduduk.calculator.pdf

import android.graphics.pdf.PdfDocument
import com.nafduduk.calculator.engine.SCALE_CONFIGS
import com.nafduduk.calculator.engine.nearestNote
import java.util.Locale

private fun fmt(n: Double, dec: Int = 2): String = String.format(Locale.US, "%.${dec}f", n)

fun pageHeader(c: PdfCanvas, title: String, subtitle: String) {
    c.setFont(bold = true)
    c.setFontSize(18f)
    c.text(title, 4.25f, 0.8f, TextAlign.CENTER)
    c.setFont(bold = false)
    c.setFontSize(10f)
    c.setTextColor(120, 120, 120)
    c.text(subtitle, 4.25f, 1.05f, TextAlign.CENTER)
    c.setTextColor(0, 0, 0)
    c.setDrawColor(200, 150, 50)
    c.setLineWidth(0.02f)
    c.line(0.8f, 1.25f, 7.7f, 1.25f)
}

fun checkboxLine(c: PdfCanvas, x: Float, y: Float, text: String, bold: Boolean = false, size: Float = 11f, maxWidthIn: Float = 6.5f) {
    c.setDrawColor(0, 0, 0)
    c.setLineWidth(0.015f)
    c.rect(x, y - 0.13f, 0.16f, 0.16f)
    c.setFont(bold = bold)
    c.setFontSize(size)
    c.text(text, x + 0.26f, y, maxWidthIn = maxWidthIn)
}

// ── PAGE: Cover Sheet ──────────────────────────────────────────
private fun drawCoverPage(c: PdfCanvas, data: FlutePdfData) {
    val isAntler = data.pipeMaterial == "antler"
    val isDrone = data.drones.isNotEmpty()

    c.setFont(bold = true)
    c.setFontSize(24f)
    c.text("${if (isAntler) "Antler" else "NAF"} ${if (isDrone) "${data.drones.size}-Drone " else ""}Flute", 4.25f, 1.3f, TextAlign.CENTER)
    c.setFont(bold = false)
    c.setFontSize(14f)
    c.setTextColor(120, 90, 40)
    c.text("${data.holeCount}-Hole · Key of ${data.rootNote.name} · Workshop Build Packet", 4.25f, 1.65f, TextAlign.CENTER)
    c.setTextColor(0, 0, 0)

    c.setDrawColor(200, 150, 50)
    c.setLineWidth(0.03f)
    c.line(1.2f, 1.95f, 7.3f, 1.95f)

    var y = 2.5f
    val specs = listOf(
        "Material" to (if (isAntler) "Antler (${data.antlerShape} curve)" else "Straight pipe"),
        "Tuning reference" to "A4 = ${fmt(data.a4, 0)} Hz",
        "Bore diameter" to "${fmt(data.boreIn, 3)}\"",
        "Root note" to data.rootNote.name,
        "Hand size" to data.handSize,
        "Melody tube (TSH→foot)" to "${fmt(data.lengthIn)}\"",
        "SAC length" to "${fmt(data.sacLenIn)}\"",
        "Total length (melody)" to "${fmt(data.totalLenIn)}\"",
    )
    c.setFontSize(12f)
    specs.forEach { (label, v) ->
        c.setFont(bold = true); c.text("$label:", 1.4f, y)
        c.setFont(bold = false); c.text(v, 4.0f, y)
        y += 0.34f
    }

    if (isDrone) {
        y += 0.15f
        c.setFont(bold = true); c.setFontSize(13f)
        c.text("Secondary Chambers (${data.drones.size}):", 1.4f, y); y += 0.3f
        c.setFont(bold = false); c.setFontSize(11f)
        data.drones.forEachIndexed { i, d ->
            val kind = if (d.playable) "Playable, ${d.holeCount}-hole" else "Drone (${d.droneIntervalLabel})"
            c.text("Chamber ${i + 2}: $kind — ${d.note.name} — bore ${fmt(d.boreIn, 3)}\" — total ${fmt(d.totalLenIn)}\"", 1.4f, y, maxWidthIn = 6.3f)
            y += 0.3f
        }
    }

    y += 0.25f
    c.setDrawColor(200, 150, 50); c.setLineWidth(0.02f)
    c.line(1.2f, y, 7.3f, y); y += 0.35f

    c.setFont(bold = true); c.setFontSize(12f)
    c.text("Packet Contents:", 1.4f, y); y += 0.3f
    c.setFont(bold = false); c.setFontSize(11f)
    listOf(
        "1. Cover Sheet — this page",
        "2. Cutting Guide — true-scale (100%) cut lines for tube length",
        "3. Drill Guide — true-scale (100%) finger hole positions & sizes",
        "4. Tuning Guide — step-by-step expected pitch as each hole opens",
        "5. Sanding Checklist",
        "6. Finishing Checklist",
    ).forEach { line -> c.text(line, 1.6f, y); y += 0.28f }

    y += 0.2f
    c.setFont(bold = false, italic = true); c.setFontSize(9.5f)
    c.setTextColor(120, 120, 120)
    c.text("Print the Cutting Guide and Drill Guide pages at 100% scale (no \"fit to page\").", 1.4f, y, maxWidthIn = 6.3f); y += 0.22f
    c.text("Each of those pages includes a 1\" calibration box — verify it with a ruler before cutting or drilling.", 1.4f, y, maxWidthIn = 6.3f)
    c.setTextColor(0, 0, 0)
    c.setFont(italic = false)
}

// ── PAGE: Tuning Guide ─────────────────────────────────────────
private fun drawTuningGuidePage(doc: NafPdfDocument, data: FlutePdfData) {
    val c = doc.addPage(PdfPageSize.LETTER_PORTRAIT)
    pageHeader(c, "Tuning Guide", "Expected pitch as each hole opens, from mouth end toward foot — check with a chromatic tuner")

    val config = SCALE_CONFIGS[data.holeCount]
    val rootFreq = data.notes.find { it.name == data.rootNote.name }?.freq
    val orderedHoles = config?.holes?.sortedByDescending { it.num } ?: emptyList()

    var y = 1.65f
    c.setFont(bold = true); c.setFontSize(11f)
    c.text("Step", 0.8f, y); c.text("Action", 1.5f, y); c.text("Interval", 3.6f, y)
    c.text("Expected Note", 4.9f, y); c.text("Expected Freq.", 6.3f, y)
    y += 0.1f; c.setDrawColor(0, 0, 0); c.setLineWidth(0.01f); c.line(0.8f, y, 7.7f, y); y += 0.28f

    c.setFont(bold = false); c.setFontSize(10.5f)
    data class Row(val step: Int, val action: String, val interval: String, val note: String, val freq: Double?)
    val rows = mutableListOf(Row(1, "Cover all holes", "Root", data.rootNote.name, rootFreq))
    orderedHoles.forEachIndexed { i, h ->
        val freq = rootFreq?.times(h.ratio)
        rows.add(
            Row(
                step = i + 2, action = "Open Hole ${h.num}", interval = h.interval,
                note = if (rootFreq != null) nearestNote(rootFreq * h.ratio, data.notes).name else "--",
                freq = freq,
            ),
        )
    }
    rows.forEach { r ->
        c.text(r.step.toString(), 0.85f, y)
        c.text(r.action, 1.5f, y)
        c.text(r.interval, 3.6f, y)
        c.setFont(bold = true); c.text(r.note, 4.9f, y); c.setFont(bold = false)
        c.text(if (r.freq != null) "${fmt(r.freq, 1)} Hz" else "--", 6.3f, y)
        y += 0.34f
    }

    y += 0.15f; c.line(0.8f, y, 7.7f, y); y += 0.3f
    c.setFont(bold = false, italic = true); c.setFontSize(9.5f)
    c.text("Drill each hole undersized first, blow a steady breath, and compare against the expected", 0.8f, y); y += 0.22f
    c.text("frequency above before enlarging. Enlarge gradually with a round file — you can always go", 0.8f, y); y += 0.22f
    c.text("bigger, never smaller. This same walkthrough is available live (with microphone comparison)", 0.8f, y); y += 0.22f
    c.text("in the app's Progressive Tuning Assistant.", 0.8f, y)
    c.setFont(italic = false)
}

// ── PAGE: Fingering Chart ───────────────────────────────────────
private fun drawFingeringChartPage(doc: NafPdfDocument, data: FlutePdfData) {
    val c = doc.addPage(PdfPageSize.LETTER_PORTRAIT)
    pageHeader(c, "Fingering Chart", "Cover = root note. Each note opens one more hole, mouth end toward foot.")

    val config = SCALE_CONFIGS[data.holeCount]
    val rootFreq = data.notes.find { it.name == data.rootNote.name }?.freq
    val orderedHoles = config?.holes?.sortedByDescending { it.num } ?: emptyList()

    data class Col(val note: String, val sub: String, val freq: Double?, val openCount: Int)
    val cols = mutableListOf(Col(data.rootNote.name, "all closed", rootFreq, 0))
    orderedHoles.forEachIndexed { i, h ->
        cols.add(
            Col(
                note = if (rootFreq != null) nearestNote(rootFreq * h.ratio, data.notes).name else "--",
                sub = h.interval,
                freq = rootFreq?.times(h.ratio),
                openCount = i + 1,
            ),
        )
    }

    val left = 0.9f; val right = 7.6f; val top = 1.7f
    val colW = (right - left) / cols.size
    val holeGap = 0.34f; val holeRad = 0.09f
    val stackTop = top + 0.55f

    c.setFont(bold = false); c.setFontSize(8f); c.setTextColor(120, 120, 120)
    orderedHoles.forEachIndexed { i, h -> c.text("H${h.num}", left - 0.28f, stackTop + i * holeGap + 0.03f, TextAlign.RIGHT) }
    c.setTextColor(0, 0, 0)

    cols.forEachIndexed { ci, col ->
        val cx = left + colW * ci + colW / 2

        c.setFont(bold = true); c.setFontSize(11.5f)
        c.text(col.note, cx, top, TextAlign.CENTER)
        c.setFont(bold = false); c.setFontSize(8f); c.setTextColor(120, 120, 120)
        c.text(col.sub, cx, top + 0.16f, TextAlign.CENTER)
        c.setTextColor(0, 0, 0)

        orderedHoles.forEachIndexed { ri, _ ->
            val cy = stackTop + ri * holeGap
            val isOpen = ri < col.openCount
            c.setDrawColor(20, 20, 20); c.setLineWidth(0.014f)
            if (isOpen) {
                c.circle(cx, cy, holeRad)
            } else {
                c.setFillColor(20, 20, 20)
                c.circle(cx, cy, holeRad, fill = true)
            }
        }

        c.setFont(bold = false); c.setFontSize(7.5f); c.setTextColor(120, 120, 120)
        c.text(if (col.freq != null) "${fmt(col.freq, 0)} Hz" else "--", cx, stackTop + orderedHoles.size * holeGap + 0.22f, TextAlign.CENTER)
        c.setTextColor(0, 0, 0)
    }

    var y = stackTop + orderedHoles.size * holeGap + 0.55f
    c.setDrawColor(200, 150, 50); c.setLineWidth(0.015f); c.line(0.8f, y, 7.7f, y); y += 0.25f
    c.setFont(bold = false, italic = true); c.setFontSize(9f); c.setTextColor(90, 90, 90)
    c.text("Filled circle = hole covered. Open circle = hole open. Shown mouth end (top) to foot end (bottom), matching how you'd hold the flute.", 0.8f, y, maxWidthIn = 6.9f); y += 0.24f
    c.text("This covers the primary scale only — half-holing and cross-fingerings for notes in between depend on the", 0.8f, y, maxWidthIn = 6.9f); y += 0.2f
    c.text("individual instrument and aren't predicted here; find them by ear.", 0.8f, y, maxWidthIn = 6.9f)
    c.setTextColor(0, 0, 0)
    c.setFont(italic = false)
}

// ── PAGE: Sanding Checklist ─────────────────────────────────────
private fun drawSandingChecklistPage(doc: NafPdfDocument, data: FlutePdfData) {
    val isAntler = data.pipeMaterial == "antler"
    val c = doc.addPage(PdfPageSize.LETTER_PORTRAIT)
    pageHeader(c, "Sanding Checklist", if (isAntler) "Antler surface & bore prep" else "Straight pipe surface prep")

    var y = 1.7f
    val items = if (isAntler) {
        listOf(
            "Rough-shape the outside with a coarse rasp or belt sander, removing saw marks from cutting the mouth and foot ends",
            "Sand the outer surface progressively: 80 → 150 → 220 grit, following the antler's natural contour rather than flattening it",
            "Round over the mouthpiece end so it sits comfortably against your lips — no sharp edges",
            "Sand the foot end edge lightly to remove burrs from cutting",
            "Deburr the inside edge of every finger hole with a round needle file or sanding drum — sharp edges here affect both feel and tone",
            "Deburr the inside edge of the TSH (sound hole) window the same way",
            "Wipe the whole antler down with a damp cloth to raise the grain, let dry, then knock back any raised fibers with 220 grit",
            "Final pass with 320–400 grit for a smooth, glove-like feel before finishing",
            "Check the bore by feel (finger or cloth-wrapped dowel) for any rough or spongy patches left from hollowing — sand or seal these before finishing",
        )
    } else {
        listOf(
            "Remove any tooling marks or flash from cutting the mouth and foot ends",
            "Sand the outer surface progressively: 120 → 220 → 320 grit if the pipe will be painted, wrapped, or left natural",
            "Round over the mouthpiece end so it sits comfortably against your lips — no sharp edges",
            "Deburr the inside edge of every finger hole — sharp edges here affect both feel and tone",
            "Deburr the inside edge of the TSH (sound hole) window the same way",
            "Lightly scuff the outer surface if you plan to paint, stain, or wrap the tube, so finish adheres evenly",
            "Wipe down with a dry or slightly damp cloth to remove all sanding dust before finishing",
        )
    }

    c.setFontSize(11.5f)
    items.forEach { item -> checkboxLine(c, 0.9f, y, item, maxWidthIn = 6.3f); y += 0.5f }

    y += 0.1f
    c.setFont(bold = false, italic = true); c.setFontSize(9.5f); c.setTextColor(120, 120, 120)
    c.text("Tip: hold the tube up to a light after sanding the bore — any thin or translucent", 0.8f, y); y += 0.2f
    c.text("spots indicate a wall that may be too thin at that point.", 0.8f, y)
    c.setTextColor(0, 0, 0)
    c.setFont(italic = false)
}

// ── PAGE: Finishing Checklist ───────────────────────────────────
private fun drawFinishingChecklistPage(doc: NafPdfDocument, data: FlutePdfData) {
    val isAntler = data.pipeMaterial == "antler"
    val isDrone = data.drones.isNotEmpty()
    val c = doc.addPage(PdfPageSize.LETTER_PORTRAIT)
    pageHeader(c, "Finishing Checklist", if (isAntler) "Sealing & finishing an antler flute" else "Sealing & finishing a pipe flute")

    var y = 1.7f
    val items = if (isAntler) {
        listOf(
            "Confirm final tuning on every hole is correct before finishing — a sealant coat makes further hole enlargement messier",
            "Apply a thin first coat of finish (tung oil, beeswax/mineral-oil blend, or antler-safe polyurethane) to the outside only",
            "Let the first coat cure fully per the product's instructions before handling",
            "Lightly buff with 0000 steel wool or a soft cloth between coats",
            "Apply 2–3 additional thin coats, curing and buffing between each, rather than one thick coat",
            "Seal the bore interior lightly if desired (thinned oil on a cloth-wrapped dowel) — avoid pooling finish near finger holes or the TSH window",
            "Wax or oil the mouthpiece end generously for a smooth, comfortable feel against the lips",
            "Attach a plug/block at the mouth end if not already permanently fixed, and confirm it seals the SAC chamber completely with no air leaks",
            "Do a final blow-test on every hole combination after finishing — finish thickness can shift pitch slightly",
        )
    } else {
        listOf(
            "Confirm final tuning on every hole is correct before finishing",
            "Clean the tube thoroughly (soap and water for PVC; tack cloth for wood) and let dry completely",
            "If painting or staining, apply primer/sealer appropriate to your material first",
            "Apply finish in thin, even coats — 2–3 coats generally outperform one thick coat",
            "Avoid pooling finish near finger holes, the TSH window, or the mouthpiece opening",
            "Let each coat cure fully before handling or applying the next",
            "Attach a plug/block at the mouth end if not already permanently fixed, and confirm it seals the SAC chamber completely with no air leaks",
            "Do a final blow-test on every hole combination after finishing — finish thickness can shift pitch slightly",
        )
    }

    c.setFontSize(11.5f)
    items.forEach { item -> checkboxLine(c, 0.9f, y, item, maxWidthIn = 6.3f); y += 0.5f }

    if (isDrone) {
        y += 0.1f
        c.setFont(bold = true); c.setFontSize(11f)
        c.text("Multi-chamber note:", 0.9f, y); y += 0.28f
        c.setFont(bold = false); c.setFontSize(10.5f)
        c.text("Finish and seal each chamber the same way, and double-check the shared mouthpiece", 0.9f, y, maxWidthIn = 6.3f); y += 0.22f
        c.text("block seals all chambers independently — an air leak between chambers will affect tone.", 0.9f, y, maxWidthIn = 6.3f)
    }
}

/**
 * exportFlutePdf(): ported 1:1 from exportPDF() in the web source — builds
 * the full 7-page workshop packet (cover, cutting guide, drill guide,
 * tuning guide, sanding checklist, finishing checklist, fingering chart)
 * and returns the assembled PdfDocument for the caller to write out (e.g.
 * via ContentResolver + a share Intent).
 */
fun exportFlutePdf(data: FlutePdfData): PdfDocument {
    val doc = NafPdfDocument()

    // 1. Cover sheet
    drawCoverPage(doc.addPage(PdfPageSize.LETTER_PORTRAIT), data)

    val chambers = mutableListOf(
        PdfChamber(
            lengthIn = data.lengthIn, sacLenIn = data.sacLenIn, boreIn = data.boreIn,
            holes = data.holes, playable = true, note = data.rootNote, label = "MELODY",
        ),
    )
    data.drones.forEachIndexed { i, d ->
        chambers.add(
            PdfChamber(
                lengthIn = d.lengthIn, sacLenIn = d.sacLenIn, boreIn = d.boreIn,
                holes = if (d.playable) d.holes else emptyList(), playable = d.playable, note = d.note,
                label = if (d.playable) "CHAMBER ${i + 2} (PLAYABLE)" else "DRONE ${i + 1}",
            ),
        )
    }

    // 2. Cutting guide, 3. Drill guide
    drawScaleTemplate(doc, chambers, ScaleTemplateMode.CUT)
    drawScaleTemplate(doc, chambers, ScaleTemplateMode.DRILL)

    // 4-6. Tuning guide, sanding + finishing checklists
    drawTuningGuidePage(doc, data)
    drawSandingChecklistPage(doc, data)
    drawFinishingChecklistPage(doc, data)

    // 7. Fingering chart — a keep-this-card reference, so it goes last.
    drawFingeringChartPage(doc, data)

    return doc.finish()
}

/** Matches the web source's `${isAntler?"antler":"naf"}_flute_${holeCount}hole_${safeName}_${bore}bore..._workshop_packet.pdf`. */
fun flutePdfFileName(data: FlutePdfData): String {
    val isAntler = data.pipeMaterial == "antler"
    val isDrone = data.drones.isNotEmpty()
    val safeName = data.rootNote.name.replace(Regex("[#/]"), "_")
    val chamberSuffix = if (isDrone) "_${data.drones.size}chamber" else ""
    return "${if (isAntler) "antler" else "naf"}_flute_${data.holeCount}hole_${safeName}_${data.boreIn}bore${chamberSuffix}_workshop_packet.pdf"
}
