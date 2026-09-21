package com.nafduduk.calculator.pdf

import android.content.Context
import android.content.Intent
import android.graphics.pdf.PdfDocument
import androidx.core.content.FileProvider
import java.io.File

/**
 * Mobile equivalent of the web source's `doc.save(filename)` (which triggers
 * a browser download): writes the PdfDocument into the app's cache/exports
 * dir, then hands it to the system share sheet via a FileProvider content://
 * URI, so the person can save it to Files, print it, or send it anywhere.
 */
fun savePdfAndShare(context: Context, document: PdfDocument, fileName: String) {
    val exportsDir = File(context.cacheDir, "exports").apply { mkdirs() }
    val file = File(exportsDir, fileName)
    file.outputStream().use { out -> document.writeTo(out) }
    document.close()

    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "application/pdf"
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(Intent.createChooser(intent, "Share workshop packet").apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    })
}
