package com.nafduduk.calculator.ui.duduk

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nafduduk.calculator.engine.DUDUK_STYLES
import com.nafduduk.calculator.engine.buildDudukDesignForKey
import com.nafduduk.calculator.engine.getNotes
import com.nafduduk.calculator.engine.recommendedDudukBore
import com.nafduduk.calculator.library.DudukConfig
import com.nafduduk.calculator.library.parseDudukConfig
import com.nafduduk.calculator.library.saveInstrumentToLibrary
import com.nafduduk.calculator.library.toJson
import com.nafduduk.calculator.pdf.dudukPdfFileName
import com.nafduduk.calculator.pdf.exportDudukPdf
import com.nafduduk.calculator.pdf.savePdfAndShare
import com.nafduduk.calculator.ui.common.FieldLabel
import com.nafduduk.calculator.ui.common.MutedNote
import com.nafduduk.calculator.ui.common.Pill
import com.nafduduk.calculator.ui.common.PillRow
import com.nafduduk.calculator.ui.common.ResultRow
import com.nafduduk.calculator.ui.common.SectionCard
import com.nafduduk.calculator.ui.theme.Bg2
import com.nafduduk.calculator.ui.theme.Bone
import com.nafduduk.calculator.ui.theme.Gold
import com.nafduduk.calculator.ui.theme.Muted
import com.nafduduk.calculator.ui.tuner.TunerPanel
import com.nafduduk.calculator.util.jsFmt
import com.nafduduk.calculator.util.jsFmtIn
import kotlin.math.max
import kotlin.math.min

/**
 * Ported from DudukPage's key-driven mode: style -> bore -> root note ->
 * reed length -> live results (tube length, 8-hole layout, reed seat),
 * wired to the ported duduk engine so numbers match the web app exactly.
 */
@Composable
fun DudukScreen(loadConfigJson: String? = null, onConfigLoaded: () -> Unit = {}) {
    val context = LocalContext.current
    // Concert pitch: every note frequency, and so every tube length and hole
    // position, comes from it — and the build sheet prints it.
    var a4 by rememberSaveable { mutableStateOf(440.0) }
    val notes = remember(a4) { getNotes(a4) }
    val standardNotes = remember(notes) { notes.filter { !it.advanced } }

    var styleId by rememberSaveable { mutableStateOf("traditional") }
    val style = remember(styleId) { DUDUK_STYLES.getValue(styleId) }

    var boreIn by rememberSaveable { mutableStateOf(0.65) }
    var noteKey by rememberSaveable { mutableStateOf("A3") }
    var reedLenIn by rememberSaveable { mutableStateOf(1.5) }

    // Clamp bore/reed length into the current style's range, mirroring the web
    // source's clamping useEffect that runs whenever `style` changes.
    val clampedBore = boreIn.coerceIn(style.boreRange.start, style.boreRange.endInclusive)
    val clampedReedLen = reedLenIn.coerceIn(style.reedLenRange.start, style.reedLenRange.endInclusive)

    val reedExt = remember(style, clampedReedLen) {
        val reedFrac = if (style.reedLenRange.endInclusive > style.reedLenRange.start) {
            (clampedReedLen - style.reedLenRange.start) / (style.reedLenRange.endInclusive - style.reedLenRange.start)
        } else {
            0.5
        }
        val f = max(0.0, min(1.0, reedFrac))
        style.reedExtRange.start + f * (style.reedExtRange.endInclusive - style.reedExtRange.start)
    }

    val rootFreq = remember(noteKey, notes) { notes.find { it.name == noteKey }?.freq ?: 220.0 }
    val boreRec = remember(rootFreq, style, reedExt) { recommendedDudukBore(rootFreq, style.boreRange, reedExt) }
    val design = remember(style, clampedBore, reedExt, clampedReedLen, rootFreq, notes) {
        buildDudukDesignForKey(style, clampedBore, reedExt, clampedReedLen, rootFreq, notes)
    }

    LaunchedEffect(loadConfigJson) {
        if (loadConfigJson != null) {
            parseDudukConfig(loadConfigJson)?.let { c ->
                styleId = c.styleId
                boreIn = c.boreIn
                noteKey = c.noteKey
                reedLenIn = c.reedLenIn
                a4 = c.a4
            }
            onConfigLoaded()
        }
    }

    var saveOpen by remember { mutableStateOf(false) }
    var saveName by remember { mutableStateOf("") }
    var savedMsg by remember { mutableStateOf("") }
    var showTuner by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SectionCard {
            FieldLabel("Tuning Reference")
            PillRow {
                listOf(440.0, 432.0).forEach { hz ->
                    Pill(text = "A4 = ${jsFmt(hz, 0)} Hz", selected = a4 == hz, onClick = { a4 = hz })
                }
            }
            if (a4 != 440.0) {
                MutedNote("${jsFmt(a4, 0)} Hz — every length and hole position below is recalculated.")
            }
        }

        SectionCard {
            FieldLabel("Style")
            PillRow {
                DUDUK_STYLES.values.forEach { s ->
                    Pill(text = s.label, selected = s.id == styleId, onClick = { styleId = s.id })
                }
            }
            MutedNote(style.desc)
        }

        SectionCard {
            FieldLabel("Root Note (Key)")
            PillRow {
                standardNotes.forEach { n ->
                    Pill(text = n.name, selected = n.name == noteKey, onClick = { noteKey = n.name })
                }
            }
            Button(
                onClick = { showTuner = !showTuner },
                colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Bone),
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            ) { Text(if (showTuner) "🎤 Hide Tuner" else "🎤 Real-Time Tuner") }
        }

        if (showTuner) {
            TunerPanel(targetNoteDefault = noteKey, notes = notes, onClose = { showTuner = false })
        }

        SectionCard {
            FieldLabel("Bore Diameter — ${fmtIn3(clampedBore)} (recommended ${fmtIn3(boreRec.boreIn)})")
            PillRow {
                boreStepOptions(style).forEach { b ->
                    Pill(text = fmtIn3(b), selected = kotlin.math.abs(b - clampedBore) < 0.005, onClick = { boreIn = b })
                }
            }
            MutedNote("This style's typical range is ${fmtIn3(style.boreRange.start)}–${fmtIn3(style.boreRange.endInclusive)}.")
        }

        SectionCard {
            FieldLabel("Reed Length — ${fmtIn(clampedReedLen)}")
            PillRow {
                reedLenStepOptions(style).forEach { l ->
                    Pill(text = fmtIn(l), selected = kotlin.math.abs(l - clampedReedLen) < 0.01, onClick = { reedLenIn = l })
                }
            }
        }

        SectionCard {
            FieldLabel("Results")
            ResultRow("Tube length (L)", fmtIn(design.tubeLenIn))
            ResultRow("Reed acoustic extension", fmtIn3(reedExt))
            ResultRow("Total length (tube + reed)", fmtIn(design.totalLenIn))
            ResultRow("Reed shaft diameter", fmtIn3(design.reedDiamIn))
            ResultRow("Nearest note", "${design.rootNote.name} (${design.rootNote.cents} cents)")
        }

        SectionCard {
            FieldLabel("Finger Holes (from reed seat)")
            DudukHoleTableHeader()
            design.holes.forEach { h ->
                DudukHoleRow(num = h.num, interval = h.interval, thumb = h.thumb, fromReed = h.fromReedIn, diameter = h.diameterIn)
            }
        }

        SectionCard {
            FieldLabel("Export")
            Button(
                onClick = {
                    val document = exportDudukPdf(design, a4, notes)
                    savePdfAndShare(context, document, dudukPdfFileName(design))
                },
                colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = androidx.compose.ui.graphics.Color(0xFF0F0801)),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Export Workshop PDF Packet", fontWeight = FontWeight.Bold)
            }
            MutedNote(
                "Three pages: the build sheet with every hole measurement, a true-scale drilling " +
                    "template to print at 100% and wrap around the tube, and a fingering chart to keep " +
                    "with the finished instrument.",
            )
        }

        SectionCard {
            FieldLabel("Save This Design")
            if (!saveOpen) {
                Button(
                    onClick = { saveOpen = true },
                    colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Bone),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("💾 Save to Library") }
            } else {
                OutlinedTextField(
                    value = saveName,
                    onValueChange = { saveName = it },
                    placeholder = { Text("e.g. \"My Traditional A3 Duduk\"") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = Bone, unfocusedTextColor = Bone,
                        focusedBorderColor = Gold, unfocusedBorderColor = com.nafduduk.calculator.ui.theme.Border,
                    ),
                )
                Row(modifier = Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = {
                            val config = DudukConfig(
                                styleId = styleId, boreIn = boreIn, noteKey = noteKey, reedLenIn = reedLenIn, a4 = a4,
                                summaryRootNote = design.rootNote.name, summaryStyle = style.label,
                            )
                            val entry = saveInstrumentToLibrary(context, saveName, "duduk", config.toJson())
                            savedMsg = if (entry != null) "Saved as \"${entry.name}\"" else "Couldn't save — device storage may be full."
                            if (entry != null) { saveName = ""; saveOpen = false }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = androidx.compose.ui.graphics.Color(0xFF0F0801)),
                        modifier = Modifier.weight(1f),
                    ) { Text("Save") }
                    Button(
                        onClick = { saveOpen = false; saveName = "" },
                        colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Muted),
                        modifier = Modifier.weight(1f),
                    ) { Text("Cancel") }
                }
            }
            if (savedMsg.isNotEmpty()) MutedNote(savedMsg)
        }
    }
}

private fun boreStepOptions(style: com.nafduduk.calculator.engine.DudukStyle): List<Double> {
    val steps = 6
    val span = style.boreRange.endInclusive - style.boreRange.start
    return (0..steps).map { style.boreRange.start + span * it / steps }
}

private fun reedLenStepOptions(style: com.nafduduk.calculator.engine.DudukStyle): List<Double> {
    val steps = 5
    val span = style.reedLenRange.endInclusive - style.reedLenRange.start
    return (0..steps).map { style.reedLenRange.start + span * it / steps }
}

@Composable
private fun DudukHoleTableHeader() {
    Row(modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp)) {
        Text("Hole", color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(0.7f))
        Text("Interval", color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1.3f))
        Text("From Reed", color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        Text("Ø", color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(0.8f))
    }
}

@Composable
private fun DudukHoleRow(num: Int, interval: String, thumb: Boolean, fromReed: Double, diameter: Double) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Text(
            text = if (thumb) "Thumb" else "H$num",
            color = if (thumb) com.nafduduk.calculator.ui.theme.DudukGold else Bone,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.weight(0.7f),
        )
        Text(interval, color = Bone, fontSize = 12.sp, modifier = Modifier.weight(1.3f))
        Text(fmtIn(fromReed), color = Bone, fontSize = 12.sp, modifier = Modifier.weight(1f))
        Text(fmtIn3(diameter), color = Bone, fontSize = 12.sp, modifier = Modifier.weight(0.8f))
    }
}

private fun fmtIn(v: Double): String = jsFmtIn(v, 2)
private fun fmtIn3(v: Double): String = jsFmtIn(v, 3)
