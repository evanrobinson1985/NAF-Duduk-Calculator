package com.nafduduk.calculator.ui.tuner

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nafduduk.calculator.engine.Note
import com.nafduduk.calculator.ui.common.MutedNote
import com.nafduduk.calculator.ui.common.Pill
import com.nafduduk.calculator.ui.common.PillRow
import com.nafduduk.calculator.ui.theme.Gold
import com.nafduduk.calculator.ui.theme.Muted
import kotlin.math.abs

/**
 * Ported from RealTuner: autocorrelation pitch detection over a live mic
 * feed, note/cents readout, an in-tune indicator, and a volume meter.
 * Android's equivalent of the web source's Web Audio AnalyserNode is
 * AudioRecord read in a loop — same autoCorrelatePitch() math either way,
 * so results match the web app exactly.
 */
@Composable
fun TunerPanel(targetNoteDefault: String, notes: List<Note>, onClose: () -> Unit) {
    // One shared microphone loop — see ui/tuner/MicPitch.kt. The Progressive
    // Tuning Assistant uses the same one.
    val mic = rememberMicPitch(notes)
    var targetNote by remember { mutableStateOf(targetNoteDefault) }

    val detectedNote = mic.noteName
    val detectedFreq = Math.round(mic.freqHz).toInt()
    val detectedCents = mic.cents
    val volume = mic.volume

    val inTune = detectedNote != "--" && detectedNote == targetNote && abs(detectedCents) < 12
    val cc = if (abs(detectedCents) < 10) Color(0xFF4ADE80) else if (abs(detectedCents) < 30) Color(0xFFFBBF24) else Color(0xFFF87171)
    val clampC = detectedCents.coerceIn(-50, 50)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color(0xFF1A1208), RoundedCornerShape(12.dp))
            .border(2.dp, if (inTune) Color(0xFF4ADE80) else Color(0xFF5A3A18), RoundedCornerShape(12.dp))
            .padding(20.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("🎤 Real-Time Tuner", color = Gold, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Button(
                onClick = onClose,
                colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent, contentColor = Color(0xFFC4A97D)),
            ) { Text("✕ Close") }
        }

        Text("Target Note", color = Muted, fontSize = 10.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        PillRow(modifier = Modifier.padding(vertical = 8.dp)) {
            notes.filter { !it.advanced }.forEach { n ->
                Pill(text = n.name, selected = n.name == targetNote, onClick = { targetNote = n.name })
            }
        }

        Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
            Text(
                detectedNote,
                color = if (inTune) Color(0xFF4ADE80) else Gold,
                fontSize = 64.sp,
                fontWeight = FontWeight.Black,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                if (detectedFreq > 0) "$detectedFreq Hz" else "",
                color = Muted,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                if (detectedCents != 0 && detectedNote != "--") "${if (detectedCents > 0) "+" else ""}$detectedCents¢" else "",
                color = cc,
                fontSize = 22.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
            if (inTune) {
                Text("✓ IN TUNE", color = Color(0xFF4ADE80), fontSize = 13.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            }
        }

        // Cents needle strip: a fixed center tick (in-tune) and a moving pip
        // offset left/right by the detected cents — mirrors the web
        // version's `left: 50% + clampC*0.42%` absolute positioning.
        BoxWithConstraints(
            modifier = Modifier
                .fillMaxWidth()
                .height(22.dp)
                .background(Color(0xFF33240F), RoundedCornerShape(999.dp)),
        ) {
            val stripWidth = maxWidth
            Box(
                modifier = Modifier
                    .offset(x = stripWidth / 2 - 1.dp)
                    .width(2.dp)
                    .height(22.dp)
                    .background(Gold),
            )
            if (detectedNote != "--") {
                val pipWidth = stripWidth * 0.10f
                val centerX = stripWidth * (0.5f + clampC * 0.0042f)
                Box(
                    modifier = Modifier
                        .offset(x = centerX - pipWidth / 2)
                        .width(pipWidth)
                        .height(22.dp)
                        .padding(vertical = 3.dp)
                        .background(cc, RoundedCornerShape(999.dp)),
                )
            }
        }
        Row(modifier = Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("♭ flat", color = Color(0xFF6B5D4A), fontSize = 10.sp)
            Text("in tune", color = Color(0xFF6B5D4A), fontSize = 10.sp)
            Text("sharp ♯", color = Color(0xFF6B5D4A), fontSize = 10.sp)
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(8.dp)
                .background(Color(0xFF33240F), RoundedCornerShape(999.dp)),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth((volume / 100f).coerceIn(0f, 1f))
                    .height(8.dp)
                    .background(if (volume > 70) Gold else Color(0xFFD97706), RoundedCornerShape(999.dp)),
            )
        }

        Button(
            onClick = { mic.toggle() },
            colors = ButtonDefaults.buttonColors(
                containerColor = if (mic.listening) Color(0xFF7F1D1D) else Gold,
                contentColor = if (mic.listening) Color(0xFFFCA5A5) else Color(0xFF0F0801),
            ),
            modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
        ) {
            Text(if (mic.listening) "⏹ Stop Microphone" else "▶ Start Microphone", fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }
        mic.error?.let { MutedNote(it) }
        Text(
            "Requires microphone permission",
            color = Color(0xFF4A3A26),
            fontSize = 10.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
        )
    }
}
