package com.nafduduk.calculator.library

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import kotlin.random.Random

private const val PREFS_NAME = "naf_calculator_prefs"
private const val LIBRARY_KEY = "naf_calculator_instrument_library_v1"

/** kind: "flute" | "duduk". configJson is a kind-specific JSON blob (see FluteConfig/DudukConfig). */
data class LibraryItem(
    val id: String,
    val name: String,
    val kind: String,
    val savedAtIso: String,
    val configJson: String,
)

private fun prefs(context: Context) = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

/**
 * Ported from the web source's loadLibrary()/persistLibrary() (localStorage
 * under LIBRARY_STORAGE_KEY) — same JSON-array-of-entries shape, backed by
 * SharedPreferences instead since there's no browser storage on Android.
 */
fun loadLibrary(context: Context): List<LibraryItem> {
    val raw = prefs(context).getString(LIBRARY_KEY, null) ?: return emptyList()
    return try {
        val arr = JSONArray(raw)
        (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            LibraryItem(
                id = o.getString("id"),
                name = o.getString("name"),
                kind = o.getString("kind"),
                savedAtIso = o.getString("savedAt"),
                configJson = o.getString("config"),
            )
        }
    } catch (e: Exception) {
        emptyList()
    }
}

private fun persistLibrary(context: Context, items: List<LibraryItem>): Boolean {
    return try {
        val arr = JSONArray()
        items.forEach { item ->
            arr.put(
                JSONObject().apply {
                    put("id", item.id)
                    put("name", item.name)
                    put("kind", item.kind)
                    put("savedAt", item.savedAtIso)
                    put("config", item.configJson)
                },
            )
        }
        prefs(context).edit().putString(LIBRARY_KEY, arr.toString()).apply()
        true
    } catch (e: Exception) {
        false
    }
}

fun saveInstrumentToLibrary(context: Context, name: String, kind: String, configJson: String): LibraryItem? {
    val items = loadLibrary(context)
    val entry = LibraryItem(
        id = "${System.currentTimeMillis()}_${Random.nextInt(0, Int.MAX_VALUE).toString(36)}",
        name = name.trim().ifEmpty { "Untitled Instrument" },
        kind = kind,
        savedAtIso = Instant.now().toString(),
        configJson = configJson,
    )
    val updated = listOf(entry) + items
    return if (persistLibrary(context, updated)) entry else null
}

fun deleteInstrumentFromLibrary(context: Context, id: String): Boolean {
    val items = loadLibrary(context).filter { it.id != id }
    return persistLibrary(context, items)
}

fun renameInstrumentInLibrary(context: Context, id: String, newName: String): Boolean {
    val items = loadLibrary(context).map { if (it.id == id) it.copy(name = newName.trim().ifEmpty { it.name }) else it }
    return persistLibrary(context, items)
}
