package com.nafduduk.calculator.ui.flute

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nafduduk.calculator.engine.NestOverrides
import com.nafduduk.calculator.engine.ResolvedNest
import com.nafduduk.calculator.ui.common.FieldLabel
import com.nafduduk.calculator.ui.common.MutedNote
import com.nafduduk.calculator.ui.theme.Bg2
import com.nafduduk.calculator.ui.theme.Bone
import com.nafduduk.calculator.ui.theme.Border
import com.nafduduk.calculator.ui.theme.Gold
import com.nafduduk.calculator.ui.theme.Muted
import com.nafduduk.calculator.util.jsFmt

/**
 * The nest voicing dimensions, each falling back to its bore-derived formula
 * when left blank. These are the numbers an experienced maker adjusts by feel
 * — they change how the flute speaks, not what pitch it plays — and until now
 * the Android build had no way to touch any of them even though both the 3D
 * preview and the split-block CAM already read every one.
 *
 * Each field's placeholder shows the value actually in use, so the panel
 * doubles as a readout of what the calculator picked.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NestOverridePanel(
    boreIn: Double,
    soundHoleWidthIn: Double,
    overrides: NestOverrides,
    onChange: (NestOverrides) -> Unit,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    val resolved = ResolvedNest(boreIn, soundHoleWidthIn, overrides)

    FieldLabel("Nest Voicing")
    MutedNote(
        "The nest is where the air leaves the slow-air chamber, crosses the flue and meets the splitting " +
            "edge. Every field below falls back to the bore-derived default when blank — the placeholder " +
            "is the value in use. These change the flute's voice, not its pitch.",
    )
    Button(
        onClick = { open = !open },
        colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Bone),
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
    ) {
        Text(
            if (open) "Hide nest dimensions" else "🪶 Nest dimensions${if (overrides.isEmpty) "" else " — overridden"}",
            fontWeight = FontWeight.Bold,
        )
    }

    if (!open) return

    FlowRow(
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        NestField("Wall thickness (in)", overrides.wallThicknessIn, resolved.wallThicknessIn, 3) {
            onChange(overrides.copy(wallThicknessIn = it))
        }
        NestField("Flue depth (in)", overrides.flueDepthIn, resolved.flueDepthIn, 4) {
            onChange(overrides.copy(flueDepthIn = it))
        }
        NestField("Flue length (in)", overrides.flueLengthIn, resolved.flueLengthIn, 3) {
            onChange(overrides.copy(flueLengthIn = it))
        }
        NestField("Ramp angle (°)", overrides.rampAngleDeg, resolved.rampAngleDeg, 1) {
            onChange(overrides.copy(rampAngleDeg = it))
        }
        NestField("Ramp curve (0-1)", overrides.rampCurve, resolved.rampCurve, 2, allowZero = true) {
            onChange(overrides.copy(rampCurve = it))
        }
        NestField("Splitting edge (°)", overrides.fippleAngleDeg, resolved.fippleAngleDeg, 1) {
            onChange(overrides.copy(fippleAngleDeg = it))
        }
        NestField("Backset (in)", overrides.backsetIn, resolved.backsetIn, 3, allowZero = true) {
            onChange(overrides.copy(backsetIn = it))
        }
        NestField("Tip height (in)", overrides.tipHeightIn, resolved.tipHeightIn, 4, allowZero = true) {
            onChange(overrides.copy(tipHeightIn = it))
        }
        NestField("Tip flat (in)", overrides.tipFlatIn, resolved.tipFlatIn, 4, allowZero = true) {
            onChange(overrides.copy(tipFlatIn = it))
        }
    }

    if (!overrides.isEmpty) {
        Button(
            onClick = { onChange(NestOverrides()) },
            colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Muted),
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
        ) { Text("↩ Reset every nest dimension to auto", fontSize = 12.sp) }
    }
}

/**
 * Blank means auto. `allowZero` is for the dimensions where zero is a real
 * setting rather than "unset" — a flat ramp face, no backset, a tip with no
 * flat — which is why they are nullable Doubles rather than defaulted to 0.
 */
@Composable
private fun NestField(
    label: String,
    value: Double?,
    inUse: Double,
    decimals: Int,
    allowZero: Boolean = false,
    onValue: (Double?) -> Unit,
) {
    var text by rememberSaveable { mutableStateOf(value?.let { jsFmt(it, decimals) } ?: "") }
    // Re-seed only when the value moves on its own (a reset, or a loaded
    // config) — not while it is being typed into.
    LaunchedEffect(value) {
        val typed = text.toDoubleOrNull()?.takeIf { allowZero || it > 0 }
        if (typed != value) text = value?.let { jsFmt(it, decimals) } ?: ""
    }
    Column(modifier = Modifier.width(158.dp)) {
        Text(label, color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        OutlinedTextField(
            value = text,
            onValueChange = { t ->
                text = t
                onValue(if (t.isBlank()) null else t.toDoubleOrNull()?.takeIf { allowZero || it > 0 })
            },
            placeholder = { Text("auto — ${jsFmt(inUse, decimals)}", color = Muted, fontSize = 12.sp) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = Bone, unfocusedTextColor = Bone,
                focusedBorderColor = Gold, unfocusedBorderColor = Border,
            ),
        )
    }
}
