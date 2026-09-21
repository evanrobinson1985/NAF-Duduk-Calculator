package com.nafduduk.calculator.ui.tuner

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BoxWithConstraints
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.nafduduk.calculator.engine.Note
import com.nafduduk.calculator.engine.autoCorrelatePitch
import com.nafduduk.calculator.engine.nearestNote
import com.nafduduk.calculator.ui.common.MutedNote
import com.nafduduk.calculator.ui.common.Pill
import com.nafduduk.calculator.ui.common.PillRow
import com.nafduduk.calculator.ui.theme.Gold
import com.nafduduk.calculator.ui.theme.Muted
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import kotlin.math.abs
import kotlin.math.min

private const val SAMPLE_RATE = 44100
private const val FRAME_SIZE = 2048

/**
 * Ported from RealTuner: autocorrelation pitch detection over a live mic
 * feed, note/cents readout, an in-tune indicator, and a volume meter.
 * Android's equivalent of the web source's Web Audio AnalyserNode is
 * AudioRecord read in a loop — same autoCorrelatePitch() math either way,
 * so results match the web app exactly.
 */
@Composable
fun TunerPanel(targetNoteDefault: String, notes: List<Note>, onClose: () -> Unit) {
    val context = LocalContext.current
    var hasPermission by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
    }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        hasPermission = granted
        if (granted) isListening = true
    }

    var isListening by remember { mutableStateOf(false) }
    var detectedNote by remember { mutableStateOf("--") }
    var detectedFreq by remember { mutableStateOf(0) }
    var detectedCents by remember { mutableStateOf(0) }
    var volume by remember { mutableFloatStateOf(0f) }
    var targetNote by remember { mutableStateOf(targetNoteDefault) }
    var micError by remember { mutableStateOf<String?>(null) }

    // The recording loop — cancelled automatically whenever isListening flips
    // to false OR this composable leaves composition (tab switch away),
    // which also releases the mic; no manual visibility check needed the
    // way the web version's rootRef.clientWidth trick required.
    LaunchedEffect(isListening) {
        if (!isListening) return@LaunchedEffect
        withContext(Dispatchers.Default) {
            val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            if (minBuf <= 0) {
                micError = "Microphone unavailable on this device."
                return@withContext
            }
            var audioRecord: AudioRecord? = null
            try {
                @Suppress("MissingPermission")
                audioRecord = AudioRecord(
                    MediaRecorder.AudioSource.MIC, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT, min(minBuf * 2, FRAME_SIZE * 2 * 4),
                )
                audioRecord.startRecording()
                val shortBuf = ShortArray(FRAME_SIZE)
                val floatBuf = FloatArray(FRAME_SIZE)
                while (isActive && isListening) {
                    val read = audioRecord.read(shortBuf, 0, FRAME_SIZE)
                    if (read <= 0) continue
                    var maxA = 0f
                    for (i in 0 until read) {
                        val f = shortBuf[i] / 32768f
                        floatBuf[i] = f
                        val a = abs(f)
                        if (a > maxA) maxA = a
                    }
                    volume = min(maxA * 120f, 100f)

                    val pitch = autoCorrelatePitch(floatBuf.copyOf(read), SAMPLE_RATE)
                    if (pitch > 60 && pitch < 2500) {
                        val ni = nearestNote(pitch, notes)
                        detectedNote = ni.name
                        detectedFreq = Math.round(pitch).toInt()
                        detectedCents = ni.cents
                    } else {
                        detectedNote = "--"; detectedFreq = 0; detectedCents = 0
                    }
                }
            } catch (e: SecurityException) {
                micError = "Microphone permission denied."
            } catch (e: Exception) {
                micError = "Microphone error: ${e.message}"
            } finally {
                try { audioRecord?.stop() } catch (e: Exception) { /* already stopped */ }
                audioRecord?.release()
                detectedNote = "--"; detectedFreq = 0; detectedCents = 0; volume = 0f
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose { isListening = false }
    }

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
            onClick = {
                if (isListening) {
                    isListening = false
                } else if (hasPermission) {
                    micError = null
                    isListening = true
                } else {
                    permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                }
            },
            colors = ButtonDefaults.buttonColors(
                containerColor = if (isListening) Color(0xFF7F1D1D) else Gold,
                contentColor = if (isListening) Color(0xFFFCA5A5) else Color(0xFF0F0801),
            ),
            modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
        ) {
            Text(if (isListening) "⏹ Stop Microphone" else "▶ Start Microphone", fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }
        micError?.let { MutedNote(it) }
        Text(
            "Requires microphone permission",
            color = Color(0xFF4A3A26),
            fontSize = 10.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
        )
    }
}
