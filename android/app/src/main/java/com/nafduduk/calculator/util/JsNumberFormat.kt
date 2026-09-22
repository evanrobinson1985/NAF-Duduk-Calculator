package com.nafduduk.calculator.util

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * The web source's `fmt(n, dec) = Number(n).toFixed(dec)`, reproduced exactly.
 *
 * Every number this app prints — G-code coordinates, the PDF build sheet, the
 * 1:1 drilling template, on-screen dimensions — has to read the same as the
 * web app a maker may be cross-checking against.
 *
 * `String.format("%.Nf")` does NOT do that: it rounds the shortest decimal
 * representation of the double HALF_UP, while JS `toFixed()` rounds the
 * double's exact binary value. They disagree whenever the shortest repr ends
 * in a 5 at the cut position, which is common for these dimensions:
 *
 *   breathHoleLength(0.75) = 0.6375, stored as 0.63749999999999995559…
 *     toFixed(3)      -> "0.637"   (rounds the true value, which is below the midpoint)
 *     %.3f            -> "0.638"   (rounds "0.6375" as written)
 *
 * `BigDecimal(double)` takes the exact binary value, so HALF_UP on it matches
 * toFixed everywhere, including genuine midpoints (0.125 -> "0.13") and
 * negatives (-0.5 -> "-1").
 *
 * One deliberate difference: JS renders a tiny negative as "-0.000"; this
 * returns "0.000". Numerically and machine-wise identical.
 */
fun jsFmt(n: Double, dec: Int = 2): String =
    if (n.isNaN() || n.isInfinite()) n.toString()
    else BigDecimal(n).setScale(dec, RoundingMode.HALF_UP).toPlainString()

/** `jsFmt` with an inch mark, for on-screen and printed dimensions. */
fun jsFmtIn(n: Double, dec: Int = 2): String = jsFmt(n, dec) + "\""
