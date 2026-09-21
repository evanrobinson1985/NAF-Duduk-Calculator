package com.nafduduk.calculator.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val AppTypography = Typography(
    bodyLarge = TextStyle(fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 22.sp, color = Bone),
    bodyMedium = TextStyle(fontWeight = FontWeight.Normal, fontSize = 13.sp, lineHeight = 19.sp, color = Bone),
    labelSmall = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 10.sp,
        letterSpacing = 0.8.sp,
        color = Amber,
    ),
    titleLarge = TextStyle(fontWeight = FontWeight.Black, fontSize = 22.sp, color = Bone),
    titleMedium = TextStyle(fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Bone),
)
