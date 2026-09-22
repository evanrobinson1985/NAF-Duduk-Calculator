package com.nafduduk.calculator.ui.flute

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nafduduk.calculator.engine.Curve
import com.nafduduk.calculator.gcode.CNC_DIALECTS
import com.nafduduk.calculator.gcode.ChannelStyle
import com.nafduduk.calculator.gcode.CncSettings
import com.nafduduk.calculator.gcode.GcodeChamber
import com.nafduduk.calculator.gcode.GcodeMethod
import com.nafduduk.calculator.gcode.GcodeSetupMode
import com.nafduduk.calculator.gcode.OutlineMode
import com.nafduduk.calculator.gcode.SplitFit
import com.nafduduk.calculator.gcode.SplitStyle
import com.nafduduk.calculator.gcode.buildGcodePrograms
import com.nafduduk.calculator.gcode.resolve
import com.nafduduk.calculator.gcode.toolSafetyWarning
import com.nafduduk.calculator.ui.common.FieldLabel
import com.nafduduk.calculator.ui.common.MutedNote
import com.nafduduk.calculator.ui.common.Pill
import com.nafduduk.calculator.ui.theme.Bg2
import com.nafduduk.calculator.ui.theme.Bone
import com.nafduduk.calculator.ui.theme.Border
import com.nafduduk.calculator.ui.theme.Gold
import com.nafduduk.calculator.ui.theme.Muted
import com.nafduduk.calculator.ui.theme.OnGold
import com.nafduduk.calculator.util.jsFmt

private val EasyBg = Color(0xFF14251A)
private val EasyBorder = Color(0xFF3A5A3A)
private val EasyText = Color(0xFF7ACC44)
private val WarnBg = Color(0xFF2A1208)
private val WarnBorder = Color(0xFF7A4A30)
private val WarnText = Color(0xFFFCA5A5)
private val NoteAmber = Color(0xFFD4A05A)

/**
 * The full CNC export panel — a port of CNCExportPanel, which the Android
 * build previously had only a hard-coded slice of: two buttons that always
 * emitted Easy Mode, inches, GRBL, `only = "all"`, no outline pass and no
 * rotary option, even though both generators already accepted every one of
 * those parameters.
 *
 * Easy Mode stays on by default and derives every numeric field from the
 * flute's own bore and hole sizes. Turning it off reveals the same fields
 * the web source exposes, pre-filled with what Easy Mode would have chosen,
 * so switching to manual starts from a working program rather than a blank.
 *
 * A split-block job downloads as TWO programs, one per setup, because the
 * nest is on the face opposite the bore and the top blank has to be turned
 * over and re-zeroed. Shipping one combined file would invite running it
 * against the wrong work zero.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CncExportPanel(
    chambers: List<GcodeChamber>,
    curve: Curve,
    droneBody: String,
    onExport: (fileName: String, gcode: String) -> Unit,
) {
    var s by remember { mutableStateOf(CncSettings()) }
    var warning by remember { mutableStateOf<String?>(null) }

    // What Easy Mode would pick, used both to run it and to seed the manual
    // fields the moment it is switched off.
    val resolved = remember(s, chambers) { s.resolve(chambers) }
    val programs = remember(s, chambers, curve, droneBody) { buildGcodePrograms(s, chambers, curve, droneBody) }

    fun export(fileName: String, build: () -> String) {
        val w = toolSafetyWarning(resolved.toolDiameter, chambers)
        warning = w
        if (w == null) onExport(fileName, build())
    }

    FieldLabel("Machining Method")
    MethodChoice(s.method) { s = s.copy(method = it) }

    // ── Easy Mode ────────────────────────────────────────────────────
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 10.dp)
            .background(if (s.easyMode) EasyBg else Bg2, RoundedCornerShape(8.dp))
            .border(1.dp, if (s.easyMode) EasyBorder else Border, RoundedCornerShape(8.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                "✨ Easy Mode ${if (s.easyMode) "— ON" else "— off"}",
                color = if (s.easyMode) EasyText else Bone,
                fontWeight = FontWeight.ExtraBold, fontSize = 13.sp,
            )
            Text(
                if (s.easyMode) {
                    "Tool size, feeds, speeds and every other setting below are auto-selected from your " +
                        "flute's own bore and hole sizes for the most accurate result."
                } else {
                    "Set every parameter by hand below."
                },
                color = Muted, fontSize = 11.sp, lineHeight = 16.sp,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        Switch(
            checked = s.easyMode,
            // Switching to manual seeds the fields from what Easy Mode chose,
            // so the first manual program is a working one.
            onCheckedChange = { on -> s = if (on) s.copy(easyMode = true) else resolved.copy(easyMode = false) },
            colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = Color(0xFF4A7A3A)),
        )
    }

    // ── Split-block-only structural choices ──────────────────────────
    if (s.method == GcodeMethod.SPLIT) {
        FieldLabel("Sound mechanism")
        ChoiceRow(SplitStyle.entries, { it.label }, isSelected = { it == s.splitStyle }) { s = s.copy(splitStyle = it) }
        MutedNote(
            when (s.splitStyle) {
                SplitStyle.NEST_INSERT ->
                    "Embedded acoustic nest: a tall lower half carries the whole nest — bore, ramp, flue floor, " +
                        "SAC exit, ridge shaped to the inner roof radius. The thin upper shell gets the full " +
                        "rectangular nest window. No flip; each blank is cut single-sided. Drones get their own lane."
                SplitStyle.SYMMETRIC ->
                    "Basic drilled layout: two identical half-round blanks. SAC and bore are cut at exact size; " +
                        "blow hole, finger holes, flue, air-exit and TSH are cut ~2mm undersized as locating guides. " +
                        "The ramp and splitting edge are not machined — hand-carve and voice those yourself."
            },
        )

        FieldLabel("Bore Channel Style${if (s.easyMode) " (auto: ${resolved.channelStyle.label})" else ""}")
        ChoiceRow(ChannelStyle.entries, { it.label }, enabled = !s.easyMode, isSelected = { it == resolved.channelStyle }) {
            s = s.copy(channelStyle = it)
        }

        FieldLabel("Body outline pass")
        ChoiceRow(OutlineMode.entries, { it.label }, isSelected = { it == s.outlineMode }) { s = s.copy(outlineMode = it) }
        MutedNote(
            when (s.outlineMode) {
                OutlineMode.OFF -> "No outline pass — the blanks keep their rectangular faces."
                OutlineMode.SCRIBE ->
                    "One deep reference groove of the finished body's silhouette, traced dead-centre as the " +
                        "job's last pass — the line to saw and round the glue-up to."
                OutlineMode.CUTOUT ->
                    "Profile-cuts the body silhouette clear through both blanks as the job's last passes, " +
                        "tool-radius compensated outward. Six tabs per half stay standing so each body half " +
                        "remains attached to the waste rails carrying the alignment pins — glue up with the " +
                        "pins still registered, then break or saw the tabs off."
            },
        )

        ToggleRow(
            checked = s.alignPins,
            onCheckedChange = { s = s.copy(alignPins = it) },
            title = "Add alignment pins (airtight glue-up)",
            detail = "auto-sized dowels (${SplitFit.pinSizes.joinToString("/") { "$it″" }}) · snug in the bottom " +
                "half, +${SplitFit.slipClearance}″/side slip fit in the top",
        )
    }

    // ── Tube-only setup choice ───────────────────────────────────────
    if (s.method == GcodeMethod.TUBE) {
        FieldLabel("CNC Setup${if (s.easyMode) " (auto: ${resolved.setupMode.label})" else ""}")
        ChoiceRow(GcodeSetupMode.entries, { it.label }, enabled = !s.easyMode, isSelected = { it == resolved.setupMode }) {
            s = s.copy(setupMode = it)
        }
        if (resolved.setupMode == GcodeSetupMode.FIXED) {
            Text(
                "The program pauses (M0) before every hole so you can rotate the tube by hand and re-clamp — " +
                    "check each comment for the required angle.",
                color = NoteAmber, fontSize = 11.sp, lineHeight = 16.sp, modifier = Modifier.padding(top = 6.dp),
            )
        } else if (s.easyMode) {
            MutedNote(
                "Rotary is selected because it's the more accurate, repeatable option — switch Easy Mode off " +
                    "if you only have a 3-axis machine.",
            )
        }
    }

    // ── Controller + units ───────────────────────────────────────────
    FieldLabel("Controller / Dialect")
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        CNC_DIALECTS.forEach { (id, d) ->
            Pill(text = d.label, selected = s.dialect == id, onClick = { s = s.copy(dialect = id) })
        }
    }

    FieldLabel("Units")
    ChoiceRow(listOf("in" to "inches", "mm" to "mm"), { it.second }, isSelected = { it.first == s.units }) {
        s = s.copy(units = it.first)
    }

    // ── Numeric parameters ───────────────────────────────────────────
    FieldLabel(if (s.easyMode) "Parameters (auto — switch Easy Mode off to edit)" else "Parameters")
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        NumberField("Tool Ø (in)", resolved.toolDiameter, 4, !s.easyMode) { s = s.copy(toolDiameter = it) }
        NumberField("Spindle (RPM)", resolved.spindleSpeed, 0, !s.easyMode) { s = s.copy(spindleSpeed = it) }
        NumberField("Feed (in/min)", resolved.feedRate, 1, !s.easyMode) { s = s.copy(feedRate = it) }
        NumberField("Plunge (in/min)", resolved.plungeRate, 1, !s.easyMode) { s = s.copy(plungeRate = it) }
        NumberField("Safe Height (in)", resolved.safeHeight, 3, !s.easyMode) { s = s.copy(safeHeight = it) }
        if (s.method == GcodeMethod.SPLIT) {
            NumberField("Stepdown (in)", resolved.stepdown, 3, !s.easyMode) { s = s.copy(stepdown = it) }
            NumberField("Stock Margin X (in)", resolved.stockMarginX, 3, !s.easyMode) { s = s.copy(stockMarginX = it) }
            NumberField("Stock Margin Y (in)", resolved.stockMarginY, 3, !s.easyMode) { s = s.copy(stockMarginY = it) }
        } else {
            NumberField("Peck Depth (in)", resolved.peckDepth, 3, !s.easyMode) { s = s.copy(peckDepth = it) }
            NumberField("Retract Height (in)", resolved.retractHeight, 3, !s.easyMode) { s = s.copy(retractHeight = it) }
        }
    }

    warning?.let {
        Text(
            it,
            color = WarnText, fontSize = 11.5.sp, lineHeight = 16.sp,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 10.dp)
                .background(WarnBg, RoundedCornerShape(6.dp))
                .border(1.dp, WarnBorder, RoundedCornerShape(6.dp))
                .padding(horizontal = 12.dp, vertical = 9.dp),
        )
    }

    // ── The programs ─────────────────────────────────────────────────
    if (s.method == GcodeMethod.SPLIT) {
        FieldLabel("Two setups, two programs")
        MutedNote(
            "The nest is on the face opposite the bore, so the top half must be turned over and re-zeroed. " +
                "Each setup ships as its own file so neither can be run against the wrong work zero. Run them in order.",
        )
    }
    programs.forEach { p ->
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(p.label, color = Bone, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                Text(p.blurb, color = Muted, fontSize = 10.sp, lineHeight = 14.sp)
            }
            Button(
                onClick = { export(p.fileName, p.build) },
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (p.key == "all") Bg2 else Gold,
                    contentColor = if (p.key == "all") Bone else OnGold,
                ),
            ) { Text("⬇", fontWeight = FontWeight.Bold) }
        }
    }

    MutedNote(
        "Uses explicit move sequences rather than canned drilling cycles (G81/G83), so the output runs " +
            "correctly on every dialect above — including GRBL, which doesn't support canned cycles at all.",
    )
}

@Composable
private fun MethodChoice(selected: GcodeMethod, onSelect: (GcodeMethod) -> Unit) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        listOf(
            GcodeMethod.SPLIT to ("🪵 Split-Block Milling" to "Mill both halves from flat stock, then glue up"),
            GcodeMethod.TUBE to ("🧵 Pre-Cut Tube Drilling" to "Drill holes into stock already cut to length"),
        ).forEach { (method, text) ->
            val on = selected == method
            Column(
                modifier = Modifier
                    .weight(1f)
                    .background(if (on) Gold else Bg2, RoundedCornerShape(8.dp))
                    .border(1.dp, if (on) Gold else Border, RoundedCornerShape(8.dp))
                    .clickable { onSelect(method) }
                    .padding(horizontal = 10.dp, vertical = 9.dp),
            ) {
                Text(text.first, color = if (on) OnGold else Bone, fontWeight = FontWeight.ExtraBold, fontSize = 12.sp)
                Text(
                    text.second,
                    color = if (on) OnGold.copy(alpha = 0.75f) else Muted,
                    fontSize = 10.sp, lineHeight = 13.sp,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
    }
}

@Composable
private fun <T> ChoiceRow(
    options: List<T>,
    label: (T) -> String,
    enabled: Boolean = true,
    isSelected: (T) -> Boolean,
    onSelect: (T) -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        options.forEach { opt ->
            androidx.compose.foundation.layout.Box(modifier = Modifier.weight(1f)) {
                Pill(text = label(opt), selected = isSelected(opt), onClick = { if (enabled) onSelect(opt) })
            }
        }
    }
}

@Composable
private fun ToggleRow(checked: Boolean, onCheckedChange: (Boolean) -> Unit, title: String, detail: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 10.dp)
            .background(Bg2, RoundedCornerShape(8.dp))
            .border(1.dp, Border, RoundedCornerShape(8.dp))
            .clickable { onCheckedChange(!checked) }
            .padding(horizontal = 12.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, color = Bone, fontWeight = FontWeight.Bold, fontSize = 12.5.sp)
            Text(detail, color = Muted, fontSize = 10.5.sp, lineHeight = 14.sp)
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(checkedThumbColor = OnGold, checkedTrackColor = Gold),
        )
    }
}

/**
 * A numeric field that keeps the typed text while editing (so a half-typed
 * "0." is not snapped back) and only reports a value once it parses.
 * Disabled in Easy Mode, where it shows what Easy Mode chose.
 */
@Composable
private fun NumberField(label: String, value: Double, decimals: Int, enabled: Boolean, onValue: (Double) -> Unit) {
    val shown = jsFmt(value, decimals)
    var text by remember(enabled, shown) { mutableStateOf(shown) }
    Column(modifier = Modifier.width(150.dp)) {
        Text(label, color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        OutlinedTextField(
            value = if (enabled) text else shown,
            onValueChange = { t ->
                text = t
                t.toDoubleOrNull()?.let { if (it > 0) onValue(it) }
            },
            enabled = enabled,
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = Bone, unfocusedTextColor = Bone,
                disabledTextColor = Muted, disabledBorderColor = Border,
                focusedBorderColor = Gold, unfocusedBorderColor = Border,
            ),
        )
    }
}
