package com.nafduduk.calculator.library

import com.nafduduk.calculator.engine.DroneChamber
import com.nafduduk.calculator.engine.ErgoOverride
import com.nafduduk.calculator.engine.HandSize
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
    // Added after the first release. Saves written before these existed load
    // with the defaults below, so an older library entry still opens.
    val holeShapeKey: String = "round",
    /** A saved ergonomic hole adjustment; null means "theoretical positions". */
    val ergoOverride: List<ErgoOverride>? = null,
    val a4: Double = 440.0,
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
    put("holeShapeKey", holeShapeKey)
    put("a4", a4)
    if (ergoOverride != null) {
        put(
            "ergoOverride",
            JSONArray().apply {
                ergoOverride.forEach { o ->
                    put(
                        JSONObject().apply {
                            put("num", o.num)
                            put("adjFromTshIn", o.adjFromTshIn)
                            put("adjDiameterIn", o.adjDiameterIn)
                        },
                    )
                }
            },
        )
    }
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
            // Matches the web source's `d.holeCount || 2`: a zero or missing
            // count means "use the default", not "no holes".
            holeCount = d.optInt("holeCount", 2).let { if (it > 0) it else 2 },
            noteKey = if (d.has("noteKey")) d.getString("noteKey") else null,
        )
    }
    val ergoArr = o.optJSONArray("ergoOverride")
    val ergo = if (ergoArr == null) {
        null
    } else {
        (0 until ergoArr.length()).map { i ->
            val e = ergoArr.getJSONObject(i)
            ErgoOverride(
                num = e.getInt("num"),
                adjFromTshIn = e.getDouble("adjFromTshIn"),
                adjDiameterIn = e.getDouble("adjDiameterIn"),
            )
        }
    }
    FluteConfig(
        noteKey = o.getString("noteKey"),
        boreIn = o.getDouble("boreIn"),
        holeCount = o.getInt("holeCount"),
        // These blobs live in SharedPreferences, so a hand-edited or
        // half-written entry must not crash the screen that calls
        // HandSize.valueOf() on this.
        handSize = o.optString("handSize", HandSize.AVERAGE.name)
            .takeIf { name -> HandSize.entries.any { it.name == name } } ?: HandSize.AVERAGE.name,
        fluteStyle = o.optString("fluteStyle", "single").takeIf { it == "single" || it == "drone" } ?: "single",
        drones = drones,
        summaryRootNote = o.optJSONObject("summary")?.optString("rootNote") ?: "",
        summaryMaterial = o.optJSONObject("summary")?.optString("material") ?: "straight",
        summaryIsDrone = o.optJSONObject("summary")?.optBoolean("isDrone") ?: false,
        holeShapeKey = o.optString("holeShapeKey", "round").ifBlank { "round" },
        ergoOverride = ergo,
        a4 = o.optDouble("a4", 440.0).let { if (it.isFinite() && it > 0) it else 440.0 },
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
