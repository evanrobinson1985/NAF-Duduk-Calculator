#!/usr/bin/env bash
# Differential test: run the original JSX's pure functions under Node and the
# Kotlin port on the JVM with identical inputs, then compare every output.
#
# This is the check that proved the port faithful (905 values, ~130k lines of
# G-code) and that caught the fmt() rounding-mode bug. Run it after any change
# to engine/, gcode/ or util/.
#
#   tools/parity/run.sh            # compare; non-zero exit if anything drifts
#   tools/parity/run.sh --update   # refresh the committed golden JS output
#
# Needs: node (+ npx, for esbuild) and a Kotlin compiler. The Kotlin compiler
# is found in this order: $KOTLINC, kotlinc on PATH, kotlin-compiler-embeddable
# from a Gradle distribution ($GRADLE_HOME, the wrapper's downloaded dist, or
# /opt/gradle-*). Gradle is NOT invoked, so this works without Android SDK or
# network access to Google's Maven.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
work="$here/work"
mkdir -p "$work"

update_golden=0
[[ "${1:-}" == "--update" ]] && update_golden=1

# ── locate a Kotlin compiler ─────────────────────────────────────────
kotlin_cp=""       # full classpath for kotlin-compiler-embeddable
kotlin_stdlib=""   # kotlin-stdlib jar, needed to compile and to run
kotlinc_bin=""
if [[ -n "${KOTLINC:-}" && -x "${KOTLINC}" ]]; then
  kotlinc_bin="$KOTLINC"
elif command -v kotlinc >/dev/null 2>&1; then
  kotlinc_bin="$(command -v kotlinc)"
else
  for dir in "${GRADLE_HOME:-}" "$HOME"/.gradle/wrapper/dists/*/*/gradle-*/ /opt/gradle-*/ /usr/share/gradle*/; do
    [[ -n "${dir:-}" && -d "${dir}/lib" ]] || continue
    compgen -G "$dir/lib/kotlin-compiler-embeddable-*.jar" >/dev/null || continue
    kotlin_cp="$(printf '%s:' "$dir"/lib/*.jar)"
    kotlin_stdlib="$(ls "$dir"/lib/kotlin-stdlib-[0-9]*.jar 2>/dev/null | head -1)"
    break
  done
fi
if [[ -z "$kotlinc_bin" && -z "$kotlin_cp" ]]; then
  echo "parity: no Kotlin compiler found." >&2
  echo "  Set KOTLINC=/path/to/kotlinc, or install kotlinc, or point GRADLE_HOME at a Gradle distribution." >&2
  exit 127
fi
if [[ -n "$kotlin_cp" && -z "$kotlin_stdlib" ]]; then
  echo "parity: found kotlin-compiler-embeddable but no kotlin-stdlib beside it." >&2
  exit 127
fi

# ── 1. original JS -> headless module, then drive it ─────────────────
echo "== parity 1/4: extracting pure functions from the JSX source =="
node "$here/extract-js.mjs"

echo "== parity 2/4: running the JS reference driver =="
node "$here/js-driver.mjs" > "$work/js.json"

# ── 2. Kotlin port: compile the pure sources + driver, then run ──────
echo "== parity 3/4: compiling and running the Kotlin driver =="
srcs=()
while IFS= read -r f; do srcs+=("$f"); done < <(
  find "$repo/android/app/src/main/java/com/nafduduk/calculator/engine" \
       "$repo/android/app/src/main/java/com/nafduduk/calculator/gcode" \
       "$repo/android/app/src/main/java/com/nafduduk/calculator/util" \
       -name '*.kt' ! -name 'GcodeExportHelper.kt' | sort
)
rm -rf "$work/out"
if [[ -n "$kotlinc_bin" ]]; then
  # A real kotlinc install bundles its own stdlib on both paths.
  "$kotlinc_bin" -nowarn -d "$work/out" "${srcs[@]}" "$here/KtDriver.kt"
  "$kotlinc_bin" -nowarn -e auditdriver.KtDriverKt -cp "$work/out" > "$work/kt.json" 2>/dev/null ||
    java -Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 \
      -cp "$work/out:$(dirname "$kotlinc_bin")/../lib/kotlin-stdlib.jar" \
      auditdriver.KtDriverKt > "$work/kt.json"
else
  java -cp "$kotlin_cp" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
    -no-stdlib -no-reflect -nowarn -cp "$kotlin_stdlib" -d "$work/out" \
    "${srcs[@]}" "$here/KtDriver.kt"
  java -Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 \
    -cp "$work/out:$kotlin_stdlib" auditdriver.KtDriverKt > "$work/kt.json"
fi
[[ -s "$work/kt.json" ]] || { echo "parity: the Kotlin driver produced no output" >&2; exit 1; }

# ── 3. compare ───────────────────────────────────────────────────────
if [[ "$update_golden" == "1" ]]; then
  node "$here/golden.mjs" write "$work/js.json" "$here/golden-js.sha256"
fi

echo "== parity 4/4: comparing =="
status=0
node "$here/compare.mjs" "$work/js.json" "$work/kt.json" || status=$?
node "$here/classify-gcode.mjs" "$work/js.json" "$work/kt.json" || status=1
node "$here/golden.mjs" check "$work/js.json" "$here/golden-js.sha256" || status=1

exit $status
