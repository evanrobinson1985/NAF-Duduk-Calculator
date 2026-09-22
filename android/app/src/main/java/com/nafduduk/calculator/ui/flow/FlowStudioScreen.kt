package com.nafduduk.calculator.ui.flow

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nafduduk.calculator.engine.FlowDesign
import com.nafduduk.calculator.engine.FlowHole
import com.nafduduk.calculator.engine.FluteConst
import com.nafduduk.calculator.engine.HandSize
import com.nafduduk.calculator.engine.bestPressureForNest
import com.nafduduk.calculator.engine.buildChamberGeometry
import com.nafduduk.calculator.engine.computeFluteAeroacoustics
import com.nafduduk.calculator.engine.getNotes
import com.nafduduk.calculator.engine.optimizeEverything
import com.nafduduk.calculator.engine.optimizeNestForDesign
import com.nafduduk.calculator.engine.recommendedBores
import com.nafduduk.calculator.engine.scoreFlowQuality
import com.nafduduk.calculator.ui.common.FieldLabel
import com.nafduduk.calculator.ui.common.MutedNote
import com.nafduduk.calculator.ui.common.Pill
import com.nafduduk.calculator.ui.common.PillRow
import com.nafduduk.calculator.ui.common.ResultRow
import com.nafduduk.calculator.ui.common.SectionCard
import com.nafduduk.calculator.ui.theme.Bg2
import com.nafduduk.calculator.ui.theme.Bone
import com.nafduduk.calculator.ui.theme.Gold
import com.nafduduk.calculator.util.jsFmt
import com.nafduduk.calculator.util.jsFmtIn

private val PRESSURE_STEPS = listOf(150.0, 200.0, 250.0, 300.0, 350.0, 400.0, 450.0, 500.0, 600.0, 700.0)

/**
 * Ported from FlowStudioPage's aeroacoustics model + optimizers (the
 * Three.js particle-jet visualization itself is out of scope — see
 * android/README.md). Self-contained: builds its own key/bore/holes design
 * rather than reading FlutePage's live FLOW_DESIGN_BRIDGE, so it works
 * standalone exactly like the web version's FLOW_DEFAULT_DESIGN fallback.
 */
@Composable
fun FlowStudioScreen() {
    val a4 = 440.0
    val notes = remember(a4) { getNotes(a4) }
    val standardNotes = remember(notes) { notes.filter { !it.advanced } }

    var noteKey by rememberSaveable { mutableStateOf("F#4") }
    var boreIn by rememberSaveable { mutableStateOf(0.75) }
    var holeCount by rememberSaveable { mutableStateOf(6) }
    var pressurePa by rememberSaveable { mutableStateOf(350.0) }

    // Nest overrides — null means "use the bore-derived FLUTE_CONST default",
    // same override-or-formula pattern the Flute page itself uses.
    var shLOverride by rememberSaveable { mutableStateOf<Double?>(null) }
    var flueDepthOverride by rememberSaveable { mutableStateOf<Double?>(null) }
    var rampAngleOverride by rememberSaveable { mutableStateOf<Double?>(null) }
    var rampCurveOverride by rememberSaveable { mutableStateOf<Double?>(null) }
    var fippleAngleOverride by rememberSaveable { mutableStateOf<Double?>(null) }
    var tipHeightOverride by rememberSaveable { mutableStateOf<Double?>(null) }
    var chimneyOverride by rememberSaveable { mutableStateOf<Double?>(null) }
    var backsetOverride by rememberSaveable { mutableStateOf<Double?>(null) }
    var flueLengthOverride by rememberSaveable { mutableStateOf<Double?>(null) }

    val selectedFreq = remember(noteKey, notes) { notes.find { it.name == noteKey }?.freq ?: 369.99 }
    val boreRec = remember(selectedFreq) { recommendedBores(selectedFreq) }
    val geometry = remember(boreIn, selectedFreq, holeCount) {
        buildChamberGeometry(bore = boreIn, freq = selectedFreq, holeCount = holeCount, handSize = HandSize.AVERAGE)
    }

    val design = remember(
        geometry, shLOverride, flueDepthOverride, rampAngleOverride, rampCurveOverride,
        fippleAngleOverride, tipHeightOverride, chimneyOverride, backsetOverride, flueLengthOverride,
    ) {
        FlowDesign(
            rootFreq = geometry.freq,
            bore = geometry.bore,
            lengthIn = geometry.lengthIn,
            sacLenIn = geometry.sacLenIn,
            shW = geometry.soundHoleWidthIn,
            shL = shLOverride ?: geometry.soundHoleLengthIn,
            flueDepthIn = flueDepthOverride ?: FluteConst.flueDepth(geometry.bore),
            rampAngleDeg = rampAngleOverride ?: FluteConst.SAC_EXIT_RAMP_ANGLE_DEG,
            fippleAngleDeg = fippleAngleOverride ?: 35.0,
            rampCurve = rampCurveOverride ?: 0.0,
            breathHoleWidthIn = FluteConst.breathHoleWidth(geometry.bore),
            breathHoleLengthIn = FluteConst.breathHoleLength(geometry.bore),
            wallThicknessIn = geometry.bore * FluteConst.INTERNAL_WALL_THICKNESS_RATIO,
            backsetIn = backsetOverride ?: 0.0,
            tipFlatIn = 0.01,
            chimneyIn = chimneyOverride ?: 0.0,
            tipHeightIn = tipHeightOverride ?: (1.0 / 128),
            flueLengthIn = flueLengthOverride,
            holeCount = holeCount,
            holes = geometry.holes.map { FlowHole(it.fromTshIn) },
        )
    }

    val metrics = remember(design, pressurePa) { computeFluteAeroacoustics(design, pressurePa) }
    val score = remember(metrics) { scoreFlowQuality(metrics) }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            "💨 Flow Studio",
            color = Color(0xFF38BDF8),
            fontSize = 24.sp,
            fontWeight = FontWeight.Black,
            modifier = Modifier.fillMaxWidth(),
        )
        MutedNote("Aeroacoustics model + nest optimizer — same physics the web app's Flow Studio scores against, minus the particle-jet 3D visualization.")

        SectionCard {
            FieldLabel("Key")
            PillRow {
                standardNotes.forEach { n -> Pill(text = n.name, selected = n.name == noteKey, onClick = { noteKey = n.name }) }
            }
        }
        SectionCard {
            FieldLabel("Bore Diameter")
            PillRow {
                boreRec.options.forEach { opt ->
                    Pill(text = opt.bore.label, selected = kotlin.math.abs(opt.bore.valIn - boreIn) < 1e-9, onClick = { boreIn = opt.bore.valIn })
                }
            }
        }
        SectionCard {
            FieldLabel("Finger Holes")
            PillRow { (0..7).forEach { n -> Pill(text = if (n == 0) "0 (drone)" else n.toString(), selected = n == holeCount, onClick = { holeCount = n }) } }
        }
        SectionCard {
            FieldLabel("Breath (SAC) Pressure")
            PillRow {
                PRESSURE_STEPS.forEach { p -> Pill(text = "${p.toInt()} Pa", selected = kotlin.math.abs(p - pressurePa) < 1e-9, onClick = { pressurePa = p }) }
            }
            MutedNote("Typical NAF breath pressure is roughly 250-600 Pa.")
        }

        SectionCard {
            FieldLabel("Quality Score")
            Text(
                "${score.total}",
                color = scoreColor(score.total),
                fontSize = 56.sp,
                fontWeight = FontWeight.Black,
                modifier = Modifier.fillMaxWidth(),
            )
            score.parts.forEach { part ->
                ScoreBar(label = part.key, value = part.value, weight = part.weight)
            }
        }

        SectionCard {
            FieldLabel("Regimes")
            ResultRow("Jet drive (root)", metrics.jetRegime.label)
            ResultRow("Airflow", metrics.flowRegime.label)
            ResultRow("Jet velocity (theta)", fmt2(metrics.theta))
            ResultRow("Reynolds number", fmt0(metrics.re))
            ResultRow("Cut-up ratio (l_c/h)", fmt2(metrics.cutupRatio))
            ResultRow("Predicted tuning offset", "${if (metrics.cents >= 0) "+" else ""}${fmt0(metrics.cents)} cents")
        }

        SectionCard {
            FieldLabel("Nest Settings (auto unless overridden)")
            ResultRow("Cut-up / TSH length (shL)", "${fmtIn3(design.shL)}${if (shLOverride == null) " (auto)" else ""}")
            ResultRow("Flue depth", "${fmtIn3(design.flueDepthIn)}${if (flueDepthOverride == null) " (auto)" else ""}")
            ResultRow("Flue length", "${fmtIn3(metrics.flueLenIn)}${if (flueLengthOverride == null) " (auto)" else ""}")
            ResultRow("Ramp angle", "${fmt0(design.rampAngleDeg)}°${if (rampAngleOverride == null) " (auto)" else ""}")
            ResultRow("Ramp curve (scoop)", fmt2(design.rampCurve))
            ResultRow("Fipple bevel", "${fmt0(design.fippleAngleDeg)}°${if (fippleAngleOverride == null) " (auto)" else ""}")
            ResultRow("Splitting-edge tip height", fmtIn3(design.tipHeightIn))
            ResultRow("Bird chimney", fmtIn3(design.chimneyIn))
            ResultRow("Backset", fmtIn3(design.backsetIn))
            ResultRow("Breath hole", "${fmtIn3(design.breathHoleWidthIn)} x ${fmtIn2(design.breathHoleLengthIn)}")

            Row(modifier = Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = {
                        val sug = optimizeNestForDesign(design, pressurePa)
                        shLOverride = sug.shL; flueDepthOverride = sug.flueDepthIn
                        rampAngleOverride = sug.rampAngleDeg; fippleAngleOverride = sug.fippleAngleDeg
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Bone),
                    modifier = Modifier.weight(1f),
                ) { Text("Suggest Nest") }
                Button(
                    onClick = { pressurePa = bestPressureForNest(design) },
                    colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Bone),
                    modifier = Modifier.weight(1f),
                ) { Text("Best Pressure") }
            }
            Button(
                onClick = {
                    val r = optimizeEverything(design)
                    pressurePa = r.pressurePa
                    flueDepthOverride = r.flueDepthIn
                    shLOverride = r.shL
                    flueLengthOverride = r.flueLengthIn
                    tipHeightOverride = r.tipHeightIn
                    rampAngleOverride = r.rampAngleDeg
                    rampCurveOverride = r.rampCurve
                    chimneyOverride = r.chimneyIn
                    backsetOverride = r.backsetIn
                    fippleAngleOverride = r.fippleAngleDeg
                },
                colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = Color(0xFF0F0801)),
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            ) { Text("⚡ Optimize Everything", fontWeight = FontWeight.Bold) }
            Button(
                onClick = {
                    shLOverride = null; flueDepthOverride = null; rampAngleOverride = null; rampCurveOverride = null
                    fippleAngleOverride = null; tipHeightOverride = null; chimneyOverride = null; backsetOverride = null
                    flueLengthOverride = null
                },
                colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Bone),
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
            ) { Text("Reset to Auto") }
        }
    }
}

@Composable
private fun ScoreBar(label: String, value: Int, weight: Int) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, color = Bone, fontSize = 11.sp)
            Text("$value  ·  w${weight}", color = scoreColor(value), fontSize = 11.sp, fontWeight = FontWeight.Bold)
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 2.dp)
                .height(6.dp)
                .background(Color(0xFF33240F), RoundedCornerShape(999.dp)),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth((value / 100f).coerceIn(0f, 1f))
                    .height(6.dp)
                    .background(scoreColor(value), RoundedCornerShape(999.dp)),
            )
        }
    }
}

private fun scoreColor(v: Int): Color = when {
    v >= 75 -> Color(0xFF4ADE80)
    v >= 45 -> Color(0xFFFBBF24)
    else -> Color(0xFFF87171)
}

private fun fmt0(v: Double): String = jsFmt(v, 0)
private fun fmt2(v: Double): String = jsFmt(v, 2)
private fun fmtIn3(v: Double): String = jsFmtIn(v, 3)
private fun fmtIn2(v: Double): String = jsFmtIn(v, 2)
