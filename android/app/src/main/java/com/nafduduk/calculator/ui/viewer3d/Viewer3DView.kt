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
import com.google.android.filament.utils.ModelViewer
import com.google.android.filament.utils.Utils
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets

/**
 * NOTE ON VERIFICATION: this file is the single least-verified piece of
 * this whole port — everywhere else in android/ was checked line-by-line
 * against the web source and reviewed for Kotlin/Compose API correctness,
 * but Filament's `filament-utils-android` ModelViewer API (method names/
 * signatures below, and whether `Utils.init()` is still required in
 * 1.51.x) is reproduced from documented usage patterns rather than
 * something checked against the library's actual current source, since
 * this sandbox cannot fetch or compile it (see android/README.md). If the
 * first real build fails here, start by diffing this file's ModelViewer
 * calls against the installed filament-utils-android version's actual
 * public API (or the `filament/android/samples/sample-gltf-viewer`
 * reference app in Google's Filament repo, which this follows).
 */
private var filamentUtilsInitialized = false
private fun ensureFilamentUtilsInit() {
    if (!filamentUtilsInitialized) {
        Utils.init()
        filamentUtilsInitialized = true
    }
}

/**
 * Renders a glTF scene (as produced by mesh/GltfExporter.kt) with
 * Filament's ModelViewer — orbit/pan/zoom gestures and a default IBL
 * environment come from ModelViewer itself, so this wrapper only owns the
 * render loop (a Choreographer frame callback) and reloading the model
 * when the underlying chamber geometry changes.
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
