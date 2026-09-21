package com.nafduduk.calculator.library

import com.nafduduk.calculator.engine.DroneChamber
import org.json.JSONArray
import org.json.JSONObject

/** Everything needed to reconstruct the Flute screen's state, plus a `summary` block for the Library list row. */
data class FluteConfig(
    val noteKey: String,
    val boreIn: Double,
    val holeCount: Int,
    val handSize: String,
    val fluteStyle: String, // "single" | "drone"
    val drones: List<DroneChamber>,
    val summaryRootNote: String,
    val summaryMaterial: String,
    val summaryIsDrone: Boolean,
)

fun FluteConfig.toJson(): String = JSONObject().apply {
    put("noteKey", noteKey)
    put("boreIn", boreIn)
    put("holeCount", holeCount)
    put("handSize", handSize)
    put("fluteStyle", fluteStyle)
    put(
        "drones",
        JSONArray().apply {
            drones.forEach { d ->
                put(
                    JSONObject().apply {
                        put("boreIn", d.boreIn)
                        put("intervalIdx", d.intervalIdx)
                        put("playable", d.playable)
                        put("holeCount", d.holeCount)
                        if (d.noteKey != null) put("noteKey", d.noteKey)
                    },
                )
            }
        },
    )
    put(
        "summary",
        JSONObject().apply {
            put("rootNote", summaryRootNote)
            put("holeCount", holeCount)
            put("material", summaryMaterial)
            put("isDrone", summaryIsDrone)
        },
    )
}.toString()

fun parseFluteConfig(json: String): FluteConfig? = try {
    val o = JSONObject(json)
    val dronesArr = o.optJSONArray("drones") ?: JSONArray()
    val drones = (0 until dronesArr.length()).map { i ->
        val d = dronesArr.getJSONObject(i)
        DroneChamber(
            boreIn = d.getDouble("boreIn"),
            intervalIdx = d.getInt("intervalIdx"),
            playable = d.getBoolean("playable"),
            holeCount = d.optInt("holeCount", 2),
            noteKey = if (d.has("noteKey")) d.getString("noteKey") else null,
        )
    }
    FluteConfig(
        noteKey = o.getString("noteKey"),
        boreIn = o.getDouble("boreIn"),
        holeCount = o.getInt("holeCount"),
        handSize = o.optString("handSize", "AVERAGE"),
        fluteStyle = o.optString("fluteStyle", "single"),
        drones = drones,
        summaryRootNote = o.optJSONObject("summary")?.optString("rootNote") ?: "",
        summaryMaterial = o.optJSONObject("summary")?.optString("material") ?: "straight",
        summaryIsDrone = o.optJSONObject("summary")?.optBoolean("isDrone") ?: false,
    )
} catch (e: Exception) {
    null
}

/** Everything needed to reconstruct the Duduk screen's state. */
data class DudukConfig(
    val styleId: String,
    val boreIn: Double,
    val noteKey: String,
    val reedLenIn: Double,
    val summaryRootNote: String,
    val summaryStyle: String,
)

fun DudukConfig.toJson(): String = JSONObject().apply {
    put("styleId", styleId)
    put("boreIn", boreIn)
    put("noteKey", noteKey)
    put("reedLenIn", reedLenIn)
    put(
        "summary",
        JSONObject().apply {
            put("rootNote", summaryRootNote)
            put("style", summaryStyle)
        },
    )
}.toString()

fun parseDudukConfig(json: String): DudukConfig? = try {
    val o = JSONObject(json)
    DudukConfig(
        styleId = o.getString("styleId"),
        boreIn = o.getDouble("boreIn"),
        noteKey = o.getString("noteKey"),
        reedLenIn = o.getDouble("reedLenIn"),
        summaryRootNote = o.optJSONObject("summary")?.optString("rootNote") ?: "",
        summaryStyle = o.optJSONObject("summary")?.optString("style") ?: "",
    )
} catch (e: Exception) {
    null
}
