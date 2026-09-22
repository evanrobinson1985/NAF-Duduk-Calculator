package com.nafduduk.calculator.engine

/** One secondary (drone or playable) chamber's inputs — mirrors the web source's `drones` array entries. */
data class DroneChamber(
    val boreIn: Double,
    val intervalIdx: Int,
    val playable: Boolean,
    val holeCount: Int = 2,
    val noteKey: String? = null,
)

/** One secondary chamber's computed result — mirrors droneResults[i] in the web source. */
data class DroneResult(
    val idx: Int,
    val boreIn: Double,
    val intervalIdx: Int,
    val droneInterval: DroneInterval?,
    val lengthIn: Double,
    val note: NamedPitch?,
    val sacLenIn: Double,
    val totalLenIn: Double?,
    val shWIn: Double,
    val shLIn: Double,
    val playable: Boolean,
    val holeCount: Int,
    val holes: List<FingerHole>,
)

/**
 * Ported 1:1 from FlutePage's `droneResults` computation: each secondary
 * chamber gets its own bore + either a fixed interval off the melody root
 * (drone) or its own directly-chosen root note (playable), run through the
 * SAME authoritative buildChamberGeometry() as the melody chamber — SAC and
 * mouthpiece margin equalized to the melody chamber so every tube's TSH
 * lands at the same X and the nests sit in one row.
 *
 * A playable drone's finger holes ALIGN with the melody tube's (hole 1 <->
 * melody hole 1, etc. — one finger spans both tubes), not independently
 * placed by ratio.
 */
fun buildDroneResults(
    drones: List<DroneChamber>,
    rootFreq: Double,
    notes: List<Note>,
    handSize: HandSize,
    holeShapeKey: String,
    melodyGeom: ChamberGeometry,
): List<DroneResult> {
    return drones.mapIndexed { i, d ->
        var di: DroneInterval? = null
        val freq = if (d.playable) {
            notes.find { it.name == d.noteKey }?.freq ?: rootFreq
        } else {
            di = DRONE_INTERVALS[d.intervalIdx]
            rootFreq * (di?.ratio ?: 1.0)
        }

        val geom = buildChamberGeometry(
            bore = d.boreIn,
            freq = freq,
            holeCount = if (d.playable) d.holeCount else 0,
            handSize = handSize,
            holeShapeKey = holeShapeKey,
            ergoOverride = null,
            sacLenInOverride = melodyGeom.sacLenIn,
            mouthpieceMarginInOverride = melodyGeom.mouthpieceMarginIn,
        )

        val holes = if (d.playable) {
            val k = minOf(d.holeCount, melodyGeom.holes.size)
            val droneSac = geom.sacLenIn
            val droneL = geom.lengthIn
            melodyGeom.holes
                .filter { it.num <= k }
                .map { mh ->
                    val worldX = melodyGeom.sacLenIn + mh.fromTshIn
                    val ft = worldX - droneSac
                    mh.copy(fromTshIn = ft, fromFootIn = droneL - ft)
                }
                .filter { it.fromTshIn > 0.45 && it.fromTshIn < droneL - 0.25 }
        } else {
            emptyList()
        }

        DroneResult(
            idx = i, boreIn = d.boreIn, intervalIdx = d.intervalIdx, droneInterval = di,
            lengthIn = geom.lengthIn, note = if (geom.playable) nearestNote(freq, notes) else null,
            sacLenIn = geom.sacLenIn, totalLenIn = geom.totalLenIn, shWIn = geom.soundHoleWidthIn, shLIn = geom.soundHoleLengthIn,
            playable = d.playable, holeCount = d.holeCount, holes = holes,
        )
    }
}
