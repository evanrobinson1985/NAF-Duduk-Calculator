package com.nafduduk.calculator.engine

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Shared pitch-detection helper (autocorrelation-based), ported 1:1 from
 * autoCorrelatePitch() in the web source — used by both the Real-Time Tuner
 * and (eventually) the Progressive Tuning Assistant so mic-listening
 * behavior is identical everywhere in the app. Same O(n^2) autocorrelation
 * loop as the original (no windowing/FFT trick), same silence threshold
 * (RMS < 0.01), same parabolic interpolation for sub-sample refinement.
 * Returns -1.0 when no clear pitch is found.
 */
fun autoCorrelatePitch(bufIn: FloatArray, sampleRate: Int): Double {
    var buf = bufIn
    var size = buf.size

    var rms = 0.0
    for (i in 0 until size) rms += (buf[i] * buf[i]).toDouble()
    if (sqrt(rms / size) < 0.01) return -1.0

    val thres = 0.2f
    var r1 = 0
    var r2 = size - 1
    for (i in 0 until size / 2) {
        if (abs(buf[i]) < thres) { r1 = i; break }
    }
    for (i in 1 until size / 2) {
        if (abs(buf[size - i]) < thres) { r2 = size - i; break }
    }
    buf = buf.copyOfRange(r1, r2)
    size = buf.size
    if (size < 2) return -1.0

    val c = DoubleArray(size)
    for (i in 0 until size) {
        var sum = 0.0
        for (j in 0 until size - i) sum += (buf[j] * buf[j + i]).toDouble()
        c[i] = sum
    }

    var d = 0
    while (d < size - 1 && c[d] > c[d + 1]) d++

    var maxval = -1.0
    var maxpos = -1
    for (i in d until size) {
        if (c[i] > maxval) { maxval = c[i]; maxpos = i }
    }
    if (maxpos <= 0) return -1.0

    var t0 = maxpos.toDouble()
    if (maxpos in 1 until size - 1) {
        val x1 = c[maxpos - 1]
        val x2 = c[maxpos]
        val x3 = c[maxpos + 1]
        val a = (x1 + x3 - 2 * x2) / 2
        val b = (x3 - x1) / 2
        if (a != 0.0) t0 -= b / (2 * a)
    }
    return if (t0 > 0) sampleRate / t0 else -1.0
}
