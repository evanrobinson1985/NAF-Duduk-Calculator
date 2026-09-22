package com.nafduduk.calculator.library

import android.content.Context
import com.nafduduk.calculator.engine.NestOverrides
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import kotlin.random.Random

private const val PREFS_NAME = "naf_calculator_prefs"
private const val NEST_KEY = "naf_calculator_nest_library_v1"
private const val NEST_SCHEMA_TAG = "naf-nest-v1"

/**
 * A saved nest: one maker's voicing, reusable across builds.
 *
 * A nest that speaks well is the hard-won part of a flute — most makers land
 * on one they trust and then cut it into every instrument they make. This is
 * that, stored the same way the instrument library is: a JSON array in
 * SharedPreferences, since Android has no localStorage.
 */
data class NestPreset(
    val id: String,
    val name: String,
    val savedAtIso: String,
    val nest: NestOverrides,
)

private fun prefs(context: Context) = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

/** Reads a nullable dimension; absent, non-finite or non-positive all mean "auto". */
private fun JSONObject.dim(key: String): Double? =
    if (!has(key)) null else optDouble(key, Double.NaN).takeIf { it.isFinite() && it > 0 }

/** Same, but zero is a legitimate value (a flat ramp, no backset, no tip flat). */
private fun JSONObject.dimAllowingZero(key: String): Double? =
    if (!has(key)) null else optDouble(key, Double.NaN).takeIf { it.isFinite() && it >= 0 }

/**
 * Parses one stored or imported nest. Deliberately permissive about the
 * wrapper — name, schema and savedAt are optional and unknown fields are
 * ignored — because a nest may arrive from a file someone was handed rather
 * than from this app's own storage. What it is strict about is the numbers:
 * anything unusable is dropped back to auto rather than carried into a cut.
 */
fun parseNestPreset(o: JSONObject): NestPreset? = try {
    NestPreset(
        id = o.optString("id").ifBlank { "imported_${System.currentTimeMillis()}" },
        name = o.optString("name").ifBlank { "Untitled Nest" },
        savedAtIso = o.optString("savedAt").ifBlank { Instant.now().toString() },
        nest = NestOverrides(
            wallThicknessIn = o.dim("wallThicknessIn"),
            flueDepthIn = o.dim("flueDepthIn"),
            flueLengthIn = o.dim("flueLengthIn"),
            rampAngleDeg = o.dim("rampAngleDeg"),
            rampCurve = o.dimAllowingZero("rampCurve"),
            fippleAngleDeg = o.dim("fippleAngleDeg"),
            backsetIn = o.dimAllowingZero("backsetIn"),
            tipHeightIn = o.dimAllowingZero("tipHeightIn"),
            tipFlatIn = o.dimAllowingZero("tipFlatIn"),
        ),
    )
} catch (e: Exception) {
    null
}

fun NestPreset.toJson(): JSONObject = JSONObject().apply {
    put("id", id)
    put("name", name)
    put("schema", NEST_SCHEMA_TAG)
    put("savedAt", savedAtIso)
    // Only what is actually set: an absent key is how this format says "auto",
    // and writing a zero instead would be read back as a real dimension.
    nest.wallThicknessIn?.let { put("wallThicknessIn", it) }
    nest.flueDepthIn?.let { put("flueDepthIn", it) }
    nest.flueLengthIn?.let { put("flueLengthIn", it) }
    nest.rampAngleDeg?.let { put("rampAngleDeg", it) }
    nest.rampCurve?.let { put("rampCurve", it) }
    nest.fippleAngleDeg?.let { put("fippleAngleDeg", it) }
    nest.backsetIn?.let { put("backsetIn", it) }
    nest.tipHeightIn?.let { put("tipHeightIn", it) }
    nest.tipFlatIn?.let { put("tipFlatIn", it) }
}

fun loadNestLibrary(context: Context): List<NestPreset> {
    val raw = prefs(context).getString(NEST_KEY, null) ?: return emptyList()
    return try {
        val arr = JSONArray(raw)
        (0 until arr.length()).mapNotNull { i -> parseNestPreset(arr.getJSONObject(i)) }
    } catch (e: Exception) {
        // A corrupted blob loses the saved nests, not the app.
        emptyList()
    }
}

private fun persistNestLibrary(context: Context, items: List<NestPreset>): Boolean = try {
    val arr = JSONArray()
    items.forEach { arr.put(it.toJson()) }
    prefs(context).edit().putString(NEST_KEY, arr.toString()).apply()
    true
} catch (e: Exception) {
    false
}

fun saveNestToLibrary(context: Context, name: String, nest: NestOverrides): NestPreset? {
    val entry = NestPreset(
        id = "${System.currentTimeMillis()}_${Random.nextInt(0, Int.MAX_VALUE).toString(36)}",
        name = name.trim().ifEmpty { "Untitled Nest" },
        savedAtIso = Instant.now().toString(),
        nest = nest,
    )
    return if (persistNestLibrary(context, listOf(entry) + loadNestLibrary(context))) entry else null
}

fun deleteNestFromLibrary(context: Context, id: String): Boolean =
    persistNestLibrary(context, loadNestLibrary(context).filter { it.id != id })
