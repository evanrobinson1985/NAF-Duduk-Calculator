package com.nafduduk.calculator.ui.flute

import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.listSaver
import com.nafduduk.calculator.engine.DroneChamber
import com.nafduduk.calculator.engine.ErgoOverride
import com.nafduduk.calculator.engine.NestOverrides

/**
 * Savers for the Flute screen's non-primitive state.
 *
 * Without these, rotating the phone or coming back after Android reclaimed
 * the process silently resets a maker's drone chambers, their ergonomic hole
 * adjustment and their nest voicing back to defaults — losing work that is
 * not otherwise recoverable unless they had already saved to the library.
 *
 * Each value is flattened to a list of primitives, which is what the saved
 * instance state Bundle can actually hold.
 */

val DroneChamberListSaver: Saver<List<DroneChamber>, Any> = listSaver(
    save = { drones ->
        drones.map { listOf(it.boreIn, it.intervalIdx, it.playable, it.holeCount, it.noteKey ?: "") }
    },
    restore = { saved ->
        saved.mapNotNull { row ->
            @Suppress("UNCHECKED_CAST")
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
    },
)

val ErgoOverrideListSaver: Saver<List<ErgoOverride>?, Any> = listSaver(
    save = { overrides ->
        overrides.orEmpty().map { listOf(it.num, it.adjFromTshIn, it.adjDiameterIn) }
    },
    restore = { saved ->
        // An empty list is how "no override" is stored; restoring it as an
        // empty list rather than null would read as "override with no holes".
        if (saved.isEmpty()) {
            null
        } else {
            saved.mapNotNull { row ->
                @Suppress("UNCHECKED_CAST")
                val f = row as? List<Any?> ?: return@mapNotNull null
                if (f.size < 3) return@mapNotNull null
                ErgoOverride(
                    num = f[0] as? Int ?: return@mapNotNull null,
                    adjFromTshIn = f[1] as? Double ?: return@mapNotNull null,
                    adjDiameterIn = f[2] as? Double ?: return@mapNotNull null,
                )
            }
        }
    },
)

/**
 * Nine dimensions in a fixed order. A saved list cannot hold nulls, and zero
 * is a real setting on several of these, so "unset" travels as NaN — which
 * the nest resolver already treats as unset anyway.
 */
private const val UNSET = Double.NaN

private fun Double?.orUnset(): Double = this ?: UNSET
private fun List<Double>.dim(i: Int): Double? = getOrNull(i)?.takeIf { it.isFinite() }

val NestOverridesSaver: Saver<NestOverrides, Any> = listSaver(
    save = {
        listOf(
            it.wallThicknessIn.orUnset(), it.flueDepthIn.orUnset(), it.flueLengthIn.orUnset(),
            it.rampAngleDeg.orUnset(), it.rampCurve.orUnset(), it.fippleAngleDeg.orUnset(),
            it.backsetIn.orUnset(), it.tipHeightIn.orUnset(), it.tipFlatIn.orUnset(),
        )
    },
    restore = { f ->
        NestOverrides(
            wallThicknessIn = f.dim(0), flueDepthIn = f.dim(1), flueLengthIn = f.dim(2),
            rampAngleDeg = f.dim(3), rampCurve = f.dim(4), fippleAngleDeg = f.dim(5),
            backsetIn = f.dim(6), tipHeightIn = f.dim(7), tipFlatIn = f.dim(8),
        )
    },
)
