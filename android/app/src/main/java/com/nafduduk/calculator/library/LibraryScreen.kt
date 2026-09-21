package com.nafduduk.calculator.library

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nafduduk.calculator.ui.common.MutedNote
import com.nafduduk.calculator.ui.common.Pill
import com.nafduduk.calculator.ui.common.PillRow
import com.nafduduk.calculator.ui.common.SectionCard
import com.nafduduk.calculator.ui.theme.Bg2
import com.nafduduk.calculator.ui.theme.Bone
import com.nafduduk.calculator.ui.theme.Border
import com.nafduduk.calculator.ui.theme.Dim
import com.nafduduk.calculator.ui.theme.Gold
import com.nafduduk.calculator.ui.theme.Muted
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * Ported from LibraryPage: saved builds (Flute + Duduk), filterable, with
 * Open/Rename/Delete actions. Backed by SharedPreferences (see
 * LibraryStorage.kt) rather than localStorage.
 */
@Composable
fun LibraryScreen(onLoad: (LibraryItem) -> Unit) {
    val context = LocalContext.current
    var items by remember { mutableStateOf(loadLibrary(context)) }
    var filter by remember { mutableStateOf("all") } // "all" | "flute" | "duduk"
    var renamingId by remember { mutableStateOf<String?>(null) }
    var renameValue by remember { mutableStateOf("") }
    var confirmDeleteId by remember { mutableStateOf<String?>(null) }

    fun refresh() { items = loadLibrary(context) }

    val filtered = items.filter { filter == "all" || it.kind == filter }
    val kindLabel = mapOf("flute" to "🪈 Flute", "duduk" to "🎶 Duduk")

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            "📚 Instrument Library",
            color = Gold,
            fontSize = 26.sp,
            fontWeight = FontWeight.Black,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            "Saved builds, stored on this device — load any of them back into the calculator anytime.",
            color = Muted,
            fontSize = 12.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )

        PillRow {
            Pill(text = "All", selected = filter == "all", onClick = { filter = "all" })
            Pill(text = "🪈 Flute", selected = filter == "flute", onClick = { filter = "flute" })
            Pill(text = "🎶 Duduk", selected = filter == "duduk", onClick = { filter = "duduk" })
        }

        if (filtered.isEmpty()) {
            SectionCard {
                MutedNote(
                    if (items.isEmpty()) {
                        "No saved instruments yet. Build something on the Flute or Duduk page, then hit \"Save to Library\"."
                    } else {
                        "No saved instruments match this filter."
                    },
                )
            }
        } else {
            filtered.forEach { item ->
                SectionCard {
                    if (renamingId == item.id) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            OutlinedTextField(
                                value = renameValue,
                                onValueChange = { renameValue = it },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedTextColor = Bone, unfocusedTextColor = Bone,
                                    focusedBorderColor = Gold, unfocusedBorderColor = Border,
                                ),
                            )
                            Button(
                                onClick = {
                                    renamingId?.let { renameInstrumentInLibrary(context, it, renameValue) }
                                    renamingId = null
                                    refresh()
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = androidx.compose.ui.graphics.Color(0xFF0F0801)),
                            ) { Text("Save") }
                        }
                    } else {
                        Text(item.name, color = Bone, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold)
                    }

                    val cfgSummary = when (item.kind) {
                        "flute" -> parseFluteConfig(item.configJson)?.let { c ->
                            "${c.summaryRootNote} · ${c.holeCount}-hole" +
                                (if (c.summaryMaterial == "antler") " · antler" else "") +
                                (if (c.summaryIsDrone) " · drone" else "")
                        }
                        "duduk" -> parseDudukConfig(item.configJson)?.let { c -> "${c.summaryRootNote} · ${c.summaryStyle}" }
                        else -> null
                    }
                    Text(
                        (kindLabel[item.kind] ?: item.kind) + (cfgSummary?.let { " · $it" } ?: ""),
                        color = Muted,
                        fontSize = 11.sp,
                    )
                    val savedAtLabel = try {
                        DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).format(
                            Instant.parse(item.savedAtIso).atZone(java.time.ZoneId.systemDefault()),
                        )
                    } catch (e: Exception) {
                        item.savedAtIso
                    }
                    Text("Saved $savedAtLabel", color = Dim, fontSize = 10.sp)

                    Row(modifier = Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Button(
                            onClick = { onLoad(item) },
                            colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = androidx.compose.ui.graphics.Color(0xFF0F0801)),
                        ) { Text("Open") }
                        Button(
                            onClick = { renamingId = item.id; renameValue = item.name },
                            colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Muted),
                        ) { Text("Rename") }
                        if (confirmDeleteId == item.id) {
                            Button(
                                onClick = { deleteInstrumentFromLibrary(context, item.id); confirmDeleteId = null; refresh() },
                                colors = ButtonDefaults.buttonColors(containerColor = androidx.compose.ui.graphics.Color(0xFF3A1808), contentColor = androidx.compose.ui.graphics.Color(0xFFFCA5A5)),
                            ) { Text("Confirm?") }
                        } else {
                            Button(
                                onClick = { confirmDeleteId = item.id },
                                colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Muted),
                            ) { Text("Delete") }
                        }
                    }
                }
            }
        }

        if (items.isNotEmpty()) {
            Text(
                "Saved instruments live on this device only — they won't sync to other devices, and clearing app data will remove them.",
                color = Dim,
                fontSize = 10.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
