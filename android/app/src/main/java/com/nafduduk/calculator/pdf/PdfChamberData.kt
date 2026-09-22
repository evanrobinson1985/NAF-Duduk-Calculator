package com.nafduduk.calculator.pdf

import com.nafduduk.calculator.engine.FingerHole
import com.nafduduk.calculator.engine.NamedPitch

/** One chamber's PDF-export data — the fields drawScaleTemplate/drawCoverPage need per chamber. */
data class PdfChamber(
    val lengthIn: Double,
    val sacLenIn: Double,
    val boreIn: Double,
    val holes: List<FingerHole>,
    val playable: Boolean,
    val note: NamedPitch?,
    val label: String,
)

/** A secondary (drone/playable) chamber, as summarized on the cover page. */
data class PdfDroneSummary(
    val playable: Boolean,
    val holeCount: Int,
    val note: NamedPitch,
    val boreIn: Double,
    val totalLenIn: Double,
    val lengthIn: Double,
    val sacLenIn: Double,
    val holes: List<FingerHole>,
    val droneIntervalLabel: String,
)

data class FlutePdfData(
    val boreIn: Double,
    val lengthIn: Double,
    val holes: List<FingerHole>,
    val holeCount: Int,
    val rootNote: NamedPitch,
    val totalLenIn: Double,
    val sacLenIn: Double,
    val handSize: String,
    val antlerShape: String,
    val pipeMaterial: String, // "straight" | "antler"
    val fluteStyle: String, // "single" | "drone"
    val drones: List<PdfDroneSummary>,
    val a4: Double,
    val notes: List<com.nafduduk.calculator.engine.Note>,
)
