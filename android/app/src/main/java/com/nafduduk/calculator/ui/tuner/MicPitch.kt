package com.nafduduk.calculator.ui.tuner

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import com.nafduduk.calculator.engine.Note
import com.nafduduk.calculator.engine.autoCorrelatePitch
import com.nafduduk.calculator.engine.nearestNote
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import kotlin.math.abs
import kotlin.math.min

internal const val SAMPLE_RATE = 44100
internal const val FRAME_SIZE = 2048

/** What the microphone is currently hearing. */
class MicPitchState internal constructor() {
    var noteName by mutableStateOf("--")
        internal set
    var freqHz by mutableStateOf(0.0)
        internal set
    var cents by mutableStateOf(0)
        internal set
    var volume by mutableFloatStateOf(0f)
        internal set
    var error by mutableStateOf<String?>(null)
        internal set
    var hasPermission by mutableStateOf(false)
        internal set
    var listening by mutableStateOf(false)
        internal set

    internal var requestPermission: () -> Unit = {}

    /** Starts listening, asking for the microphone first if it has not been granted. */
    fun start() = if (hasPermission) { listening = true } else requestPermission()

    fun stop() {
        listening = false
    }

    fun toggle() = if (listening) stop() else start()

    val isSilent: Boolean get() = freqHz <= 0
}

/**
 * One microphone, one recording loop, shared by the Real-Time Tuner and the
 * Progressive Tuning Assistant. Both need the same thing — autocorrelation
 * pitch over a live feed — and a second copy of the AudioRecord lifecycle is
 * exactly where a leaked microphone comes from.
 *
 * The loop is tied to composition: it stops when `listening` goes false, and
 * also when the caller leaves the tree (a tab switch away), which releases
 * the device. The web source had to check `rootRef.clientWidth === 0` by hand
 * for the same reason; here it falls out of the effect's lifecycle.
 */
@Composable
fun rememberMicPitch(notes: List<Note>): MicPitchState {
    val context = LocalContext.current
    val state = remember { MicPitchState() }

    LaunchedEffect(Unit) {
        state.hasPermission =
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    }

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        state.hasPermission = granted
        state.listening = granted
        if (!granted) state.error = "Microphone permission denied."
    }
    state.requestPermission = { launcher.launch(Manifest.permission.RECORD_AUDIO) }

    LaunchedEffect(state.listening) {
        if (!state.listening) return@LaunchedEffect
        state.error = null
        withContext(Dispatchers.Default) {
            val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            if (minBuf <= 0) {
                state.error = "Microphone unavailable on this device."
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
                while (isActive && state.listening) {
                    val read = audioRecord.read(shortBuf, 0, FRAME_SIZE)
                    if (read <= 0) continue
                    var maxA = 0f
                    for (i in 0 until read) {
                        val f = shortBuf[i] / 32768f
                        floatBuf[i] = f
                        val a = abs(f)
                        if (a > maxA) maxA = a
                    }
                    state.volume = min(maxA * 120f, 100f)
                    val pitch = autoCorrelatePitch(floatBuf.copyOf(read), SAMPLE_RATE)
                    if (pitch > 60 && pitch < 2500) {
                        val ni = nearestNote(pitch, notes)
                        state.noteName = ni.name
                        state.freqHz = pitch
                        state.cents = ni.cents
                    } else {
                        state.noteName = "--"; state.freqHz = 0.0; state.cents = 0
                    }
                }
            } catch (e: SecurityException) {
                state.error = "Microphone permission denied."
            } catch (e: Exception) {
                state.error = "Microphone error: ${e.message}"
            } finally {
                try { audioRecord?.stop() } catch (e: Exception) { /* already stopped */ }
                audioRecord?.release()
                state.noteName = "--"; state.freqHz = 0.0; state.cents = 0; state.volume = 0f
            }
        }
    }

    DisposableEffect(Unit) { onDispose { state.listening = false } }

    return state
}
