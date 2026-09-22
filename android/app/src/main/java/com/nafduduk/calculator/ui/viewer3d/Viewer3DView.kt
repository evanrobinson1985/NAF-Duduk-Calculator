package com.nafduduk.calculator.ui.viewer3d

import android.view.Choreographer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import com.google.android.filament.Colors
import com.google.android.filament.EntityManager
import com.google.android.filament.LightManager
import com.google.android.filament.Skybox
import com.google.android.filament.utils.ModelViewer
import com.google.android.filament.utils.Utils
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets

/**
 * NOTE ON VERIFICATION: this file is the least-verified piece of the port.
 * Everywhere else in android/ is checked against the web source and, since
 * the audit, type-checked and differential-tested; but Filament's
 * `filament-utils-android` ModelViewer API (the method names/signatures
 * below, and whether `Utils.init()` is still required in 1.51.x) is
 * reproduced from documented usage rather than checked against the library's
 * own source, because this sandbox cannot fetch or compile it. If the first
 * real build fails here, diff these calls against the installed
 * filament-utils-android version's public API, or against
 * `filament/android/samples/sample-gltf-viewer` in Google's Filament repo,
 * which this follows.
 */
private var filamentUtilsInitialized = false
private fun ensureFilamentUtilsInit() {
    if (!filamentUtilsInitialized) {
        Utils.init()
        filamentUtilsInitialized = true
    }
}

/**
 * Renders a glTF scene (as produced by mesh/GltfExporter.kt) with Filament's
 * ModelViewer — orbit/pan/zoom gestures come from ModelViewer itself, so this
 * wrapper owns the render loop (a Choreographer frame callback), the scene's
 * lighting, and reloading the model when the geometry changes.
 *
 * ModelViewer does NOT install any lighting of its own: Google's own
 * sample-gltf-viewer creates an IBL and a sun before anything is visible.
 * Without that, a PBR glTF renders black no matter what the material says, so
 * this adds a sun-style directional light plus a neutral grey skybox that
 * doubles as ambient fill. Pairs with the dielectric material the exporter
 * now writes.
 */
@Composable
fun Viewer3DView(gltfJson: String, modifier: Modifier = Modifier) {
    ensureFilamentUtilsInit()
    val context = LocalContext.current
    val surfaceView = remember { android.view.SurfaceView(context) }
    val modelViewer = remember { ModelViewer(surfaceView) }
    val choreographer = remember { Choreographer.getInstance() }

    DisposableEffect(modelViewer) {
        surfaceView.setOnTouchListener { _, event -> modelViewer.onTouchEvent(event); true }

        val engine = modelViewer.engine
        val scene = modelViewer.scene

        // Neutral studio background; also the ambient the model picks up.
        val skybox = Skybox.Builder()
            .color(0.055f, 0.043f, 0.027f, 1.0f)
            .build(engine)
        scene.skybox = skybox

        // Sun-style key light, angled down the tube's length so the bore,
        // nest cut and finger holes all catch a highlight edge.
        val sun = EntityManager.get().create()
        val (r, g, b) = Colors.cct(5_500.0f)
        LightManager.Builder(LightManager.Type.DIRECTIONAL)
            .color(r, g, b)
            .intensity(90_000.0f)
            .direction(-0.45f, -1.0f, -0.35f)
            .castShadows(true)
            .build(engine, sun)
        scene.addEntity(sun)

        // Softer fill from the opposite side so the shadowed half is readable.
        val fill = EntityManager.get().create()
        LightManager.Builder(LightManager.Type.DIRECTIONAL)
            .color(0.85f, 0.89f, 1.0f)
            .intensity(28_000.0f)
            .direction(0.6f, 0.35f, 0.5f)
            .castShadows(false)
            .build(engine, fill)
        scene.addEntity(fill)

        val frameCallback = object : Choreographer.FrameCallback {
            override fun doFrame(frameTimeNanos: Long) {
                choreographer.postFrameCallback(this)
                modelViewer.render(frameTimeNanos)
            }
        }
        choreographer.postFrameCallback(frameCallback)

        onDispose {
            choreographer.removeFrameCallback(frameCallback)
            modelViewer.destroyModel()
            scene.removeEntity(sun)
            scene.removeEntity(fill)
            engine.destroyEntity(sun)
            engine.destroyEntity(fill)
            EntityManager.get().destroy(sun)
            EntityManager.get().destroy(fill)
            scene.skybox = null
            engine.destroySkybox(skybox)
        }
    }

    LaunchedEffect(gltfJson) {
        modelViewer.destroyModel()
        val bytes = gltfJson.toByteArray(StandardCharsets.UTF_8)
        val buffer = ByteBuffer.allocateDirect(bytes.size).apply {
            put(bytes)
            rewind()
        }
        // The exported glTF embeds its buffer as a base64 data URI (see
        // GltfExporter.kt) so it never references an external resource —
        // this callback should never actually be invoked.
        modelViewer.loadModelGltf(buffer) { uri ->
            throw IllegalStateException("Unexpected external glTF resource reference: $uri")
        }
        modelViewer.transformToUnitCube()
    }

    AndroidView(modifier = modifier.fillMaxSize(), factory = { surfaceView })
}
