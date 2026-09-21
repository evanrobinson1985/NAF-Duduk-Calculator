# NAF Flute & Duduk Calculator — Android (native, in progress)

A native Kotlin + Jetpack Compose port of the web calculator
(`../antler_duduk_calculator (50) (4).jsx`). This is a **partial, in-progress
port** — see "What's ported so far" below.

## Why native, and why partial

The web app isn't just a calculator UI: it's five subsystems in one file
(13.7k lines) — a Flute page, a Duduk page, a Three.js 3D CSG viewer, a
CNC/G-code CAM generator with toolpath simulation, a jsPDF report generator,
an aeroacoustics optimizer ("Flow Studio"), STL/OBJ/PLY/GLTF mesh export,
and a mic-based real-time tuner. A faithful native rewrite of all of that —
a hand-rolled CSG/mesh engine (Android has no Three.js), G-code toolpath
simulation, PDF generation, FFT pitch detection — is a multi-month project.
This directory is being built out in phases; each phase is a real, working
slice, not a stub.

## What's ported so far

- **Engine** (`app/src/main/java/com/nafduduk/calculator/engine/`) — pure
  Kotlin, no Android dependencies, unit-testable in a plain JVM test:
  - `Notes.kt` — the full 101-note database (`ALL_NOTES`), `getNotes(a4)`,
    `noteNameFromFreq`, `nearestNote`.
  - `Bores.kt` — `BORES`, `DRONE_INTERVALS`, `HARMONY_PRESETS`,
    `SCALE_CONFIGS` (1-7 hole layouts), `tubeLen`, `recommendedBores`.
  - `Duduk.kt` — `DUDUK_STYLES`, `DUDUK_HOLES_8`, `dudukTubeLen`,
    `recommendedDudukBore`, `dudukHoleDiam`, `buildDudukDesignForKey`.
  - `FluteConst.kt` — the sourced Flutopedia/Prairie/Wolf construction
    constants and formulas (SAC length, sound-hole/flue dimensions, hole
    diameter/shape formulas).
  - `ChamberGeometry.kt` — `buildChamberGeometry`, the web app's own
    "single source of truth" geometry builder, plus `ergonomicAdjustHoles`.

  Every formula and constant here is a direct, line-by-line port of the
  matching function in the jsx — same variable names in comments, same
  magic numbers, so it's auditable against the source.

- **UI** (`app/src/main/java/com/nafduduk/calculator/ui/`):
  - App-level tab bar (`AppTabBar.kt`) matching the web app's 5 tabs
    (Flute / Duduk / Library / G-Code / Flow Studio) and their exact accent
    colors.
  - `flute/FluteScreen.kt` — single melody-chamber calculator: key picker,
    bore picker (with recommendation), hole-count picker, hand-size picker,
    live results and finger-hole table.
  - `duduk/DudukScreen.kt` — style/key/bore/reed-length calculator with
    live results and the 8-hole layout.
  - `ui/theme/` — dark gold/bone/card palette lifted directly from the web
    app's inline styles (`bg0/bg1/bg2/border/gold/amber/bone/muted`).

- **PDF export** (`app/src/main/java/com/nafduduk/calculator/pdf/`) — the
  full 7-page workshop packet (cover, true-scale cutting guide, true-scale
  drill guide, tuning guide, sanding checklist, finishing checklist,
  fingering chart), ported line-for-line from `exportPDF()` and its helper
  functions. `PdfCanvas.kt` is a small jsPDF-style shim over Android's
  `PdfDocument`/`Canvas` so the page-drawing code reads as a transcription,
  not a redesign. Exported via `FileProvider` + the share sheet.

- **CNC G-code export** (`app/src/main/java/com/nafduduk/calculator/gcode/`)
  — the "tube drilling" strategy (`generateTubeDrillingGCode`, ported 1:1):
  drills the sound hole, SAC exit, flue channel, and finger holes into a
  tube that already has its internal wall/plug installed. Explicit
  rapid/feed peck-drilling moves, no G81/G83 canned cycles, so it runs on
  GRBL as well as LinuxCNC/Mach3/4. `computeEasyModeParams` (auto tool
  size/feeds/speeds from the flute's own dimensions) is ported too.

- **Library** (`app/src/main/java/com/nafduduk/calculator/library/`) — save
  and reload full Flute/Duduk build configurations. `LibraryStorage.kt`
  ports `loadLibrary`/`persistLibrary`/`saveInstrumentToLibrary`/
  `deleteInstrumentFromLibrary`/`renameInstrumentInLibrary` verbatim, backed
  by `SharedPreferences` (JSON array of entries) instead of the web app's
  `localStorage` — same shape, same one-entry-per-instrument model.
  `LibraryScreen.kt` is the filterable list (All/Flute/Duduk) with
  Open/Rename/Delete, matching `LibraryPage`. Both calculator screens got a
  "Save to Library" card and now accept a `loadConfigJson` to restore state
  when opened from the Library tab, wired through `MainActivity`'s
  `pendingLoad`, mirroring `App()`'s own pending-load handoff.

- **Real-time tuner** (`app/src/main/java/com/nafduduk/calculator/ui/tuner/TunerPanel.kt`)
  — `autoCorrelatePitch()` ported 1:1 to `engine/PitchDetection.kt` (same
  O(n²) autocorrelation, same silence threshold, same parabolic
  interpolation), fed by `AudioRecord` instead of a Web Audio
  `AnalyserNode`. Runtime `RECORD_AUDIO` permission handling included.
  Toggleable from both the Flute and Duduk screens.

## What's NOT ported yet

- **The "split-block" CNC milling strategy**
  (`generateSplitBlockGCode` in the jsx, ~1,600 lines across its
  "symmetric" and "nest-insert" variants) — cutting the full acoustic nest
  (ramp, flue, SAC, splitting edge) from two glued half-blanks on a mill,
  as opposed to drilling holes into an already-round tube. Deliberately
  deferred: it's deeply coupled to the nest-override data model (flue
  length/depth, ramp angle/curve, backset, wall thickness, breath-hole
  geometry) that Task "Nest overrides..." below hasn't built yet, and its
  toolpath math (mouthpiece outline offsetting, alignment-pin planning,
  ball-nose bore sweeps) is intricate enough that porting it ahead of that
  data model risked either silently wrong toolpaths or a lot of rework.
  Revisit once nest overrides + multi-chamber land.
- The G-Code viewer/toolpath simulator (2D/3D playback of a loaded
  program) — a Three.js-scene feature, folded into the 3D viewer phase.
- Multi-chamber (drone) support on the Flute page — currently single
  melody chamber only. PDF/G-code export already accept multi-chamber
  data (`drones: List<PdfDroneSummary>`, `chambers: List<GcodeChamber>`)
  so this phase is mostly a UI + orchestration job, not new math.
- Nest overrides, ergonomic hole adjustment UI, harmony builder, antler
  assistant, finger-reach analyzer.
- The 3D viewer and STL/OBJ/PLY/GLTF mesh export.
- Flow Studio.

These are tracked as separate phases — ask to continue any of them.

## Building

**This sandbox cannot build this project.** Android Gradle Plugin and every
AndroidX/Compose artifact are published only to Google's Maven repo
(`dl.google.com` / `maven.google.com`), and this environment's network
policy blocks that host (confirmed: `mavenCentral()` is reachable,
`dl.google.com` returns a policy-denied 403 on every request). This is a
network-policy limitation, not a missing-SDK one — installing the SDK
locally wouldn't fix it, since Gradle dependency resolution would still be
blocked.

To build:
1. Open this `android/` folder in Android Studio (Hedgehog+) on a machine
   with normal internet access — it'll fetch everything and build
   immediately with no other setup.
2. Or, if you want to keep building inside this remote environment, check
   whether its network policy can be widened to allow `dl.google.com` and
   `maven.google.com` — see the environment configuration docs at
   https://code.claude.com/docs/en/claude-code-on-the-web.

Every file here was written carefully and reviewed by hand for correctness
(imports, API shapes, Kotlin syntax), but none of it has been
compiler-verified in this sandbox — treat the first local build as the
real first compile.
