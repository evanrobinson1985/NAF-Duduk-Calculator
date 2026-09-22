package com.nafduduk.calculator.ui.flute

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nafduduk.calculator.engine.FingerHole
import com.nafduduk.calculator.engine.Note
import com.nafduduk.calculator.engine.centsOff
import com.nafduduk.calculator.engine.isHoleOpen
import com.nafduduk.calculator.engine.tuningSteps
import com.nafduduk.calculator.ui.common.MutedNote
import com.nafduduk.calculator.ui.tuner.rememberMicPitch
import com.nafduduk.calculator.ui.theme.Gold
import com.nafduduk.calculator.ui.theme.Muted
import com.nafduduk.calculator.util.jsFmt
import kotlin.math.abs

private val InTune = Color(0xFF4ADE80)
private val Near = Color(0xFFFBBF24)
private val Off = Color(0xFFF87171)
private val Card = Color(0xFF1A1208)
private val CardEdge = Color(0xFF5A3A18)
private val Tan = Color(0xFFC4A97D)
private val Amberish = Color(0xFFD4A05A)
private val Dim = Color(0xFF6B5D4A)
private val Track = Color(0xFF33240F)

/**
 * The Progressive Tuning Assistant: drill and test one hole at a time rather
 * than cutting all six and hoping.
 *
 * Holes open from the mouth end toward the foot — the smallest pitch jump
 * first — which is both standard NAF fingering and the order that lets each
 * hole be enlarged to pitch before the next one exists. The expected pitch at
 * each step is the root times that hole's own scale ratio, the same ratio
 * that placed the hole, so this can never disagree with the results table.
 *
 * The step sequence is in engine/TuningSteps.kt, where it is tested; the
 * microphone comes from the same shared loop as the Real-Time Tuner.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProgressiveTuningAssistant(
    holes: List<FingerHole>,
    holeCount: Int,
    rootFreq: Double?,
    notes: List<Note>,
) {
    val steps = remember(holes, holeCount, rootFreq, notes) { tuningSteps(holes, holeCount, rootFreq, notes) }
    if (steps.isEmpty()) {
        MutedNote(
            "This chamber has no finger holes to walk through — progressive tuning only applies to a " +
                "playable chamber with holes.",
        )
        return
    }

    var stepIdx by rememberSaveable { mutableStateOf(0) }
    val idx = stepIdx.coerceIn(0, steps.size - 1)
    val step = steps[idx]
    val mic = rememberMicPitch(notes)

    val cents = if (mic.listening) centsOff(step.expectedFreq, mic.freqHz) else null
    val matches = cents != null && abs(cents) < 12
    val centsColor = when {
        cents == null -> Muted
        abs(cents) < 10 -> InTune
        abs(cents) < 30 -> Near
        else -> Off
    }

    MutedNote(
        "Drill and test one step at a time, opening holes from the mouth end toward the foot (the smallest " +
            "pitch jump first, largest last — matching standard NAF fingering). At each step cover the holes " +
            "shown, blow a steady breath, and compare against the expected pitch before enlarging the hole " +
            "or moving on.",
    )

    // Step dots: R for the root, then the hole each step opens.
    FlowRow(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        steps.forEachIndexed { i, s ->
            Box(
                modifier = Modifier
                    .size(28.dp)
                    .background(
                        when {
                            i == idx -> Gold
                            i < idx -> CardEdge
                            else -> Color(0xFF241608)
                        },
                        CircleShape,
                    )
                    .border(1.dp, if (i == idx) Gold else Color(0xFF4A3A26), CircleShape)
                    .clickable { stepIdx = i },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    if (s.isRoot) "R" else "${s.holeNum}",
                    color = when {
                        i == idx -> Color(0xFF0F0801)
                        i < idx -> Color(0xFFE5D5B8)
                        else -> Muted
                    },
                    fontSize = 10.sp, fontWeight = FontWeight.Bold,
                )
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Card, RoundedCornerShape(12.dp))
            .border(2.dp, if (matches) InTune else CardEdge, RoundedCornerShape(12.dp))
            .padding(18.dp),
    ) {
        Text(
            "Step ${idx + 1} of ${steps.size}",
            color = Amberish, fontSize = 11.sp, fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
        )
        Text(
            step.label,
            color = Gold, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold,
            textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
        )
        if (!step.isRoot && step.interval.isNotBlank()) {
            Text(
                "(${step.interval} from root)",
                color = Muted, fontSize = 11.sp,
                textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
            )
        }

        // Which holes are covered right now, in the order they sit on the tube.
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
            horizontalArrangement = Arrangement.Center,
        ) {
            holes.sortedByDescending { it.num }.forEach { h ->
                val open = step.isHoleOpen(h.num)
                Column(
                    modifier = Modifier.padding(horizontal = 3.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        modifier = Modifier
                            .size(22.dp)
                            .background(if (open) Color.Transparent else Tan, CircleShape)
                            .border(2.dp, if (open) Color(0xFF7ACC44) else Tan, CircleShape),
                    )
                    Text("H${h.num}", color = Dim, fontSize = 9.sp, modifier = Modifier.padding(top = 2.dp))
                }
            }
        }
        Text(
            "filled = finger covering the hole · green ring = uncovered",
            color = Dim, fontSize = 10.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
        )

        Text(
            "EXPECTED",
            color = Muted, fontSize = 10.sp, textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
        )
        Text(
            step.expectedNote?.name ?: "--",
            color = Gold, fontSize = 44.sp, fontWeight = FontWeight.Black,
            textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
        )
        Text(
            step.expectedFreq?.let { "${jsFmt(it, 1)} Hz" } ?: "",
            color = Tan, fontSize = 14.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
        )

        if (mic.listening) {
            Text(
                "HEARING",
                color = Muted, fontSize = 10.sp, textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            )
            Text(
                mic.noteName,
                color = if (matches) InTune else Color(0xFFE5D5B8), fontSize = 32.sp, fontWeight = FontWeight.ExtraBold,
                textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
            )
            Text(
                if (mic.isSilent) "" else "${Math.round(mic.freqHz)} Hz",
                color = Muted, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
            )
            Text(
                cents?.let { "${if (it > 0) "+" else ""}$it¢" } ?: "",
                color = centsColor, fontSize = 20.sp,
                textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
            )
            when {
                matches -> Text(
                    "✓ MATCHES EXPECTED PITCH",
                    color = InTune, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                )
                cents != null -> Text(
                    // Wood only comes off, so a sharp hole is a different
                    // problem from a flat one: flat you can fix, sharp you
                    // mostly have to diagnose.
                    if (cents > 0) {
                        "Sharp — the hole may be slightly large, or check for air leaks"
                    } else {
                        "Flat — enlarge this hole gradually, then re-check"
                    },
                    color = Amberish, fontSize = 11.sp,
                    textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                )
            }

            CentsStrip(cents, centsColor)
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 6.dp)
                    .height(6.dp)
                    .background(Track, RoundedCornerShape(999.dp)),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth((mic.volume / 100f).coerceIn(0f, 1f))
                        .height(6.dp)
                        .background(if (mic.volume > 70) Gold else Color(0xFFD97706), RoundedCornerShape(999.dp)),
                )
            }
        }

        Button(
            onClick = { mic.toggle() },
            colors = ButtonDefaults.buttonColors(
                containerColor = if (mic.listening) Color(0xFF7F1D1D) else Gold,
                contentColor = if (mic.listening) Color(0xFFFCA5A5) else Color(0xFF0F0801),
            ),
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        ) {
            Text(
                if (mic.listening) "⏹ Stop Microphone" else "🎤 Compare With Microphone (optional)",
                fontWeight = FontWeight.Bold,
            )
        }
        mic.error?.let { MutedNote(it) }
    }

    Row(modifier = Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(
            onClick = { stepIdx = (idx - 1).coerceAtLeast(0) },
            enabled = idx > 0,
            colors = ButtonDefaults.buttonColors(
                containerColor = Color(0xFF241608), contentColor = Color(0xFFE5D5B8),
                disabledContainerColor = Card, disabledContentColor = Color(0xFF4A3A26),
            ),
            modifier = Modifier.weight(1f),
        ) { Text("← Previous", fontWeight = FontWeight.Bold) }
        Button(
            onClick = { stepIdx = (idx + 1).coerceAtMost(steps.size - 1) },
            enabled = idx < steps.size - 1,
            colors = ButtonDefaults.buttonColors(
                containerColor = Gold, contentColor = Color(0xFF0F0801),
                disabledContainerColor = Color(0xFF4A3A26), disabledContentColor = Muted,
            ),
            modifier = Modifier.weight(1f),
        ) { Text(if (idx == steps.size - 1) "✓ All Holes Open" else "Next →", fontWeight = FontWeight.Bold) }
    }
}

/** A fixed centre tick with a pip offset by the cents error, clamped to ±50. */
@Composable
private fun CentsStrip(cents: Int?, color: Color) {
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 10.dp)
            .height(16.dp)
            .background(Track, RoundedCornerShape(999.dp)),
    ) {
        val strip = maxWidth
        Box(modifier = Modifier.offset(x = strip / 2 - 1.dp).width(2.dp).height(16.dp).background(Gold))
        if (cents != null) {
            val pip = strip * 0.09f
            val centerX = strip * (0.5f + cents.coerceIn(-50, 50) * 0.0042f)
            Box(
                modifier = Modifier
                    .offset(x = centerX - pip / 2)
                    .width(pip)
                    .height(16.dp)
                    .padding(vertical = 2.dp)
                    .background(color, RoundedCornerShape(999.dp)),
            )
        }
    }
}
