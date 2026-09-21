package com.nafduduk.calculator.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nafduduk.calculator.ui.theme.Bg2
import com.nafduduk.calculator.ui.theme.Border
import com.nafduduk.calculator.ui.theme.Gold
import com.nafduduk.calculator.ui.theme.Muted
import com.nafduduk.calculator.ui.theme.OnGold

// Same five pages, same order and same per-tab accent colors as the web
// App()'s tab() helper (gold / #e8a33d / #7acc44 / #5aa7e0 / #38bdf8).
enum class AppTab(val emoji: String, val label: String, val activeBg: Color, val activeFg: Color) {
    Flute("🪈", "Flute", Gold, Color(0xFF0F0801)),
    Duduk("🎶", "Duduk", Color(0xFFE8A33D), Color(0xFF1A0E00)),
    Library("📚", "Library", Color(0xFF7ACC44), Color(0xFF0F1A08)),
    GCode("⚙", "G-Code", Color(0xFF5AA7E0), Color(0xFF04121F)),
    FlowStudio("💨", "Flow Studio", Color(0xFF38BDF8), Color(0xFF04121F)),
}

@Composable
fun AppTabBar(current: AppTab, onSelect: (AppTab) -> Unit) {
    androidx.compose.foundation.layout.Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color(0xFF0C0600))
            .padding(horizontal = 14.dp, vertical = 10.dp),
    ) {
        Text(
            text = "NAF Flute & Duduk Calculator",
            color = Muted,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            AppTab.entries.forEach { tab ->
                TabPill(tab = tab, selected = tab == current, onClick = { onSelect(tab) }, modifier = Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun TabPill(tab: AppTab, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    androidx.compose.foundation.layout.Box(
        modifier = modifier
            .clickable(onClick = onClick)
            .background(if (selected) tab.activeBg else Bg2, RoundedCornerShape(8.dp))
            .border(1.dp, if (selected) tab.activeBg else Border, RoundedCornerShape(8.dp))
            .padding(vertical = 10.dp, horizontal = 4.dp),
    ) {
        Text(
            text = "${tab.emoji} ${tab.label}",
            color = if (selected) tab.activeFg else Muted,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            maxLines = 1,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
