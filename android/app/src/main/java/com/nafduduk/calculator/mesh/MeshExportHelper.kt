package com.nafduduk.calculator.mesh

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File

/** Same FileProvider + share-sheet pattern as the PDF/G-code exporters — writes the mesh text to cache/exports and hands it to the system share sheet. */
fun saveMeshAndShare(context: Context, contents: String, fileName: String, mimeType: String) {
    val exportsDir = File(context.cacheDir, "exports").apply { mkdirs() }
    val file = File(exportsDir, fileName)
    file.writeText(contents)

    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = mimeType
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(
        Intent.createChooser(intent, "Share 3D model").apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        },
    )
}
