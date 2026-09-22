package com.nafduduk.calculator.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.util.Log

/**
 * Recorded flute notes, so a maker can hear a key before committing a piece
 * of antler to it.
 *
 * Ported from the web source's NOTE_SAMPLES map, with one correction. That
 * map and the audio actually shipped in samples.zip do not agree: nine of its
 * thirty entries name files the archive does not contain (C3, C#3, D3, F3,
 * F#3, Ab3, C#4, Ab4 and E5), and the archive carries eight recordings the
 * map never referenced. The entries below are the ones with real audio behind
 * them, plus those eight — mapping a file that exists is strictly better than
 * mapping one that does not, and playback has to cope with a missing sample
 * either way.
 *
 * The nine notes with no recording simply have no preview, which is what the
 * web app does today; it just fails quietly rather than saying so.
 * "Ultra-High E.mp3" is deliberately left unmapped because its filename does
 * not say which octave it is, and guessing would put the wrong pitch behind a
 * note name.
 */
private const val SAMPLES_DIR = "samples"

val NOTE_SAMPLES: Map<String, String> = mapOf(
    // Below the original C3-F5 range: shipped in the archive, unmapped in the
    // web source. Reachable once a note outside the standard range can be
    // picked; the audio is there and correct either way.
    "G1" to "Ultra-Low G1.mp3",
    "G2" to "Very Low G2.mp3",
    "B2" to "Very Low B2 NAF.mp3",
    // The original range, less the nine the archive does not carry.
    "Eb3" to "Low Eb3.mp3",
    "E3" to "Low E3.mp3",
    "G3" to "Low G3.mp3",
    "A3" to "Low A3.mp3",
    "Bb3" to "Low Bb3.mp3",
    "B3" to "Low B3.mp3",
    "C4" to "Mid C4.mp3",
    "D4" to "Mid D4.mp3",
    "Eb4" to "Mid Eb4.mp3",
    "E4" to "Mid-Range E4.mp3",
    "F4" to "Mid F4.mp3",
    "F#4" to "Mid F#4.mp3",
    "G4" to "Mid G4.mp3",
    "A4" to "Mid A4.mp3",
    "Bb4" to "Mid Bb4.mp3",
    "B4" to "Mid B4.mp3",
    "C5" to "High C5.mp3",
    "C#5" to "High C#5.mp3",
    "D5" to "High D5.mp3",
    "Eb5" to "High Eb5.mp3",
    "F5" to "High F5.mp3",
    // Above it: also shipped, also unmapped in the web source.
    "F#5" to "High F#5.mp3",
    "G5" to "High G5.mp3",
    "A5" to "High A5.mp3",
    "F#6" to "Very High F#6.mp3",
)

/** True when this note has a recording, so the UI shows the preview only where it works. */
fun hasNoteSample(noteName: String): Boolean = NOTE_SAMPLES.containsKey(noteName)

/**
 * Plays note samples one at a time.
 *
 * Picking a new note cuts off whatever was already sounding rather than
 * layering on top of it — the web source keeps a single module-level Audio
 * element for exactly this reason. On Android the same idea needs real
 * cleanup: a MediaPlayer holds a codec, so every one started has to be
 * released, including one replaced mid-note.
 */
object NoteSamplePlayer {
    private const val TAG = "NoteSample"

    private var current: MediaPlayer? = null

    @Synchronized
    fun play(context: Context, noteName: String) {
        stop()
        val file = NOTE_SAMPLES[noteName]
        if (file == null) {
            Log.i(TAG, "No sample recorded for \"$noteName\".")
            return
        }
        try {
            val player = MediaPlayer()
            context.applicationContext.assets.openFd("$SAMPLES_DIR/$file").use { afd ->
                player.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
            }
            player.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build(),
            )
            // Released from the callback rather than left for the next play():
            // a sample that finishes on its own would otherwise hold a codec
            // until the next note.
            player.setOnCompletionListener { p ->
                synchronized(this) { if (current === p) current = null }
                p.release()
            }
            player.setOnErrorListener { p, what, extra ->
                Log.w(TAG, "Playback error for \"$noteName\" ($what/$extra).")
                synchronized(this) { if (current === p) current = null }
                p.release()
                true
            }
            player.prepare()
            player.start()
            current = player
        } catch (e: Exception) {
            // A missing or unplayable sample must never take the screen down;
            // the preview just does not sound.
            Log.w(TAG, "Couldn't play sample for \"$noteName\" ($file).", e)
            current = null
        }
    }

    /** Stops and releases whatever is sounding. Safe to call when nothing is. */
    @Synchronized
    fun stop() {
        val player = current ?: return
        current = null
        try {
            if (player.isPlaying) player.stop()
        } catch (e: IllegalStateException) {
            // Already stopped or never started; released below either way.
        }
        player.release()
    }
}
