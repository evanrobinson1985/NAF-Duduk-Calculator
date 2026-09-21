package com.nafduduk.calculator.engine

/**
 * Ported 1:1 from ALL_NOTES in the web source (antler_duduk_calculator jsx,
 * "SHARED CONSTANTS" section). Every note from C0 to E8 (101 total), from the
 * Native American Flute Database. `advanced` marks anything outside the
 * practical hand-held melody-flute range (octaves 3-5 through F) — the same
 * 30 notes the app has always offered by default (Baritone/Tenor/most of
 * Alto); everything else is real data but impractical for a one-piece
 * melody flute.
 */
data class Note(val name: String, val freq: Double, val family: String, val advanced: Boolean)

val NOTE_FAMILIES_ORDER = listOf(
    "Sub-bass", "Contrabass", "Bass", "Baritone", "Tenor", "Alto", "Soprano", "Sopranino", "Ultra",
)

val ALL_NOTES: List<Note> = listOf(
    Note("C0", 16.352, "Sub-bass", true), Note("C#0", 17.324, "Sub-bass", true),
    Note("D0", 18.354, "Sub-bass", true), Note("Eb0", 19.445, "Sub-bass", true),
    Note("E0", 20.602, "Sub-bass", true), Note("F0", 21.827, "Sub-bass", true),
    Note("F#0", 23.125, "Sub-bass", true), Note("G0", 24.5, "Sub-bass", true),
    Note("Ab0", 25.957, "Sub-bass", true), Note("A0", 27.5, "Sub-bass", true),
    Note("Bb0", 29.135, "Sub-bass", true), Note("B0", 30.868, "Sub-bass", true),
    Note("C1", 32.703, "Contrabass", true), Note("C#1", 34.648, "Contrabass", true),
    Note("D1", 36.708, "Contrabass", true), Note("Eb1", 38.891, "Contrabass", true),
    Note("E1", 41.203, "Contrabass", true), Note("F1", 43.654, "Contrabass", true),
    Note("F#1", 46.249, "Contrabass", true), Note("G1", 48.999, "Contrabass", true),
    Note("Ab1", 51.913, "Contrabass", true), Note("A1", 55.0, "Contrabass", true),
    Note("Bb1", 58.27, "Contrabass", true), Note("B1", 61.735, "Contrabass", true),
    Note("C2", 65.406, "Bass", true), Note("C#2", 69.296, "Bass", true),
    Note("D2", 73.416, "Bass", true), Note("Eb2", 77.782, "Bass", true),
    Note("E2", 82.407, "Bass", true), Note("F2", 87.307, "Bass", true),
    Note("F#2", 92.499, "Bass", true), Note("G2", 97.999, "Bass", true),
    Note("Ab2", 103.826, "Bass", true), Note("A2", 110.0, "Bass", true),
    Note("Bb2", 116.541, "Bass", true), Note("B2", 123.471, "Bass", true),
    Note("C3", 130.81, "Baritone", false), Note("C#3", 138.59, "Baritone", false),
    Note("D3", 146.83, "Baritone", false), Note("Eb3", 155.56, "Baritone", false),
    Note("E3", 164.81, "Baritone", false), Note("F3", 174.61, "Baritone", false),
    Note("F#3", 185.00, "Baritone", false), Note("G3", 196.00, "Baritone", false),
    Note("Ab3", 207.65, "Baritone", false), Note("A3", 220.00, "Baritone", false),
    Note("Bb3", 233.08, "Baritone", false), Note("B3", 246.94, "Baritone", false),
    Note("C4", 261.63, "Tenor", false), Note("C#4", 277.18, "Tenor", false),
    Note("D4", 293.66, "Tenor", false), Note("Eb4", 311.13, "Tenor", false),
    Note("E4", 329.63, "Tenor", false), Note("F4", 349.23, "Tenor", false),
    Note("F#4", 369.99, "Tenor", false), Note("G4", 392.00, "Tenor", false),
    Note("Ab4", 415.30, "Tenor", false), Note("A4", 440.00, "Tenor", false),
    Note("Bb4", 466.16, "Tenor", false), Note("B4", 493.88, "Tenor", false),
    Note("C5", 523.25, "Alto", false), Note("C#5", 554.37, "Alto", false),
    Note("D5", 587.33, "Alto", false), Note("Eb5", 622.25, "Alto", false),
    Note("E5", 659.25, "Alto", false), Note("F5", 698.46, "Alto", false),
    Note("F#5", 739.989, "Alto", true), Note("G5", 783.991, "Alto", true),
    Note("Ab5", 830.609, "Alto", true), Note("A5", 880.0, "Alto", true),
    Note("Bb5", 932.328, "Alto", true), Note("B5", 987.767, "Alto", true),
    Note("C6", 1046.502, "Soprano", true), Note("C#6", 1108.731, "Soprano", true),
    Note("D6", 1174.659, "Soprano", true), Note("Eb6", 1244.508, "Soprano", true),
    Note("E6", 1318.51, "Soprano", true), Note("F6", 1396.913, "Soprano", true),
    Note("F#6", 1479.978, "Soprano", true), Note("G6", 1567.982, "Soprano", true),
    Note("Ab6", 1661.219, "Soprano", true), Note("A6", 1760.0, "Soprano", true),
    Note("Bb6", 1864.655, "Soprano", true), Note("B6", 1975.533, "Soprano", true),
    Note("C7", 2093.005, "Sopranino", true), Note("C#7", 2217.461, "Sopranino", true),
    Note("D7", 2349.318, "Sopranino", true), Note("Eb7", 2489.016, "Sopranino", true),
    Note("E7", 2637.02, "Sopranino", true), Note("F7", 2793.826, "Sopranino", true),
    Note("F#7", 2959.955, "Sopranino", true), Note("G7", 3135.963, "Sopranino", true),
    Note("Ab7", 3322.438, "Sopranino", true), Note("A7", 3520.0, "Sopranino", true),
    Note("Bb7", 3729.31, "Sopranino", true), Note("B7", 3951.066, "Sopranino", true),
    Note("C8", 4186.009, "Ultra", true), Note("C#8", 4434.922, "Ultra", true),
    Note("D8", 4698.636, "Ultra", true), Note("Eb8", 4978.032, "Ultra", true),
    Note("E8", 5274.041, "Ultra", true),
)

/** getNotes(a4): re-pitches the whole table to a non-440 A4 reference. */
fun getNotes(a4: Double): List<Note> {
    val ratio = a4 / 440.0
    return ALL_NOTES.map { it.copy(freq = it.freq * ratio) }
}

private val NOTE_NAMES_CHROM = listOf("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")

data class NamedPitch(val name: String, val cents: Int)

/** noteNameFromFreq: nearest chromatic note name + cents offset, for an arbitrary A4. */
fun noteNameFromFreq(freq: Double, a4: Double = 440.0): NamedPitch {
    val semis = Math.round(12 * ln2(freq / a4)).toInt() + 69
    val oct = Math.floorDiv(semis, 12) - 1
    val idx = ((semis % 12) + 12) % 12
    val exactF = a4 * Math.pow(2.0, (semis - 69) / 12.0)
    val cents = Math.round(1200 * ln2(freq / exactF)).toInt()
    return NamedPitch(NOTE_NAMES_CHROM[idx] + oct, cents)
}

/** nearestNote: closest note (by cents distance) in a given note list. */
fun nearestNote(freq: Double, notes: List<Note>): NamedPitch {
    var best = notes[0]
    var minC = Double.POSITIVE_INFINITY
    for (n in notes) {
        val c = Math.abs(1200 * ln2(freq / n.freq))
        if (c < minC) { minC = c; best = n }
    }
    return NamedPitch(best.name, Math.round(1200 * ln2(freq / best.freq)).toInt())
}

internal fun ln2(x: Double): Double = Math.log(x) / Math.log(2.0)
