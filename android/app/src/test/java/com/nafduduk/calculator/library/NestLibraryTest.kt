package com.nafduduk.calculator.library

import com.nafduduk.calculator.engine.NestOverrides
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A saved nest is a maker's voicing, carried between builds and sometimes
 * between people as a file. So the parser has to be permissive about the
 * wrapper and strict about the numbers: an unusable dimension must read as
 * "auto", never as a real measurement that gets cut into wood.
 */
class NestLibraryTest {
    private fun preset(nest: NestOverrides) = NestPreset("id1", "Warm low D", "2026-01-01T00:00:00Z", nest)

    @Test
    fun `a full nest round-trips exactly`() {
        val nest = NestOverrides(
            wallThicknessIn = 0.16, flueDepthIn = 0.048, flueLengthIn = 0.9, rampAngleDeg = 14.0,
            rampCurve = 0.35, fippleAngleDeg = 28.0, backsetIn = 0.08, tipHeightIn = 0.0078, tipFlatIn = 0.012,
        )
        val back = parseNestPreset(preset(nest).toJson())!!
        assertEquals("Warm low D", back.name)
        assertEquals("id1", back.id)
        assertEquals(nest, back.nest)
    }

    @Test
    fun `an unset dimension is left out rather than written as zero`() {
        // Absence is how this format says "auto". A zero would be read back as
        // a real dimension on every field where zero is meaningful.
        val json = preset(NestOverrides(flueDepthIn = 0.05)).toJson()
        assertTrue(json.has("flueDepthIn"))
        assertFalse(json.has("wallThicknessIn"))
        assertFalse(json.has("rampCurve"))
        assertEquals(NestOverrides(flueDepthIn = 0.05), parseNestPreset(json)!!.nest)
    }

    @Test
    fun `zero survives where zero is a real setting`() {
        val nest = NestOverrides(rampCurve = 0.0, backsetIn = 0.0, tipHeightIn = 0.0, tipFlatIn = 0.0)
        val back = parseNestPreset(preset(nest).toJson())!!
        assertEquals("a flat ramp face is a choice", 0.0, back.nest.rampCurve!!, 1e-12)
        assertEquals(0.0, back.nest.backsetIn!!, 1e-12)
        assertEquals(0.0, back.nest.tipHeightIn!!, 1e-12)
        assertEquals(0.0, back.nest.tipFlatIn!!, 1e-12)
    }

    @Test
    fun `a dimension that cannot be zero reads a zero as auto`() {
        val o = JSONObject("""{"name":"x","wallThicknessIn":0,"flueDepthIn":-1,"rampAngleDeg":0}""")
        val n = parseNestPreset(o)!!.nest
        assertNull("a wall of zero thickness is an unset field", n.wallThicknessIn)
        assertNull(n.flueDepthIn)
        assertNull(n.rampAngleDeg)
    }

    @Test
    fun `an imported file without the app's wrapper still loads`() {
        // Someone hands you a nest as a bare JSON object; name, id and
        // timestamp are this app's bookkeeping, not the maker's data.
        val bare = JSONObject("""{"flueDepthIn":0.045,"rampAngleDeg":12,"unknownField":"ignored"}""")
        val p = parseNestPreset(bare)
        assertNotNull(p)
        assertEquals("Untitled Nest", p!!.name)
        assertTrue(p.id.isNotBlank())
        assertTrue(p.savedAtIso.isNotBlank())
        assertEquals(0.045, p.nest.flueDepthIn!!, 1e-12)
        assertEquals(12.0, p.nest.rampAngleDeg!!, 1e-12)
    }

    @Test
    fun `garbage in a stored field does not take the whole nest down`() {
        val o = JSONObject("""{"name":"Odd","flueDepthIn":"not a number","rampAngleDeg":14}""")
        val p = parseNestPreset(o)!!
        assertNull("an unreadable dimension is auto", p.nest.flueDepthIn)
        assertEquals("the readable ones still load", 14.0, p.nest.rampAngleDeg!!, 1e-12)
    }

    @Test
    fun `an all-auto nest is preserved as all-auto`() {
        val back = parseNestPreset(preset(NestOverrides()).toJson())!!
        assertTrue(back.nest.isEmpty)
    }
}
