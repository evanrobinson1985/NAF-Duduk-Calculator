package com.nafduduk.calculator.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

// The web app has no light theme — it's always the dark bg0/bone/gold
// palette — so this Android theme mirrors that: one fixed dark scheme,
// isSystemInDarkTheme() is unused on purpose.
private val AppColorScheme = darkColorScheme(
    primary = Gold,
    onPrimary = OnGold,
    secondary = Amber,
    onSecondary = OnGold,
    background = Bg0,
    onBackground = Bone,
    surface = Bg1,
    onSurface = Bone,
    surfaceVariant = Bg2,
    onSurfaceVariant = Muted,
    outline = Border,
)

@Composable
fun NafDudukTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = AppColorScheme,
        typography = AppTypography,
        content = content,
    )
}
