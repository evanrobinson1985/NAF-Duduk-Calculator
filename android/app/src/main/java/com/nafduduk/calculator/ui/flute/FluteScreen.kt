package com.nafduduk.calculator.ui.flute

import androidx.compose.foundation.clickable
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
import com.nafduduk.calculator.engine.BORES
import com.nafduduk.calculator.engine.Curve
import com.nafduduk.calculator.engine.DRONE_INTERVALS
import com.nafduduk.calculator.engine.DroneChamber
import com.nafduduk.calculator.engine.ErgoOverride
import com.nafduduk.calculator.engine.HandSize
import com.nafduduk.calculator.engine.SCALE_CONFIGS
import com.nafduduk.calculator.engine.buildChamberGeometry
import com.nafduduk.calculator.engine.buildDroneResults
import com.nafduduk.calculator.engine.getNotes
import com.nafduduk.calculator.engine.nearestNote
import com.nafduduk.calculator.engine.recommendedBores
import com.nafduduk.calculator.gcode.GcodeChamber
import com.nafduduk.calculator.gcode.GcodeMethod
import com.nafduduk.calculator.gcode.SplitBlockParams
import com.nafduduk.calculator.gcode.TubeDrillingParams
import com.nafduduk.calculator.gcode.computeEasyModeParams
import com.nafduduk.calculator.gcode.generateSplitBlockGCode
import com.nafduduk.calculator.gcode.generateTubeDrillingGCode
import com.nafduduk.calculator.gcode.saveGcodeAndShare
import com.nafduduk.calculator.library.FluteConfig
import com.nafduduk.calculator.library.parseFluteConfig
import com.nafduduk.calculator.library.saveInstrumentToLibrary
import com.nafduduk.calculator.library.toJson
import com.nafduduk.calculator.pdf.FlutePdfData
import com.nafduduk.calculator.pdf.PdfDroneSummary
import com.nafduduk.calculator.pdf.exportFlutePdf
import com.nafduduk.calculator.pdf.flutePdfFileName
import com.nafduduk.calculator.pdf.savePdfAndShare
import com.nafduduk.calculator.ui.tuner.TunerPanel
import com.nafduduk.calculator.ui.viewer3d.Viewer3DPanel
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
fun FluteScreen(loadConfigJson: String? = null, onConfigLoaded: () -> Unit = {}) {
    val context = LocalContext.current
    val a4 = 440.0
    val notes = remember(a4) { getNotes(a4) }
    val standardNotes = remember(notes) { notes.filter { !it.advanced } }

    var noteKey by rememberSaveable { mutableStateOf("A4") }
    var boreIn by rememberSaveable { mutableStateOf(0.625) }
    var holeCount by rememberSaveable { mutableStateOf(6) }
    var handSizeName by rememberSaveable { mutableStateOf(HandSize.AVERAGE.name) }
    val handSize = remember(handSizeName) { HandSize.valueOf(handSizeName) }

    // "single" | "drone". Drone-chamber state isn't rememberSaveable (no Saver
    // written for the DroneChamber list yet) so it resets on a configuration
    // change/process death — an accepted simplification for this phase.
    var fluteStyle by rememberSaveable { mutableStateOf("single") }
    var drones by remember { mutableStateOf(listOf(DroneChamber(boreIn = boreIn, intervalIdx = 0, playable = false, holeCount = 2))) }

    var ergoOverride by remember { mutableStateOf<List<ErgoOverride>?>(null) }
    // Mirrors FlutePage's own useEffect: any change to the fields that shift
    // theoretical hole positions invalidates an active ergonomic override.
    LaunchedEffect(boreIn, noteKey, holeCount, handSizeName) { ergoOverride = null }

    val selectedFreq = remember(noteKey, notes) { notes.find { it.name == noteKey }?.freq ?: 440.0 }
    val boreRec = remember(selectedFreq) { recommendedBores(selectedFreq) }
    val geometry = remember(boreIn, selectedFreq, holeCount, handSize, ergoOverride) {
        buildChamberGeometry(bore = boreIn, freq = selectedFreq, holeCount = holeCount, handSize = handSize, ergoOverride = ergoOverride)
    }
    val droneResults = remember(fluteStyle, drones, selectedFreq, notes, handSize, geometry) {
        if (fluteStyle == "drone") buildDroneResults(drones, selectedFreq, notes, handSize, "round", geometry) else emptyList()
    }
    val allDronesValid = fluteStyle == "drone" && droneResults.isNotEmpty() && droneResults.all { it.lengthIn > 0 && it.note != null }

    var showErgoAdjust by remember { mutableStateOf(false) }
    var showAntlerAssistant by remember { mutableStateOf(false) }
    var showFingerReach by remember { mutableStateOf(false) }
    var showHarmonyBuilder by remember { mutableStateOf(false) }

    LaunchedEffect(loadConfigJson) {
        if (loadConfigJson != null) {
            parseFluteConfig(loadConfigJson)?.let { c ->
                noteKey = c.noteKey
                boreIn = c.boreIn
                holeCount = c.holeCount
                handSizeName = c.handSize
                fluteStyle = c.fluteStyle
                drones = c.drones
            }
            onConfigLoaded()
        }
    }

    var saveOpen by remember { mutableStateOf(false) }
    var saveName by remember { mutableStateOf("") }
    var savedMsg by remember { mutableStateOf("") }
    var showTuner by remember { mutableStateOf(false) }
    var show3dPreview by remember { mutableStateOf(false) }
    var splitStyle by rememberSaveable { mutableStateOf("nest-insert") } // "nest-insert" | "symmetric"

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

        SectionCard {
            FieldLabel("Antler Selection Assistant")
            Button(
                onClick = { showAntlerAssistant = !showAntlerAssistant },
                colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Bone),
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (showAntlerAssistant) "Hide" else "Already have a piece of antler? Check it here") }
            if (showAntlerAssistant) {
                Column(modifier = Modifier.padding(top = 12.dp)) {
                    AntlerAssistantPanel(
                        holeCount = holeCount, notes = notes,
                        onApply = { bore, curve, key -> boreIn = bore; noteKey = key },
                    )
                }
            }
        }

        SectionCard {
            FieldLabel("Flute Style")
            PillRow {
                Pill(text = "🎵 Single Flute", selected = fluteStyle == "single", onClick = { fluteStyle = "single" })
                Pill(text = "🎵🎵 Drone Flute", selected = fluteStyle == "drone", onClick = { fluteStyle = "drone" })
            }
            if (fluteStyle == "drone") {
                Button(
                    onClick = { showHarmonyBuilder = !showHarmonyBuilder },
                    colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Bone),
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                ) { Text(if (showHarmonyBuilder) "Hide Harmony Builder" else "🎼 Harmony Builder (quick presets)") }
                if (showHarmonyBuilder) {
                    Column(modifier = Modifier.padding(top = 12.dp)) {
                        HarmonyBuilderPanel(boreIn = boreIn, noteKey = noteKey, onApply = { newDrones -> drones = newDrones })
                    }
                }
            }
        }

        if (fluteStyle == "drone") {
            drones.forEachIndexed { i, d ->
                SectionCard {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        FieldLabel("Chamber ${i + 2} — ${if (d.playable) "Playable" else "Drone"}")
                        if (drones.size > 1) {
                            Text(
                                "✕ Remove",
                                color = Muted,
                                fontSize = 11.sp,
                                modifier = Modifier
                                    .padding(bottom = 8.dp)
                                    .clickable { drones = drones.filterIndexed { idx, _ -> idx != i } },
                            )
                        }
                    }
                    PillRow {
                        BORES.forEach { b ->
                            Pill(
                                text = b.label,
                                selected = kotlin.math.abs(b.valIn - d.boreIn) < 1e-9,
                                onClick = { drones = drones.mapIndexed { idx, dd -> if (idx == i) dd.copy(boreIn = b.valIn) else dd } },
                            )
                        }
                    }
                    PillRow(modifier = Modifier.padding(top = 6.dp)) {
                        Pill(text = "Drone", selected = !d.playable, onClick = { drones = drones.mapIndexed { idx, dd -> if (idx == i) dd.copy(playable = false) else dd } })
                        Pill(text = "Playable", selected = d.playable, onClick = { drones = drones.mapIndexed { idx, dd -> if (idx == i) dd.copy(playable = true, noteKey = dd.noteKey ?: noteKey) else dd } })
                    }
                    if (!d.playable) {
                        PillRow(modifier = Modifier.padding(top = 6.dp)) {
                            DRONE_INTERVALS.forEachIndexed { ii, di ->
                                Pill(
                                    text = di.label,
                                    selected = ii == d.intervalIdx,
                                    onClick = { drones = drones.mapIndexed { idx, dd -> if (idx == i) dd.copy(intervalIdx = ii) else dd } },
                                )
                            }
                        }
                    } else {
                        PillRow(modifier = Modifier.padding(top = 6.dp)) {
                            standardNotes.forEach { n ->
                                Pill(
                                    text = n.name,
                                    selected = n.name == d.noteKey,
                                    onClick = { drones = drones.mapIndexed { idx, dd -> if (idx == i) dd.copy(noteKey = n.name) else dd } },
                                )
                            }
                        }
                        PillRow(modifier = Modifier.padding(top = 6.dp)) {
                            (1..7).forEach { hc ->
                                Pill(
                                    text = hc.toString(),
                                    selected = hc == d.holeCount,
                                    onClick = { drones = drones.mapIndexed { idx, dd -> if (idx == i) dd.copy(holeCount = hc) else dd } },
                                )
                            }
                        }
                    }
                    droneResults.getOrNull(i)?.let { dr ->
                        if (dr.lengthIn > 0) {
                            ResultRow("Length (L)", fmtIn(dr.lengthIn))
                            dr.totalLenIn?.let { ResultRow("Total length", fmtIn(it)) }
                            dr.note?.let { ResultRow("Note", it.name) }
                        } else {
                            MutedNote("This bore + interval doesn't produce a buildable length.")
                        }
                    }
                }
            }

            if (drones.size < 3) {
                Button(
                    onClick = { drones = drones + DroneChamber(boreIn = boreIn, intervalIdx = 0, playable = false, holeCount = 2, noteKey = noteKey) },
                    colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Bone),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("+ Add Chamber (${drones.size + 1} of 4 max)") }
            }

            if (allDronesValid) {
                val totalBoreWidth = boreIn + droneResults.sumOf { it.boreIn }
                SectionCard {
                    FieldLabel("Multi-Chamber Summary")
                    ResultRow("Total chamber count", "${1 + droneResults.size} (${if (1 + droneResults.size == 4) "maximum" else "of 4 max"})")
                    ResultRow("Combined bore width", fmtIn3(totalBoreWidth))
                    MutedNote("All bores may fit side-by-side in one wide piece of stock — look for stock at least ${fmtIn3(totalBoreWidth * 1.4)} across.")
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

            SectionCard {
                FieldLabel("3D Preview & Model Export")
                Button(
                    onClick = { show3dPreview = !show3dPreview },
                    colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Bone),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (show3dPreview) "Hide 3D Preview" else "🧊 Show 3D Preview & Export") }
                if (show3dPreview) {
                    Column(modifier = Modifier.padding(top = 12.dp)) {
                        Viewer3DPanel(
                            geometry = geometry,
                            fileBaseName = "naf_flute_${holeCount}hole_${noteKey.replace("#", "sharp")}",
                        )
                    }
                }
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
                        placeholder = { Text("e.g. \"My Favorite G Minor\"") },
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
                                val rootNote = nearestNote(selectedFreq, notes)
                                val config = FluteConfig(
                                    noteKey = noteKey, boreIn = boreIn, holeCount = holeCount, handSize = handSizeName,
                                    fluteStyle = fluteStyle, drones = drones, summaryRootNote = rootNote.name,
                                    summaryMaterial = "straight", summaryIsDrone = fluteStyle == "drone",
                                )
                                val entry = saveInstrumentToLibrary(context, saveName, "flute", config.toJson())
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

            if (geometry.holes.isNotEmpty()) {
                SectionCard {
                    FieldLabel("Finger Holes (from mouth end / TSH)")
                    HoleTableHeader()
                    geometry.holes.sortedByDescending { it.num }.forEach { h ->
                        HoleRow(num = h.num, interval = h.interval, fromTsh = h.fromTshIn, diameter = h.diameterIn)
                    }
                    Row(modifier = Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { showErgoAdjust = !showErgoAdjust },
                            colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Bone),
                            modifier = Modifier.weight(1f),
                        ) { Text(if (showErgoAdjust) "Hide Ergo" else "Ergonomic Adjust", fontSize = 12.sp) }
                        Button(
                            onClick = { showFingerReach = !showFingerReach },
                            colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Bone),
                            modifier = Modifier.weight(1f),
                        ) { Text(if (showFingerReach) "Hide Reach" else "Finger Reach Check", fontSize = 12.sp) }
                    }
                }

                if (showErgoAdjust) {
                    SectionCard {
                        FieldLabel("Ergonomic Hole Adjustment")
                        ErgonomicAdjustPanel(
                            holes = geometry.theoreticalHoles,
                            applied = ergoOverride != null,
                            onApply = { override -> ergoOverride = override },
                            onReset = { ergoOverride = null },
                        )
                    }
                }

                if (showFingerReach) {
                    SectionCard {
                        FieldLabel("Finger Reach Analyzer")
                        FingerReachPanel(holes = geometry.holes, boreIn = boreIn, holeCount = holeCount)
                    }
                }

                Button(
                    onClick = {
                        val rootNote = nearestNote(selectedFreq, notes)
                        val validDrones = if (fluteStyle == "drone") {
                            droneResults.filter { it.lengthIn > 0 && it.note != null }.map { dr ->
                                PdfDroneSummary(
                                    playable = dr.playable,
                                    holeCount = dr.holeCount,
                                    note = dr.note!!,
                                    boreIn = dr.boreIn,
                                    totalLenIn = dr.totalLenIn ?: dr.lengthIn,
                                    lengthIn = dr.lengthIn,
                                    sacLenIn = dr.sacLenIn,
                                    holes = dr.holes,
                                    droneIntervalLabel = dr.droneInterval?.label ?: "",
                                )
                            }
                        } else {
                            emptyList()
                        }
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
                            fluteStyle = fluteStyle,
                            drones = validDrones,
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
                        val melodyChamber = GcodeChamber(
                            lengthIn = geometry.lengthIn,
                            sacLenIn = geometry.sacLenIn,
                            boreIn = boreIn,
                            holes = geometry.holes,
                            playable = true,
                            label = "MELODY",
                            shWIn = geometry.soundHoleWidthIn,
                            shLIn = geometry.soundHoleLengthIn,
                        )
                        val droneChambers = if (fluteStyle == "drone") {
                            droneResults.filter { it.lengthIn > 0 }.mapIndexed { i, dr ->
                                GcodeChamber(
                                    lengthIn = dr.lengthIn,
                                    sacLenIn = dr.sacLenIn,
                                    boreIn = dr.boreIn,
                                    holes = dr.holes,
                                    playable = dr.playable,
                                    label = if (dr.playable) "CHAMBER ${i + 2} (PLAYABLE)" else "DRONE ${i + 1}",
                                    shWIn = dr.shWIn,
                                    shLIn = dr.shLIn,
                                )
                            }
                        } else {
                            emptyList()
                        }
                        val chambers = listOf(melodyChamber) + droneChambers
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
                MutedNote("Drills the sound hole, SAC exit, flue channel, and finger holes into an already-round tube.")

                FieldLabel("Split-Block Style")
                PillRow {
                    Pill(text = "Embedded nest", selected = splitStyle == "nest-insert", onClick = { splitStyle = "nest-insert" })
                    Pill(text = "Basic drilled layout", selected = splitStyle == "symmetric", onClick = { splitStyle = "symmetric" })
                }
                Button(
                    onClick = {
                        val melodyChamber = GcodeChamber(
                            lengthIn = geometry.lengthIn,
                            sacLenIn = geometry.sacLenIn,
                            boreIn = boreIn,
                            holes = geometry.holes,
                            playable = true,
                            label = "MELODY",
                            shWIn = geometry.soundHoleWidthIn,
                            shLIn = geometry.soundHoleLengthIn,
                        )
                        val droneChambers = if (fluteStyle == "drone") {
                            droneResults.filter { it.lengthIn > 0 }.mapIndexed { i, dr ->
                                GcodeChamber(
                                    lengthIn = dr.lengthIn,
                                    sacLenIn = dr.sacLenIn,
                                    boreIn = dr.boreIn,
                                    holes = dr.holes,
                                    playable = dr.playable,
                                    label = if (dr.playable) "CHAMBER ${i + 2} (PLAYABLE)" else "DRONE ${i + 1}",
                                    shWIn = dr.shWIn,
                                    shLIn = dr.shLIn,
                                )
                            }
                        } else {
                            emptyList()
                        }
                        val chambers = listOf(melodyChamber) + droneChambers
                        val easy = computeEasyModeParams(chambers, GcodeMethod.SPLIT)
                        val gcode = generateSplitBlockGCode(
                            SplitBlockParams(
                                chambers = chambers,
                                curve = Curve.STRAIGHT,
                                units = "in",
                                toolDiameter = easy.toolDiameter,
                                stepdown = easy.stepdown,
                                feedRate = easy.feedRate,
                                plungeRate = easy.plungeRate,
                                safeHeight = easy.safeHeight,
                                stockMarginX = easy.stockMarginX,
                                stockMarginY = easy.stockMarginY,
                                channelStyle = easy.channelStyle,
                                dialect = "grbl",
                                spindleSpeed = easy.spindleSpeed,
                                alignPins = true,
                                splitStyle = splitStyle,
                                only = "all",
                            ),
                        )
                        saveGcodeAndShare(context, gcode, "naf_flute_${holeCount}hole_split_block_${splitStyle}.nc")
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Bone),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Export CNC G-Code (Split-Block)", fontWeight = FontWeight.Bold)
                }
                MutedNote(
                    if (splitStyle == "nest-insert") {
                        "Mills the full acoustic nest (ramp, flue, SAC exit, splitting edge) into two raw-stock blanks — a tall lower blank carrying the nest and a thin upper shell with the sound window. No flip; straight bodies only from this quick-export button (curved bodies need the curve param wired up — see android/README.md)."
                    } else {
                        "Basic drilled layout, hand-finish mode: the SAC and full bore are cut at true size; every other feature is a locating cut left undersized to hand-fit. The ramp and splitting edge are entirely hand-carved. Straight bodies only from this quick-export button."
                    },
                )
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
