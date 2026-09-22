package com.nafduduk.calculator.engine

/** Speed of sound, inches/sec at 68°F / 20°C — SPEED in the web source. */
const val SPEED_IN_PER_SEC = 13504.0

data class Bore(val label: String, val valIn: Double, val mm: Double)

// Capped at 2" — the flue-channel nest (and real NAF practice) tops out here.
val BORES: List<Bore> = listOf(
    Bore("3/8\"", 0.375, 9.5), Bore("7/16\"", 0.4375, 11.1),
    Bore("1/2\"", 0.5, 12.7), Bore("9/16\"", 0.5625, 14.3),
    Bore("5/8\"", 0.625, 15.9), Bore("11/16\"", 0.6875, 17.5),
    Bore("3/4\"", 0.75, 19.1), Bore("7/8\"", 0.875, 22.2),
    Bore("15/16\"", 0.9375, 23.8), Bore("1\"", 1.0, 25.4),
    Bore("1-1/8\"", 1.125, 28.6), Bore("1-1/4\"", 1.25, 31.8),
    Bore("1-3/8\"", 1.375, 34.9), Bore("1-1/2\"", 1.5, 38.1),
    Bore("1-3/4\"", 1.75, 44.5), Bore("2\"", 2.0, 50.8),
)

data class DroneInterval(val label: String, val ratio: Double, val desc: String)

val DRONE_INTERVALS: List<DroneInterval> = listOf(
    DroneInterval("5th Below Root", 2.0 / 3.0, "Most traditional NAF drone — deep warm bass"),
    DroneInterval("4th Below Root", 3.0 / 4.0, "Slightly higher bass drone, very warm"),
    DroneInterval("Octave Below", 0.5, "Deep bass — drone tube ≈ 2× melody length"),
    DroneInterval("Unison (Root)", 1.0, "Drone doubles the melody root exactly"),
    DroneInterval("4th Above Root", 4.0 / 3.0, "Bright open drone above the melody"),
    DroneInterval("5th Above Root", 3.0 / 2.0, "Bright harmony — shorter drone bore"),
)

data class HarmonyPreset(val id: String, val name: String, val icon: String, val intervals: List<Int>, val desc: String)

val HARMONY_PRESETS: List<HarmonyPreset> = listOf(
    HarmonyPreset(
        "traditional", "Traditional", "🪶", listOf(0),
        "Single 5th-below drone — the classic NAF sound. Deep, warm, unmistakably Native American flute.",
    ),
    HarmonyPreset(
        "deep", "Deep Duet", "🌊", listOf(2, 0),
        "Octave-below + 5th-below. Two bass drones stacked for a rich, resonant low end.",
    ),
    HarmonyPreset(
        "bright", "Bright Harmony", "☀️", listOf(3, 4),
        "Root + 4th-above. An open, airy pairing that sits above the melody instead of under it.",
    ),
    HarmonyPreset(
        "power", "Power Trio", "⚡", listOf(0, 3, 5),
        "5th-below, root, and 5th-above — a full power-chord spread across three chambers.",
    ),
)

data class ScaleHole(val num: Int, val interval: String, val ratio: Double)
data class ScaleConfig(val name: String, val holes: List<ScaleHole>)

/** SCALE_CONFIGS keyed by hole count (1..7), ported verbatim. */
val SCALE_CONFIGS: Map<Int, ScaleConfig> = mapOf(
    1 to ScaleConfig("1-Hole (Root · Octave)", listOf(ScaleHole(1, "Octave", 2.0000))),
    2 to ScaleConfig(
        "2-Hole (Root · 5th · Octave)",
        listOf(ScaleHole(2, "Perf 5th", 1.4983), ScaleHole(1, "Octave", 2.0000)),
    ),
    3 to ScaleConfig(
        "3-Hole Pentatonic (Root · 5th · Octave)",
        listOf(ScaleHole(3, "Min 3rd", 1.1892), ScaleHole(2, "Perf 5th", 1.4983), ScaleHole(1, "Octave", 2.0000)),
    ),
    4 to ScaleConfig(
        "4-Hole Pentatonic",
        listOf(
            ScaleHole(4, "Min 3rd", 1.1892), ScaleHole(3, "Perf 4th", 1.3348),
            ScaleHole(2, "Perf 5th", 1.4983), ScaleHole(1, "Octave", 2.0000),
        ),
    ),
    5 to ScaleConfig(
        "5-Hole Pentatonic Minor",
        listOf(
            ScaleHole(5, "Min 3rd", 1.1892), ScaleHole(4, "Perf 4th", 1.3348),
            ScaleHole(3, "Perf 5th", 1.4983), ScaleHole(2, "Min 7th", 1.7818),
            ScaleHole(1, "Octave", 2.0000),
        ),
    ),
    6 to ScaleConfig(
        "6-Hole Pentatonic Minor",
        listOf(
            ScaleHole(6, "Min 3rd", 1.1892), ScaleHole(5, "Perf 4th", 1.3348),
            ScaleHole(4, "Perf 5th", 1.4983), ScaleHole(3, "Min 7th", 1.7818),
            ScaleHole(2, "Octave", 2.0000), ScaleHole(1, "Maj 9th", 2.2449),
        ),
    ),
    7 to ScaleConfig(
        "7-Hole Diatonic",
        listOf(
            ScaleHole(7, "Maj 2nd", 1.1225), ScaleHole(6, "Min 3rd", 1.1892),
            ScaleHole(5, "Perf 4th", 1.3348), ScaleHole(4, "Perf 5th", 1.4983),
            ScaleHole(3, "Maj 6th", 1.6818), ScaleHole(2, "Min 7th", 1.7818),
            ScaleHole(1, "Octave", 2.0000),
        ),
    ),
)

/** tubeLen(freq, r): closed-end pipe length with the app's end-correction constant. */
fun tubeLen(freq: Double, r: Double): Double = (SPEED_IN_PER_SEC / (2 * freq)) - (0.6 * r)

const val BORE_SWEET_MIN = 10.0
const val BORE_SWEET_MAX = 24.0
const val BORE_HARD_MIN = 5.0
const val BORE_HARD_MAX = 52.0

data class BoreOption(val bore: Bore, val tubeLenIn: Double, val inHardRange: Boolean, val inSweetSpot: Boolean)

data class BoreRecommendation(
    val best: BoreOption,
    val options: List<BoreOption>,
    val reachesSweetSpot: Boolean,
    val extreme: Boolean,
    val extremeTooLong: Boolean,
    val extremeTooShort: Boolean,
)

/**
 * recommendedBores(freq): which BORES produce a comfortable, buildable tube
 * length for this frequency. Always returns a real "best" recommendation —
 * never null — ported 1:1 from the web source's fallback chain: prefer
 * sweet-spot (10"-24") options, then any hard-range (5"-52") option, then
 * the closest of ALL options if the key is simply too extreme for either.
 */
fun recommendedBores(freq: Double): BoreRecommendation {
    val all = BORES.map { b ->
        val tl = tubeLen(freq, b.valIn / 2)
        BoreOption(
            bore = b,
            tubeLenIn = tl,
            inHardRange = tl in BORE_HARD_MIN..BORE_HARD_MAX,
            inSweetSpot = tl in BORE_SWEET_MIN..BORE_SWEET_MAX,
        )
    }

    val options = all.filter { it.inHardRange }
    val sweetOptions = options.filter { it.inSweetSpot }
    val pool = sweetOptions.ifEmpty { options.ifEmpty { all } }
    val mid = (BORE_SWEET_MIN + BORE_SWEET_MAX) / 2
    val best = pool.reduce { a, b -> if (Math.abs(b.tubeLenIn - mid) < Math.abs(a.tubeLenIn - mid)) b else a }
    val extreme = !best.inHardRange

    return BoreRecommendation(
        best = best,
        options = all,
        reachesSweetSpot = sweetOptions.isNotEmpty(),
        extreme = extreme,
        extremeTooLong = extreme && best.tubeLenIn > BORE_HARD_MAX,
        extremeTooShort = extreme && best.tubeLenIn < BORE_HARD_MIN,
    )
}
