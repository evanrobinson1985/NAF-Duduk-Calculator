package com.nafduduk.calculator.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import com.nafduduk.calculator.ui.theme.Amber
import com.nafduduk.calculator.ui.theme.Bg1
import com.nafduduk.calculator.ui.theme.Bg2
import com.nafduduk.calculator.ui.theme.Bone
import com.nafduduk.calculator.ui.theme.Border
import com.nafduduk.calculator.ui.theme.Dim
import com.nafduduk.calculator.ui.theme.Gold
import com.nafduduk.calculator.ui.theme.Muted

/** Mirrors the web app's `card` inline-style object: bg1 background, 1px border, rounded, padded. */
@Composable
fun SectionCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(Bg1, RoundedCornerShape(8.dp))
            .border(1.dp, Border, RoundedCornerShape(8.dp))
            .padding(horizontal = 16.dp, vertical = 14.dp),
        content = content,
    )
}

/** Mirrors the web app's `lbl` inline-style object: small uppercase amber label. */
@Composable
fun FieldLabel(text: String) {
    Text(
        text = text.uppercase(),
        color = Amber,
        fontSize = 10.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 0.8.sp,
        modifier = Modifier.padding(bottom = 8.dp),
    )
}

/** Mirrors the web app's `pill` inline-style factory: active = gold-filled, inactive = bg2/dim border. */
@Composable
fun Pill(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    enabled: Boolean = true,
    activeColor: Color = Gold,
) {
    Text(
        text = text,
        color = if (selected) Color(0xFF0F0801) else Bone,
        fontSize = 13.sp,
        fontWeight = FontWeight.Bold,
        textAlign = TextAlign.Center,
        modifier = Modifier
            .clickable(enabled = enabled, onClick = onClick)
            .background(if (selected) activeColor else Bg2, RoundedCornerShape(6.dp))
            .border(1.dp, if (selected) activeColor else Dim, RoundedCornerShape(6.dp))
            .padding(horizontal = 13.dp, vertical = 6.dp),
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PillRow(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    FlowRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) { content() }
}

@Composable
fun MutedNote(text: String) {
    Text(text = text, color = Muted, fontSize = 11.sp, lineHeight = 16.sp)
}

@Composable
fun ResultRow(label: String, value: String) {
    androidx.compose.foundation.layout.Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(text = label, color = Muted, fontSize = 12.sp)
        Text(text = value, color = Bone, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    }
}

/**
 * A checkbox-style toggle for a single preference, sized for a caption rather
 * than a section heading — used where the option explains itself in a line.
 */
@Composable
fun ToggleNote(checked: Boolean, onCheckedChange: (Boolean) -> Unit, label: String) {
    androidx.compose.foundation.layout.Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp)
            .clickable { onCheckedChange(!checked) },
        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(if (checked) "☑" else "☐", color = if (checked) Gold else Muted, fontSize = 14.sp)
        Text(label, color = Muted, fontSize = 11.sp, lineHeight = 16.sp)
    }
}
