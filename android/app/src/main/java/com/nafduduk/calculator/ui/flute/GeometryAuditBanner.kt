package com.nafduduk.calculator.ui.flute

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nafduduk.calculator.engine.FluteGeometryAudit
import com.nafduduk.calculator.engine.GeometryIssue
import com.nafduduk.calculator.ui.theme.Border
import com.nafduduk.calculator.ui.theme.Muted

private val GoodBg = Color(0xFF14251A)
private val GoodBorder = Color(0xFF3A5A3A)
private val GoodText = Color(0xFF7ACC44)
private val GoodBody = Color(0xFFA0E8B8)
private val WarnBg = Color(0xFF2A1208)
private val WarnBorder = Color(0xFF7A4A30)
private val WarnText = Color(0xFFFCA5A5)

/**
 * The verdict of the automatic geometry audit, matching the web source's
 * panel: a quiet green tick when everything already agreed, a list of what
 * was corrected when it did not, and an undo for a maker who meant it.
 *
 * `fixUndone` is deliberately not sticky across edits — the caller resets it
 * whenever the geometry changes, so an undo applies to the numbers it was
 * pressed for and nothing later.
 */
@Composable
fun GeometryAuditBanner(
    audit: FluteGeometryAudit,
    fixUndone: Boolean,
    onUndo: () -> Unit,
    onReapply: () -> Unit,
) {
    when {
        audit.wasValid -> Banner(GoodBg, GoodBorder) {
            Text(
                "✓ Geometry auto-validated — hole positions, sound-hole dimensions and SAC length all agree " +
                    "with the shared formulas used by every output (table, 3D, drilling template, PDF, G-code).",
                color = GoodText, fontSize = 11.5.sp, lineHeight = 16.sp,
            )
        }

        !fixUndone -> Banner(GoodBg, GoodBorder) {
            val n = audit.issues.size
            Text(
                "🔧 $n geometry issue${if (n == 1) "" else "s"} found & fixed automatically — " +
                    "every export below uses the corrected geometry.",
                color = GoodText, fontWeight = FontWeight.ExtraBold, fontSize = 11.5.sp, lineHeight = 16.sp,
                modifier = Modifier.padding(bottom = 6.dp),
            )
            IssueList(audit.fixes, GoodBody)
            if (audit.remaining.isNotEmpty()) {
                // Should never happen: every check has a canonical answer the
                // fix snaps to. Surfaced rather than swallowed if it does.
                Text(
                    "⚠ ${audit.remaining.size} still unresolved after the fix:",
                    color = WarnText, fontWeight = FontWeight.Bold, fontSize = 11.5.sp,
                    modifier = Modifier.padding(top = 6.dp),
                )
                IssueList(audit.remaining, WarnText)
            }
            Button(
                onClick = onUndo,
                modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent, contentColor = Muted),
                border = BorderStroke(1.dp, Border),
            ) {
                Text("↩ Undo fix — keep my original values", fontWeight = FontWeight.Bold, fontSize = 11.5.sp)
            }
        }

        else -> Banner(WarnBg, WarnBorder) {
            Text(
                "⚠ Fix undone — exports use YOUR original values, which failed these checks:",
                color = WarnText, fontWeight = FontWeight.ExtraBold, fontSize = 11.5.sp, lineHeight = 16.sp,
                modifier = Modifier.padding(bottom = 6.dp),
            )
            IssueList(audit.issues, WarnText)
            Button(
                onClick = onReapply,
                modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFF3A2A10),
                    contentColor = Color(0xFFFCD34D),
                ),
                border = BorderStroke(1.dp, Color(0xFFB7791F)),
            ) {
                Text("🔧 Re-apply the automatic fix", fontWeight = FontWeight.ExtraBold, fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun IssueList(items: List<GeometryIssue>, color: Color) {
    items.forEach {
        Text("• $it", color = color, fontSize = 11.5.sp, lineHeight = 16.sp, modifier = Modifier.padding(bottom = 3.dp))
    }
}

@Composable
private fun Banner(bg: Color, border: Color, content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(bg, RoundedCornerShape(6.dp))
            .border(1.dp, border, RoundedCornerShape(6.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) { content() }
}
