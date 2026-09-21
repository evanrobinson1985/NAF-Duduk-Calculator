package com.nafduduk.calculator.ui.viewer3d

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.nafduduk.calculator.engine.ChamberGeometry
import com.nafduduk.calculator.engine.Curve
import com.nafduduk.calculator.mesh.CsgSolid
import com.nafduduk.calculator.mesh.buildChamberSolid
import com.nafduduk.calculator.mesh.exportGltf
import com.nafduduk.calculator.mesh.exportObj
import com.nafduduk.calculator.mesh.exportPly
import com.nafduduk.calculator.mesh.exportStl
import com.nafduduk.calculator.mesh.saveMeshAndShare
import com.nafduduk.calculator.ui.common.MutedNote
import com.nafduduk.calculator.ui.common.Pill
import com.nafduduk.calculator.ui.common.PillRow
import com.nafduduk.calculator.ui.theme.Bg2
import com.nafduduk.calculator.ui.theme.Bone
import com.nafduduk.calculator.ui.theme.Gold
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The Flute screen's "3D Preview" panel: builds the current chamber's CSG
 * solid (off the main thread — boolean mesh ops aren't free), renders it
 * with Filament, and exports it as STL/OBJ/PLY/glTF. See
 * ChamberMeshBuilder.kt's doc comment for what's simplified relative to
 * the web app's exact nest geometry, and Viewer3DView.kt's for the
 * Filament-API caveat.
 */
@Composable
fun Viewer3DPanel(geometry: ChamberGeometry, fileBaseName: String) {
    val context = LocalContext.current
    var curve by remember { mutableStateOf(Curve.STRAIGHT) }
    var solid by remember { mutableStateOf<CsgSolid?>(null) }
    var building by remember { mutableStateOf(true) }

    LaunchedEffect(geometry, curve) {
        building = true
        solid = withContext(Dispatchers.Default) { buildChamberSolid(geometry, curve) }
        building = false
    }

    Column {
        MutedNote("A simplified 3D preview: hollow bore, finger holes, and an approximated sound-hole/flue/ramp cut (not the exact machining-precision nest profile — see android/README.md). Pinch/drag to orbit, pan, and zoom.")

        PillRow(modifier = Modifier.padding(vertical = 8.dp)) {
            Pill(text = "Straight", selected = curve == Curve.STRAIGHT, onClick = { curve = Curve.STRAIGHT })
            Pill(text = "Slight curve", selected = curve == Curve.SLIGHT, onClick = { curve = Curve.SLIGHT })
            Pill(text = "Heavy curve", selected = curve == Curve.HEAVY, onClick = { curve = Curve.HEAVY })
        }

        val currentSolid = solid
        if (building || currentSolid == null) {
            Column(modifier = Modifier.fillMaxWidth().height(280.dp), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                CircularProgressIndicator(color = Gold)
                MutedNote("Building 3D model…")
            }
        } else {
            val gltfJson = remember(currentSolid) { exportGltf(currentSolid) }
            Viewer3DView(gltfJson = gltfJson, modifier = Modifier.fillMaxWidth().height(320.dp))

            Column(modifier = Modifier.padding(top = 10.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { saveMeshAndShare(context, exportStl(currentSolid, fileBaseName), "$fileBaseName.stl", "model/stl") },
                        colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = Color(0xFF0F0801)),
                        modifier = Modifier.weight(1f),
                    ) { Text("STL") }
                    Button(
                        onClick = { saveMeshAndShare(context, exportObj(currentSolid, fileBaseName), "$fileBaseName.obj", "model/obj") },
                        colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Bone),
                        modifier = Modifier.weight(1f),
                    ) { Text("OBJ") }
                }
                Row(modifier = Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { saveMeshAndShare(context, exportPly(currentSolid), "$fileBaseName.ply", "model/ply") },
                        colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Bone),
                        modifier = Modifier.weight(1f),
                    ) { Text("PLY") }
                    Button(
                        onClick = { saveMeshAndShare(context, exportGltf(currentSolid), "$fileBaseName.gltf", "model/gltf+json") },
                        colors = ButtonDefaults.buttonColors(containerColor = Bg2, contentColor = Bone),
                        modifier = Modifier.weight(1f),
                    ) { Text("glTF") }
                }
            }
        }
    }
}
