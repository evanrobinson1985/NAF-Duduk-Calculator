package com.nafduduk.calculator.audio

import com.nafduduk.calculator.engine.ALL_NOTES
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The sample map has to agree with the audio that actually ships. The web
 * source's did not — nine of its entries named files that were never in the
 * archive, and it silently played nothing for them. A map entry with no file
 * behind it is a button that does nothing, which reads as a broken app.
 */
class NoteSamplesTest {
    /**
     * Gradle runs unit tests from the module directory, but other runners use
     * the project or repository root, so look for the assets from each
     * ancestor of the working directory by every path that could reach them.
     */
    private val assetsDir: File = generateSequence(File(".").absoluteFile.normalize()) { it.parentFile }
        .flatMap { root ->
            sequenceOf(
                "src/main/assets/samples",
                "app/src/main/assets/samples",
                "android/app/src/main/assets/samples",
            ).map { File(root, it) }
        }
        .firstOrNull { it.isDirectory }
        ?: error("Couldn't find the samples assets directory from ${File(".").absolutePath}")

    @Test
    fun `every mapped note has a file that actually ships`() {
        val missing = NOTE_SAMPLES.filterValues { !File(assetsDir, it).isFile }
        assertTrue("mapped but not shipped: ${missing.keys.sorted()}", missing.isEmpty())
    }

    @Test
    fun `every mapped note is a real note name`() {
        val known = ALL_NOTES.map { it.name }.toSet()
        val unknown = NOTE_SAMPLES.keys.filter { it !in known }
        assertTrue("not a note this app knows: $unknown", unknown.isEmpty())
    }

    @Test
    fun `no two notes share a recording`() {
        val dupes = NOTE_SAMPLES.entries.groupBy { it.value }.filterValues { it.size > 1 }
        assertTrue("one file mapped to several notes: ${dupes.keys}", dupes.isEmpty())
    }

    @Test
    fun `the shipped audio is nearly all reachable`() {
        // One file — "Ultra-High E.mp3" — is deliberately unmapped because
        // its name does not say which octave it is. Anything else going
        // unmapped means a recording is sitting in the APK unused.
        val shipped = assetsDir.listFiles { f -> f.extension == "mp3" }!!.map { it.name }.toSet()
        val unmapped = shipped - NOTE_SAMPLES.values.toSet()
        assertEquals("unmapped recordings: ${unmapped.sorted()}", setOf("Ultra-High E.mp3"), unmapped)
    }

    @Test
    fun `hasNoteSample agrees with the map`() {
        assertTrue(hasNoteSample("A4"))
        assertTrue(NOTE_SAMPLES.keys.all { hasNoteSample(it) })
        // One of the nine the archive never carried.
        assertFalse("C3 has no recording and must not claim one", hasNoteSample("C3"))
        assertFalse(hasNoteSample("not a note"))
    }
}
