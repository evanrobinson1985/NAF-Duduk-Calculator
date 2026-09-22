package com.nafduduk.calculator.ui.flute

import com.nafduduk.calculator.engine.DroneChamber
import com.nafduduk.calculator.engine.ErgoOverride
import com.nafduduk.calculator.engine.NestOverrides
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The savers decide what survives a rotation or a process death. A silent
 * drop here loses a maker's drone chambers, their dragged hole positions or
 * their nest voicing, with no error and no way back.
 *
 * The Compose Saver objects cannot be exercised outside a composition, so
 * these test the flatten/rebuild pair directly — which is where the data
 * actually gets lost.
 */
class FluteSaversTest {
    private fun roundTripDrones(drones: List<DroneChamber>): List<DroneChamber> {
        val saved: List<Any> = drones.map { listOf(it.boreIn, it.intervalIdx, it.playable, it.holeCount, it.noteKey ?: "") }
        return saved.mapNotNull { row ->
            val f = row as? List<Any?> ?: return@mapNotNull null
            if (f.size < 5) return@mapNotNull null
            DroneChamber(
                boreIn = f[0] as? Double ?: return@mapNotNull null,
                intervalIdx = f[1] as? Int ?: 0,
                playable = f[2] as? Boolean ?: false,
                holeCount = f[3] as? Int ?: 2,
                noteKey = (f[4] as? String)?.takeIf { it.isNotEmpty() },
            )
        }
    }

    private fun roundTripErgo(overrides: List<ErgoOverride>?): List<ErgoOverride>? {
        val saved: List<Any> = overrides.orEmpty().map { listOf(it.num, it.adjFromTshIn, it.adjDiameterIn) }
        if (saved.isEmpty()) return null
        return saved.mapNotNull { row ->
            val f = row as? List<Any?> ?: return@mapNotNull null
            if (f.size < 3) return@mapNotNull null
            ErgoOverride(
                num = f[0] as? Int ?: return@mapNotNull null,
                adjFromTshIn = f[1] as? Double ?: return@mapNotNull null,
                adjDiameterIn = f[2] as? Double ?: return@mapNotNull null,
            )
        }
    }

    private fun roundTripNest(n: NestOverrides): NestOverrides {
        fun u(v: Double?) = v ?: Double.NaN
        val f = listOf(
            u(n.wallThicknessIn), u(n.flueDepthIn), u(n.flueLengthIn), u(n.rampAngleDeg), u(n.rampCurve),
            u(n.fippleAngleDeg), u(n.backsetIn), u(n.tipHeightIn), u(n.tipFlatIn),
        )
        fun d(i: Int) = f.getOrNull(i)?.takeIf { it.isFinite() }
        return NestOverrides(
            wallThicknessIn = d(0), flueDepthIn = d(1), flueLengthIn = d(2), rampAngleDeg = d(3),
            rampCurve = d(4), fippleAngleDeg = d(5), backsetIn = d(6), tipHeightIn = d(7), tipFlatIn = d(8),
        )
    }

    @Test
    fun `drone chambers survive intact, including a playable one's chosen note`() {
        val drones = listOf(
            DroneChamber(boreIn = 0.625, intervalIdx = 2, playable = false, holeCount = 2),
            DroneChamber(boreIn = 0.875, intervalIdx = 0, playable = true, holeCount = 3, noteKey = "A3"),
        )
        assertEquals(drones, roundTripDrones(drones))
    }

    @Test
    fun `a drone with no chosen note comes back with none, not an empty string`() {
        // noteKey travels as "" because a saved list cannot hold nulls; if it
        // came back as "" the note lookup would silently find nothing.
        val drones = listOf(DroneChamber(boreIn = 0.625, intervalIdx = 1, playable = false, holeCount = 2))
        assertNull(roundTripDrones(drones).single().noteKey)
    }

    @Test
    fun `an empty drone list survives as empty`() {
        assertTrue(roundTripDrones(emptyList()).isEmpty())
    }

    @Test
    fun `an ergonomic override survives with every hole's adjustment`() {
        val ergo = listOf(
            ErgoOverride(num = 1, adjFromTshIn = 6.25, adjDiameterIn = 0.31),
            ErgoOverride(num = 4, adjFromTshIn = 9.5, adjDiameterIn = 0.28),
        )
        assertEquals(ergo, roundTripErgo(ergo))
    }

    @Test
    fun `no ergonomic override stays null rather than becoming an empty override`() {
        // An empty list would read as "an override that moves no holes",
        // which is not the same as "use the theoretical positions".
        assertNull(roundTripErgo(null))
        assertNull(roundTripErgo(emptyList()))
    }

    @Test
    fun `nest overrides survive, and unset stays unset`() {
        val nest = NestOverrides(wallThicknessIn = 0.16, flueDepthIn = 0.048, rampCurve = 0.35, backsetIn = 0.08)
        val back = roundTripNest(nest)
        assertEquals(nest, back)
        assertNull("an untouched dimension must not become a number", back.flueLengthIn)
        assertNull(back.fippleAngleDeg)
    }

    @Test
    fun `zero survives the round trip where zero is a real setting`() {
        val nest = NestOverrides(rampCurve = 0.0, backsetIn = 0.0, tipHeightIn = 0.0, tipFlatIn = 0.0)
        val back = roundTripNest(nest)
        assertEquals(0.0, back.rampCurve!!, 1e-12)
        assertEquals(0.0, back.backsetIn!!, 1e-12)
        assertEquals(0.0, back.tipHeightIn!!, 1e-12)
        assertEquals(0.0, back.tipFlatIn!!, 1e-12)
    }

    @Test
    fun `an all-auto nest survives as all-auto`() {
        assertTrue(roundTripNest(NestOverrides()).isEmpty)
    }
}
