package com.nafduduk.calculator.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The nest resolver is shared by the 3D preview and the split-block CAM. If
 * the two ever resolve a dimension differently the preview lies about what
 * the machine will cut, so this pins the fallbacks and the clamps.
 */
class NestOverridesTest {
    private val bore = 0.75
    private val shW = FluteConst.soundHoleWidth(bore)

    private fun resolve(o: NestOverrides = NestOverrides()) = ResolvedNest(bore, shW, o)

    @Test
    fun `no overrides means the bore-derived formulas, unchanged`() {
        val n = resolve()
        assertEquals(maxOf(0.05, (bore / 2) * 0.28), n.wallThicknessIn, 1e-12)
        assertEquals(2 * shW, n.flueLengthIn, 1e-12)
        assertEquals(FluteConst.flueDepth(bore), n.flueDepthIn, 1e-12)
        assertEquals(FluteConst.SAC_EXIT_RAMP_ANGLE_DEG, n.rampAngleDeg, 1e-12)
        assertEquals("a straight ramp face", 0.0, n.rampCurve, 1e-12)
        assertEquals(35.0, n.fippleAngleDeg, 1e-12)
        assertEquals("no backset", 0.0, n.backsetIn, 1e-12)
        assertEquals(1.0 / 128, n.tipHeightIn, 1e-12)
        assertEquals(0.01, n.tipFlatIn, 1e-12)
        assertTrue(NestOverrides().isEmpty)
        assertFalse(NestOverrides(flueDepthIn = 0.04).isEmpty)
    }

    @Test
    fun `a sane override is used as given`() {
        val n = resolve(
            NestOverrides(
                wallThicknessIn = 0.2, flueDepthIn = 0.05, flueLengthIn = 0.9, rampAngleDeg = 12.0,
                rampCurve = 0.4, fippleAngleDeg = 28.0, backsetIn = 0.1, tipHeightIn = 0.02, tipFlatIn = 0.02,
            ),
        )
        assertEquals(0.2, n.wallThicknessIn, 1e-12)
        assertEquals(0.05, n.flueDepthIn, 1e-12)
        assertEquals(0.9, n.flueLengthIn, 1e-12)
        assertEquals(12.0, n.rampAngleDeg, 1e-12)
        assertEquals(0.4, n.rampCurve, 1e-12)
        assertEquals(28.0, n.fippleAngleDeg, 1e-12)
        assertEquals(0.1, n.backsetIn, 1e-12)
        assertEquals(0.02, n.tipHeightIn, 1e-12)
        assertEquals(0.02, n.tipFlatIn, 1e-12)
    }

    @Test
    fun `an unbuildable override is clamped rather than obeyed`() {
        val huge = resolve(
            NestOverrides(
                wallThicknessIn = 99.0, flueLengthIn = 99.0, rampCurve = 9.0,
                backsetIn = 99.0, tipHeightIn = 99.0, tipFlatIn = 99.0,
            ),
        )
        assertEquals("a wall thicker than the flute is not a wall", 0.5, huge.wallThicknessIn, 1e-12)
        assertEquals(2.0, huge.flueLengthIn, 1e-12)
        assertEquals(1.0, huge.rampCurve, 1e-12)
        assertTrue("backset cannot undercut the bore", huge.backsetIn <= bore / 3 + 1e-12)
        assertTrue("nor eat the flue", huge.backsetIn <= huge.flueLengthIn * 0.6 + 1e-12)
        assertTrue("the tip cannot rise above the flue it sits in", huge.tipHeightIn <= huge.flueDepthIn * 0.9 + 1e-12)
        assertEquals(0.06, huge.tipFlatIn, 1e-12)

        val tiny = resolve(NestOverrides(wallThicknessIn = 0.0001, flueLengthIn = 0.0001, rampCurve = -5.0))
        assertEquals(0.04, tiny.wallThicknessIn, 1e-12)
        assertEquals(0.1, tiny.flueLengthIn, 1e-12)
        assertEquals(0.0, tiny.rampCurve, 1e-12)
    }

    @Test
    fun `zero is a real setting where zero means something`() {
        // A flat ramp face, no backset and a tip with no flat are all real
        // choices, which is why these are nullable rather than defaulted to 0.
        val n = resolve(NestOverrides(rampCurve = 0.0, backsetIn = 0.0, tipHeightIn = 0.0, tipFlatIn = 0.0))
        assertEquals(0.0, n.rampCurve, 1e-12)
        assertEquals(0.0, n.backsetIn, 1e-12)
        assertEquals(0.0, n.tipHeightIn, 1e-12)
        assertEquals(0.0, n.tipFlatIn, 1e-12)
    }

    @Test
    fun `a zero or negative dimension that cannot be zero falls back to auto`() {
        // The web source's own `Number.isFinite(x) && x > 0` guard: a wall of
        // zero thickness is not a choice, it is an unset field.
        val auto = resolve()
        val n = resolve(NestOverrides(wallThicknessIn = 0.0, flueDepthIn = -1.0, flueLengthIn = 0.0, rampAngleDeg = 0.0, fippleAngleDeg = -3.0))
        assertEquals(auto.wallThicknessIn, n.wallThicknessIn, 1e-12)
        assertEquals(auto.flueDepthIn, n.flueDepthIn, 1e-12)
        assertEquals(auto.flueLengthIn, n.flueLengthIn, 1e-12)
        assertEquals(auto.rampAngleDeg, n.rampAngleDeg, 1e-12)
        assertEquals(auto.fippleAngleDeg, n.fippleAngleDeg, 1e-12)
    }
}
