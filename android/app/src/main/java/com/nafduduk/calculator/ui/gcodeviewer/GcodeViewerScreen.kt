package com.nafduduk.calculator.ui.gcodeviewer

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nafduduk.calculator.gcode.ParsedGcode
import com.nafduduk.calculator.gcode.SegmentType
import com.nafduduk.calculator.ui.common.FieldLabel
import com.nafduduk.calculator.ui.common.MutedNote
import com.nafduduk.calculator.ui.common.ResultRow
import com.nafduduk.calculator.ui.common.SectionCard
import com.nafduduk.calculator.ui.theme.Bg2
import com.nafduduk.calculator.ui.theme.Bone
import com.nafduduk.calculator.ui.theme.Border
import com.nafduduk.calculator.ui.theme.Gold
import com.nafduduk.calculator.ui.theme.Muted
import com.nafduduk.calculator.ui.theme.OnGold
import com.nafduduk.calculator.util.jsFmt
import kotlinx.coroutines.delay

private val Back = Color(0xFF0C0600)
private val RapidColor = Color(0xFF4A3A26)
private val CutColor = Color(0xFFF59E0B)
private val DoneColor = Color(0xFF7ACC44)
private val ToolColor = Color(0xFFE5D5B8)
private val WarnColor = Color(0xFFD4A05A)

/**
 * The toolpath viewer: what the machine will actually do, before it does it.
 *
 * Simulating a program before cutting is how a maker catches a wrong work
 * zero or an inverted axis while it still costs nothing. Playback runs
 * through the motion segments in order, drawing what has been cut in green
 * behind the tool and what is still to come in amber ahead of it.
 *
 * Top view only (X/Y). The material-removal simulation the web source draws
 * in 3D is a larger piece of work and is what the milled-blank CAD export
 * needs; this is the part that makes a program readable.
 */
@Composable
fun GcodeViewerPanel(program: String, fileName: String, modifier: Modifier = Modifier) {
    val parsed = remember(program) { parseProgram(program) }
    if (parsed == null) {
        MutedNote("Nothing to show — the program is empty.")
        return
    }

    val runs = remember(parsed) { toolpathRuns(parsed) }
    val motions = remember(parsed) { motionSegments(parsed) }
    var progress by remember(parsed) { mutableFloatStateOf(1f) }
    var playing by remember(parsed) { mutableStateOf(false) }

    // Roughly twenty seconds end to end regardless of program length, so a
    // short program is watchable and a long one does not take all day.
    LaunchedEffect(playing, parsed) {
        if (!playing) return@LaunchedEffect
        if (progress >= 1f) progress = 0f
        while (playing && progress < 1f) {
            delay(16)
            progress = (progress + 1f / (20f * 60f)).coerceAtMost(1f)
        }
        playing = false
    }

    Column(modifier = modifier.fillMaxWidth()) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(1.6f)
                .border(1.dp, Border),
        ) {
            Canvas(modifier = Modifier.fillMaxSize()) {
                drawRect(Back, Offset.Zero, size)
                val proj = ToolpathProjection(parsed.bounds, size.width, size.height)
                drawToolpath(runs, proj)
                drawProgress(parsed, motions, proj, progress.toDouble())
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(
                onClick = { playing = !playing },
                colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = OnGold),
            ) { Text(if (playing) "⏸" else "▶", fontWeight = FontWeight.Bold) }
            Slider(
                value = progress,
                onValueChange = { progress = it; playing = false },
                modifier = Modifier.weight(1f),
                colors = SliderDefaults.colors(thumbColor = Gold, activeTrackColor = Gold, inactiveTrackColor = Bg2),
            )
        }

        val done = completedMotionCount(motions, progress.toDouble())
        ResultRow("Move", "$done of ${motions.size}")
        toolPositionAt(motions, progress.toDouble())?.let { p ->
            ResultRow(
                "Tool at",
                "X ${jsFmt(p.x, 3)}  Y ${jsFmt(p.y, 3)}  Z ${jsFmt(p.z, 3)} ${parsed.units}",
            )
        }
        ResultRow("Lines", "${parsed.lineCount}")
        ResultRow(
            "Cut envelope",
            "${jsFmt(parsed.cutBounds.sizeX, 2)} × ${jsFmt(parsed.cutBounds.sizeY, 2)} × " +
                "${jsFmt(parsed.cutBounds.sizeZ, 2)} ${parsed.units}",
        )
        if (parsed.stockBlocks.isNotEmpty()) {
            ResultRow("Blanks", parsed.stockBlocks.joinToString(", ") { it.label })
        }

        if (parsed.warnings.isNotEmpty()) {
            FieldLabel("Warnings")
            parsed.warnings.forEach {
                Text("⚠ $it", color = WarnColor, fontSize = 11.sp, lineHeight = 16.sp, modifier = Modifier.padding(bottom = 3.dp))
            }
        }
        MutedNote(
            "Top view (X/Y). Amber is still to cut, green is done, dim grey is rapid travel. " +
                "Simulate before you cut: a wrong work zero costs nothing to catch here.",
        )
    }
}

/** Returns null for a program with nothing in it, so the caller can say so. */
private fun parseProgram(program: String): ParsedGcode? {
    if (program.isBlank()) return null
    val parsed = com.nafduduk.calculator.gcode.parseGcode(program)
    return if (parsed.segments.none { it.isMotion }) null else parsed
}

private fun DrawScope.drawToolpath(runs: List<PathRun>, proj: ToolpathProjection) {
    // Rapids first, so cutting moves draw over them rather than under.
    for (pass in 0..1) {
        for (run in runs) {
            if (run.cutting != (pass == 1)) continue
            val path = Path()
            run.points.forEachIndexed { i, p ->
                val x = proj.x(p.x)
                val y = proj.y(p.y)
                if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            drawPath(
                path,
                if (run.cutting) CutColor else RapidColor,
                style = Stroke(width = if (run.cutting) 1.6f else 1f),
            )
        }
    }
}

/** Retraces the completed cutting moves in green, then marks the tool. */
private fun DrawScope.drawProgress(
    parsed: ParsedGcode,
    motions: List<com.nafduduk.calculator.gcode.GcodeSegment>,
    proj: ToolpathProjection,
    progress: Double,
) {
    val done = completedMotionCount(motions, progress)
    val path = Path()
    var open = false
    for (i in 0 until done) {
        val seg = motions[i]
        if (seg.type != SegmentType.FEED) { open = false; continue }
        val pts = if (seg.points.isNotEmpty()) seg.points else listOfNotNull(seg.from, seg.to)
        if (pts.size < 2) { open = false; continue }
        pts.forEachIndexed { j, p ->
            val x = proj.x(p.x)
            val y = proj.y(p.y)
            if (j == 0 && !open) path.moveTo(x, y) else path.lineTo(x, y)
        }
        open = true
    }
    drawPath(path, DoneColor, style = Stroke(width = 2f))

    toolPositionAt(motions, progress)?.let { p ->
        val c = Offset(proj.x(p.x), proj.y(p.y))
        drawCircle(ToolColor, 4f, c)
        drawCircle(Back, 2f, c)
    }
}
