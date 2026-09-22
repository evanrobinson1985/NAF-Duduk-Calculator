package com.nafduduk.calculator.ui.flute

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nafduduk.calculator.engine.NestOverrides
import com.nafduduk.calculator.engine.ResolvedNest
import com.nafduduk.calculator.library.deleteNestFromLibrary
import com.nafduduk.calculator.library.loadNestLibrary
import com.nafduduk.calculator.library.saveNestToLibrary
import com.nafduduk.calculator.ui.common.FieldLabel
import com.nafduduk.calculator.ui.common.MutedNote
import com.nafduduk.calculator.ui.theme.Bg2
import com.nafduduk.calculator.ui.theme.Bone
import com.nafduduk.calculator.ui.theme.Border
import com.nafduduk.calculator.ui.theme.Gold
import com.nafduduk.calculator.ui.theme.Muted
import com.nafduduk.calculator.ui.theme.OnGold
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
    val context = LocalContext.current
    var open by rememberSaveable { mutableStateOf(false) }
    val resolved = ResolvedNest(boreIn, soundHoleWidthIn, overrides)
    var presets by remember { mutableStateOf(loadNestLibrary(context)) }
    var saveOpen by remember { mutableStateOf(false) }
    var saveName by remember { mutableStateOf("") }
    var savedMsg by remember { mutableStateOf("") }

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

    // ── Saved nests ──────────────────────────────────────────────────
    // A nest that speaks well is the hard-won part of a flute, and most
    // makers reuse one across builds rather than re-deriving it.
    FieldLabel("Saved Nests")
    if (presets.isEmpty()) {
        MutedNote("None saved yet. Once a nest speaks the way you want, save it here and cut it into the next build.")
    } else {
        presets.forEach { preset ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(preset.name, color = Bone, fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
                    Text(describeNest(preset.nest), color = Muted, fontSize = 10.sp, lineHeight = 14.sp)
                }
                Button(
                    onClick = { onChange(preset.nest) },
                    colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = OnGold),
                ) { Text("Apply", fontSize = 11.sp, fontWeight = FontWeight.Bold) }
                Button(
                    onClick = {
                        deleteNestFromLibrary(context, preset.id)
                        presets = loadNestLibrary(context)
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Muted),
                ) { Text("✕", fontSize = 11.sp) }
            }
        }
    }

    if (!saveOpen) {
        Button(
            onClick = { saveOpen = true; savedMsg = "" },
            enabled = !overrides.isEmpty,
            colors = ButtonDefaults.buttonColors(
                containerColor = Bg2, contentColor = Bone,
                disabledContainerColor = Bg2, disabledContentColor = Muted,
            ),
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        ) {
            Text(
                if (overrides.isEmpty) "Adjust a dimension above to save a nest" else "💾 Save this nest",
                fontSize = 12.sp, fontWeight = FontWeight.Bold,
            )
        }
    } else {
        OutlinedTextField(
            value = saveName,
            onValueChange = { saveName = it },
            placeholder = { Text("e.g. \"Warm low-D nest\"", color = Muted, fontSize = 12.sp) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = Bone, unfocusedTextColor = Bone,
                focusedBorderColor = Gold, unfocusedBorderColor = Border,
            ),
        )
        Row(modifier = Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = {
                    val entry = saveNestToLibrary(context, saveName, overrides)
                    savedMsg = if (entry != null) "Saved as \"${entry.name}\"" else "Couldn't save — device storage may be full."
                    if (entry != null) {
                        presets = loadNestLibrary(context)
                        saveName = ""
                        saveOpen = false
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = OnGold),
                modifier = Modifier.weight(1f),
            ) { Text("Save") }
            Button(
                onClick = { saveOpen = false; saveName = "" },
                colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Muted),
                modifier = Modifier.weight(1f),
            ) { Text("Cancel") }
        }
    }
    if (savedMsg.isNotEmpty()) MutedNote(savedMsg)
}

/** A one-line summary of what a saved nest actually changes. */
private fun describeNest(n: NestOverrides): String {
    val parts = buildList {
        n.wallThicknessIn?.let { add("wall ${jsFmt(it, 3)}\"") }
        n.flueDepthIn?.let { add("flue ${jsFmt(it, 4)}\" deep") }
        n.flueLengthIn?.let { add("flue ${jsFmt(it, 3)}\" long") }
        n.rampAngleDeg?.let { add("ramp ${jsFmt(it, 1)}°") }
        n.rampCurve?.let { add("curve ${jsFmt(it, 2)}") }
        n.fippleAngleDeg?.let { add("edge ${jsFmt(it, 1)}°") }
        n.backsetIn?.let { add("backset ${jsFmt(it, 3)}\"") }
        n.tipHeightIn?.let { add("tip ${jsFmt(it, 4)}\"") }
        n.tipFlatIn?.let { add("flat ${jsFmt(it, 4)}\"") }
    }
    return if (parts.isEmpty()) "every dimension automatic" else parts.joinToString(" · ")
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
