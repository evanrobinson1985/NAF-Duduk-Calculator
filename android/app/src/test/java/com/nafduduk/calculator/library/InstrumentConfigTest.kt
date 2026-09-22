package com.nafduduk.calculator.library

import com.nafduduk.calculator.engine.DroneChamber
import com.nafduduk.calculator.engine.ErgoOverride
import com.nafduduk.calculator.engine.HandSize
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A saved instrument has to come back identical — a silent field drop here is
 * a maker losing a tuned design. Also covers hostile input, since these blobs
 * live in SharedPreferences where anything could have been written.
 */
class InstrumentConfigTest {
    private val full = FluteConfig(
        noteKey = "F#4", boreIn = 0.75, holeCount = 6, handSize = HandSize.COMPACT.name,
        fluteStyle = "drone",
        drones = listOf(
            DroneChamber(boreIn = 0.625, intervalIdx = 1, playable = false, holeCount = 2),
            DroneChamber(boreIn = 0.875, intervalIdx = 0, playable = true, holeCount = 3, noteKey = "A3"),
        ),
        summaryRootNote = "F#4", summaryMaterial = "antler", summaryIsDrone = true,
        holeShapeKey = "undercut",
        ergoOverride = listOf(
            ErgoOverride(num = 2, adjFromTshIn = 7.31, adjDiameterIn = 0.305),
            ErgoOverride(num = 3, adjFromTshIn = 8.42, adjDiameterIn = 0.281),
        ),
        a4 = 432.0,
    )

    @Test
    fun `flute config survives a JSON round trip field for field`() {
        val back = parseFluteConfig(full.toJson())
        assertNotNull("parse returned null", back)
        assertEquals(full, back)
    }

    @Test
    fun `drone entries keep their own note keys and hole counts`() {
        val back = parseFluteConfig(full.toJson())!!
        assertEquals(2, back.drones.size)
        assertNull("a silent drone must not gain a note key", back.drones[0].noteKey)
        assertEquals("A3", back.drones[1].noteKey)
        assertEquals(3, back.drones[1].holeCount)
        assertTrue(back.drones[1].playable)
    }

    @Test
    fun `ergonomic override and hole shape are persisted`() {
        val back = parseFluteConfig(full.toJson())!!
        assertEquals("undercut", back.holeShapeKey)
        assertEquals(2, back.ergoOverride!!.size)
        assertEquals(7.31, back.ergoOverride!![0].adjFromTshIn, 1e-9)
        assertEquals(0.281, back.ergoOverride!![1].adjDiameterIn, 1e-9)
    }

    @Test
    fun `a4 reference is persisted`() {
        assertEquals(432.0, parseFluteConfig(full.toJson())!!.a4, 1e-9)
    }

    @Test
    fun `saves written before these fields existed still load`() {
        // Exactly what the previous version wrote: no holeShape, no ergo, no a4.
        val legacy = """
            {"noteKey":"A4","boreIn":0.625,"holeCount":6,"handSize":"AVERAGE","fluteStyle":"single",
             "drones":[],"summary":{"rootNote":"A4","holeCount":6,"material":"straight","isDrone":false}}
        """.trimIndent()
        val back = parseFluteConfig(legacy)
        assertNotNull("a legacy save must still parse", back)
        assertEquals("A4", back!!.noteKey)
        assertEquals("round", back.holeShapeKey)
        assertNull(back.ergoOverride)
        assertEquals(440.0, back.a4, 1e-9)
    }

    @Test
    fun `a corrupted hand size falls back instead of crashing`() {
        val weird = """{"noteKey":"A4","boreIn":0.625,"holeCount":6,"handSize":"enormous","fluteStyle":"single","drones":[]}"""
        val back = parseFluteConfig(weird)
        assertNotNull(back)
        // Must be usable by the screen, which calls HandSize.valueOf on it.
        HandSize.valueOf(back!!.handSize)
    }

    @Test
    fun `malformed input returns null rather than throwing`() {
        for (bad in listOf("", "   ", "{not json", "[]", "null", "{}", """{"noteKey":"A4"}""")) {
            assertNull("should reject: $bad", parseFluteConfig(bad))
        }
    }

    @Test
    fun `duduk config survives a round trip and rejects junk`() {
        val cfg = DudukConfig(
            styleId = "traditional", boreIn = 0.7, noteKey = "A3", reedLenIn = 1.6,
            summaryRootNote = "A3", summaryStyle = "Traditional Armenian",
        )
        assertEquals(cfg, parseDudukConfig(cfg.toJson()))
        for (bad in listOf("", "{oops", "[]", "{}")) assertNull("should reject: $bad", parseDudukConfig(bad))
    }

    @Test
    fun `the SAC and mouthpiece overrides survive a round trip, and absent means auto`() {
        val withOverrides = FluteConfig(
            noteKey = "A4", boreIn = 0.625, holeCount = 6, handSize = "AVERAGE", fluteStyle = "single",
            drones = emptyList(), summaryRootNote = "A4", summaryMaterial = "straight", summaryIsDrone = false,
            sacLenIn = 3.75, mouthpieceMarginIn = 1.25,
        )
        val back = parseFluteConfig(withOverrides.toJson())!!
        assertEquals(3.75, back.sacLenIn!!, 1e-9)
        assertEquals(1.25, back.mouthpieceMarginIn!!, 1e-9)

        // Null must not be written at all, so an old reader sees "no override"
        // rather than a zero it would treat as a real value.
        val auto = withOverrides.copy(sacLenIn = null, mouthpieceMarginIn = null)
        val json = auto.toJson()
        assertFalse(json.contains("sacLenIn"))
        assertFalse(json.contains("mouthpieceMarginIn"))
        assertNull(parseFluteConfig(json)!!.sacLenIn)
        assertNull(parseFluteConfig(json)!!.mouthpieceMarginIn)
    }

    @Test
    fun `a nonsense override in a saved entry is read as auto, not as a real value`() {
        // These blobs live in SharedPreferences and can be hand-edited.
        for (bad in listOf("0", "-2.5", "\"abc\"", "null")) {
            val json = """{"noteKey":"A4","boreIn":0.625,"holeCount":6,"sacLenIn":$bad}"""
            val c = parseFluteConfig(json)
            assertNotNull("a bad override must not sink the whole entry: $bad", c)
            assertNull("$bad must read as auto", c!!.sacLenIn)
        }
    }

    @Test
    fun `a duduk config carries its tuning reference`() {
        val c = DudukConfig(
            styleId = "traditional", boreIn = 0.65, noteKey = "A3", reedLenIn = 1.5,
            summaryRootNote = "A3", summaryStyle = "Traditional", a4 = 432.0,
        )
        assertEquals(432.0, parseDudukConfig(c.toJson())!!.a4, 1e-9)
        // An entry saved before the field existed still opens, at concert pitch.
        val legacy = """{"styleId":"traditional","boreIn":0.65,"noteKey":"A3","reedLenIn":1.5}"""
        assertEquals(440.0, parseDudukConfig(legacy)!!.a4, 1e-9)
    }
}
