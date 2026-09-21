package com.nafduduk.calculator.gcode

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File

/** Mobile equivalent of the web source's downloadBlob(): writes the G-code text to the app's cache/exports dir and hands it to the system share sheet. */
fun saveGcodeAndShare(context: Context, gcode: String, fileName: String) {
    val exportsDir = File(context.cacheDir, "exports").apply { mkdirs() }
    val file = File(exportsDir, fileName)
    file.writeText(gcode)

    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(
        Intent.createChooser(intent, "Share G-code program").apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        },
    )
}
