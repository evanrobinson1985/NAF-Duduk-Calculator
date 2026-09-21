package com.nafduduk.calculator.ui.theme

import androidx.compose.ui.graphics.Color

// Exact palette lifted from the web app's FlutePage inline styles (bg0/bg1/bg2,
// border, gold, amber, bone, muted, dim) so the Android UI reads identically.
val Bg0 = Color(0xFF0F0801)
val Bg1 = Color(0xFF1A1005)
val Bg2 = Color(0xFF241608)
val Border = Color(0xFF3A2A14)
val Gold = Color(0xFFF59E0B)
val Amber = Color(0xFFD97706)
val Bone = Color(0xFFE5D5B8)
val Muted = Color(0xFF8A7255)
val Dim = Color(0xFF4A3A26)

// Duduk page uses a slightly different gold/amber (e8a33d/c9842a) and bone
// (e8dcc8) — kept distinct so a future Duduk-specific theme variant can use it.
val DudukGold = Color(0xFFE8A33D)
val DudukAmber = Color(0xFFC9842A)
val DudukBone = Color(0xFFE8DCC8)
val DudukMuted = Color(0xFF9A8166)

val OnGold = Color(0xFF0F0801) // text color drawn on top of gold-filled controls
