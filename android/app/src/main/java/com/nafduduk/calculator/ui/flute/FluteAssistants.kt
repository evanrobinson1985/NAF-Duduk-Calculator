package com.nafduduk.calculator.ui.flute

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nafduduk.calculator.engine.Curve
import com.nafduduk.calculator.engine.DRONE_INTERVALS
import com.nafduduk.calculator.engine.DroneChamber
import com.nafduduk.calculator.engine.ErgoOverride
import com.nafduduk.calculator.engine.FingerHole
import com.nafduduk.calculator.engine.HARMONY_PRESETS
import com.nafduduk.calculator.engine.Note
import com.nafduduk.calculator.engine.analyzeAntlerFit
import com.nafduduk.calculator.engine.analyzeFingerReach
import com.nafduduk.calculator.engine.ergonomicAdjustHoles
import com.nafduduk.calculator.ui.common.MutedNote
import com.nafduduk.calculator.ui.common.Pill
import com.nafduduk.calculator.ui.common.PillRow
import com.nafduduk.calculator.ui.theme.Bg2
import com.nafduduk.calculator.ui.theme.Bone
import com.nafduduk.calculator.ui.theme.Border
import com.nafduduk.calculator.ui.theme.Gold
import com.nafduduk.calculator.ui.theme.Muted
import com.nafduduk.calculator.util.jsFmtIn

private fun fmtIn(v: Double): String = jsFmtIn(v, 2)
private fun fmtIn3(v: Double): String = jsFmtIn(v, 3)

// ── ERGONOMIC HOLE ADJUSTMENT ──────────────────────────────────────
@Composable
fun ErgonomicAdjustPanel(holes: List<FingerHole>, applied: Boolean, onApply: (List<ErgoOverride>) -> Unit, onReset: () -> Unit) {
    var blend by remember { mutableStateOf(0.5f) }
    val adjusted = remember(holes, blend) { ergonomicAdjustHoles(holes, blend.toDouble()) }
    val maxDrift = adjusted.maxOfOrNull { kotlin.math.abs(it.centsShift) } ?: 0

    fun driftColor(c: Int): Color {
        val a = kotlin.math.abs(c)
        return when {
            a == 0 -> Muted
            a <= 15 -> Color(0xFF4ADE80)
            a <= 40 -> Color(0xFFFBBF24)
            else -> Color(0xFFF87171)
        }
    }

    Column {
        MutedNote("Theoretical hole positions come from pure scale-degree math, which doesn't always land evenly under your fingers. This blends interior holes toward even spacing — the two end holes never move — and estimates the tuning cost plus a starting diameter compensation for each shifted hole.")

        Row(modifier = Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Pure theoretical tuning", color = Muted, fontSize = 11.sp)
            Text("Fully even spacing", color = Muted, fontSize = 11.sp)
        }
        Slider(
            value = blend, onValueChange = { blend = it }, valueRange = 0f..1f,
            colors = SliderDefaults.colors(thumbColor = Gold, activeTrackColor = Gold),
        )
        Text(
            "${(blend * 100).toInt()}% toward even spacing",
            color = Gold, fontSize = 13.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )

        Column(modifier = Modifier.padding(top = 10.dp, bottom = 10.dp)) {
            adjusted.forEach { h ->
                Row(modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
                    Text("H${h.hole.num}", color = Bone, fontWeight = FontWeight.Bold, fontSize = 12.sp, modifier = Modifier.padding(end = 8.dp))
                    Text(fmtIn(h.adjFromTshIn), color = Bone, fontSize = 12.sp, modifier = Modifier.weight(1f))
                    Text(fmtIn3(h.adjDiameterIn), color = Bone, fontSize = 12.sp, modifier = Modifier.weight(1f))
                    Text(
                        if (h.centsShift == 0) "no change" else "${if (h.centsShift > 0) "+" else ""}${h.centsShift}¢",
                        color = driftColor(h.centsShift), fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        if (maxDrift > 40) {
            MutedNote("⚠ At this blend, the largest pitch drift is $maxDrift¢ — that's a noticeable tuning shift. Consider a lower blend, or plan to compensate with the suggested diameters and confirm each hole by ear during drilling.")
        }

        Row(modifier = Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { onApply(adjusted.map { ErgoOverride(it.hole.num, it.adjFromTshIn, it.adjDiameterIn) }) },
                colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = Color(0xFF0F0801)),
                modifier = Modifier.weight(1f),
            ) { Text("Apply Adjusted Positions") }
            if (applied) {
                Button(
                    onClick = onReset,
                    colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Muted),
                ) { Text("Reset") }
            }
        }
        if (applied) {
            MutedNote("✓ Adjusted positions are active — the hole table, PDF, and G-code exports below all reflect this adjustment.")
        }
    }
}

// ── ANTLER SELECTION ASSISTANT ─────────────────────────────────────
@Composable
fun AntlerAssistantPanel(holeCount: Int, notes: List<Note>, onApply: (boreIn: Double, curvature: Curve, noteKey: String) -> Unit) {
    var length by remember { mutableStateOf("") }
    var widestDiam by remember { mutableStateOf("") }
    var tipDiam by remember { mutableStateOf("") }
    var curvature by remember { mutableStateOf(Curve.STRAIGHT) }
    var result by remember { mutableStateOf<com.nafduduk.calculator.engine.AntlerFitResult?>(null) }

    val canAnalyze = (length.toDoubleOrNull() ?: 0.0) > 0 && (widestDiam.toDoubleOrNull() ?: 0.0) > 0 && (tipDiam.toDoubleOrNull() ?: 0.0) > 0

    Column {
        MutedNote("Already have a piece of antler in hand? Enter its real measurements and this checks which keys it can actually be built into.")

        Row(modifier = Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = length, onValueChange = { length = it }, label = { Text("Length (in)") }, singleLine = true,
                modifier = Modifier.weight(1f),
                colors = OutlinedTextFieldDefaults.colors(focusedTextColor = Bone, unfocusedTextColor = Bone, focusedBorderColor = Gold, unfocusedBorderColor = Border),
            )
            OutlinedTextField(
                value = widestDiam, onValueChange = { widestDiam = it }, label = { Text("Widest (in)") }, singleLine = true,
                modifier = Modifier.weight(1f),
                colors = OutlinedTextFieldDefaults.colors(focusedTextColor = Bone, unfocusedTextColor = Bone, focusedBorderColor = Gold, unfocusedBorderColor = Border),
            )
            OutlinedTextField(
                value = tipDiam, onValueChange = { tipDiam = it }, label = { Text("Tip (in)") }, singleLine = true,
                modifier = Modifier.weight(1f),
                colors = OutlinedTextFieldDefaults.colors(focusedTextColor = Bone, unfocusedTextColor = Bone, focusedBorderColor = Gold, unfocusedBorderColor = Border),
            )
        }

        PillRow(modifier = Modifier.padding(top = 10.dp)) {
            Pill(text = "straight", selected = curvature == Curve.STRAIGHT, onClick = { curvature = Curve.STRAIGHT })
            Pill(text = "slight", selected = curvature == Curve.SLIGHT, onClick = { curvature = Curve.SLIGHT })
            Pill(text = "heavy", selected = curvature == Curve.HEAVY, onClick = { curvature = Curve.HEAVY })
        }

        Button(
            onClick = {
                result = analyzeAntlerFit(length.toDouble(), widestDiam.toDouble(), tipDiam.toDouble(), curvature, notes, holeCount)
            },
            enabled = canAnalyze,
            colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = Color(0xFF0F0801)),
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
        ) { Text("🔍 Analyze This Antler", fontWeight = FontWeight.Bold) }

        result?.let { r ->
            Column(modifier = Modifier.padding(top = 14.dp)) {
                if (!r.fits) {
                    val msg = if (r.reason == "tip_too_narrow") {
                        "The tip diameter is too narrow to hold any standard bore with safe wall thickness."
                    } else {
                        "Even at the largest bore this piece supports (${fmtIn3(r.boreIn ?: 0.0)}), the usable tube length works out to ${fmtIn(r.usableTubeLenIn ?: 0.0)} — too short to reach any playable note."
                    }
                    Text("✗ This piece doesn't have enough usable length or width to build a flute", color = Color(0xFFFCA5A5), fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    MutedNote(msg)
                } else {
                    Text("✓ This antler can be built as a ${r.scaleName}", color = Color(0xFF7ACC44), fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    MutedNote("Recommended bore: ${fmtIn3(r.boreIn ?: 0.0)} · Usable tube length after SAC & trim: ${fmtIn(r.usableTubeLenIn ?: 0.0)}")

                    Text("Best-fit keys, ranked", color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 10.dp, bottom = 6.dp))
                    r.bestMatches.forEachIndexed { i, m ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 3.dp)
                                .background(if (i == 0) Color(0xFF1F2E18) else Bg2, RoundedCornerShape(8.dp))
                                .padding(horizontal = 12.dp, vertical = 9.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Column {
                                Text("✓ ${m.name}", color = if (i == 0) Color(0xFF7ACC44) else Color(0xFF4ADE80), fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                Text(if (m.fitsExact) "Near-perfect fit" else "Fits with ${fmtIn(m.diffIn)} trimmed off", color = Muted, fontSize = 11.sp)
                            }
                            Button(
                                onClick = { onApply(r.boreIn ?: 0.0, curvature, m.name) },
                                colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = Color(0xFF0F0801)),
                            ) { Text("Apply", fontSize = 12.sp) }
                        }
                    }
                    if (r.tooLongExamples.isNotEmpty()) {
                        MutedNote("✗ Too short for lower keys like ${r.tooLongExamples.joinToString(", ") { it.name }}.")
                    }
                }
            }
        }
    }
}

// ── FINGER REACH ANALYZER ──────────────────────────────────────────
@Composable
fun FingerReachPanel(holes: List<FingerHole>, boreIn: Double, holeCount: Int) {
    val analysis = remember(holes) { analyzeFingerReach(holes) }

    fun statusColor(s: com.nafduduk.calculator.engine.ReachStatus) = when (s) {
        com.nafduduk.calculator.engine.ReachStatus.COMFORTABLE -> Color(0xFF4ADE80)
        com.nafduduk.calculator.engine.ReachStatus.TIGHT -> Color(0xFFFBBF24)
        com.nafduduk.calculator.engine.ReachStatus.STRETCH -> Color(0xFFFBBF24)
        com.nafduduk.calculator.engine.ReachStatus.CRAMPED -> Color(0xFFF87171)
        com.nafduduk.calculator.engine.ReachStatus.EXCEEDS -> Color(0xFFF87171)
    }
    fun statusLabel(s: com.nafduduk.calculator.engine.ReachStatus) = when (s) {
        com.nafduduk.calculator.engine.ReachStatus.COMFORTABLE -> "Comfortable"
        com.nafduduk.calculator.engine.ReachStatus.TIGHT -> "Tight"
        com.nafduduk.calculator.engine.ReachStatus.STRETCH -> "Stretch"
        com.nafduduk.calculator.engine.ReachStatus.CRAMPED -> "Cramped — fingers will collide"
        com.nafduduk.calculator.engine.ReachStatus.EXCEEDS -> "Exceeds average hand reach"
    }

    val overallColor = if (analysis.hasProblem) Color(0xFFF87171) else if (analysis.hasWarning) Color(0xFFFBBF24) else Color(0xFF4ADE80)
    val overallText = if (analysis.hasProblem) {
        "⚠ One or more gaps fall outside comfortable hand reach"
    } else if (analysis.hasWarning) {
        "Playable, but a couple of gaps are tight or a stretch"
    } else {
        "✓ All hole spacing is within comfortable reach"
    }

    Column {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFF1A1208), RoundedCornerShape(8.dp))
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            Text(overallText, color = overallColor, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        }

        Column(modifier = Modifier.padding(top = 10.dp)) {
            analysis.gaps.forEach { g ->
                Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Text("H${g.fromNum} → H${g.toNum}", color = Muted, fontSize = 11.sp, modifier = Modifier.padding(end = 8.dp))
                    Box(modifier = Modifier.weight(1f).height(10.dp).background(Color(0xFF2A1C0E), RoundedCornerShape(999.dp))) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth((g.gapIn / 2.2).toFloat().coerceIn(0f, 1f))
                                .height(10.dp)
                                .background(statusColor(g.status), RoundedCornerShape(999.dp)),
                        )
                    }
                    Text(fmtIn(g.gapIn), color = Bone, fontSize = 11.sp, modifier = Modifier.padding(horizontal = 8.dp))
                    Text(statusLabel(g.status), color = statusColor(g.status), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
            }
        }

        if (analysis.hasProblem) {
            val isCramped = analysis.gaps.any { it.status == com.nafduduk.calculator.engine.ReachStatus.CRAMPED }
            val isExceeds = analysis.gaps.any { it.status == com.nafduduk.calculator.engine.ReachStatus.EXCEEDS }
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 10.dp)
                    .background(Color(0xFF2A1208), RoundedCornerShape(8.dp))
                    .padding(horizontal = 14.dp, vertical = 12.dp),
            ) {
                Text("Recommended fixes — try one or more:", color = Color(0xFFFCA5A5), fontWeight = FontWeight.Bold, fontSize = 12.sp)
                if (isCramped) {
                    MutedNote("• Lower the tuning key — a lower root note needs a longer tube, spreading holes further apart.")
                    MutedNote("• Decrease bore diameter — currently ${fmtIn3(boreIn)}.")
                    MutedNote("• Reduce hole count — $holeCount now.")
                }
                if (isExceeds) {
                    MutedNote("• Raise the tuning key — a higher root note needs a shorter tube, pulling holes closer together.")
                    MutedNote("• Increase bore diameter — currently ${fmtIn3(boreIn)}.")
                    MutedNote("• Reduce hole count — $holeCount now.")
                }
                MutedNote("• Set hand size to \"large\" if your reach is above average.")
            }
        } else if (analysis.hasWarning) {
            MutedNote("Tight or stretch gaps are playable for most hands but worth testing on a full-size mockup before committing to a final drill.")
        }
    }
}

// ── HARMONY BUILDER ─────────────────────────────────────────────────
@Composable
fun HarmonyBuilderPanel(boreIn: Double, noteKey: String, onApply: (List<DroneChamber>) -> Unit) {
    var customCount by remember { mutableStateOf(2) }
    val customSpread = mapOf(1 to listOf(0), 2 to listOf(2, 0), 3 to listOf(0, 3, 5))

    fun buildDroneSet(intervalIdxs: List<Int>): List<DroneChamber> =
        intervalIdxs.map { ix -> DroneChamber(boreIn = boreIn, intervalIdx = ix, playable = false, holeCount = 2, noteKey = noteKey) }

    Column {
        MutedNote("Pick a harmony style to automatically configure your drone chambers, tuned relative to the melody root ($noteKey). You can still hand-tune bore, interval, or make a chamber playable afterward.")

        Column(modifier = Modifier.padding(top = 10.dp)) {
            HARMONY_PRESETS.forEach { p ->
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                        .background(Bg2, RoundedCornerShape(10.dp))
                        .clickable { onApply(buildDroneSet(p.intervals)) }
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                ) {
                    Text("${p.icon} ${p.name}", color = Bone, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Text(p.intervals.joinToString(" · ") { DRONE_INTERVALS[it].label }, color = Color(0xFFD4A05A), fontSize = 10.sp)
                    Text(p.desc, color = Muted, fontSize = 11.sp)
                }
            }
        }

        Column(modifier = Modifier.padding(top = 12.dp)) {
            Text("Or build a custom spread", color = Muted, fontSize = 11.sp, modifier = Modifier.padding(bottom = 8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(1, 2, 3).forEach { n ->
                    Pill(text = "$n Drone${if (n > 1) "s" else ""}", selected = customCount == n, onClick = { customCount = n })
                }
            }
            Text(
                customSpread.getValue(customCount).joinToString(" · ") { DRONE_INTERVALS[it].label },
                color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 6.dp, bottom = 8.dp),
            )
            Button(
                onClick = { onApply(buildDroneSet(customSpread.getValue(customCount))) },
                colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = Color(0xFF0F0801)),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Apply") }
        }
    }
}
