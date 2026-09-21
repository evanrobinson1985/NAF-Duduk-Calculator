package com.nafduduk.calculator.ui.flute

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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import com.nafduduk.calculator.engine.HandSize
import com.nafduduk.calculator.engine.SCALE_CONFIGS
import com.nafduduk.calculator.engine.buildChamberGeometry
import com.nafduduk.calculator.engine.getNotes
import com.nafduduk.calculator.engine.nearestNote
import com.nafduduk.calculator.engine.recommendedBores
import com.nafduduk.calculator.gcode.GcodeChamber
import com.nafduduk.calculator.gcode.GcodeMethod
import com.nafduduk.calculator.gcode.TubeDrillingParams
import com.nafduduk.calculator.gcode.computeEasyModeParams
import com.nafduduk.calculator.gcode.generateTubeDrillingGCode
import com.nafduduk.calculator.gcode.saveGcodeAndShare
import com.nafduduk.calculator.pdf.FlutePdfData
import com.nafduduk.calculator.pdf.exportFlutePdf
import com.nafduduk.calculator.pdf.flutePdfFileName
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
import java.util.Locale

/**
 * Ported from FlutePage's melody-chamber calculator (single chamber): key
 * picker -> bore picker (with recommendation) -> hole count -> hand size ->
 * live results, wired to the ported buildChamberGeometry engine so the
 * numbers match the web app exactly. Multi-chamber drones, nest overrides,
 * 3D preview, PDF/CNC export are separate, larger phases (see repo TODOs).
 */
@Composable
fun FluteScreen() {
    val context = LocalContext.current
    val a4 = 440.0
    val notes = remember(a4) { getNotes(a4) }
    val standardNotes = remember(notes) { notes.filter { !it.advanced } }

    var noteKey by rememberSaveable { mutableStateOf("A4") }
    var boreIn by rememberSaveable { mutableStateOf(0.625) }
    var holeCount by rememberSaveable { mutableStateOf(6) }
    var handSizeName by rememberSaveable { mutableStateOf(HandSize.AVERAGE.name) }
    val handSize = remember(handSizeName) { HandSize.valueOf(handSizeName) }

    val selectedFreq = remember(noteKey, notes) { notes.find { it.name == noteKey }?.freq ?: 440.0 }
    val boreRec = remember(selectedFreq) { recommendedBores(selectedFreq) }
    val geometry = remember(boreIn, selectedFreq, holeCount, handSize) {
        buildChamberGeometry(bore = boreIn, freq = selectedFreq, holeCount = holeCount, handSize = handSize)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SectionCard {
            FieldLabel("Root Note (Key)")
            PillRow {
                standardNotes.forEach { n ->
                    Pill(text = n.name, selected = n.name == noteKey, onClick = { noteKey = n.name })
                }
            }
        }

        SectionCard {
            FieldLabel("Bore Diameter")
            PillRow {
                boreRec.options.forEach { opt ->
                    val isRec = opt.bore.label == boreRec.best.bore.label
                    Pill(
                        text = opt.bore.label + if (isRec) " ★" else "",
                        selected = kotlin.math.abs(opt.bore.valIn - boreIn) < 1e-9,
                        onClick = { boreIn = opt.bore.valIn },
                    )
                }
            }
            MutedNote("★ recommended bore for this key — lands closest to the 10\"-24\" comfortable-hold sweet spot.")
        }

        SectionCard {
            FieldLabel("Number of Finger Holes")
            PillRow {
                (1..7).forEach { n ->
                    Pill(text = n.toString(), selected = n == holeCount, onClick = { holeCount = n })
                }
            }
            SCALE_CONFIGS[holeCount]?.let { MutedNote(it.name) }
        }

        SectionCard {
            FieldLabel("Hand Size")
            PillRow {
                HandSize.entries.forEach { hs ->
                    Pill(
                        text = hs.name.lowercase().replaceFirstChar { it.titlecase() },
                        selected = hs == handSize,
                        onClick = { handSizeName = hs.name },
                    )
                }
            }
        }

        if (geometry.playable) {
            SectionCard {
                FieldLabel("Results")
                ResultRow("Tube length (L)", fmtIn(geometry.lengthIn))
                geometry.totalLenIn?.let { ResultRow("Total blank length", fmtIn(it)) }
                ResultRow("SAC (slow-air chamber) length", fmtIn(geometry.sacLenIn))
                ResultRow("Sound-hole width", fmtIn(geometry.soundHoleWidthIn))
                ResultRow("Sound-hole length", fmtIn(geometry.soundHoleLengthIn))
            }

            if (geometry.holes.isNotEmpty()) {
                SectionCard {
                    FieldLabel("Finger Holes (from mouth end / TSH)")
                    HoleTableHeader()
                    geometry.holes.sortedByDescending { it.num }.forEach { h ->
                        HoleRow(num = h.num, interval = h.interval, fromTsh = h.fromTshIn, diameter = h.diameterIn)
                    }
                }

                Button(
                    onClick = {
                        val rootNote = nearestNote(selectedFreq, notes)
                        val pdfData = FlutePdfData(
                            boreIn = boreIn,
                            lengthIn = geometry.lengthIn,
                            holes = geometry.holes,
                            holeCount = holeCount,
                            rootNote = rootNote,
                            totalLenIn = geometry.totalLenIn ?: geometry.lengthIn,
                            sacLenIn = geometry.sacLenIn,
                            handSize = handSize.name.lowercase(),
                            antlerShape = "straight",
                            pipeMaterial = "straight",
                            fluteStyle = "single",
                            drones = emptyList(),
                            a4 = a4,
                            notes = notes,
                        )
                        val document = exportFlutePdf(pdfData)
                        savePdfAndShare(context, document, flutePdfFileName(pdfData))
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = androidx.compose.ui.graphics.Color(0xFF0F0801)),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Export Workshop PDF Packet", fontWeight = FontWeight.Bold)
                }

                Button(
                    onClick = {
                        val gcodeChamber = GcodeChamber(
                            lengthIn = geometry.lengthIn,
                            sacLenIn = geometry.sacLenIn,
                            boreIn = boreIn,
                            holes = geometry.holes,
                            playable = true,
                            label = "MELODY",
                            shWIn = geometry.soundHoleWidthIn,
                            shLIn = geometry.soundHoleLengthIn,
                        )
                        val chambers = listOf(gcodeChamber)
                        val easy = computeEasyModeParams(chambers, GcodeMethod.TUBE)
                        val gcode = generateTubeDrillingGCode(
                            TubeDrillingParams(
                                chambers = chambers,
                                units = "in",
                                toolDiameter = easy.toolDiameter,
                                feedRate = easy.feedRate,
                                plungeRate = easy.plungeRate,
                                peckDepth = easy.peckDepth,
                                safeHeight = easy.safeHeight,
                                retractHeight = easy.retractHeight,
                                dialect = "grbl",
                                spindleSpeed = easy.spindleSpeed,
                                setupMode = "fixed",
                            ),
                        )
                        saveGcodeAndShare(context, gcode, "naf_flute_${holeCount}hole_tube_drilling.nc")
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Bone),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Export CNC G-Code (Tube Drilling)", fontWeight = FontWeight.Bold)
                }
                MutedNote("Drills the sound hole, SAC exit, flue channel, and finger holes into a tube. The split-block milling strategy (cutting the full acoustic nest from raw stock) isn't ported yet — see android/README.md.")
            }
        } else {
            SectionCard {
                MutedNote("This key + bore combination doesn't produce a buildable tube length. Try a different bore.")
            }
        }
    }
}

@Composable
private fun HoleTableHeader() {
    Row(modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp)) {
        Text("Hole", color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(0.6f))
        Text("Interval", color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1.4f))
        Text("From TSH", color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        Text("Ø", color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(0.8f))
    }
}

@Composable
private fun HoleRow(num: Int, interval: String, fromTsh: Double, diameter: Double) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Text("H$num", color = Gold, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(0.6f))
        Text(interval, color = Bone, fontSize = 12.sp, modifier = Modifier.weight(1.4f))
        Text(fmtIn(fromTsh), color = Bone, fontSize = 12.sp, modifier = Modifier.weight(1f))
        Text(fmtIn3(diameter), color = Bone, fontSize = 12.sp, modifier = Modifier.weight(0.8f))
    }
}

private fun fmtIn(v: Double): String = String.format(Locale.US, "%.2f\"", v)
private fun fmtIn3(v: Double): String = String.format(Locale.US, "%.3f\"", v)
