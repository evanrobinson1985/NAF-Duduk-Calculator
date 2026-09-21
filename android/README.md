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
  — both machining strategies, ported 1:1:
  - **Tube drilling** (`generateTubeDrillingGCode`): drills the sound hole,
    SAC exit, flue channel, and finger holes into a tube that already has
    its internal wall/plug installed.
  - **Split-block** (`generateSplitBlockGCode`, `SplitBlockGcode.kt` +
    `SplitBlockNestInsert.kt` + `SplitBlockSymmetric.kt`): mills the full
    acoustic nest into two half-blanks that glue together, in either of the
    web source's two architectures — "nest-insert" (a tall lower blank
    carrying the whole nest faced up to the inner roof, and a thin upper
    shell with a rectangular through-window whose downstream edge is the
    splitting edge; no flip) or "symmetric" (the classic split at the bore
    axis, basic drilled layout / hand-finish mode: only the SAC and full
    bore are cut at true size, every other feature is a locating cut left
    `HAND_FINISH_UNDERSIZE_IN` undersized, and the ramp/splitting edge are
    entirely hand-carved). Includes the helical-ramp exact-diameter hole
    borer (`drillRoundHole`), the alignment-dowel pin planner (`SplitFit`,
    ported from `SPLIT_FIT`), the mouthpiece plan-outline rough cut with
    outward-normal offsetting, and the body-outline scribe/full-cutout
    passes with mitered cutter compensation and registration tabs. Wired
    into the Flute screen's "Export CNC G-Code (Split-Block)" button with a
    style picker; the quick-export button only covers straight bodies (the
    web app's curve param isn't wired into that button yet, though the
    generator itself takes and honors it).
  - Both strategies use explicit rapid/feed peck-drilling moves, no G81/G83
    canned cycles, so they run on GRBL as well as LinuxCNC/Mach3/4.
    `computeEasyModeParams` (auto tool size/feeds/speeds from the flute's
    own dimensions, for both methods) is ported too.
  - The split-block port was verified without a build by compiling it
    standalone against `kotlin-compiler-embeddable` (bundled with the
    project's Gradle distribution) plus the pure-Kotlin `engine`/`gcode`
    sources on the classpath — a real syntax/type check, not just manual
    review, for everything except the Android-only pieces (Compose UI,
    `FileProvider` sharing) that this sandbox still can't reach.

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

- **Flow Studio** (`app/src/main/java/com/nafduduk/calculator/engine/FlowStudio.kt`
  + `ui/flow/FlowStudioScreen.kt`) — the full aeroacoustics model
  (`computeFluteAeroacoustics`), composite quality scorer
  (`scoreFlowQuality`), and both optimizers (`optimizeNestForDesign`'s
  closed-form theta=7/Re~950 solve, and `optimizeEverything`'s 3-sweep
  coordinate-descent search over all 10 nest controls) ported 1:1. The
  Three.js particle-jet visualization itself is out of scope — this is the
  physics + recommendations, not the animation. Self-contained (builds its
  own key/bore/holes design rather than reading a live bridge from the
  Flute screen), same as the web version's own standalone fallback.

- **Maker assistants** (`engine/AntlerFit.kt`, `engine/FingerReach.kt`,
  `ui/flute/FluteAssistants.kt`) — `analyzeAntlerFit` (which keys a real
  measured antler section can be built into), `analyzeFingerReach` (hole-gap
  comfort checking against adult hand-span thresholds), the Ergonomic Hole
  Adjustment blend tool (wired to a real `ergoOverride` that now flows
  through geometry, PDF, and G-code export, same as the web app), and the
  Harmony Builder drone presets — all ported 1:1 and wired into the Flute
  screen as toggleable panels.

- **Multi-chamber (drone) support** (`engine/DroneChamber.kt`) —
  `buildDroneResults` ported 1:1: up to 3 secondary chambers, each either a
  fixed interval off the melody root or its own playable root note, run
  through the same authoritative `buildChamberGeometry` as the melody
  chamber, SAC/mouthpiece-margin equalized across chambers, playable-drone
  holes aligned to the melody tube's finger positions. Wired into the Flute
  screen's Single/Drone toggle and into PDF/G-code export.

- **3D preview + mesh export** (`app/src/main/java/com/nafduduk/calculator/mesh/`,
  `ui/viewer3d/`) — a from-scratch BSP-tree CSG engine (`Csg.kt`, the
  Android equivalent of the web app's `three-bvh-csg`), a chamber mesh
  builder (`ChamberMeshBuilder.kt`: hollow bore, finger holes, and the
  exact sound-hole/flue/ramp nest cut — see below), STL/OBJ/PLY/glTF
  exporters (with a proper ear-clipping triangulator, `Triangulation.kt`,
  since the exact nest profile introduced genuinely concave CSG fragments
  that naive fan-triangulation gets wrong), and an interactive
  Filament-based 3D view (`Viewer3DView.kt`) with orbit/pan/zoom, embedded
  in the Flute screen.
  - The nest cut (sound hole/flue/ramp) is now the web app's exact
    swept-2D-profile geometry (see `buildChamberMesh()` in the jsx): the
    same "channel"/"block" `moveTo`/`lineTo`/`quadraticCurveTo` point
    sequences, extruded along the tube's local frame
    (`LocalFrame.kt`/`ExtrudedProfile.kt`, matching the source's
    `localUpAt()` and `THREE.Shape`+`ExtrudeGeometry` construction
    point-for-point), not a box/wedge approximation. Two intentional
    differences remain, both because this app has no nest-override UI yet:
    every nest dimension uses the bore-derived auto formula (equivalent to
    every override being unset), and the result is one unioned watertight
    part rather than the source's separate mouthpiece-plug/block meshes.
  - The CSG engine and mesh math (including this exact-profile geometry)
    were hand-verified against the classic BSP-CSG algorithm and by
    hand-deriving the polygon winding orders and the `localUpAt()`
    Gram-Schmidt formula against the jsx source line-for-line — but never
    compiled or rendered, so treat the first real build+run as the actual
    test, not this description.

## What's NOT ported yet

- The G-Code viewer/toolpath simulator (2D/3D playback of a loaded
  program) — a Three.js-scene feature distinct from the chamber 3D preview
  above.
- Nest (SAC exit ramp/flue channel/TSH/fipple) override sliders on the
  Flute page itself (Flow Studio has its own independent nest-override
  controls, already ported, and the 3D preview's exact nest cut uses the
  same bore-derived auto formulas the Flute page does). The split-block
  generator itself already accepts the same per-chamber nest overrides as
  the web source (`GcodeChamber.nestRampAngleDeg`/`nestRampCurve`/etc.) —
  they're just not exposed as sliders on the Flute page yet, so every
  export uses the auto formulas.
- The split-block quick-export button on the Flute screen always builds a
  straight body (`Curve.STRAIGHT`) — the generator itself takes and honors
  a `curve` parameter (bow amplitude flows through every toolpath exactly
  as in the source), it's just not wired to a picker on that button yet
  (the 3D preview panel has its own separate straight/slight/heavy picker).

These are tracked as separate phases — ask to continue any of them.

## Building

**This sandbox cannot build this project.** Android Gradle Plugin and every
AndroidX/Compose artifact are published only to Google's Maven repo
(`dl.google.com` / `maven.google.com`), and this environment's network
policy blocks that host (confirmed: `mavenCentral()` is reachable,
`dl.google.com` returns a policy-denied 403 on every request). This is a
network-policy limitation, not a missing-SDK one — installing the SDK
locally wouldn't fix it, since Gradle dependency resolution would still be
blocked. (The 3D preview's Filament dependencies happen to publish to
`mavenCentral()`, not just Google's Maven, but that doesn't help here — AGP
and AndroidX alone are enough to block every build in this sandbox.)

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
