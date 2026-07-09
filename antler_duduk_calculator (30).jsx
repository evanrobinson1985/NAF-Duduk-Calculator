/**
 * NAF Flute & Duduk Calculator — React component
 * ----------------------------------------------------
 * Dependencies (npm install):
 *   react@18, react-dom@18, jspdf@2.5.1
 *
 * Usage:
 *   This file exports a default-rendering App via ReactDOM.createRoot at the
 *   bottom, assuming a <div id="root"></div> exists in your HTML (typical of
 *   Vite / Create React App). If you're integrating into an existing app with
 *   its own render call, just delete the last line and `export default App;`
 *   instead, then mount <App/> wherever you like.
 *
 * Structure:
 *   - Shared constants/helpers (NOTES, SCALE_CONFIGS, BORES, DRONE_INTERVALS, etc.)
 *   - DrillingTemplate, RealTuner — shared SVG diagram + mic-tuner components
 *   - exportPDF / drawScaleTemplate — antler flute PDF build sheet generator
 *   - FlutePage — full antler flute calculator: single melody chamber + up to 3
 *     additional chambers, each independently toggled Drone (no holes) or
 *     Playable (own root note + 1-4 finger holes), 4 chambers max total
 *   - DUDUK_STYLES, dudukTubeLen, DudukTemplate, exportDudukPDF — duduk acoustics
 *   - DudukPage — full duduk calculator (traditional Armenian / Western style)
 *   - App — top-level page-tab switcher between Flute and Duduk calculators
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { jsPDF } from "jspdf";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Brush, Evaluator, SUBTRACTION, ADDITION } from "three-bvh-csg";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ═══════════════════════════════════════════════════════════════
//  SHARED CONSTANTS
// ═══════════════════════════════════════════════════════════════
const SPEED = 13504; // inches/sec at 68°F / 20°C

const NOTES_440 = [
  { name:"C3",  freq:130.81 }, { name:"C#3", freq:138.59 },
  { name:"D3",  freq:146.83 }, { name:"Eb3", freq:155.56 },
  { name:"E3",  freq:164.81 }, { name:"F3",  freq:174.61 },
  { name:"F#3", freq:185.00 }, { name:"G3",  freq:196.00 },
  { name:"Ab3", freq:207.65 }, { name:"A3",  freq:220.00 },
  { name:"Bb3", freq:233.08 }, { name:"B3",  freq:246.94 },
  { name:"C4",  freq:261.63 }, { name:"C#4", freq:277.18 },
  { name:"D4",  freq:293.66 }, { name:"Eb4", freq:311.13 },
  { name:"E4",  freq:329.63 }, { name:"F4",  freq:349.23 },
  { name:"F#4", freq:369.99 }, { name:"G4",  freq:392.00 },
  { name:"Ab4", freq:415.30 }, { name:"A4",  freq:440.00 },
  { name:"Bb4", freq:466.16 }, { name:"B4",  freq:493.88 },
  { name:"C5",  freq:523.25 }, { name:"C#5", freq:554.37 },
  { name:"D5",  freq:587.33 }, { name:"Eb5", freq:622.25 },
  { name:"E5",  freq:659.25 }, { name:"F5",  freq:698.46 },
];

function getNotes(a4) {
  const ratio = a4 / 440;
  return NOTES_440.map(n => ({ name: n.name, freq: n.freq * ratio }));
}

// ═══════════════════════════════════════════════════════════════
//  NOTE AUDIO SAMPLES
//  Maps every selectable note (D3–F5, matching NOTES_440 above) to its
//  sample filename. Files live in a "samples" folder next to this HTML
//  file (./samples/<filename>). Not all samples need to exist yet —
//  missing files simply fail to play silently (a warning is logged to
//  the console) so the app keeps working as more samples are added.
//  To add a new sample, just drop the file into the samples folder —
//  if the filename matches the table below it will work immediately.
//  No code changes needed unless the note range (NOTES_440) changes.
// ═══════════════════════════════════════════════════════════════
const NOTE_SAMPLES = {
  "C3":  "Low C3.mp3",
  "C#3": "Low C#3.mp3",
  "D3":  "Low D3.mp3",
  "Eb3": "Low Eb3.mp3",
  "E3":  "Low E3.mp3",
  "F3":  "Low F3.mp3",
  "F#3": "Low F#3.mp3",
  "G3":  "Low G3.mp3",
  "Ab3": "Low Ab3.mp3",
  "A3":  "Low A3.mp3",
  "Bb3": "Low Bb3.mp3",
  "B3":  "Low B3.mp3",
  "C4":  "Mid C4.mp3",
  "C#4": "Mid C#4.mp3",
  "D4":  "Mid D4.mp3",
  "Eb4": "Mid Eb4.mp3",
  "E4":  "Mid-Range E4.mp3",
  "F4":  "Mid F4.mp3",
  "F#4": "Mid F#4.mp3",
  "G4":  "Mid G4.mp3",
  "Ab4": "Mid Ab4.mp3",
  "A4":  "Mid A4.mp3",
  "Bb4": "Mid Bb4.mp3",
  "B4":  "Mid B4.mp3",
  "C5":  "High C5.mp3",
  "C#5": "High C#5.mp3",
  "D5":  "High D5.mp3",
  "Eb5": "High Eb5.mp3",
  "E5":  "High E5.mp3",
  "F5":  "High F5.mp3",
};

const SAMPLES_DIR = "./samples/";

// Tracks the single currently-playing note sample (module-level, shared
// across every call site — melody key picker, drone key picker, etc.) so
// selecting a new note always cuts off whatever was already sounding
// instead of layering on top of it.
let _currentNoteAudio = null;

// Plays a single note sample once, stopping any previous sample first.
// Safe to call even when the sample is missing or the note has no mapping
// — it just warns to the console instead of throwing.
function playNoteSample(noteName) {
  if (_currentNoteAudio) {
    try {
      _currentNoteAudio.pause();
      _currentNoteAudio.currentTime = 0;
    } catch (e) { /* ignore — element may already be in a bad state */ }
    _currentNoteAudio = null;
  }

  const file = NOTE_SAMPLES[noteName];
  if (!file) { console.warn(`[note sample] No sample mapped for note "${noteName}" yet.`); return; }
  try {
    const audio = new Audio(SAMPLES_DIR + encodeURIComponent(file));
    _currentNoteAudio = audio;
    audio.addEventListener("ended", () => { if (_currentNoteAudio === audio) _currentNoteAudio = null; });
    audio.play().catch(err => {
      console.warn(`[note sample] Couldn't play sample for "${noteName}" (${file}) — file may not be added yet.`, err);
      if (_currentNoteAudio === audio) _currentNoteAudio = null;
    });
  } catch (err) {
    console.warn(`[note sample] Error playing sample for "${noteName}".`, err);
    _currentNoteAudio = null;
  }
}

const SCALE_CONFIGS = {
  1: { name:"1-Hole (Root · Octave)",
       holes:[{num:1,interval:"Octave",ratio:2.0000}]},
  2: { name:"2-Hole (Root · 5th · Octave)",
       holes:[{num:2,interval:"Perf 5th",ratio:1.4983},{num:1,interval:"Octave",ratio:2.0000}]},
  3: { name:"3-Hole Pentatonic (Root · 5th · Octave)",
       holes:[{num:3,interval:"Min 3rd",ratio:1.1892},{num:2,interval:"Perf 5th",ratio:1.4983},{num:1,interval:"Octave",ratio:2.0000}]},
  4: { name:"4-Hole Pentatonic",
       holes:[{num:4,interval:"Min 3rd",ratio:1.1892},{num:3,interval:"Perf 4th",ratio:1.3348},{num:2,interval:"Perf 5th",ratio:1.4983},{num:1,interval:"Octave",ratio:2.0000}]},
  5: { name:"5-Hole Pentatonic Minor",
       holes:[{num:5,interval:"Min 3rd",ratio:1.1892},{num:4,interval:"Perf 4th",ratio:1.3348},{num:3,interval:"Perf 5th",ratio:1.4983},{num:2,interval:"Min 7th",ratio:1.7818},{num:1,interval:"Octave",ratio:2.0000}]},
  6: { name:"6-Hole Pentatonic Minor",
       holes:[{num:6,interval:"Min 3rd",ratio:1.1892},{num:5,interval:"Perf 4th",ratio:1.3348},{num:4,interval:"Perf 5th",ratio:1.4983},{num:3,interval:"Min 7th",ratio:1.7818},{num:2,interval:"Octave",ratio:2.0000},{num:1,interval:"Maj 9th",ratio:2.2449}]},
  7: { name:"7-Hole Diatonic",
       holes:[{num:7,interval:"Maj 2nd",ratio:1.1225},{num:6,interval:"Min 3rd",ratio:1.1892},{num:5,interval:"Perf 4th",ratio:1.3348},{num:4,interval:"Perf 5th",ratio:1.4983},{num:3,interval:"Maj 6th",ratio:1.6818},{num:2,interval:"Min 7th",ratio:1.7818},{num:1,interval:"Octave",ratio:2.0000}]},
};

const BORES = [
  {label:'3/8"',    val:0.375,  mm:9.5 }, {label:'7/16"',  val:0.4375,mm:11.1},
  {label:'1/2"',    val:0.5,    mm:12.7}, {label:'9/16"',  val:0.5625,mm:14.3},
  {label:'5/8"',    val:0.625,  mm:15.9}, {label:'11/16"', val:0.6875,mm:17.5},
  {label:'3/4"',    val:0.75,   mm:19.1}, {label:'7/8"',   val:0.875, mm:22.2},
  {label:'15/16"',  val:0.9375, mm:23.8}, {label:'1"',     val:1.0,   mm:25.4},
  {label:'1-1/8"',  val:1.125,  mm:28.6}, {label:'1-1/4"', val:1.25,  mm:31.8},
  {label:'1-3/8"',  val:1.375,  mm:34.9}, {label:'1-1/2"', val:1.5,   mm:38.1},
  {label:'1-3/4"',  val:1.75,   mm:44.5}, {label:'2"',     val:2.0,   mm:50.8},
  {label:'2-1/4"',  val:2.25,   mm:57.2}, {label:'2-1/2"', val:2.5,   mm:63.5},
  {label:'2-3/4"',  val:2.75,   mm:69.9}, {label:'3"',     val:3.0,   mm:76.2},
  {label:'3-1/4"',  val:3.25,   mm:82.6}, {label:'3-1/2"', val:3.5,   mm:88.9},
  {label:'3-3/4"',  val:3.75,   mm:95.3}, {label:'4"',     val:4.0,   mm:101.6},
];

const DRONE_INTERVALS = [
  {label:"5th Below Root",  ratio:2/3,  desc:"Most traditional NAF drone — deep warm bass"},
  {label:"4th Below Root",  ratio:3/4,  desc:"Slightly higher bass drone, very warm"},
  {label:"Octave Below",    ratio:0.5,  desc:"Deep bass — drone tube ≈ 2× melody length"},
  {label:"Unison (Root)",   ratio:1.0,  desc:"Drone doubles the melody root exactly"},
  {label:"4th Above Root",  ratio:4/3,  desc:"Bright open drone above the melody"},
  {label:"5th Above Root",  ratio:3/2,  desc:"Bright harmony — shorter drone bore"},
];

// ═══════════════════════════════════════════════════════════════
//  HARMONY BUILDER — preset drone-chamber combinations
//  Each preset lists intervalIdx values into DRONE_INTERVALS above, applied
//  in order as chamber 2, 3, 4... Presets are pure-drone (no finger holes)
//  since that's the traditional use case; the per-chamber cards below still
//  let the person hand-tune bore/interval/playable after applying a preset.
// ═══════════════════════════════════════════════════════════════
const HARMONY_PRESETS = [
  { id:"traditional", name:"Traditional",  icon:"🪶", intervals:[0],
    desc:"Single 5th-below drone — the classic NAF sound. Deep, warm, unmistakably Native American flute." },
  { id:"deep",         name:"Deep Duet",    icon:"🌊", intervals:[2,0],
    desc:"Octave-below + 5th-below. Two bass drones stacked for a rich, resonant low end." },
  { id:"bright",       name:"Bright Harmony", icon:"☀️", intervals:[3,4],
    desc:"Root + 4th-above. An open, airy pairing that sits above the melody instead of under it." },
  { id:"power",        name:"Power Trio",   icon:"⚡", intervals:[0,3,5],
    desc:"5th-below, root, and 5th-above — a full power-chord spread across three chambers." },
];

// ═══════════════════════════════════════════════════════════════
//  SHARED HELPERS
// ═══════════════════════════════════════════════════════════════
const NOTE_NAMES_CHROM = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"];

function noteNameFromFreq(freq, a4 = 440) {
  const semis  = Math.round(12 * Math.log2(freq / a4)) + 69;
  const oct    = Math.floor(semis / 12) - 1;
  const idx    = ((semis % 12) + 12) % 12;
  const exactF = a4 * Math.pow(2, (semis - 69) / 12);
  const cents  = Math.round(1200 * Math.log2(freq / exactF));
  return { name: NOTE_NAMES_CHROM[idx] + oct, cents };
}

function tubeLen(freq, r) { return (SPEED / (2 * freq)) - (0.6 * r); }

// Given a note frequency, finds which bore(s) from BORES produce a comfortable,
// buildable tube length (5"–52" hard limit; ~10"–24" is the comfortable "sweet
// spot" most NAF/antler players find easiest to hold and finger). Returns the
// full list of workable bores plus a single best recommendation — the bore
// whose resulting tube length lands closest to the middle of the sweet spot.
// Note: for low keys, tube length is dominated by pitch, not bore — a wider
// bore only shortens the tube by a fraction of an inch, so the "recommendation"
// there is really "biggest bore available" rather than a true sweet-spot fit.
const BORE_SWEET_MIN = 10, BORE_SWEET_MAX = 24, BORE_HARD_MIN = 5, BORE_HARD_MAX = 52;
function recommendedBores(freq) {
  const options = BORES.map(b => {
    const tl = tubeLen(freq, b.val / 2);
    const inHardRange  = tl >= BORE_HARD_MIN && tl <= BORE_HARD_MAX;
    const inSweetSpot  = tl >= BORE_SWEET_MIN && tl <= BORE_SWEET_MAX;
    return { ...b, tubeLen: tl, inHardRange, inSweetSpot };
  }).filter(o => o.inHardRange);

  if (options.length === 0) return { best: null, options: [], reachesSweetSpot: false };

  const sweetOptions = options.filter(o => o.inSweetSpot);
  const pool = sweetOptions.length > 0 ? sweetOptions : options;
  const mid = (BORE_SWEET_MIN + BORE_SWEET_MAX) / 2;
  const best = pool.reduce((a, b) => Math.abs(b.tubeLen - mid) < Math.abs(a.tubeLen - mid) ? b : a);

  return { best, options, reachesSweetSpot: sweetOptions.length > 0 };
}

function nearestNote(freq, NOTES) {
  let best = NOTES[0], minC = Infinity;
  for (const n of NOTES) {
    const c = Math.abs(1200 * Math.log2(freq / n.freq));
    if (c < minC) { minC = c; best = n; }
  }
  return { name: best.name, cents: Math.round(1200 * Math.log2(freq / best.freq)) };
}

// ═══════════════════════════════════════════════════════════════
//  ANTLER SELECTION ASSISTANT
//  Takes real physical measurements of a specific antler section (length,
//  widest diameter, tip diameter, curvature) and reports which keys it can
//  actually be built into — reusing the same tube-length physics as the
//  rest of the app (tubeLen, sacLen formula, BORES list) rather than a
//  separate model, so results always agree with the calculator above.
// ═══════════════════════════════════════════════════════════════
const ANTLER_WALL_MARGIN = 0.12; // inches of wall thickness reserved per side at the narrowest point (the tip)
const ANTLER_TRIM_ALLOWANCE = 2.0; // inches lost to squaring up both cut ends (matches totalLen's +2.0)

function analyzeAntlerFit({ length, widestDiam, tipDiam, curvature }, NOTES, holeCount) {
  const length_ = parseFloat(length), widest_ = parseFloat(widestDiam), tip_ = parseFloat(tipDiam);
  if (!length_ || !widest_ || !tip_ || length_ <= 0 || widest_ <= 0 || tip_ <= 0) return null;

  // The bore can't exceed what the narrowest usable point (the tip) can hold
  // once wall thickness is reserved on both sides — the widest point is
  // rarely the limiting factor since makers drill/ream a constant-ish bore
  // down the piece.
  const maxUsableBore = Math.min(widest_, tip_) - ANTLER_WALL_MARGIN * 2;

  // Pick the largest standard bore size that fits within that limit — bigger
  // bore generally means a shorter, easier-to-finger tube for the same note.
  const usableBores = BORES.filter(b => b.val <= maxUsableBore);
  if (usableBores.length === 0) {
    return { fits: false, reason: "tip_too_narrow", maxUsableBore, results: [] };
  }
  const bore = usableBores[usableBores.length - 1].val;

  // Curvature eats into usable straight length beyond the flat trim
  // allowance — a heavily curved piece needs more material sacrificed to
  // get a straight-enough bore path, matching the build guide's advice to
  // measure along the curve rather than point-to-point.
  const curveLossFactor = curvature === "heavy" ? 0.88 : curvature === "slight" ? 0.95 : 1.0;
  const sacLen = bore * FLUTE_CONST.SAC_LEN_RATIO;
  const usableTubeLen = (length_ * curveLossFactor) - sacLen - ANTLER_TRIM_ALLOWANCE;

  if (usableTubeLen < BORE_HARD_MIN) {
    return { fits: false, reason: "too_short", maxUsableBore, bore, usableTubeLen, results: [] };
  }

  // For every note across the app's full range, check how close that note's
  // required tube length (at this bore) is to what this antler can actually
  // provide. A note is "buildable" if its ideal tube is at or slightly under
  // the usable length (extra gets trimmed from the foot); a note needing a
  // longer tube than available simply doesn't fit this piece.
  const results = NOTES.map(n => {
    const idealLen = tubeLen(n.freq, bore / 2);
    const diff = usableTubeLen - idealLen; // positive = room to spare, trim to fit
    const fitsExact = diff >= 0 && diff <= 1.5; // within trimming tolerance, minimal waste
    const fitsWithTrim = diff > 1.5;              // fits with extra material trimmed off
    const tooLong = diff < 0;                       // note needs more tube than this antler has
    return { name: n.name, freq: n.freq, idealLen, diff, fitsExact, fitsWithTrim, tooLong };
  });

  const buildable = results.filter(r => !r.tooLong).sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));
  const bestMatches = buildable.slice(0, 5);
  const tooLongExamples = results.filter(r => r.tooLong).sort((a,b) => a.diff - b.diff).slice(0, 3);

  const scaleName = SCALE_CONFIGS[holeCount] ? SCALE_CONFIGS[holeCount].name : `${holeCount}-Hole`;

  return {
    fits: buildable.length > 0, bore, usableTubeLen, sacLen, maxUsableBore,
    bestMatches, tooLongExamples, scaleName, results,
  };
}

function fmt(n, dec=2) { return Number(n).toFixed(dec); }

function holeDiam(bore, holeNum, holeCount) {
  const base = bore * 0.45;
  const adj  = holeNum >= holeCount ? -0.02 : holeNum <= 2 ? 0.03 : 0;
  return Math.max(0.18, Math.min(base + adj, bore * 0.58));
}

// ═══════════════════════════════════════════════════════════════
//  ERGONOMIC HOLE ADJUSTMENT
//  Real theoretical hole positions (from scale-degree ratios) are rarely
//  evenly spaced — some gaps end up cramped, others stretched. Professional
//  makers nudge interior holes toward more even spacing for a more
//  comfortable, consistent finger pattern, accepting a small tuning
//  compromise they correct for later by adjusting hole diameter and
//  undercutting. This models that same tradeoff: blend theoretical
//  positions toward even spacing by a chosen strength, and report both the
//  resulting pitch drift (so the maker knows the tuning cost) and a
//  suggested diameter compensation (a labeled estimate, not a guarantee —
//  final tuning is always done by ear/tuner against the drilled hole).
// ═══════════════════════════════════════════════════════════════

// Cents-per-percent-diameter-change used for the compensation estimate.
// This is a commonly cited rule-of-thumb rate for small hole/bore ratios,
// not a precise acoustic derivation — always presented to the user as an
// estimate to start from, not a guaranteed target.
const DIAM_CENTS_PER_PCT = 10;

function ergonomicAdjustHoles(holes, blend) {
  // holes must already be in physical order (foot-to-mouth or mouth-to-foot
  // doesn't matter for the blend itself, but we sort by fromTSH ascending —
  // i.e. mouth to foot — so "first"/"last" anchor the two end holes, which
  // never move; only interior holes shift.
  const ordered = [...holes].sort((a, b) => parseFloat(a.fromTSH) - parseFloat(b.fromTSH));
  const n = ordered.length;
  if (n < 3) {
    // Nothing to blend with fewer than 3 holes — first/last would be the
    // only two holes anyway.
    return ordered.map(h => ({ ...h, adjFromTSH: h.fromTSH, adjDiameter: h.diameter, centsShift: 0 }));
  }

  const first = parseFloat(ordered[0].fromTSH);
  const last  = parseFloat(ordered[n-1].fromTSH);

  return ordered.map((h, i) => {
    const orig = parseFloat(h.fromTSH);
    if (i === 0 || i === n-1) {
      return { ...h, adjFromTSH: h.fromTSH, adjDiameter: h.diameter, centsShift: 0 };
    }
    const even = first + (last - first) * (i / (n-1));
    const adj = orig * (1 - blend) + even * blend;

    // Approximate resulting pitch shift from moving the hole (same
    // simplified proportional model the rest of the app uses for hole
    // placement — consistent, not a new physical assumption).
    const origFreqRel = 1 / orig;
    const newFreqRel  = 1 / adj;
    const centsShift  = 1200 * Math.log2(newFreqRel / origFreqRel);

    // Suggested diameter compensation: flat (negative cents) -> enlarge;
    // sharp (positive cents) -> shrink. Clamped to a sane range so the
    // estimate never suggests something absurd.
    const baseDiam = parseFloat(h.diameter);
    const pctChange = -centsShift / DIAM_CENTS_PER_PCT;
    const adjDiam = Math.max(0.12, baseDiam * (1 + pctChange / 100));

    return { ...h, adjFromTSH: fmt(adj), adjDiameter: fmt(adjDiam, 3), centsShift: Math.round(centsShift) };
  });
}

// ═══════════════════════════════════════════════════════════════
//  FINGER HOLE SHAPE
//  Round is the default/baseline this whole app already calculates for.
//  The other shapes change how a hole of the SAME acoustic effect looks
//  and feels: oval and undercut holes vent more efficiently per unit of
//  drilled diameter (so the drilled/major diameter can be a little smaller
//  for the same pitch effect as a round hole), while countersunk is a
//  comfort-only shape with negligible acoustic effect. Percentages are
//  maker-community rules of thumb, not a precise acoustic derivation —
//  always labeled as a starting point to fine-tune by ear.
// ═══════════════════════════════════════════════════════════════
const HOLE_SHAPES = {
  round: {
    label: "Round", icon: "●",
    desc: "Standard drilled hole — the baseline this calculator's diameters already assume.",
    acousticFactor: 1.0,
    howTo: "Drill straight down with a standard bit, sized to the diameter shown.",
  },
  oval: {
    label: "Oval", icon: "⬭",
    desc: "Elongated along the tube's length. Slightly larger perceived opening for the same drilled width, so the major (long) axis can run a bit smaller than an equivalent round hole while still reaching pitch.",
    acousticFactor: 0.93,
    howTo: "Drill a round pilot hole, then elongate along the tube axis with a round file — aim for a length-to-width ratio around 1.3–1.5:1.",
  },
  undercut: {
    label: "Undercut", icon: "◉",
    desc: "The interior (bore-side) edge is beveled wider than the drilled surface opening. Acoustically closer to a larger hole than its surface diameter suggests — a common way to fine-sharpen pitch without visibly enlarging the hole.",
    acousticFactor: 0.90,
    howTo: "Drill the surface opening at the diameter shown, then use a small round file or undercutting tool angled into the bore from inside (or through the hole itself) to bevel the inner edge — work gradually and check pitch often.",
  },
  countersunk: {
    label: "Countersunk", icon: "◎",
    desc: "The outer (finger-side) edge is chamfered for comfort — this is primarily ergonomic, not acoustic. Diameter stays essentially the same as round.",
    acousticFactor: 1.0,
    howTo: "Drill the standard round hole first, then lightly chamfer just the outer rim with a countersink bit or sanding — don't remove more than the outer 10–15% of wall thickness.",
  },
};

// Returns the drilled/major dimension to target for a given shape, so the
// SAME target pitch is reached as the app's baseline round-hole diameter.
function holeShapeDiameter(baseDiam, shapeKey) {
  const shape = HOLE_SHAPES[shapeKey] || HOLE_SHAPES.round;
  return baseDiam * shape.acousticFactor;
}

// ═══════════════════════════════════════════════════════════════
//  ★ AUTHORITATIVE GEOMETRY BUILDER — SINGLE SOURCE OF TRUTH ★
//
//  Every representation of a flute chamber in this app — the results
//  table, the SVG drilling template, the 3D viewer, the PDF workshop
//  packet, and the CNC G-code generator — must derive its numbers from
//  the object this function returns, not from a local recomputation.
//  Before this consolidation, the melody chamber and each drone chamber
//  independently repeated the SAC-length formula (bore*4.6), the sound-
//  hole-window formula (bore*0.82 / bore*1.25), and the finger-hole
//  diameter/overlap-safety logic — three separate copies of the same
//  physics that could silently drift apart if only one was ever edited.
//  This function is that one copy.
//
//  Physical constants used here (SAC length ratio, sound-hole window
//  ratios, hole-diameter-to-bore ratio, overlap safety margin) are NOT
//  redefined elsewhere — search for FLUTE_CONST below before adding any
//  new geometry-affecting number anywhere in this file.
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
//  BIRD/TOTEM BLOCK MODELS — embedded STL data (base64)
//  Real, licensed 3D-printable totem block models, simplified/decimated
//  for embedding (original high-detail source files were 1.1MB and 6MB);
//  these are quadric-decimated to ~150-200KB each with negligible visual
//  difference at the on-screen size these render at — verified by
//  rendering both the original and simplified versions and comparing
//  pixel output directly, not just polygon count).
//
//  Dolphin Block: by Thingiverse user 21Starman12, licensed CC BY-SA.
//    https://www.thingiverse.com/thing:6895832
//  Kokopelli Block: used with permission/rights held by the app owner.
//
//  Both models are Z-up in their native units (millimeters) with the
//  block's flat base at Z=0 — confirmed by direct inspection before use.
// ═══════════════════════════════════════════════════════════════
const BIRD_STL_DOLPHIN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC4CwAAbZwHvsm7dz//n1s+erDJQDqeOj8Xn4VBlmemQDyOMD/sl4FBBAqdQGSXEj9kX4RBAACeLa689BQXP8yXTj/zJCdBqe0gQPDA/0GyP0pBORXnP7ouAkLlk1BBQHx0QEup+EEAABCWcj8/c6K+QCYYPbg+gkF2y7bAmQcIQmmrfkE0ZNjAWkcJQnKnhEGRoZ/AjAgCQgAAAACAv3yvhiMsf1eitMhuQAAAwMEAACBBtMhuQCpJzUB+SSBBtMhuQAAA0MEAANinAAAAAAAAAAAAAAAAgL8X2Z1BAADQwQAA2KcX2Y1BAADQwQAA2KcX2Y1B16ObwQAA2KcAAAAAAAAAAAAAAACAv7TIbkAAANDBAADYp1pkt0DXo5vBAADYp1pkt0AAANDBAADYpwAAAAAAgAAAAIAAAIC/F9mdQc/3v0EAANinF9mdQQAA0MEAANinF9mNQdejm8EAANinAAAAAACAAAAAAAAAgL8X2Z1Bz/e/QQAA2KcX2Y1B16ObwQAA2KdaZLdA16ObwQAA2KcAAAAAAAAAAAAAAACAv7TIbkAAANDBAADYp7TIbkDP979BAADYp1pkt0DXo5vBAADYpwAAAAAAgAAAAAAAAIC/F9mdQc/3v0EAANinWmS3QNejm8EAANintMhuQM/3v0EAANinAAAAAIA/AAAAAAAAAAAX2Z1Bz/e/QQAA2KcX2Z1BG3vKQJgyIEEX2Z1BAADQwQAA2KcAAAAAgD8AAACAAAAAABfZnUEAAMDBAAAgQRfZnUEAANDBAADYpxfZnUEbe8pAmDIgQQAAAAAAAAAAAAAAAIA/F9mdQQAAwMEAACBBF9mNQdejm8EAACBBF9mNQQAAwMEAACBBAAAAAAAAAAAAAAAAgD+0yG5AAADAwQAAIEFaZLdAAADAwQAAIEFaZLdA16ObwQAAIEEAAAC2rzoepBq67v9/P7TIbkAqSc1AfkkgQbTIbkAAAMDBAAAgQVpkt0DXo5vBAAAgQQAAAAAAACUv+7n+/38/F9mNQdejm8EAACBBF9mdQRt7ykCYMiBBWmS3QNejm8EAACBBAAC1onK6aIrVuff/fz8X2Z1BAADAwQAAIEEX2Z1BG3vKQJgyIEEX2Y1B16ObwQAAIEEAAAAAgL8AAAAAAAAAABfZjUHXo5vBAADYpxfZjUEAANDBAADYpxfZjUEAAMDBAAAgQQAAAACAvwAAAAAAAAAAF9mNQdejm8EAANinF9mNQQAAwMEAACBBF9mNQdejm8EAACBBAAAAAAAAVgd7v6vSSD4X2Y1BAADQwQAA2KcX2Z1BAADQwQAA2KcX2Z1BAADAwQAAIEEAAAAAAABWB3u/q9JIPhfZjUEAANDBAADYpxfZnUEAAMDBAAAgQRfZjUEAAMDBAAAgQQAAAACAPwAAAIAAAAAAWmS3QAAAwMEAACBBWmS3QAAA0MEAANinWmS3QNejm8EAANinAAAAAIA/AAAAgAAAAABaZLdAAADAwQAAIEFaZLdA16ObwQAA2KdaZLdA16ObwQAAIEEAAAAAAABWB3u/q9JIPrTIbkAAAMDBAAAgQbTIbkAAANDBAADYp1pkt0AAANDBAADYpwAAAAAAAFYHe7+r0kg+tMhuQAAAwMEAACBBWmS3QAAA0MEAANinWmS3QAAAwMEAACBBAAAAAAAAAACAvwAAAABaZLdA16ObwQAAIEFaZLdA16ObwQAA2KcX2Y1B16ObwQAA2KcAAAAAAAAAAIC/AAAAAFpkt0DXo5vBAAAgQRfZjUHXo5vBAADYpxfZjUHXo5vBAAAgQQAA5f9/v+rpzLppdGq6tMhuQCEwQ0IfhQ1BDNJuQDT4QUJA1gtBEchuQFlhPkKA1C9BAAD//3+/ky4QOZNpYrkM0m5ANPhBQkDWC0HKyG5Az+80QhWDFEERyG5AWWE+QoDUL0EAAAAAgL/3gfW27m6huLTIbkAAANhBz/cvQbTIbkBU4zRCiUEUQYTKbkDhVi1CkSUAQQAAAACAvxU4/rUuY8K3tMhuQAAA2EHP9y9BEchuQFlhPkKA1C9ByshuQM/vNEIVgxRBAAD//3+/297yNwOznzm0yG5AVOM0QolBFEG0yG5AAADYQc/3L0HKyG5Az+80QhWDFEEAAAAAgL+HiQU3SnvaNrTIbkAuUv5BUI+kQLTIbkAAANhBz/cvQYTKbkDhVi1CkSUAQQAAAACAv63K56Yu1UIntMhuQKvA3EHCcWhAtMhuQAAA2EHP9y9BtMhuQC5S/kFQj6RAAAAAAIC/AAAAgAAAAAC0yG5Ad76OQY/CLUG0yG5AwcqKQQAAIEG0yG5AuAYYQc/3L0EAAAAAgL8AAAAAAAAAALTIbkBWDpRBAAAgQbTIbkB3vo5Bj8ItQbTIbkAAANhBz/cvQQAAAACAvwAAAAAAAACAtMhuQLgGGEHP9y9BtMhuQAAA2EHP9y9BtMhuQHe+jkGPwi1BAAAAAIC/tdwBqAqI/Ke0yG5AbDnNQSxaFUC0yG5AVg6UQQAAIEG0yG5Aq8DcQcJxaEAAAAAAgL8YJL6lT0NKJ7TIbkAAANhBz/cvQbTIbkCrwNxBwnFoQLTIbkBWDpRBAAAgQQAAAACAv3nWWSZwJO8ltMhuQFYOlEEAACBBtMhuQGw5zUEsWhVAtMhuQM/3v0EAANinAAAAAIC/JuRVps3xjKa0yG5AoecGQeApJ0G0yG5AuAYYQc/3L0G0yG5Az/e/QQAA2KcAAAAAgL8AAACAAAAAgLTIbkDByopBAAAgQbTIbkDP979BAADYp7TIbkC4BhhBz/cvQQAAAACAvwAAAIAAAACAtMhuQFYOlEEAACBBtMhuQM/3v0EAANintMhuQMHKikEAACBBAAAAAIC/SNW0Jb1zKya0yG5AKknNQH5JIEG0yG5AoecGQeApJ0G0yG5Az/e/QQAA2KcAAAAAgL8AAAAA5m5MJLTIbkDP979BAADYp7TIbkAAANDBAADYp7TIbkAqSc1AfkkgQQAAAACAP9USObXd3Cs2F9mdQUZEQ0JM2Q1BFNmdQekhPkKx9i9BFdmdQdDlNEIyUxRBAAAAAIA/hLtMtZk+ADYX2Z1BF9lBQoGVC0EX2Z1BRkRDQkzZDUEV2Z1B0OU0QjJTFEEAAPv/fz/ULpo4AcRKOhXZnUHQ5TRCMlMUQRfZnUEAANhBz/cvQRfZnUFU4zRCiUEUQQAAAACAPxDrpTTcnKQ1FNmdQekhPkKx9i9BF9mdQQAA2EHP9y9BFdmdQdDlNEIyUxRBAAAAAIA/W9Y9tuR6DLYX2Z1Bvk/7QUgQoUAr2Z1BK+krQosS+0AX2Z1BAADYQc/3L0EAAAAAgD8KvxY2/j7GNyvZnUEr6StCixL7QBfZnUFU4zRCiUEUQRfZnUEAANhBz/cvQQAAAACAP2Xy2yfvZiWoF9mdQdW320H3XmRAF9mdQb5P+0FIEKFAF9mdQQAA2EHP9y9BAAAAAIA/AAAAAAAAAAAX2Z1BVg6UQQAAIEEX2Z1BwcqKQQAAIEEX2Z1Bz/e/QQAA2KcAAAAAgD8AAAAAAAAAABfZnUHByopBAAAgQRfZnUG4BhhBz/cvQRfZnUHP979BAADYpwAAAACAPwAAAIAAAAAAF9mdQbgGGEHP9y9BF9mdQcHKikEAACBBF9mdQZzEjkEtsi1BAAAAAIA/AAAAAAAAAAAX2Z1BAADYQc/3L0EX2Z1BuAYYQc/3L0EX2Z1BnMSOQS2yLUEAAAAAgD8AAAAAAAAAABfZnUEAANhBz/cvQRfZnUGcxI5BLbItQRfZnUFWDpRBAAAgQQAAAACAP3fQ+CiCB/coF9mdQaAezUHEBxNAF9mdQdW320H3XmRAF9mdQVYOlEEAACBBAAAAAIA/R8agJjcGK6gX2Z1BAADYQc/3L0EX2Z1BVg6UQQAAIEEX2Z1B1bfbQfdeZEAAAAAAgD/1P7CnsXxBpxfZnUHP979BAADYpxfZnUGgHs1BxAcTQBfZnUFWDpRBAAAgQQAAAACAP9TQySefETIoF9mdQRt7ykCYMiBBF9mdQc/3v0EAANinF9mdQfydA0F0/CVBAAAAAIA/oxH0p4zUIKgX2Z1B/J0DQXT8JUEX2Z1Bz/e/QQAA2KcX2Z1BuAYYQc/3L0EAANNO4L7+Gk0/ALTQPs0+wkBnvIo9boSQQbLV2kAIgRA/TVCPQfuHzUC+xyA/SL2KQQAAqst4P7SPBb5C30g+/htNQVzIg0FlYvdBOHZPQeI4Z0HtzeZBsFlVQR2ocUHAr9tBAAAjaW2/25JEvjBnpD7DOhlBnQcJQhJK2EE3DCJBmxcVQkJy80EWLhNBzo8TQnQl3EEAAMXAtr7dF2o/WWpDvn+XJUGCBjVCw88HQpEWF0F0TjVCrfAPQswSLkGB3DZCi6QMQgAAj2VZO0jgCD9kVVi/hMpuQOFWLUKRJQBBF9mdQVTjNEKJQRRBK9mdQSvpK0KLEvtAAAAAAAAACX5SP6KzEb8tsjtBi+w0Qsl2FEEX2Z1BVOM0QolBFEG0yG5AVOM0QolBFEEAADybQDlkH18/LAT7vhfZnUFU4zRCiUEUQS2yO0GL7DRCyXYUQRXZnUHQ5TRCMlMUQQAAj0ueusBhKr5mbny/LbI7QYvsNELJdhRBF9mdQRfZQUKBlQtBFdmdQdDlNEIyUxRBAADuDqm68y0qvpNwfL8M0m5ANPhBQkDWC0EX2Z1BF9lBQoGVC0EtsjtBi+w0Qsl2FEEAAA3ACLo32l43/v9/PxTZnUHpIT5CsfYvQRHIbkBZYT5CgNQvQRfZnUEAANhBz/cvQQAAbuLeuidQXz8aVvo+EchuQFlhPkKA1C9BF9mdQUZEQ0JM2Q1BtMhuQCEwQ0IfhQ1BAAAgwUc79lJbPxgIBD8RyG5AWWE+QoDUL0EU2Z1B6SE+QrH2L0EX2Z1BRkRDQkzZDUEAAIOfpLnjH6c+XPpxvwzSbkA0+EFCQNYLQbTIbkAhMENCH4UNQRfZnUEX2UFCgZULQQAACUBBOgrJvT5iw22/F9mdQUZEQ0JM2Q1BF9mdQRfZQUKBlQtBtMhuQCEwQ0IfhQ1BAABTaeS5kxcovv+GfL8tsjtBi+w0Qsl2FEHKyG5Az+80QhWDFEEM0m5ANPhBQkDWC0EAAAAAAABtcds5//9/PxfZnUEAANhBz/cvQRHIbkBZYT5CgNQvQbTIbkAAANhBz/cvQQAATA+8OCmqSz8qGhu/LbI7QYvsNELJdhRBtMhuQFTjNEKJQRRByshuQM/vNEIVgxRBAAAAAAAAROcNP0kSVb+Eym5A4VYtQpElAEG0yG5AVOM0QolBFEEX2Z1BVOM0QolBFEEAAH2TmzoYVA4/mMlUv7TIbkCrwNxBwnFoQBfZnUHVt9tB915kQLTIbkBsOc1BLFoVQAAAw562ulNPEj/bEVK/F9mdQaAezUHEBxNAtMhuQGw5zUEsWhVAF9mdQdW320H3XmRAAAA3CJS7D8Z2Ps9zeL+0yG5ALlL+QVCPpECEym5A4VYtQpElAEEr2Z1BK+krQosS+0AAADtPjbp1BXI+Nr94v7TIbkAuUv5BUI+kQCvZnUEr6StCixL7QBfZnUG+T/tBSBChQAAAtdVwuqYRsj6yBHC/F9mdQb5P+0FIEKFAF9mdQdW320H3XmRAtMhuQKvA3EHCcWhAAABps8k642utPg3ecL8X2Z1Bvk/7QUgQoUC0yG5Aq8DcQcJxaEC0yG5ALlL+QVCPpEAAADHUlrm9Y10/WIoAvxfZnUGcxI5BLbItQRfZnUHByopBAAAgQbTIbkB3vo5Bj8ItQQAAAAAAANr7XT/pBf++tMhuQHe+jkGPwi1BF9mdQcHKikEAACBBtMhuQMHKikEAACBBAAAAAACAAAAAAAAAgD+0yG5AVg6UQQAAIEG0yG5AwcqKQQAAIEEX2Z1BwcqKQQAAIEEAAAAAAIAAAAAAAACAP7TIbkBWDpRBAAAgQRfZnUHByopBAAAgQRfZnUFWDpRBAAAgQQAAAAAAAP+eSr+Ndhy/F9mdQZzEjkEtsi1BtMhuQFYOlEEAACBBF9mdQVYOlEEAACBBAADe45G2k6FKvzdzHL8X2Z1BnMSOQS2yLUG0yG5Ad76OQY/CLUG0yG5AVg6UQQAAIEEAAAAAAAAAAAAAAACAPxfZnUEAANhBz/cvQbTIbkAAANhBz/cvQRfZnUG4BhhBz/cvQQAAAAAAAAAAAIAAAIA/tMhuQLgGGEHP9y9BF9mdQbgGGEHP9y9BtMhuQAAA2EHP9y9BAADQkSu6AjBQP+z5FL+0yG5AbDnNQSxaFUAX2Z1BoB7NQcQHE0AX2Z1Bz/e/QQAA2KcAAAAAAAAzu1A/rTYUv7TIbkBsOc1BLFoVQBfZnUHP979BAADYp7TIbkDP979BAADYpwAA4qhjP9Wn477QIds9hyp/QZ3b48BvSgJCaat+QTRk2MBaRwlCpcN2QbQy9cC6vQpCAAAAAAAAwCTqvpepYz8X2Z1BuAYYQc/3L0G0yG5AuAYYQc/3L0G0yG5AoecGQeApJ0EAAD4Fxrr98uC+1PdlPxfZnUG4BhhBz/cvQbTIbkCh5wZB4CknQRfZnUH8nQNBdPwlQQAACLHuOk13Vb4VYHo/F9mdQfydA0F0/CVBtMhuQKHnBkHgKSdBtMhuQCpJzUB+SSBBAAD/2zK6k64/vo95ez8X2Z1B/J0DQXT8JUG0yG5AKknNQH5JIEEX2Z1BG3vKQJgyIEEAADFBtTmSzS66+/9/P7TIbkAqSc1AfkkgQVpkt0DXo5vBAAAgQRfZnUEbe8pAmDIgQQAAAAAAAAAAAAAAAIC/LbJjQQAAiEEAADBBLbITQQAAiEEAADBBLbJjQQAAFEIAADBBAAA9GQ28meoxv4gOOL9u/A9BCB8ywJ6mm0FEsQhBzktvwBcWo0EUdQ9BzaHiv9jSk0EAAIj21D5IxkS/JdH4vhk1A0HycYHA55ykQWj72kDHelXAWleSQUSxCEHOS2/AFxajQQAAye9wvrqZWj9Tq+0+BAqdQGSXEj9kX4RBn4BaQGSM4D4tSoBBzT7CQGe8ij1uhJBBAADoSJS+j89RP5Eg/T7NPsJAZ7yKPW6EkEH7h81AvscgP0i9ikEECp1AZJcSP2RfhEEAAOWAfT/wcpc9Fs7xPbBZVUEdqHFBwK/bQTwFUkFceY9BhnfbQf4bTUFcyINBZWL3QQAAsvw+Pgl2Az+AalY/5ZNQQUB8dEBLqfhBj99hQbDeqUB2b+9BaeBSQRWju0C/Ye5BAACOF4s9PB9EPVcdfz8oOz9B47EGwT6qLEKeYDhBSOwIwf3OLEJJikJBvpoOwSK0LEIAAM7D4D52VuY9TDRkP1PqSUEPNQrB3XUrQpqkRkH43wXBBLorQig7P0HjsQbBPqosQgAABUfxO4zf8T4VoGE/aeBSQRWju0C/Ye5BUkorQVkc1kDq/+pB6vIeQWm/nUCdmvJBAAB/RX4+GAkDP9uIUj8y/WhBMPaRP7GOAUICsXNB+iLNQApC50GP32FBsN6pQHZv70EAAP+8gbwmdAg/YJBYP2ngUkEVo7tAv2HuQeryHkFpv51AnZryQeWTUEFAfHRAS6n4QQAAnTEZug0EED83plM/6vIeQWm/nUCdmvJB8yQnQantIEDwwP9B5ZNQQUB8dEBLqfhBAAAAAAAAAAAAgAAAgL8tshNBAAAUQgAAMEEtsmNBAAAUQgAAMEEtshNBAACIQQAAMEEAAMnhXT9WOcM+76KkPj5avkEFsjVCN0o/Qpp0vkHNZTZCgVE+Qmb/vEFR1DVC/vRAQgAAYULvPruQEr9tdiy/FHUPQc2h4r/Y0pNBIy7yQI5nyb/huYpBB0UHQXIuUr87h4pBAABnD84+9CIuv87VHL8UdQ9BzaHiv9jSk0FEsQhBzktvwBcWo0EjLvJAjmfJv+G5ikEAAN6RFj+x4Q6/9NQVv0SxCEHOS2/AFxajQWj72kDHelXAWleSQSMu8kCOZ8m/4bmKQQAAq3Ppvo3DGD8LCik/rGOLQF5Ejb90pJBBiZCpQCCfmr5MDpBBn4BaQGSM4D4tSoBBAABzZJ6+WjwXPul8cD+jxDRBpQ8Pwa7ALEKeYDhBSOwIwf3OLEKNvTBBFScLwXdELEIAAIIxtb6E28Q+FURaP8YVNEH4IQPB2bUrQo29MEEVJwvBd0QsQp5gOEFI7AjB/c4sQgAAHNbAvrNmMD/tfx4/zT7CQGe8ij1uhJBBn4BaQGSM4D4tSoBBiZCpQCCfmr5MDpBBAAC3/32/SlfhPNBI+T219w1BUgIYQhiI1UEgrQtB+l4XQjZ7zEE7UAhBgk0KQpeuxEEAALkbdb/URpW9C/eOPhYuE0HOjxNCdCXcQbX3DUFSAhhCGIjVQTtQCEGCTQpCl67EQQAArMcgv+eG9D4LSB0/u+FYQJbXAcDxl49Bh2SGQPVZicBDTaRBUR+ZQFPlBMAfT5tBAAAVHgo/is42v3xl5L5rovlAAuemwCW9r0EkpsBAoOuWwNMcmEEZNQNB8nGBwOecpEEAABbmEj9W+h6/W68IvySmwECg65bA0xyYQWj72kDHelXAWleSQRk1A0HycYHA55ykQQAAAOhBv0gkJz8wjs855yIzQVMTlkH3tvJByVkuQf9Lk0FHFfdBelozQfYvlkEd9QRCAACQryC/zZLUPXKCRb9K5t5AmEQyQrLrE0Kyu/xAU1MyQv7kEEI9avVAkS4xQiF8EUIAANzkub1H4gA/RfdbP1JKK0FZHNZA6v/qQVZrGEEhxuFAYkvoQeryHkFpv51AnZryQQAAR0o7P3zIjr7eQB+/5jGHQeaUIUHUvmlByViPQciGCEFkE4RBL1CFQdyTq0D3pYNBAAAkKTA/R6V/vuFoLr+plmxBOBwMQQt5T0GYqnRBlyA8QUUJRkHmMYdB5pQhQdS+aUEAAAMJMj8p3JS+mDkov6mWbEE4HAxBC3lPQeYxh0HmlCFB1L5pQS9QhUHck6tA96WDQQAA+WpSvTwpYj9icu4+Ote5QbdDJ0BE70FBTQC+QXZ1P0DtYDdB6C+3QTc6MUDbnzxBAAB0txK+7YdzP+zCiz5NAL5BdnU/QO1gN0HpTbxB0PJBQKJtM0HoL7dBNzoxQNufPEEAAL1d4L4yLmU/i12lvelNvEHQ8kFAom0zQardtEHCjyZAqUE4Qegvt0E3OjFA2588QQAA8gkMPjG4MD59t3k/SYpCQb6aDsEitCxCnmA4QUjsCMH9zixCTq01Qc0nEsHCTy1CAAA0/Oc8xV78PlufXj9OrTVBzScSwcJPLUI2kEFB8TETwbJcLUJJikJBvpoOwSK0LEIAAMnQBj9ZqQy/ug4mP0hzVUHzAghClszeQSwFUEEZQwxCWDToQYIESkEsEQhCwYjjQQAA0wxeP3F1pb42wsE+Plq+QQWyNUI3Sj9CZv+8QVHUNUL+9EBCnD28QVs+NEJoeEBCAAAQT1g/6dUFv+Ya5z2cPbxBWz40Qmh4QEKhz71BH9I0Qt1DPUI+Wr5BBbI1QjdKP0IAALc3fD9iGyO+X+CAvT5avkEFsjVCN0o/QqHPvUEf0jRC3UM9Qpp0vkHNZTZCgVE+QgAAClZ6P+xmir0juUq+oc+9QR/SNELdQz1Cs567QSIPNkJMbjdCmnS+Qc1lNkKBUT5CAADV92w/cnKiPlMWU76adL5BzWU2QoFRPkKznrtBIg82QkxuN0IAM7pBo143QhtCNkIAACdnIb8GiM4+ssQpP3ev1UDMlMM/Mi/1QTMw8UCHO8hAKLXkQUyE00ABostAYSPdQQAAU5mVvpmD6D4ld1c/6vIeQWm/nUCdmvJBVmsYQSHG4UBiS+hBRmcIQQPGw0Cwj+lBAACIxla+7iEIP70MUj/q8h5Bab+dQJ2a8kFGZwhBA8bDQLCP6UF38BVBkKywP3DtAUIAALagm77wujy/FXkaPyKhMEG9rYhBjXACQiwCLkHYwnhBlzH1QdMxM0EWhG9BK9rwQQAA2vQ2v2ssBb+vZe8+IqEwQb2tiEGNcAJCZkUtQYfQhEF9A/5BLAIuQdjCeEGXMfVBAACdGJe944kZPzX5Sz/+ZrVBa5k2Qn2mQEIu7bpBuJ41QqykQULGxLdBP3s3QowYQEIAALXeKT9MHiw/af6nPgkYu0HfmjdCXz4/Qmb/vEFR1DVC/vRAQpp0vkHNZTZCgVE+QgAAmAmGPrM5PT+R3R4/Zv+8QVHUNUL+9EBCCRi7Qd+aN0JfPj9CLu26QbieNUKspEFCAACOtIY+TiY9P4HQHj8JGLtB35o3Ql8+P0LGxLdBP3s3QowYQEIu7bpBuJ41QqykQUIAANcusD3ax3I/d1CcPgkYu0HfmjdCXz4/Qjdwt0GiZjhCREk9QsbEt0E/ezdCjBhAQgAAN77TvrSZ7z4V8Ec/RmcIQQPGw0Cwj+lBMzDxQIc7yEAoteRBd/AVQZCssD9w7QFCAACS4US9APW8vhmcbT9NMDlBzSwZwcSoLEI2kEFB8TETwbJcLUJOrTVBzScSwcJPLUIAAPvP2r43vOs+ni5HPzMw8UCHO8hAKLXkQegm8kCmNOc/Qun5QXfwFUGQrLA/cO0BQgAA9FMdv5e0qz75yjY/Tq01Qc0nEsHCTy1CnmA4QUjsCMH9zixCo8Q0QaUPD8GuwCxCAADaQxe/r1hDv6EVhr6RPgRBg+MuQh1jD0JYbAxBC28tQmEDD0L/GfxAwwAvQkGMEkIAAJjnST68Em2/WrykvpkXjECYPKzAhTGXQUsisED7Dq7ArAaeQW4CpEDCCrfA+KGiQQAAoIfFvTSSer+EDzm+bgKkQMIKt8D4oaJBTyWUQBuStsByHKRBmReMQJg8rMCFMZdBAACdEUO/7d8Kv9sVtb7/GfxAwwAvQkGMEkKr1PtAaTkwQmG/EEKRPgRBg+MuQh1jD0IAAI3/sD6ywW8/Lq1tPQkYu0HfmjdCXz4/Qi5yu0FI1jdC/3I6Qjdwt0GiZjhCREk9QgAABmETP4BI1L4dajQ/ga5UQQK2A0KMDdpBSHNVQfMCCEKWzN5BggRKQSwRCELBiONBAAB2hh2/d9SzPWGKSL+r1PtAaTkwQmG/EEI9avVAkS4xQiF8EUKyu/xAU1MyQv7kEEIAACMVVb+Wfu6+KseZvqvU+0BpOTBCYb8QQv8Z/EDDAC9CQYwSQj1q9UCRLjFCIXwRQgAA57aQPPe8DL+Jy1U/ggRKQSwRCELBiONBzxIyQdJwB0J49uJBORswQXGUAEJl89lBAADVpxo/lWlLP51meD0ucrtBSNY3Qv9yOkIJGLtB35o3Ql8+P0KadL5BzWU2QoFRPkIAAIFLq75d1Ec/YSkHP3+Sq0G2JDhCwUA7Qv5mtUFrmTZCfaZAQsbEt0E/ezdCjBhAQgAAdbmHvoeOTD8ZKAq/zlUFQaefMkLmtw9CAS4PQXGCNEI/TRFCM70LQR/UMUI7wQ1CAABaWhi+r+xvP/iCoT7GxLdBP3s3QowYQEI3cLdBomY4QkRJPUJ/kqtBtiQ4QsFAO0IAAKh5ZD+Q8+i97n3fPsSYbEEYZwVC68bFQUhzVUHzAghClszeQfJYZEFwFfhB7lTJQQAAieAMv0lPej7cYkw/fB6lQSYnN0J83jpC7C6oQaLUNUJ4VDxC/ma1QWuZNkJ9pkBCAAASWZ2+ZbZNP49+Aj9/kqtBtiQ4QsFAO0J8HqVBJic3QnzeOkL+ZrVBa5k2Qn2mQEIAAMhaFb/vh0o/Kw88PslZLkH/S5NBRxX3QeciM0FTE5ZB97byQZ9+L0GBEJZBTPrsQQAAEO9EvEwRlz5slXQ/1QokQUyKIkFN395B2tZXQc7tFUE7JeFBTeFRQddsM0GpjdxBAADS8WM+tDKvPtGyaT/x6VJB8q78QKoq5kH9tGpBGfoCQaJl4kHa1ldBzu0VQTsl4UEAANazVz6Lkak+znRrP/20akEZ+gJBomXiQU0PbEHvCjZBTwzZQdrWV0HO7RVBOyXhQQAAV6Rev0QN9T4CF/c9f78wQYY7kEGg8AVCyVkuQf9Lk0FHFfdBFvknQT7VkkHE7+FBAADhYBo9xQHFPtgXbD/a1ldBzu0VQTsl4UFSSitBWRzWQOr/6kHx6VJB8q78QKoq5kEAAHSk9r7Y4hY/DwQmv+lNvEHQ8kFAom0zQSNdu0Hs7jJA8mkxQardtEHCjyZAqUE4QQAATtz/vrO1zD7ItES/qt20QcKPJkCpQThBI127QezuMkDyaTFBgQm2QS6DFECUYjRBAADWClW/XbnKvjy+xj6AKWBA56uawG2mnUEhk11AvzKlwLdFmkGn9HZAJy2qwPvNn0EAALmBZ7/X0ME+XPhJPp9+L0GBEJZBTPrsQa8kK0Ek8ZdBKWbfQRb5J0E+1ZJBxO/hQQAASFZQv0sREj+Cs+E9FvknQT7VkkHE7+FByVkuQf9Lk0FHFfdBn34vQYEQlkFM+uxBAAB3aTi/ZR4EvxxC7T4sAi5B2MJ4QZcx9UFmRS1Bh9CEQX0D/kH75ClBcCt2QY+N8EEAAF+3AL9Nulu/KdDRPaf0dkAnLarA+82fQWrMcEA6aavA+nCZQU8llEAbkrbAchykQQAAqdb4vcAOer+5pjS+mReMQJg8rMCFMZdBTyWUQBuStsByHKRBasxwQDppq8D6cJlBAACgTBG/Opc3P5UPz74BLg9BcYI0Qj9NEUKRFhdBdE41Qq3wD0IzvQtBH9QxQjvBDUIAAKxPED8e1dm+Jj01P4GuVEECtgNCjA3aQYIESkEsEQhCwYjjQfjGTkFUUwFCWYnZQQAAJo0QP1uEub5h1T0/nD28QVs+NEJoeEBCZv+8QVHUNUL+9EBCLu26QbieNUKspEFCAACEnfa+tYsgP1i0HL8zvQtBH9QxQjvBDULitgpBWlowQs5xDEKyu/xAU1MyQv7kEEIAAHxjCL8E8Ak/FQ4nvzO9C0Ef1DFCO8ENQrK7/EBTUzJC/uQQQs5VBUGnnzJC5rcPQgAA6yChPcazFb/pr04/ggRKQSwRCELBiONBORswQXGUAEJl89lB+MZOQVRTAUJZidlBAAB9T1u+ErDHPhxDZT/VCiRBTIoiQU3f3kGXSg9BGbMZQehQ3kFWaxhBIcbhQGJL6EEAACFrlL4Pjzy/h3EcP8o6K0HSvmdBv0fqQdMxM0EWhG9BK9rwQSwCLkHYwnhBlzH1QQAAnb4/v8Ij8r69lu0+LAIuQdjCeEGXMfVB++QpQXArdkGPjfBByjorQdK+Z0G/R+pBAAAq/+Y+Om/jvhsnRj/OWrpB9F80QmYYQUKcPbxBWz40Qmh4QEIu7bpBuJ41QqykQUIAAAhmXD/KLna+P4vlPgCpYEF2vAtC1gfYQUhzVUHzAghClszeQcSYbEEYZwVC68bFQQAALZBtPwD2rr0KtLk+NVlsQQqJEkL3R8xBAKlgQXa8C0LWB9hBxJhsQRhnBULrxsVBAACvwka+Gse+PlFPaD+T0bZBLU01QrBVQUIu7bpBuJ41QqykQUL+ZrVBa5k2Qn2mQEIAAP33n70Y4MW+r0JrP85aukH0XzRCZhhBQi7tukG4njVCrKRBQpPRtkEtTTVCsFVBQgAAF8kTvvDLwj7l2Gk/VmsYQSHG4UBiS+hBUkorQVkc1kDq/+pB1QokQUyKIkFN395BAACThJA8bAnOPkFQaj/a1ldBzu0VQTsl4UHVCiRBTIoiQU3f3kFSSitBWRzWQOr/6kEAAJfKNL6AUAy/5UtRP56TtUF4TzRCRYlAQs5aukH0XzRCZhhBQpPRtkEtTTVCsFVBQgAAXPT/vcutRb8gfB8/zlq6QfRfNEJmGEFCnpO1QXhPNEJFiUBCkku3QQORM0JVyT9CAABgEmO+Q5fGPioHZT9GZwhBA8bDQLCP6UFWaxhBIcbhQGJL6EGXSg9BGbMZQehQ3kEAABNi3L7wecE+tNhRP5dKD0EZsxlB6FDeQedT7kBewwtBkTHbQTMw8UCHO8hAKLXkQQAAykpaPn3Vdb/pUjg+nD28QVs+NEJoeEBCkku3QQORM0JVyT9COEK4QaIqM0IbFT1CAADoUw0+hRpovwwdzD7OWrpB9F80QmYYQUKSS7dBA5EzQlXJP0KcPbxBWz40Qmh4QEIAABZW476NU8M+FI1PP5dKD0EZsxlB6FDeQTMw8UCHO8hAKLXkQUZnCEEDxsNAsI/pQQAAOk4mP0uKQr+FnbY8nD28QVs+NEJoeEBCImS7QY3DM0LzfjxCoc+9QR/SNELdQz1CAADQzsE+/0Bsv2xEkT0iZLtBjcMzQvN+PEKcPbxBWz40Qmh4QEI4QrhBoiozQhsVPUIAAE7ZIz8wMMm+GwcpP0hzVUHzAghClszeQYGuVEECtgNCjA3aQfJYZEFwFfhB7lTJQQAAtQwBv7XOVD/Y1m++ZJexQSDdG0B8wUFB6C+3QTc6MUDbnzxB/DqwQYjEEUDtpz5BAACoW/y+dLxeP9807ruq3bRBwo8mQKlBOEH8OrBBiMQRQO2nPkHoL7dBNzoxQNufPEEAAAjYRT812Xm+avkVP4tBWUEqh/pBYqrRQfJYZEFwFfhB7lTJQYGuVEECtgNCjA3aQQAA82czP1W/kb68cie/qZZsQTgcDEELeU9BL1CFQdyTq0D3pYNBRXJ4QQtre0CczH1BAABTAgQ/MFXNvuvTQT+LQVlBKof6QWKq0UGBrlRBArYDQowN2kH4xk5BVFMBQlmJ2UEAAEBBxT7XLZe+nNFfv/B5YEHmGfxAftlLQaC6UUE3zBZBSf48QZ5/YkGpCzBBJts7QQAAWKkNPypLjL4tXUm/nn9iQakLMEEm2ztBqZZsQTgcDEELeU9B8HlgQeYZ/EB+2UtBAAAqOE+/u2gLPlQ5Ej/610hAvOOVwHoDmUGHZIZA9VmJwENNpEHK50xAIsp9wOdcmEEAAPYqT7/3ZT8+dZMOP/rXSEC845XAegOZQYApYEDnq5rAbaadQYdkhkD1WYnAQ02kQQAAGZ3qPoeXVT7qL10/KDs/QeOxBsE+qixCSYpCQb6aDsEitCxCU+pJQQ81CsHddStCAAB1jRe/1NJIv9s3Pb5YbAxBC28tQmEDD0KRPgRBg+MuQh1jD0LwNQhBSpkuQvZwDUIAAFJrQL+HARe/aBqXvqvU+0BpOTBCYb8QQvA1CEFKmS5C9nANQpE+BEGD4y5CHWMPQgAAGHbgPgNMJz9L9h0/cVpLQf0qAcHJpClCmsxCQbLNAMEMEStCmqRGQfjfBcEEuitCAABLvnm/TMW+vfLJSz6vYyFBGjNwQbjw2kFmRS1Bh9CEQX0D/kF/vzBBhjuQQaDwBUIAACITvT5nXCO/VvMsPzcWUEF1KFRBZNjfQfRfS0FnDWhBWYfqQbfMRUG/dWNBMOLpQQAAP/BMv9shW718zRi/4rYKQVpaMELOcQxC8DUIQUqZLkL2cA1Cq9T7QGk5MEJhvxBCAAAVAU2/iPSsPaXLF7+yu/xAU1MyQv7kEELitgpBWlowQs5xDEKr1PtAaTkwQmG/EEIAAK2pgr5dim8/q2t5vvmNLEH5uDNCl/sAQn+XJUGCBjVCw88HQswSLkGB3DZCi6QMQgAAQkSNPoXBZr5rNG+/oLpRQTfMFkFJ/jxB999NQepoNUH3eDRBnn9iQakLMEEm2ztBAADhNBg/fxmAvnaeQ7+plmxBOBwMQQt5T0Gef2JBqQswQSbbO0GYqnRBlyA8QUUJRkEAALpKE7+4bkQ/6PyQvpEWF0F0TjVCrfAPQn+XJUGCBjVCw88HQjRDGUFuZzNCR64JQgAALkwYPy+yp75/6Ts/oH9RQa578kEwONFBi0FZQSqH+kFiqtFB+MZOQVRTAUJZidlBAAC/otY8aX5+vyI/171hTU1B/HEgQca8OUHcPjhBVA0gQQo1OEFphU1BT3ohQZUGMEEAAI9zibyEZUS/9yYkP7fMRUG/dWNBMOLpQeGPREFCAX5BOL/5QdMxM0EWhG9BK9rwQQAAs6kzP00XwD4zBhs/9iNQQS9UB8EANilCcVpLQf0qAcHJpClCU+pJQQ81CsHddStCAAA5uTI/6XPBPm+vGz9xWktB/SoBwcmkKUKapEZB+N8FwQS6K0JT6klBDzUKwd11K0IAAHdPUL8dHNa+L7XOPvrXSEC845XAegOZQSGTXUC/MqXAt0WaQYApYEDnq5rAbaadQQAAR+JPvyBl1L5YKtI++tdIQLzjlcB6A5lBRbpBQFJ3m8BP2JVBIZNdQL8ypcC3RZpBAABo/5s+9PdcP+4nzj7lskNBH9b4wNWLKEKazEJBss0AwQwRK0JxWktB/SoBwcmkKUIAACxxZL/fRq6+VMCXPso6K0HSvmdBv0fqQfvkKUFwK3ZBj43wQYBaJ0EPUHJBYYPqQQAAtrEDv0nsWb+F/tM9p/R2QCctqsD7zZ9BIZNdQL8ypcC3RZpBasxwQDppq8D6cJlBAAD9h1Q/2EGEvRrADT9T6klBDzUKwd11K0IZk0tB9G0NwZe+KkL2I1BBL1QHwQA2KUIAAGuCDr+4yEw/B3Rlvp/vIUFCjTJCWUABQjRDGUFuZzNCR64JQn+XJUGCBjVCw88HQgAAyzwDv9tQBb+BwS4/GaEkQTS/C0KmDuZBVFMfQTw0BEKrjthB6/MqQYWyCEJgx+NBAAA12d69YWEMPwJCVD+eYDhBSOwIwf3OLEIoOz9B47EGwT6qLELGFTRB+CEDwdm1K0IAACapXb/U0Oc+yelZvpEWF0F0TjVCrfAPQjRDGUFuZzNCR64JQveHFEH8mC9CHmUGQgAAqsMdO2AXPD+UqC0/msxCQbLNAMEMEStCxhU0QfghA8HZtStCKDs/QeOxBsE+qixCAAAWI5s+iU4cP+pQOz+apEZB+N8FwQS6K0KazEJBss0AwQwRK0IoOz9B47EGwT6qLEIAANMcGT89SsM+NnA0P2fuckGzwZm9nmoDQgGMhUGO8CY/4W75QbGXhEGUkjBAOB/xQQAAPiwjPFmoaj+kmcw+5bJDQR/W+MDViyhCyfM1Qfyo98BrSyhCmsxCQbLNAMEMEStCAAAQKXC9sztiP6S77T7J8zVB/Kj3wGtLKELGFTRB+CEDwdm1K0KazEJBss0AwQwRK0IAAFIuDr/wgZC+8T9IP56TtUF4TzRCRYlAQpPRtkEtTTVCsFVBQuwuqEGi1DVCeFQ8QgAAlpUNv6grBz7pllI/k9G2QS1NNUKwVUFC/ma1QWuZNkJ9pkBC7C6oQaLUNUJ4VDxCAAD3+Qq/OBzzvndUMT/sLqhBotQ1QnhUPEKyhKlB94g0Qgz3O0Kek7VBeE80QkWJQEIAADBztb79r1W/X83XPjwXtEHAWzNCswY+Qp6TtUF4TzRCRYlAQki4qUHm0jNCfZY6QgAAym+PvskCKj9nczG/4rYKQVpaMELOcQxCM70LQR/UMUI7wQ1CkRYXQXRONUKt8A9CAAASlSm//V8pP3Xjs76RFhdBdE41Qq3wD0L3hxRB/JgvQh5lBkLitgpBWlowQs5xDEIAAAatr772NVi/23XSPrKEqUH3iDRCDPc7Qki4qUHm0jNCfZY6Qp6TtUF4TzRCRYlAQgAA2qG1vr6kVb+n0tc+npO1QXhPNEJFiUBCPBe0QcBbM0KzBj5Ckku3QQORM0JVyT9CAAD5r7I+n2ZvPzxaeD0ZEblBImk4QvhyOEI3cLdBomY4QkRJPUIucrtBSNY3Qv9yOkIAAJIamT2faJO+kWl0v6C6UUE3zBZBSf48Qdw+OEFUDSBBCjU4QWFNTUH8cSBBxrw5QQAA4FecPucPs76DvGK/qUtTQYPZ1EALDk9BoLpRQTfMFkFJ/jxB8HlgQeYZ/EB+2UtBAAA/Vyk+P827vh1dar+pS1NBg9nUQAsOT0ECeDpBB5PpQBprRkGgulFBN8wWQUn+PEEAAAa4hz0S2p2+JPByvwJ4OkEHk+lAGmtGQdw+OEFUDSBBCjU4QaC6UUE3zBZBSf48QQAAp3w2v05Ao75s6R8/VFMfQTw0BEKrjthB2AwjQeU6AEIloNZB6/MqQYWyCEJgx+NBAAB/W1q/J3WDvsev6D5UUx9BPDQEQquO2EEZoSRBNL8LQqYO5kHDOhlBnQcJQhJK2EEAAL1nrr5nnwa/QYVHPzkbMEFxlABCZfPZQevzKkGFsghCYMfjQdgMI0HlOgBCJaDWQQAABRE9vuG9B7/21lM/zxIyQdJwB0J49uJB6/MqQYWyCEJgx+NBORswQXGUAEJl89lBAACqkFm+a+DQvpVPY7/xsxlBR9/YQHYYUkH40CFBZKEKQQVIQkECeDpBB5PpQBprRkEAAKMAFr+0C7O+hSM7v/GzGUFH39hAdhhSQZ2gCUGmB5dAzrpuQcBaC0EEkwpB4C1PQQAAbMx4v+LOpjqUK3E+opklQexKIEETATBBNQcoQZnzH0F8BjpBla4lQSbLNkFkODBBAADtiWE/bArgPiwpOL4ucrtBSNY3Qv9yOkKadL5BzWU2QoFRPkIAM7pBo143QhtCNkIAAJSbDL/O0FW/rHnevEW6QUBSd5vAT9iVQWrMcEA6aavA+nCZQSGTXUC/MqXAt0WaQQAAmy/7vb7Kdj9RdXE+f5KrQbYkOELBQDtCN3C3QaJmOEJEST1C+nGfQSMhOUJcETRCAADsjc48EDo9v/5MLD+3zEVBv3VjQTDi6UHTMTNBFoRvQSva8EHZxS1Bsx1YQb0a5EEAAGjwBD8eevu+mQgzvyMu8kCOZ8m/4bmKQXXkpkDCyFDAEz2GQWd5t0BJZtu/Pp6AQQAA7jb6vueoFr+U4SQ/2cUtQbMdWEG9GuRB0zEzQRaEb0Er2vBByjorQdK+Z0G/R+pBAACFzQw/v4YPv7h2Hr915KZAwshQwBM9hkEjLvJAjmfJv+G5ikFo+9pAx3pVwFpXkkEAAJXBJz8i2Ts/8po3vhkRuUEiaThC+HI4Qi5yu0FI1jdC/3I6QgAzukGjXjdCG0I2QgAAysUyPsXwez+kgAA9N3C3QaJmOEJEST1CGRG5QSJpOEL4cjhCJ1uzQQn7OELHdTZCAAAqhV0/jbfJPYKg+z7GYY1BxlWDvlAq7kHBT4pBFdCMP3Fl8UH+goBBJtyhv5c4A0IAALjzv7sNCn8/TtuwPSdbs0EJ+zhCx3U2Qvpxn0EjITlCXBE0Qjdwt0GiZjhCREk9QgAASfJvv3usIT4nGZ++43YPQfvjLUKNnAdC8DUIQUqZLkL2cA1C4rYKQVpaMELOcQxCAABKu0o/RMJjPq+UET8BjIVBjvAmP+Fu+UH+goBBJtyhv5c4A0LBT4pBFdCMP3Fl8UEAAK74Wr+W0eE+OCCLvrWuEkHx6CpCuz0AQuN2D0H74y1CjZwHQveHFEH8mC9CHmUGQgAAMltfP4LVhT2+7/c+eL6DQbdcCcD/yABCxmGNQcZVg75QKu5B/oKAQSbcob+XOANCAACvu1m/tx21Ph9Gx77itgpBWlowQs5xDEL3hxRB/JgvQh5lBkLjdg9B++MtQo2cB0IAAJrFFT8DBc8+9/gzPwGMhUGO8CY/4W75QWfuckGzwZm9nmoDQv6CgEEm3KG/lzgDQgAAr4IaP5qwlz7ffz0/GZNLQfRtDcGXvipCSYpCQb6aDsEitCxCNpBBQfExE8GyXC1CAACOySQ/b+BcPtH3Oz8Zk0tB9G0NwZe+KkI2kEFB8TETwbJcLUI3OUtBvKQTwR9HK0IAAFjtJT9gOpW+Qxo0P1PqSUEPNQrB3XUrQkmKQkG+mg7BIrQsQhmTS0H0bQ3Bl74qQgAAmsEiP/ylCb+pxQ0/xc9DQcaIGcGn+StCb8hNQV7gFsEuwilCNzlLQbykE8EfRytCAADrGBY/ErXPvq+AMz83OUtBvKQTwR9HK0I2kEFB8TETwbJcLULFz0NBxogZwaf5K0IAAM/Oaz9BbqE9Mi3DPjc5S0G8pBPBH0crQq7iUUGXThHB8yEnQhmTS0H0bQ3Bl74qQgAA7B9tP9po2jyleMA+ruJRQZdOEcHzISdCNzlLQbykE8EfRytCb8hNQV7gFsEuwilCAABBi18/ErpZvsmC4D6u4lFBl04RwfMhJ0L2I1BBL1QHwQA2KUIZk0tB9G0NwZe+KkIAAMqIIj87ZQq/cUwNP8XPQ0HGiBnBp/krQhQdS0Fi/RvBKkYpQm/ITUFe4BbBLsIpQgAAqVk9P+lmqT4FBxY/AYyFQY7wJj/hbvlBwU+KQRXQjD9xZfFBsZeEQZSSMEA4H/FBAABwJXs/VjoKPrtmDj40DVFBUhiVQZ1t2UHCxUlBXhWSQesG9kE8BVJBXHmPQYZ320EAAFXyaj+luaI90jjHPni+g0G3XAnA/8gAQnKnhEGRoZ/AjAgCQmh7ikEhIRXAYPrxQQAAShJ6P7ka6L3Z1jk+cqeEQZGhn8CMCAJCyUuIQfdogcCSLvVBaHuKQSEhFcBg+vFBAACHBDm/R7XIPp+3ET/K50xAIsp9wOdcmEGHZIZA9VmJwENNpEG74VhAltcBwPGXj0EAAGfyCD/NLBe/i68av2j72kDHelXAWleSQeGDpEBJuYvASViOQXXkpkDCyFDAEz2GQQAAYrkKP0CiHr/fWRG/4YOkQEm5i8BJWI5BaPvaQMd6VcBaV5JBJKbAQKDrlsDTHJhBAACNgO07eeYcPEb7f7+imSVB7EogQRMBMEGVriVBJss2QWQ4MEHTCytB5nEgQY4LMEEAAAWqT7oQk/o7EP5/v2mFTUFPeiFBlQYwQdMLK0HmcSBBjgswQZWuJUEmyzZBZDgwQQAAIULnPDGvf7/ERCe9opklQexKIEETATBB0wsrQeZxIEGOCzBBNQcoQZnzH0F8BjpBAAD7njE6t7B/v41mSb3TCytB5nEgQY4LMEHcPjhBVA0gQQo1OEE1ByhBmfMfQXwGOkEAAG698zwhtH6/N57EvWmFTUFPeiFBlQYwQdw+OEFUDSBBCjU4QdMLK0HmcSBBjgswQQAATr9ov3JpSr7iqLs+Fi4TQc6PE0J0JdxBO1AIQYJNCkKXrsRBwzoZQZ0HCUISSthBAADlPO++O+idvvcdVL+CsBRBdZIvQQDvO0H40CFBZKEKQQVIQkHxsxlBR9/YQHYYUkEAAMbdar9OGOy9H/fCPjtQCEGCTQpCl67EQSzQEkHtEwRCwY/NQcM6GUGdBwlCEkrYQQAA6PvSveV1qr5X82+/3D44QVQNIEEKNThB+NAhQWShCkEFSEJBNQcoQZnzH0F8BjpBAAAK/Zu+b+eHvm4rar81ByhBmfMfQXwGOkH40CFBZKEKQQVIQkGCsBRBdZIvQQDvO0EAAPzb9L65VZ2+SJ1Sv8BaC0EEkwpB4C1PQYKwFEF1ki9BAO87QfGzGUFH39hAdhhSQQAAhikYv0frfb7U1kO/wFoLQQSTCkHgLU9B3dAIQTzpP0Hq3D9BgrAUQXWSL0EA7ztBAABHl5s+r/tLv0yyBb+ZF4xAmDyswIUxl0E+m3NALy2OwCwRiUHhg6RASbmLwElYjkEAABLY+L35eaG+a+9wv/jQIUFkoQpBBUhCQdw+OEFUDSBBCjU4QQJ4OkEHk+lAGmtGQQAAWLPCPhShR789nf6+4YOkQEm5i8BJWI5BJKbAQKDrlsDTHJhBSyKwQPsOrsCsBp5BAAD1NK0+gjNMv1yj/77hg6RASbmLwElYjkFLIrBA+w6uwKwGnkGZF4xAmDyswIUxl0EAAHR6Gz9xBK2+0Q84v6mWbEE4HAxBC3lPQUVyeEELa3tAnMx9QfB5YEHmGfxAftlLQQAAJBfsvZACcb+sOaK+R407QIKwmsAUcY9Bku1DQPeak8BqzIlBasxwQDppq8D6cJlBAADyRDK+84Jwv5UMl76S7UNA95qTwGrMiUGZF4xAmDyswIUxl0FqzHBAOmmrwPpwmUEAAGP+CD66Nlu/kGj/vpLtQ0D3mpPAasyJQT6bc0AvLY7ALBGJQZkXjECYPKzAhTGXQQAAQz4Uv+NjUL/B2jg9asxwQDppq8D6cJlBRbpBQFJ3m8BP2JVBR407QIKwmsAUcY9BAACL/Lw+s0okvzwXLL8+m3NALy2OwCwRiUF15KZAwshQwBM9hkHhg6RASbmLwElYjkEAAEdRlj5A9FW/65PtPj5iQUERSy1C77sfQhAiRUF2HypCT24ZQt9+YEG8Di1CcmMaQgAASkbdvApUfb+a8BA+PBe0QcBbM0KzBj5COEK4QaIqM0IbFT1Ckku3QQORM0JVyT9CAAC+RDU/bT8vvxdbMb6hz71BH9I0Qt1DPUIiZLtBjcMzQvN+PEId6rpB5rY0QrPDN0IAABRvbD/fLpq+VAtzvqHPvUEf0jRC3UM9Qh3qukHmtjRCs8M3QrOeu0EiDzZCTG43QgAAR54LP7dVUr/JzCk+CaVhQR2OLEJE9BZC335gQbwOLUJyYxpCNC9UQa9BKkIFohZCAAAWc4C9Yfh+vzsPgz04QrhBoiozQhsVPUI8F7RBwFszQrMGPkJ5xKxBJy0zQryaN0IAACGvLr7fNXq/f/L/PXnErEEnLTNCvJo3QjwXtEHAWzNCswY+Qki4qUHm0jNCfZY6QgAAtoyfPs8Scb8S9QG+OEK4QaIqM0IbFT1CiB23QQ0YNEIgzDRCImS7QY3DM0LzfjxCAADgdA8/E11Ovye+Qr6IHbdBDRg0QiDMNEId6rpB5rY0QrPDN0IiZLtBjcMzQvN+PEIAAMW3Vr/iwIC+0En3PlRTH0E8NARCq47YQcM6GUGdBwlCEkrYQSzQEkHtEwRCwY/NQQAAiSLIvumAu76tLVg/+GMnQTm79kE1adNBORswQXGUAEJl89lB2AwjQeU6AEIloNZBAAAZyVu/yIkUvuHN+z4HHhhBcAj4QZRvzUFUUx9BPDQEQquO2EEs0BJB7RMEQsGPzUEAAG3zJ79gxaO+u/4uP9gMI0HlOgBCJaDWQVRTH0E8NARCq47YQQceGEFwCPhBlG/NQQAAlic2PgWQHL/JW0U/xc9DQcaIGcGn+StCNpBBQfExE8GyXC1CTTA5Qc0sGcHEqCxCAABVn2S/aidvvZBs5D47UAhBgk0KQpeuxEHWPQhBJ0L0QXJgwEEs0BJB7RMEQsGPzUEAAHvZU7/bug++KCgLPyzQEkHtEwRCwY/NQdY9CEEnQvRBcmDAQQceGEFwCPhBlG/NQQAA8tdLP158Cz/gkoY+cVpLQf0qAcHJpClC9iNQQS9UB8EANilC/O1RQVaW9cAIXCFCAADllHk/ppJtvDdgYz4EXVRB9T0OwXl2JEL2I1BBL1QHwQA2KUKu4lFBl04RwfMhJ0IAACc+cD9/CoS+l09rPq7iUUGXThHB8yEnQm/ITUFe4BbBLsIpQoZtT0EEbRvBgc0mQgAAIrtxP7eOlD3QZ6Q+b7hXQTxngkHoCdZBPAVSQVx5j0GGd9tBsFlVQR2ocUHAr9tBAABQrkk/9bQHvwWOoD5vyE1BXuAWwS7CKUIUHUtBYv0bwSpGKUKGbU9BBG0bwYHNJkIAAEHFPj8+niq/6C+1PAmlYUEdjixCRPQWQlqcWEHb4ilCiZ8SQt3nX0Ev2ytCVooQQgAAC8d0P9zjgL4OMhk+hm1PQQRtG8GBzSZCBF1UQfU9DsF5diRCruJRQZdOEcHzISdCAADXBAk/GpNQv8tUZD4JpWFBHY4sQkT0FkI0L1RBr0EqQgWiFkJanFhB2+IpQomfEkIAAOpL0j4S2z6/al0GP6nYPkGC9SHB6I0pQqXKRUGmyiHBSEEoQhQdS0Fi/RvBKkYpQgAA552iPh3AXb9RgMU+335gQbwOLUJyYxpCECJFQXYfKkJPbhlCNC9UQa9BKkIFohZCAADoUnY/BLR/vhiT3j1yp4RBkaGfwIwIAkJpq35BNGTYwFpHCULJS4hB92iBwJIu9UEAADwcBD+kPJa+iwJOP4tBWUEqh/pBYqrRQaB/UUGue/JBMDjRQZgEXUHpFO9BHknMQQAAKMZXv000ur5pEss+RbpBQFJ3m8BP2JVB+tdIQLzjlcB6A5lBcQMXQIm8hcDLeo9BAADSQ02/6vALPonsFD/K50xAIsp9wOdcmEFxAxdAibyFwMt6j0H610hAvOOVwHoDmUEAAB8XKL89T9Y+S58gP8rnTEAiyn3A51yYQbvhWECW1wHA8ZePQct7yT92NzjAc++EQQAAmoISP55Eur70Izy/8HlgQeYZ/EB+2UtBRXJ4QQtre0CczH1BjY9uQdBddkDruXZBAADs3Gk/vTqKvRJizT5oe4pBISEVwGD68UHGYY1BxlWDvlAq7kF4voNBt1wJwP/IAEIAAMFLbT9Ipkg+fNWjPjwFUkFceY9BhnfbQVyIVUFGVZVBwcrSQTQNUUFSGJVBnW3ZQQAAMLV1PyqpzT28NIY+PAVSQVx5j0GGd9tBb7hXQTxngkHoCdZBXIhVQUZVlUHBytJBAABZdL++gWnqPod7Tj/sLqhBotQ1QnhUPEJ8HqVBJic3QnzeOkIY0ppBfBU2QrIWOUIAADJR1T5EBT6/tFsGPxAiRUF2HypCT24ZQkqHTEFkxidCf6QUQjQvVEGvQSpCBaIWQgAAWiROP7P4Db4blhM/8lhkQXAV+EHuVMlBi0FZQSqH+kFiqtFBmARdQekU70EeScxBAABfOiE/Kbo9v+gpbj6GbU9BBG0bwYHNJkIUHUtBYv0bwSpGKUKlykVBpsohwUhBKEIAAMbz1z6PrEe/vLTsPhQdS0Fi/RvBKkYpQsXPQ0HGiBnBp/krQqnYPkGC9SHB6I0pQgAAcEgGPuq9R79QkBw/TTA5Qc0sGcHEqCxCqdg+QYL1IcHojSlCxc9DQcaIGcGn+StCAAAOFQY/imzHvnTyQb+Nj25B0F12QOu5dkFcj2BBibAMQDOhekHweWBB5hn8QH7ZS0EAAFXF1z5tWdS+fXROv1yPYEGJsAxAM6F6QalLU0GD2dRACw5PQfB5YEHmGfxAftlLQQAAdqsDPp2c3r6VLGS/qUtTQYPZ1EALDk9Br8ZJQYQ8h0ChnGBBAng6QQeT6UAaa0ZBAABFWnc/bH/JvT3pcz7lK41BYdlJwLhY5EFoe4pBISEVwGD68UHJS4hB92iBwJIu9UEAANDenT7FYei+UwVWv6/GSUGEPIdAoZxgQalLU0GD2dRACw5PQVyPYEGJsAxAM6F6QQAAYON4PSy06L4CgGO/bnQ6QYSuREDF/2hBAng6QQeT6UAaa0ZBr8ZJQYQ8h0ChnGBBAACBxnI/bkaNvlBSID5i04dBXTKVwE9170GKNpJB6/Hsvywt2EHlK41BYdlJwLhY5EEAAKfTcj+XQoy+B6AiPslLiEH3aIHAki71QWLTh0FdMpXAT3XvQeUrjUFh2UnAuFjkQQAAbS9kP0aPYz4NTMo+HLeMQcXGp0AeVdlBwU+KQRXQjD9xZfFBb0iRQWfTJT9ZtONBAAC8gim/xTWkvnphLb+doAlBpgeXQM66bkFuBepA69O0QLPUe0HAWgtBBJMKQeAtT0EAAJgLPz8gvbK99+4oP0lpZEFboOBBfDHGQfJYZEFwFfhB7lTJQZgEXUHpFO9BHknMQQAARyxGvjmM/L7wG1m/NjwsQbbnqUC6bldBbnQ6QYSuREDF/2hB3z4dQRAhCkCiLXhBAACobgC/novUvl1JQr+doAlBpgeXQM66bkHxsxlBR9/YQHYYUkHfPh1BECEKQKIteEEAAOddFD6JyeK+6X9iP/jGTkFUUwFCWYnZQe7fQUFu7fZBSLnUQaB/UUGue/JBMDjRQQAAfM6fvNcIUr+ORhI/nUw1QbGcHcGECCtCqdg+QYL1IcHojSlCTTA5Qc0sGcHEqCxCAADR1BC+CIxkv14C2z7BhDhBV2AlwYk/J0Kp2D5BgvUhweiNKUKdTDVBsZwdwYQIK0IAAJ0FD73aIcC+iB9tP+7fQUFu7fZBSLnUQS8gJ0G48+tB6cXPQWzFS0GH0eZBT2LOQQAAJdSDPcJz0b5XBGk/7t9BQW7t9kFIudRB+MZOQVRTAUJZidlBORswQXGUAEJl89lBAAAD3YA+OLCSvnenbD/u30FBbu32QUi51EFsxUtBh9HmQU9izkGgf1FBrnvyQTA40UEAAHFfFj9FviC+Fz9LP0ieW0EEUeJBikfKQZgEXUHpFO9BHknMQaB/UUGue/JBMDjRQQAA104YPwejS7/DAuw9pcpFQabKIcFIQShCABNGQRVqJcF2oyFChm1PQQRtG8GBzSZCAAARmxs/zntJv0G81z1ywFFBNIccwTNkIUKGbU9BBG0bwYHNJkIAE0ZBFWolwXajIUIAAARgYT52VXe//NQJPgATRkEVaiXBdqMhQqXKRUGmyiHBSEEoQsGEOEFXYCXBiT8nQgAAnlJEPwXrGj6lqh8/pbJZQfo1jEGtcdJBXIhVQUZVlUHBytJBb7hXQTxngkHoCdZBAADfbJ++BiRYv1lL3z7IZDFBKkMqQmN7GUIv+ipBK48sQobIHEJIOiZBR04qQq+SF0IAALc2Ir4uTVi/UskCPy/6KkErjyxChsgcQshkMUEqQypCY3sZQj5iQUERSy1C77sfQgAAKGWZvne2Pj+3lRg/fB6lQSYnN0J83jpCf5KrQbYkOELBQDtCAcehQQtIOEJknjhCAABiLKm8jvdkvyfB5D4+YkFBEUstQu+7H0LIZDFBKkMqQmN7GUIQIkVBdh8qQk9uGUIAADi2Ur6dE04/g3QOP6/ZmUFdRzdCgZo4QnwepUEmJzdCfN46QgHHoUELSDhCZJ44QgAAfAdcv1nxjDwAyAI/GOLZP6uzcMDH5YZBtPr/Px18ecC/8IpBy3vJP3Y3OMBz74RBAADXDbi+s1tjPsgGaD8Y0ppBfBU2QrIWOUJ8HqVBJic3QnzeOkKv2ZlBXUc3QoGaOEIAAGbLMD2gqX+/UX3jPAATRkEVaiXBdqMhQsGEOEFXYCXBiT8nQmT1M0G8JSbBaRYiQgAAOehCPm+3dL+57WQ+wYQ4QVdgJcGJPydCpcpFQabKIcFIQShCqdg+QYL1IcHojSlCAABJmgK/ROlbv0zQLT0WVxtBrp8rQvluF0LiQw5BH7YtQp1lGkKNfRFBKBotQvjBF0IAAKsT3r5mM/6+Jn1AP00wOUHNLBnBxKgsQk6tNUHNJxLBwk8tQr7pLkEtlBPB5BksQgAAzsMXv3Insz6trzk/vukuQS2UE8HkGSxCTq01Qc0nEsHCTy1Co8Q0QaUPD8GuwCxCAADXKgK/WvAJvxvyKz9NMDlBzSwZwcSoLEJioi1BsSEcwSnhKUKdTDVBsZwdwYQIK0IAAKjK775AGhq/55ElP00wOUHNLBnBxKgsQr7pLkEtlBPB5BksQmKiLUGxIRzBKeEpQgAANeEFvw6hEj+rlyE/rHMoQXl5BsEUDypCxhU0QfghA8HZtStCMxUuQWQ7AMEhzylCAACCQgm/OCbaPiGLOj+scyhBeXkGwRQPKkKNvTBBFScLwXdELELGFTRB+CEDwdm1K0IAAKi/O71v4ei+Fa9jvwJ4OkEHk+lAGmtGQW50OkGErkRAxf9oQTY8LEG256lAum5XQQAAhWhkviCUwr75zWW/8bMZQUff2EB2GFJBAng6QQeT6UAaa0ZBNjwsQbbnqUC6bldBAABHcnM/p3IrvjsohT6KNpJB6/Hsvywt2EHr/JRBItmUPpsP2UFoe4pBISEVwGD68UEAAKVoRD9fvho+QJIfP7XzW0GfNoJBBHvTQaWyWUH6NYxBrXHSQW+4V0E8Z4JB6AnWQQAA4aZlP8XwAj4Qj9g+xmGNQcZVg75QKu5Bb0iRQWfTJT9ZtONBwU+KQRXQjD9xZfFBAAAPV3E/J3e6vetJpD5oe4pBISEVwGD68UHr/JRBItmUPpsP2UHGYY1BxlWDvlAq7kEAALUGpr61HuS+tJ9Vv/GzGUFH39hAdhhSQTY8LEG256lAum5XQd8+HUEQIQpAoi14QQAAuyxxP8GJx7ysQKs+6/yUQSLZlD6bD9lBb0iRQWfTJT9ZtONBxmGNQcZVg75QKu5BAAAJ6kQ/gDT8PVSFID+181tBnzaCQQR700FvuFdBPGeCQegJ1kEvAVtBlRJhQYeI10EAACYyVj5YpkU/BqIZP9eFskHOmOY/DB5WQXFsq0HF2cU/EFVgQViYpUGRYyk/ppd2QQAATgCnvTzQeT9fmE8+f5KrQbYkOELBQDtC+nGfQSMhOUJcETRCAcehQQtIOEJknjhCAABWkXI/uZPdPZECmj5vSJFBZ9MlP1m040Hr/JRBItmUPpsP2UH+qphBFV8nQM3HxkEAAF1Sez/mmB++AaLfPUmKlUFl/CO/WnbJQZJhmkFpzhRAn82/Qev8lEEi2ZQ+mw/ZQQAAPdd6P2B6KL7f+uc9ijaSQevx7L8sLdhBSYqVQWX8I79adslB6/yUQSLZlD6bD9lBAABNx9y+yxHjvpslST/sLqhBotQ1QnhUPEIg9aBBwKw0QuGxOUKyhKlB94g0Qgz3O0IAAOzAmj5V0pa+/BRoP0ieW0EEUeJBikfKQaB/UUGue/JBMDjRQWzFS0GH0eZBT2LOQQAAdfQjPxAPHb7EpUA/mARdQekU70EeScxBSJ5bQQRR4kGKR8pBSWlkQVug4EF8McZBAAArCZ+9upUBvxHiWz/u30FBbu32QUi51EE5GzBBcZQAQmXz2UH4YydBObv2QTVp00EAAFwMtr0/kqK+7K5xP/hjJ0E5u/ZBNWnTQS8gJ0G48+tB6cXPQe7fQUFu7fZBSLnUQQAA+BEuv7ijlb7ZJyw/LyAnQbjz60Hpxc9B2AwjQeU6AEIloNZBBx4YQXAI+EGUb81BAABhGQm/WuAwvp2fUz/HBx1BWtToQbzZy0EvICdBuPPrQenFz0EHHhhBcAj4QZRvzUEAAL+Z0D4n2Q4+sQtnP6WyWUH6NYxBrXHSQbXzW0GfNoJBBHvTQZ9CaUHZgoZB+c/PQQAA833NPugdRz6xIWU/LwFbQZUSYUGHiNdBW5FvQUVdW0EAi9NBtfNbQZ82gkEEe9NBAACdxcI+1+g8Pqb+Zz9bkW9BRV1bQQCL00GfQmlB2YKGQfnPz0G181tBnzaCQQR700EAAEboWz5X/0Q/U/cZP1iYpUGRYyk/ppd2QXFsq0HF2cU/EFVgQat/mkE54lA/xFt7QQAAam5Xv8Chyb6YVL0+RbpBQFJ3m8BP2JVBcQMXQIm8hcDLeo9BhTUrQNknlcCNHpFBAAAEeoC9ukBxP1k6qD5xbKtBxdnFPxBVYEFJpaVBHRCvP7tLZkGrf5pBOeJQP8Rbe0EAALaAeb/qbuw9imdEPm47I0HICJVBBpHUQZ2sIUFSMoxBiO3VQRb5J0E+1ZJBxO/hQQAAvQvavoFqWL9eGKU+FlcbQa6fK0L5bhdCxwUhQTtXKUIHUxNCSDomQUdOKkKvkhdCAABYTga/5qZZv1ZCMz2NfRFBKBotQvjBF0JYbAxBC28tQmEDD0KxqBhBIqYrQnACEUIAADFgAr/v8Vu/WdxLPY19EUEoGi1C+MEXQrGoGEEipitCcAIRQhZXG0GunytC+W4XQgAAtuqCvmrRXb/Ahts+SLipQebSM0J9ljpCsoSpQfeINEIM9ztCIPWgQcCsNELhsTlCAAANU02/QCHiPUZDFj/K50xAIsp9wOdcmEHLe8k/djc4wHPvhEFxAxdAibyFwMt6j0EAABgXx76+9gS/CM1CP+wuqEGi1DVCeFQ8QhjSmkF8FTZCshY5QiD1oEHArDRC4bE5QgAAzbAVv1BeT78cWjS9R407QIKwmsAUcY9BhTUrQNknlcCNHpFBkCEMQD7Nh8B8SodBAACnyde9lkp7v5kGIz5IuKlB5tIzQn2WOkL7tKBBJfIzQqVbOEJ5xKxBJy0zQryaN0IAAJnGWb83ssy+kMCuPrT6/z8dfHnAv/CKQSlCFUBMFIzAUhONQXEDF0CJvIXAy3qPQQAABqxKvp9JWr/Nivc++7SgQSXyM0KlWzhCIPWgQcCsNELhsTlCHUOWQeXZNEIS0TdCAACHNqi9ZHtyvwCznj77tKBBJfIzQqVbOEK4cZNBjW4zQqoHNUJ5xKxBJy0zQryaN0IAAK9whb6LT1a/0Db2Pki4qUHm0jNCfZY6QiD1oEHArDRC4bE5Qvu0oEEl8jNCpVs4QgAArdFpP53tIz6crb++s567QSIPNkJMbjdCh0GzQbgTNkJZPC1CADO6QaNeN0IbQjZCAACc2HM/pvMdviFmhj6KNpJB6/Hsvywt2EFoe4pBISEVwGD68UHlK41BYdlJwLhY5EEAACcvQL+fIMS9JlUnP429MEEVJwvBd0QsQqxzKEF5eQbBFA8qQofvKkFo3Q3BWoAqQgAAixMVvo5zYT8w0OY+xhU0QfghA8HZtStCyfM1Qfyo98BrSyhCMxUuQWQ7AMEhzylCAABMrBK/0vIaP4R4DT+1qyhBdHgEwSGRKUKscyhBeXkGwRQPKkIzFS5BZDsAwSHPKUIAALkOGr/kpb4+5d80P4fvKkFo3Q3BWoAqQr7pLkEtlBPB5BksQqPENEGlDw/BrsAsQgAAd/XovJl+o77ofHI/2AwjQeU6AEIloNZBLyAnQbjz60Hpxc9B+GMnQTm79kE1adNBAAAxqxU8pjRsvtMVeT/KQSpBJtrgQXwgzUFsxUtBh9HmQU9izkEvICdBuPPrQenFz0EAALBVJL9xwjm+3bc+P8cHHUFa1OhBvNnLQQceGEFwCPhBlG/NQXEiEUEGk+VBy+7FQQAA1B4ov33Ir74n5Cs/h+8qQWjdDcFagCpCo8Q0QaUPD8GuwCxCjb0wQRUnC8F3RCxCAAAhjG4/hhi2vlfSkz1i04dBXTKVwE9170ExjoRBYyy7wEjl6kGKNpJB6/Hsvywt2EEAALZgtD49lm+/P2CeuinpeEHHvy5COYATQgmlYUEdjixCRPQWQoCiakE9aS1CcEYPQgAAwflRvxQehj2MexE/h+8qQWjdDcFagCpCgoAoQRFJFMHnzilCvukuQS2UE8HkGSxCAAAgfFi/MU3QvgPlsD5xAxdAibyFwMt6j0EpQhVATBSMwFITjUGFNStA2SeVwI0ekUEAAOtAN7+4x+W+WvIIP77pLkEtlBPB5BksQoKAKEERSRTB584pQmKiLUGxIRzBKeEpQgAAqp8dv+yfSb+u7sW8KUIVQEwUjMBSE41BkCEMQD7Nh8B8SodBhTUrQNknlcCNHpFBAADWVgU/WAlav1mOaz3d519BL9srQlaKEEKAompBPWktQnBGD0IJpWFBHY4sQkT0FkIAACXRcj+ncqC+yVc9vXy5jUHEZkTAYR2+QYo2kkHr8ey/LC3YQSH+ikFxW4vA1s/LQQAAVL5uP75QuL72f9W8ijaSQevx7L8sLdhBfLmNQcRmRMBhHb5BSYqVQWX8I79adslBAAC8AVS/xU+DPRaMDj9xAxdAibyFwMt6j0HLe8k/djc4wHPvhEG0+v8/HXx5wL/wikEAADHwar/HVEw+6tivPsYkJUGIFxDBqPQmQoKAKEERSRTB584pQofvKkFo3Q3BWoAqQgAA5vJkv0BPUr5+gss+h+8qQWjdDcFagCpCrHMoQXl5BsEUDypCxiQlQYgXEMGo9CZCAADJtwm/vZBXvx8SIT1FukFAUnebwE/YlUGFNStA2SeVwI0ekUFHjTtAgrCawBRxj0EAAB/VHz6kUXs/3SnfvUpDqEFM/jhCN6EuQidbs0EJ+zhCx3U2QkGOsEG3XThC+uouQgAAANAJPzl9Tj96/Xm+GRG5QSJpOEL4cjhCADO6QaNeN0IbQjZCQY6wQbddOEL66i5CAABBZY8+MIJzPxabBL5BjrBBt104QvrqLkInW7NBCfs4Qsd1NkIZEblBImk4QvhyOEIAABzVhr6MyGe/3H+qvkeNO0CCsJrAFHGPQZAhDEA+zYfAfEqHQZLtQ0D3mpPAasyJQQAA5lYbPxg2wz7cizI/zyKyQVtFC8DcC35B6Eq9QV+KNT6CDFZB4cGnQbHJAL9vvIBBAAAJmk4/iTbpPv1mwL6HQbNBuBM2Qlk8LUKV1rBBfSA3QoDpK0IAM7pBo143QhtCNkIAAMeWeL9Fn/K9wmdUPvvkKUFwK3ZBj43wQWZFLUGH0IRBfQP+Qa9jIUEaM3BBuPDaQQAA4Pt6v8uXlj3FIjs+r2MhQRozcEG48NpBgFonQQ9QckFhg+pB++QpQXArdkGPjfBBAAALWH2/S/u+PdXZ3z1/vzBBhjuQQaDwBUIW+SdBPtWSQcTv4UGvYyFBGjNwQbjw2kEAAEO41j3yoEm/jXAbv9liHEBWDF/AGH16QT6bc0AvLY7ALBGJQZLtQ0D3mpPAasyJQQAA2scWP0arQT9Gg5G+ldawQX0gN0KA6StCQY6wQbddOEL66i5CADO6QaNeN0IbQjZCAAC7RTS/scA1vxxO+juQIQxAPs2HwHxKh0EpQhVATBSMwFITjUEY4tk/q7NwwMflhkEAAIKdcD9oiqu+JMKGPTGOhEFjLLvASOXqQbyEhUHuML3ACpLaQSH+ikFxW4vA1s/LQQAAM6JLv/kgAr+v8qg+xb8mQT92GsGJXyZCYqItQbEhHMEp4SlCgoAoQRFJFMHnzilCAABX0G0/K7K7vt2HUj0h/opBcVuLwNbPy0GKNpJB6/Hsvywt2EExjoRBYyy7wEjl6kEAAPwCdj/fLg6+U/l0PtlQiUHjgbXAiW7MQSH+ikFxW4vA1s/LQbyEhUHuML3ACpLaQQAAEu53v2eURDyryX4+rHMoQXl5BsEUDypCVfAhQRzVDME9zCNCxiQlQYgXEMGo9CZCAACkqR+/e4w8Pw8Qhj4zFS5BZDsAwSHPKUL4zStBNKbuwE4wIkK1qyhBdHgEwSGRKUIAAMt5a796j6Q+z2BmPrWrKEF0eATBIZEpQs03IkG0CPzAnaogQqxzKEF5eQbBFA8qQgAAd+FMvxEsDD9VLHo+zTciQbQI/MCdqiBCtasoQXR4BMEhkSlCi2olQbhR6sCnUh5CAABmRfe+1KuIvvN+VT/HBx1BWtToQbzZy0HKQSpBJtrgQXwgzUEvICdBuPPrQenFz0EAAJyLdr+DwgW+VhpxPsYkJUGIFxDBqPQmQkjUI0G8GRbBOsckQoKAKEERSRTB584pQgAAhotuv677ir4krnY+goAoQRFJFMHnzilCSNQjQbwZFsE6xyRCxb8mQT92GsGJXyZCAAAAJO0+t21hv9Jfzb3d519BL9srQlaKEEIfo2xB4dgtQv7BDUKAompBPWktQnBGD0IAAIgOSz+zLBi/wXUHPtfYXEGXyylCUd0LQt3nX0Ev2ytCVooQQlqcWEHb4ilCiZ8SQgAAF0k/P1UCJb+jySU+TotlQedbK0InDghC3edfQS/bK0JWihBC19hcQZfLKUJR3QtCAACN8OY+BBhVPy3ZpL5BjrBBt104QvrqLkKV1rBBfSA3QoDpK0L4Eq1BEXE4QrKsLEIAAJxCrL6uygS+ecduP8cHHUFa1OhBvNnLQcQWHUEH6dVBDzvJQcpBKkEm2uBBfCDNQQAAcSp5v5YDfj2JSWI+r2MhQRozcEG48NpBFvknQT7VkkHE7+FBnawhQVIyjEGI7dVBAADb+TG/Md8OvarLNz9xIhFBBpPlQcvuxUHADwtB2ujVQTs7wkHHBx1BWtToQbzZy0EAAPUPHL8Fk+C9mvpIP8cHHUFa1OhBvNnLQcAPC0Ha6NVBOzvCQcQWHUEH6dVBDzvJQQAAAbtXvwzDub5Oqcs+GOLZP6uzcMDH5YZBKUIVQEwUjMBSE41BtPr/Px18ecC/8IpBAADvZmA/kHejvjtiuL6znrtBIg82QkxuN0Id6rpB5rY0QrPDN0KHQbNBuBM2Qlk8LUIAAP22Wz/Bovy+pIIQPlqcWEHb4ilCiZ8SQjAfVUFTnidCtv8PQtfYXEGXyylCUd0LQgAAuVAuPwKCK79odpe+y5+yQfW9NEItKS5CHeq6Qea2NEKzwzdCiB23QQ0YNEIgzDRCAAAw50E/utkYv3dEhz4wH1VBU54nQrb/D0JanFhB2+IpQomfEkI0L1RBr0EqQgWiFkIAAKvWHT9ATzm/A4mePjAfVUFTnidCtv8PQjQvVEGvQSpCBaIWQkqHTEFkxidCf6QUQgAA5voKP9crMT91kPO+qexQQfJxH0LOuLZBcpxUQZW2JkIg+c1ByTpcQaF/IULEJcNBAABXyd8+xrM6v5XABj9Kh0xBZMYnQn+kFEIQIkVBdh8qQk9uGUJGMUpB2iwlQoWGEUIAAMfVqD7Vd2+/FYUCvogdt0ENGDRCIMw0QjhCuEGiKjNCGxU9QrfJsUGUtzNC8KswQgAALrtSPzs94r4wkLa+y5+yQfW9NEItKS5Ch0GzQbgTNkJZPC1CHeq6Qea2NEKzwzdCAACJvDk/tNgWv3kGtj5Kh0xBZMYnQn+kFEJGMUpB2iwlQoWGEUIwH1VBU54nQrb/D0IAAOjphrypOU2/KvkYPx7BMkEAvh1C0bEIQhAiRUF2HypCT24ZQshkMUEqQypCY3sZQgAAN1u3PipfND+21Ry/qexQQfJxH0LOuLZBmJlYQRdqG0Kwsa9BF0JSQacBGUJGTahBAACNygE/mgNTvxwMgb7Ln7JB9b00Qi0pLkKIHbdBDRg0QiDMNEK3ybFBlLczQvCrMEIAAGXl6D4jaTi//gsGP0YxSkHaLCVChYYRQhAiRUF2HypCT24ZQlMuQ0F/0xxC8o8HQgAAl23CvoV8Wr8+v7Y+YqItQbEhHMEp4SlCwYQ4QVdgJcGJPydCnUw1QbGcHcGECCtCAABffzk/KCsOv4ny0D4wH1VBU54nQrb/D0JGMUpB2iwlQoWGEUKxGEpB6AoeQqvcB0IAAIuK876J91e/NRF/PmKiLUGxIRzBKeEpQjbcLUE28yLB1DYkQsGEOEFXYCXBiT8nQgAAw6MnOnsMSz9Y6Bu/JNcpQSoRI0KzIsBBtm9JQaR8JUKGdMZBqexQQfJxH0LOuLZBAAAMLWm8zU5Nv47gGD9TLkNBf9McQvKPB0IQIkVBdh8qQk9uGUIewTJBAL4dQtGxCEIAADR9IL/dbD+/nvxfPmKiLUGxIRzBKeEpQsW/JkE/dhrBiV8mQjbcLUE28yLB1DYkQgAA1MqsvnNYb7+CNOA9ZPUzQbwlJsFpFiJCwYQ4QVdgJcGJPydCNtwtQTbzIsHUNiRCAACrG2i/6PC5PQzr0j5m1h1Bf3uLQX/C0kHtyB1BMhNvQfsY10GvYyFBGjNwQbjw2kEAABViXL/y9gM+zQX8Pq9jIUEaM3BBuPDaQZ2sIUFSMoxBiO3VQWbWHUF/e4tBf8LSQQAAca8zv1TTML9KEzI+uazWP7ZEc8Bd0IRBkCEMQD7Nh8B8SodBGOLZP6uzcMDH5YZBAADEH2k/IAGQvlr7mj7ZUIlB44G1wIluzEGONYtBpfC3wKwrxkHV9otBl+yuwFz+xUEAAMenbD/FE4Y7DTzDPtlQiUHjgbXAiW7MQdX2i0GX7K7AXP7FQSCgi0FxuZTAk77GQQAARxLkPgc4Wr9JLYy+y5+yQfW9NEItKS5Ct8mxQZS3M0LwqzBCB2esQe9yM0ITIC1CAADEv3g/wgcTvucyQD4goItBcbmUwJO+xkEh/opBcVuLwNbPy0HZUIlB44G1wIluzEEAAMO9UD9BGuW+3w28vpDxsEHKrTRCUl8sQodBs0G4EzZCWTwtQsufskH1vTRCLSkuQgAAxqT3PVVOET/lelA/CUhXQZnMrj+17AJC5ZNQQUB8dEBLqfhBsj9KQTkV5z+6LgJCAADn+8A9POwQP2OlUT8JSFdBmcyuP7XsAkKP32FBsN6pQHZv70Hlk1BBQHx0QEup+EEAAAKkHj7e7Hs/4EyyvUpDqEFM/jhCN6EuQkGOsEG3XThC+uouQvgSrUERcThCsqwsQgAACrKPPBjyfz9l7DC8SkOoQUz+OEI3oS5C+nGfQSMhOUJcETRCJ1uzQQn7OELHdTZCAABMD/I9ufB7P4xxB75KQ6hBTP44QjehLkL4Eq1BEXE4QrKsLEJVCalBZT04QmleKUIAAJSbsT4s/gA/0oJKPzL9aEEw9pE/sY4BQo/fYUGw3qlAdm/vQQlIV0GZzK4/tewCQgAAF4NcPX4xf79snm69ecSsQSctM0K8mjdCt8mxQZS3M0LwqzBCOEK4QaIqM0IbFT1CAABmPVy/S3QaPndQ+T5uOyNByAiVQQaR1EFm1h1Bf3uLQX/C0kGdrCFBUjKMQYjt1UEAABwPwLx65X+/hf+DPLhxk0GNbjNCqgc1Qg+yo0Eo/jJCo50lQnnErEEnLTNCvJo3QgAAf+kKPgSIfb9dZea8B2esQe9yM0ITIC1Ct8mxQZS3M0LwqzBCecSsQSctM0K8mjdCAAAKwEq/AfpevlsEEr+D2MNACFcSQeqHd0EmtqVAmVUwQS2AgEHo4sVA2Xk1QVSzaEEAANTnN78mXJa+g3Ahv24F6kDr07RAs9R7QZeGx0CvRbVAC7CHQYPYw0AIVxJB6od3QQAAEhtFv5B8i75TuBO/g9jDQAhXEkHqh3dBl4bHQK9FtUALsIdBT/SsQF6a5UDD2IpBAAAjsTS/JtSNvunnJr/o4sVA2Xk1QVSzaEHAWgtBBJMKQeAtT0FuBepA69O0QLPUe0EAABfeMb+/LIK+lTosv+jixUDZeTVBVLNoQWap/0DaDDZBaaZKQcBaC0EEkwpB4C1PQQAA2LAnv4khjr515zO/bgXqQOvTtECz1HtBg9jDQAhXEkHqh3dB6OLFQNl5NUFUs2hBAABMvye+7/MHP/zSVD/q8h5Bab+dQJ2a8kF38BVBkKywP3DtAULzJCdBqe0gQPDA/0EAAF0ayz4sU2E/S3KFPuWyQ0Ef1vjA1YsoQnFaS0H9KgHByaQpQjT2RkFDjOzADh4iQgAAJEsXvy0GyD4WrTQ/d6/VQMyUwz8yL/VBZ8LqQLO7h794hwJC6CbyQKY05z9C6flBAADpc8c80rx4PwPkcD7lskNBH9b4wNWLKEI09kZBQ4zswA4eIkLJ8zVB/Kj3wGtLKEIAAHg8G7+t8cU++uExP+gm8kCmNOc/Qun5QWfC6kCzu4e/eIcCQjQGB0GpYBK/kEoFQgAA7+X1PpfNBT+ZUjQ/cZO/QSqpIkA72DxBWJilQZFjKT+ml3ZB4cGnQbHJAL9vvIBBAACV1do+8kZePyjygD787VFBVpb1wAhcIUI09kZBQ4zswA4eIkJxWktB/SoBwcmkKUIAAH1P4D6xyVM/1Qi0PneJU0FZgOHAo/MaQjT2RkFDjOzADh4iQvztUUFWlvXACFwhQgAAI0ORPizJOD/imSE/WJilQZFjKT+ml3ZBcZO/QSqpIkA72DxB14WyQc6Y5j8MHlZBAAA7LOO+7VEJPpbWYj9m1h1Bf3uLQX/C0kEElwlBQV+NQYZnzUGX0xlBY8F9QcOp00EAAOWMK79YZSI+EqE5P2bWHUF/e4tBf8LSQZfTGUFjwX1Bw6nTQe3IHUEyE29B+xjXQQAAv4u6PlPkIz94Ii0/14WyQc6Y5j8MHlZBcZO/QSqpIkA72DxBOte5QbdDJ0BE70FBAABUHOY+av1UP0SJpr5VCalBZT04QmleKUL4Eq1BEXE4QrKsLEKV1rBBfSA3QoDpK0IAANfv2T4imGO/KKMsvgdnrEHvcjNCEyAtQpDxsEHKrTRCUl8sQsufskH1vTRCLSkuQgAAYFEMP0PfS7/e44K+kPGwQcqtNEJSXyxCbeerQaZKNEIZLShCJzGsQZFtNEJcDyhCAAAAAAAAAAAAAAAAAAAnMaxBkW00QlwPKEJt56tBpko0QhktKEJt56tBpko0QhktKEIAAAAAAAAAAAAAAAAAAG3nq0GmSjRCGS0oQicxrEGRbTRCXA8oQm3nq0GmSjRCGS0oQgAA+HVPP+4m1L4KE9S+h0GzQbgTNkJZPC1CkPGwQcqtNEJSXyxCrKGpQf8vNULltSRCAADuS0k/JmLuvtHuz74nMaxBkW00QlwPKEKsoalB/y81QuW1JEKQ8bBByq00QlJfLEIAAAAAAAAAAAAAAAAAAG3nq0GmSjRCGS0oQm3nq0GmSjRCGS0oQm3nq0GmSjRCGS0oQgAAPLzqPqaxUT+Pg7C+VQmpQWU9OEJpXilCldawQX0gN0KA6StCJ9umQX5ANkIkMiNCAAB0WsW+Odk+P2MyC78k1ylBKhEjQrMiwEFqaCZBEPEdQjVMs0FGFh9Bh68hQrwowEEAAHSCyz5Pw1k/NzKwvifbpkF+QDZCJDIjQggCoUFrIjdC/v8hQlUJqUFlPThCaV4pQgAA9b1PP6Rpnj7V0P2+J9umQX5ANkIkMiNCldawQX0gN0KA6StCh0GzQbgTNkJZPC1CAAAP1kw/tYiyPlfg+b6HQbNBuBM2Qlk8LUKsoalB/y81QuW1JEIn26ZBfkA2QiQyI0IAAG+kOz8I7wy/fZbMPrEYSkHoCh5Cq9wHQos3T0G2mCBCTQgJQjAfVUFTnidCtv8PQgAAB90iPtoNRj8XAx0/14WyQc6Y5j8MHlZBOte5QbdDJ0BE70FBXFixQb3tC0AH9k5BAABCAyi8DzZIP32DH78k1ylBKhEjQrMiwEGp7FBB8nEfQs64tkFqaCZBEPEdQjVMs0EAAPEEVD5xNUY/vhkZP3Fsq0HF2cU/EFVgQdeFskHOmOY/DB5WQVxYsUG97QtAB/ZOQQAATOgVP8jgJj+/s/a+yTpcQaF/IULEJcNBwxFgQfnYGkIefLNBqexQQfJxH0LOuLZBAAD5vh8/0iYpP3yW1b6YmVhBF2obQrCxr0Gp7FBB8nEfQs64tkHDEWBB+dgaQh58s0EAALauWj+/z+A+e4iOvmA8ZkEoFxZCgPCtQcMRYEH52BpCHnyzQcSsY0E9ux5CrUTFQQAAoJbKPnSXWj9gIK0+d4lTQVmA4cCj8xpC6ptMQf4O2cA9UBpCNPZGQUOM7MAOHiJCAACdLB0/gYNGvzL5Fj5Oi2VB51srQicOCEIfo2xB4dgtQv7BDULd519BL9srQlaKEEIAAHmEej+HhUI9NBpNPvYjUEEvVAfBADYpQgRdVEH1PQ7BeXYkQpAuXkF8iQLBvsYXQgAAlAChvnt4aT8F3YY+6C+3QTc6MUDbnzxBZJexQSDdG0B8wUFBXFixQb3tC0AH9k5BAAAPNbG8cotlPx9n4j4617lBt0MnQETvQUHoL7dBNzoxQNufPEFcWLFBve0LQAf2TkEAAEwOdD89sY2+2Qn3PQRdVEH1PQ7BeXYkQolGWEEAsQ/BzeYbQpAuXkF8iQLBvsYXQgAABOh1P4z1Pj4OK1M+7xZaQQOq7MBYyBlC9iNQQS9UB8EANilCkC5eQXyJAsG+xhdCAACIFH0/f1HCvb+F7z2JRlhBALEPwc3mG0IEXVRB9T0OwXl2JEJ64VVBTjUVweLXH0IAAPYEdD9NE2o9uwGYPrBZVUEdqHFBwK/bQUjhVkHwyWJBcKnaQW+4V0E8Z4JB6AnWQQAAu/qbvoE6aj8Kgoc+EearQSmWAUBdXEtBXFixQb3tC0AH9k5BZJexQSDdG0B8wUFBAAD6/Vc/bmT4Pf/cBT8vAVtBlRJhQYeI10FvuFdBPGeCQegJ1kFI4VZB8MliQXCp2kEAAGGzyb1BpVM/IswNPzKvAL8YcjxA7ow3QSBvfj5eniNAnfNCQWM0sT7RnS9AncA+QQAAfehVPx5MrjvfoQw/6NRWQaMHTkGUzNpBLwFbQZUSYUGHiNdBSOFWQfDJYkFwqdpBAACjSBo/OBfIPl0cMj9xk79BKqkiQDvYPEHhwadBsckAv2+8gEHoSr1BX4o1PoIMVkEAAFiqRD5V+3A/rxOOPmM0sT7RnS9AncA+QVFgVD89RSlAusc+QQa9sz7xjjhAQB03QQAAoTkCP4luWz+lVaW9UWBUPz1FKUC6xz5BdjuJPypkHkCzWjpBBr2zPvGOOEBAHTdBAAAmiwc/mxkwP9Ev/r52O4k/KmQeQLNaOkEOXWU+qlcxQExyMkEGvbM+8Y44QEAdN0EAAIAMTj4MhnA/fNuNPga9sz7xjjhAQB03QVzwiL5dsUVAmyozQWM0sT7RnS9AncA+QQAALDyZPYHtVT9gTAs/cWyrQcXZxT8QVWBBXFixQb3tC0AH9k5BSaWlQR0Qrz+7S2ZBAACYAJe+FLRtP53qZj5cWLFBve0LQAf2TkER5qtBKZYBQF1cS0FJpaVBHRCvP7tLZkEAAAl6Oz+h9h0/inWTPu8WWkEDquzAWMgZQvztUUFWlvXACFwhQvYjUEEvVAfBADYpQgAAkEtGPzUCGr/e2kc+kjhkQeYXKUJwYgJCTotlQedbK0InDghC19hcQZfLKUJR3QtCAADDf2c/7BDSvlag8T164VVBTjUVweLXH0KGbU9BBG0bwYHNJkJywFFBNIccwTNkIUIAALPYdD8OMHS+kHwsPoZtT0EEbRvBgc0mQnrhVUFONRXB4tcfQgRdVEH1PQ7BeXYkQgAAgOpPP8vY+b5buKM+N4pXQeIkIEKfDgNCMB9VQVOeJ0K2/w9CizdPQbaYIEJNCAlCAAAokyo/bWMQP9i8+b7DEWBB+dgaQh58s0FzlWNB3v4TQgEKpkGYmVhBF2obQrCxr0EAADveLz4XynQ/sq9yvlUJqUFlPThCaV4pQggCoUFrIjdC/v8hQrC5l0FRIThCY6ciQgAA9NuNuhI2QT/J8Se/amgmQRDxHUI1TLNBqexQQfJxH0LOuLZBxYgmQVEEGUJW96dBAAAi/Qs/y0HLva7SVD/ael9B8fDLwKXwF0K4o15BH1HDwPg0GEIcJFdBwIvZwLcbGUIAAFohMzx//z4/O28qvxdCUkGnARlCRk2oQcWIJkFRBBlCVvenQansUEHycR9Czri2QQAALBUcPpDnfL8/ROi8ecSsQSctM0K8mjdCD7KjQSj+MkKjnSVCB2esQe9yM0ITIC1CAAAtZnQ/RXyNPoNZ4r16CnFBODAOQkxFrEHErGNBPbseQq1ExUFYQ2ZBw9QfQhzy1UEAAAu/az9946s+5uhKvnoKcUE4MA5CTEWsQWA8ZkEoFxZCgPCtQcSsY0E9ux5CrUTFQQAARVI7P2wnHj9+bpM+d4lTQVmA4cCj8xpC/O1RQVaW9cAIXCFC7xZaQQOq7MBYyBlCAAA+d0k/pgz2Pp0dxr5zlWNB3v4TQgEKpkHDEWBB+dgaQh58s0FgPGZBKBcWQoDwrUEAABpgdj9Ey1c9/G2IPrKzmEHHah9Btj62QbzKlkEyuQtBGxe/QU1TmUFEYvVArZ+3QQAAAAAAAAAAAAAAAAAAbeerQaZKNEIZLShCbeerQaZKNEIZLShCbeerQaZKNEIZLShCAABE0Nk+7WFjv9WmMb5t56tBpko0QhktKEKQ8bBByq00QlJfLELjpahBClczQlYOKUIAAMlU2T5BkmO/6CMwvpDxsEHKrTRCUl8sQgdnrEHvcjNCEyAtQuOlqEEKVzNCVg4pQgAAjGS8PsHmab+RxzC+rhinQY3/M0Iu6yNC46WoQQpXM0JWDilCD7KjQSj+MkKjnSVCAAAAAAAAAAAAAAAAAABt56tBpko0QhktKEJt56tBpko0QhktKEJt56tBpko0QhktKEIAAIzeez+1+D09O/IwPk1TmUFEYvVArZ+3QUjsmUF2NhxBBrmvQbKzmEHHah9Btj62QQAAAAAAAAAAAAAAAAAAbeerQaZKNEIZLShCbeerQaZKNEIZLShC46WoQQpXM0JWDilCAACMcgw/PthLvyKBgr6uGKdBjf8zQi7rI0InMaxBkW00QlwPKEJt56tBpko0QhktKEIAAKYRbr4rD3A/5COEPkmlpUEdEK8/u0tmQRHmq0EplgFAXVxLQWYfoEFZh5Y/+3xnQQAAfxp/P7/d5zwHI6E9TVOZQURi9UCtn7dBXASaQX4lnECu47ZBBpiaQR86m0Cvqq9BAABJ1ge/usxYPxYMEb0u/aNBvbm4PybZWUFmH6BBWYeWP/t8Z0ER5qtBKZYBQF1cS0EAAAbXfz/MzBC9twgcOmWymUG0vg5B+2ubQUjsmUF2NhxBBrmvQU1TmUFEYvVArZ+3QQAA6X0PPxEMuj6ngT6/3rgZP7leFkDqsDNBDl1lPqpXMUBMcjJBdjuJPypkHkCzWjpBAACoEOM+VQZBP2MY+L4GvbM+8Y44QEAdN0EOXWU+qlcxQExyMkFc8Ii+XbFFQJsqM0EAANLuBL91rFo/1Z3avC79o0G9ubg/JtlZQcLAn0G/9ZA/IphfQWYfoEFZh5Y/+3xnQQAAX/gxP9rGvD2sfzY/6NRWQaMHTkGUzNpBBk5YQfcvQUE/6dpBLwFbQZUSYUGHiNdBAAD8oui+3txjPxQsE71mH6BBWYeWP/t8Z0HCwJ9Bv/WQPyKYX0FYPppBa1FOPyt/aUEAAP+x2D4db2O/SwM2vq4Yp0GN/zNCLusjQm3nq0GmSjRCGS0oQuOlqEEKVzNCVg4pQgAAbHWMPoDRdL9bvM69D7KjQSj+MkKjnSVC46WoQQpXM0JWDilCB2esQe9yM0ITIC1CAADQp9q8F71kP96A5T5jNLE+0Z0vQJ3APkFc8Ii+XbFFQJsqM0EyrwC/GHI8QO6MN0EAAMPbRr8f9R+/tvqgPbGoGEEipitCcAIRQscFIUE7VylCB1MTQhZXG0GunytC+W4XQgAADPw6P4nmxD4PgBA/7xZaQQOq7MBYyBlCHCRXQcCL2cC3GxlCd4lTQVmA4cCj8xpCAAA7+DM/XF7FPnL/GD92ymFB/zPhwASYFkIcJFdBwIvZwLcbGULvFlpBA6rswFjIGUIAAJ9NPz/C2ga/i2XPvq4Yp0GN/zNCLusjQqyhqUH/LzVC5bUkQicxrEGRbTRCXA8oQgAAaCl1P8GRdD0CMpA+SOFWQfDJYkFwqdpBsFlVQR2ocUHAr9tBOHZPQeI4Z0HtzeZBAACc7/k+zSUOv+5fLD+3zEVBv3VjQTDi6UFFQ0dBHldTQeu04kE3FlBBdShUQWTY30EAAIgrUD9osaa+2wT3Pjh2T0HiOGdB7c3mQfRfS0FnDWhBWYfqQTcWUEF1KFRBZNjfQQAAAiFBP673fLwq/ic/uKNeQR9Rw8D4NBhC2npfQfHwy8Cl8BdCSqZvQadMzMCsShNCAADlmjO/ZrgTP34S1r5GFh9Bh68hQrwowEEC4BlBJU8ZQkRprUHOiRlBFbsgQsgtwkEAAJAXd7+UaIG80KSFPjtQCEGCTQpCl67EQSCtC0H6XhdCNnvMQbdx/kAvpgVCWU+zQQAAfl17v67dQT68sMu7LoHxQEVM/EHEu6JBIK0LQfpeF0I2e8xBTgwKQYH4FELe3bpBAAC90G+/e8afPv0cIr65GBRB5+EfQoYnyEFe9AhB6aAQQtX7rEFODApBgfgUQt7dukEAAPZjXr+e/va+5QvmPY2GH0FInSdCZPUMQrGoGEEipitCcAIRQmxwGEGnxCpCSc0MQgAAI/tQv64kC79gFUg+jYYfQUidJ0Jk9QxCxwUhQTtXKUIHUxNCsagYQSKmK0JwAhFCAAAY6Ee/8PsWv1PLUj7HBSFBO1cpQgdTE0KNhh9BSJ0nQmT1DEJK5ylBQ6QlQv4lEUIAABMiFL9z9ku/uoQyPlhsDEELby1CYQMPQmxwGEGnxCpCSc0MQrGoGEEipitCcAIRQgAAiKgrv7VHBT+PTAe/wsCfQb/1kD8imF9BSNGdQUgBLz8vbl1BKOuZQTsoEz/6m2VBAADar/++zeotP+2jCb9GFh9Bh68hQrwowEFqaCZBEPEdQjVMs0EC4BlBJU8ZQkRprUEAAEPhXb9ecdQ+jLyNvjb5EkG+BhRCEF+mQbkYFEHn4R9ChifIQc6JGUEVuyBCyC3CQQAAhSwbv18iSb92Pv09/MERQWNZK0IzTghCbHAYQafEKkJJzQxCWGwMQQtvLUJhAw9CAAArMEW/otsiv/eCNj3wNQhBSpkuQvZwDUL8wRFBY1krQjNOCEJYbAxBC28tQmEDD0IAAEyApb6KTqS+0uZjPx1DlkHl2TRCEtE3QiD1oEHArDRC4bE5QhjSmkF8FTZCshY5QgAAy55/PwubOz0FJPE8BpiaQR86m0Cvqq9BZbKZQbS+DkH7a5tBTVOZQURi9UCtn7dBAACu0Gw/B9K8PTanvD6uf5dBQVeNQNi3wkFNU5lBRGL1QK2ft0FjBJNBidWfQBHQzEEAAEqzRb6L8EA/atUgP6/ZmUFdRzdCgZo4QgHHoUELSDhCZJ44QudvkEFHoThCRIk1QgAAoURrvsXSrj6SUGk/k9yPQZx+N0LGLTdCgoyOQbL1NUKeljdCGNKaQXwVNkKyFjlCAADQLPi9m4tTP5nKDD/nb5BBR6E4QkSJNUKT3I9BnH43QsYtN0Kv2ZlBXUc3QoGaOEIAAHt1gb52Uow+T4ltP5Pcj0GcfjdCxi03QhjSmkF8FTZCshY5Qq/ZmUFdRzdCgZo4QgAAD2TmvN86ez+KokI+AcehQQtIOEJknjhC+nGfQSMhOUJcETRC52+QQUehOEJEiTVCAACqxq+9tOhoP/Dozz5c8Ii+XbFFQJsqM0G9OE2/HxBEQNlFMkEyrwC/GHI8QO6MN0EAACSKIr/YcjI/PJCqvi79o0G9ubg/JtlZQT8uokFPfZI/ir1WQcLAn0G/9ZA/IphfQQAABCQyP8ggnL75dCY/p4dQQSTQSUGyLt1B6NRWQaMHTkGUzNpBNxZQQXUoVEFk2N9BAAAwsSO9jyB/P+nTk71c8Ii+XbFFQJsqM0G3QDm/vYhDQKXBL0G9OE2/HxBEQNlFMkEAAJpOKD5S1g+9vFt8v964GT+5XhZA6rAzQbdAOb+9iENApcEvQQ5dZT6qVzFATHIyQQAAYs2dPqsvFT+QfkC/XPCIvl2xRUCbKjNBDl1lPqpXMUBMcjJBt0A5v72IQ0ClwS9BAACGqgU/XaHTvlH6Pj9FQ0dBHldTQeu04kG9tkhB1cZHQdL+3kE3FlBBdShUQWTY30EAAAsy8D7Byca+Ww9LP722SEHVxkdB0v7eQaeHUEEk0ElBsi7dQTcWUEF1KFRBZNjfQQAAF89tv0D8bj5kJpM+/P5pv0jjHkDOATRBFwNov6Vi3T8oMT5BvThNvx8QREDZRTJBAAAC9GO/EFO2Pf+B5L69OE2/HxBEQNlFMkG3QDm/vYhDQKXBL0H8/mm/SOMeQM4BNEEAAD7PML8MUy4/5VR5vi79o0G9ubg/JtlZQU2opkH1Rso/hthQQT8uokFPfZI/ir1WQQAAHjZAv/p5Bj+FAc2+wsCfQb/1kD8imF9BPy6iQU99kj+KvVZBSNGdQUgBLz8vbl1BAADk8Dq//XqgPpJnG78/LqJBT32SP4q9VkEqtaVBSpOcP+PnTkFI0Z1BSAEvPy9uXUEAAET5cz+UDJc8IsyaPk1TmUFEYvVArZ+3QbzKlkEyuQtBGxe/QWMEk0GJ1Z9AEdDMQQAAxe95P4TzvTxvRVw+XASaQX4lnECu47ZBTVOZQURi9UCtn7dBrn+XQUFXjUDYt8JBAAAO5n8/ctgpPFJI1jxli5pBxmMhQKHvuEEGmJpBHzqbQK+qr0GSYZpBac4UQJ/Nv0EAABvhfj/uxVM99nefPVwEmkF+JZxAruO2QZJhmkFpzhRAn82/QQaYmkEfOptAr6qvQQAAJsi5vjgqR7+0TQM/SDomQUdOKkKvkhdCSucpQUOkJUL+JRFCyGQxQSpDKkJjexlCAADL1TG/mC0gv/uytT5IOiZBR04qQq+SF0LHBSFBO1cpQgdTE0JK5ylBQ6QlQv4lEUIAAERMWz8nSz27RhMEP3bKYUH/M+HABJgWQu8WWkEDquzAWMgZQql3XkGQpvXAhfUXQgAA23sVvEF9Cr8fS1c/vbZIQdXGR0HS/t5BRUNHQR5XU0HrtOJB2cUtQbMdWEG9GuRBAAArQDG94qQqv2+CPj/ZxS1Bsx1YQb0a5EFFQ0dBHldTQeu04kG3zEVBv3VjQTDi6UEAAII5VT9eQLA7l6oNP+jUVkGjB05BlMzaQUjhVkHwyWJBcKnaQTcWUEF1KFRBZNjfQQAAUv5YPy16ADy90Ac/qXdeQZCm9cCF9RdCG/1oQR/n8sBjwBNCdsphQf8z4cAEmBZCAAA862w/9/5Pvti5oz43FlBBdShUQWTY30FI4VZB8MliQXCp2kE4dk9B4jhnQe3N5kEAACMeWT/U8aW9MAkGP5AuXkF8iQLBvsYXQhv9aEEf5/LAY8ATQql3XkGQpvXAhfUXQgAAK0Q+P0ujKr5P4CU/dsphQf8z4cAEmBZCSqZvQadMzMCsShNC2npfQfHwy8Cl8BdCAADqMx4/Nw16vrFPPz/ael9B8fDLwKXwF0IcJFdBwIvZwLcbGUJ2ymFB/zPhwASYFkIAAHg/Hb/N4UQ/mPQ0vhHmq0EplgFAXVxLQU2opkH1Rso/hthQQS79o0G9ubg/JtlZQQAA1bscPtaELruL+3w/6ptMQf4O2cA9UBpCXd1KQTPEwMCgYxpCFS1FQfeM2MD3mRpCAADItp4+uud3PtVdaz9bkW9BRV1bQQCL00EGTlhB9y9BQT/p2kFND2xB7wo2QU8M2UEAAOObzz6ROBE9ddVpP13dSkEzxMDAoGMaQuqbTEH+DtnAPVAaQrijXkEfUcPA+DQYQgAA+jTVPuiMZDyDuGg/6ptMQf4O2cA9UBpCHCRXQcCL2cC3GxlCuKNeQR9Rw8D4NBhCAABaKRE/q32iPXriUT8GTlhB9y9BQT/p2kHo1FZBowdOQZTM2kGnh1BBJNBJQbIu3UEAAI54Wj7Dsag+J3RrP9rWV0HO7RVBOyXhQU0PbEHvCjZBTwzZQU3hUUHXbDNBqY3cQQAAZskgvwtrPT8huHa+EearQSmWAUBdXEtB6j2rQXlf7D9vCEZBTaimQfVGyj+G2FBBAACGY0S/9+7WPmFX+L7qPatBeV/sP28IRkEqtaVBSpOcP+PnTkFNqKZB9UbKP4bYUEEAAGknfD6I9uo9bF92P00PbEHvCjZBTwzZQQZOWEH3L0FBP+naQU3hUUHXbDNBqY3cQQAAFsGkPYp+cj/L2Z4+6ptMQf4O2cA9UBpCFS1FQfeM2MD3mRpCNPZGQUOM7MAOHiJCAAB+ekm/kGv/PrjSub4C4BlBJU8ZQkRprUE2+RJBvgYUQhBfpkHOiRlBFbsgQsgtwkEAADtF5r4Vqio/tSkYvwLgGUElTxlCRGmtQcWIJkFRBBlCVvenQZNcG0GXABRCzfGgQQAAp4zjvmrELD+hzha/AuAZQSVPGUJEaa1BamgmQRDxHUI1TLNBxYgmQVEEGUJW96dBAAAumAi/YOAuvx9Q/z7IZDFBKkMqQmN7GUJK5ylBQ6QlQv4lEUIewTJBAL4dQtGxCEIAAKB9Yb+l3sk++jGGvl70CEHpoBBC1fusQbkYFEHn4R9ChifIQTb5EkG+BhRCEF+mQQAA/t4nvxgcDj8m/wK/k1wbQZcAFELN8aBBNvkSQb4GFEIQX6ZBAuAZQSVPGUJEaa1BAAAxLVm/xYDtvqWqgj6Nhh9BSJ0nQmT1DEJscBhBp8QqQknNDEL8wRFBY1krQjNOCEIAAKIY3z7BOyg/O3Mdv5iZWEEXahtCsLGvQVdtWEE+ABRCXMqfQRdCUkGnARlCRk2oQQAAFMlEPjlbKz8ZuDe/F0JSQacBGUJGTahBV21YQT4AFEJcyp9BTW1HQQsAFEJJg51BAABzRTc8Teo6P8HmLr/FiCZBUQQZQlb3p0EXQlJBpwEZQkZNqEFNbUdBCwAUQkmDnUEAAN6rSr5rUVS/usAFPx1DlkHl2TRCEtE3Qrhxk0GNbjNCqgc1Qvu0oEEl8jNCpVs4QgAARPZ/P6ANjTwX8Tw6c5VjQd7+E0IBCqZBQvZjQQC8DkJPIJtBLbJjQQAAFEIAADBBAAAxG22/q4iOvtYxgr78wRFBY1krQjNOCELwNQhBSpkuQvZwDULjdg9B++MtQo2cB0IAADX66zrl/38/DszwOHOVY0He/hNCAQqmQS2yY0EAABRCAAAwQVdtWEE+ABRCXMqfQQAAxOUbP08ZFD9z6wq/c5VjQd7+E0IBCqZBV21YQT4AFEJcyp9BmJlYQRdqG0Kwsa9BAADD/Fo/MmfDPpZGs75gPGZBKBcWQoDwrUHADnRBLIYCQn8rlEFC9mNBALwOQk8gm0EAAIlbXT8O77w+zYCuvnOVY0He/hNCAQqmQWA8ZkEoFxZCgPCtQUL2Y0EAvA5CTyCbQQAAjYI3uQAAgD/trCi4V21YQT4AFEJcyp9BLbJjQQAAFEIAADBBTW1HQQsAFEJJg51BAAAAAAAAAACAP1RYm7YtshNBAAAUQgAAMEFNbUdBCwAUQkmDnUEtsmNBAAAUQgAAMEEAAGFdE7/hjjy+Y/RLvyq1pUFKk5w/4+dOQRo7r0GIVuI/6iA/Qe8ipUGgpAg/70dSQQAAHc4fvcGEMD9FJDm/g/0lQfj/E0IJap5BxYgmQVEEGUJW96dBTW1HQQsAFEJJg51BAACOhTS/0X/aPuf0EL8/LqJBT32SP4q9VkFNqKZB9UbKP4bYUEEqtaVBSpOcP+PnTkEAAIiCLjxF/H8/UEkjujb5EkG+BhRCEF+mQZNcG0GXABRCzfGgQS2yE0EAABRCAAAwQQAAnwtiOvr/fz+nn+O4g/0lQfj/E0IJap5BLbITQQAAFEIAADBBk1wbQZcAFELN8aBBAAAXsKW++C8oP8RQLr/FiCZBUQQZQlb3p0GD/SVB+P8TQglqnkGTXBtBlwAUQs3xoEEAALkRPD7Pnkk/t5QWv6Sh1UA26/I+Xn+BQR1pvEDmAak+Cfd7QTXcxkBVWiE/gwOCQQAA/YCMPV3AeD+zhme+erDJQDqeOj8Xn4VBNdzGQFVaIT+DA4JBlmemQDyOMD/sl4FBAAA0j4g9aFx7P0umNb6WZ6ZAPI4wP+yXgUE13MZAVVohP4MDgkFyCa5AbGgcP8KmfUEAALTfR74HiQG/shRXPx1DlkHl2TRCEtE3QhjSmkF8FTZCshY5QoKMjkGy9TVCnpY3QgAAAa7WvRSBJr7iKXs/HUOWQeXZNEIS0TdCgoyOQbL1NUKeljdCBJqKQa23NELuKzdCAACzAXq/qehavptDxDxUABNB+UApQttHAkL8wRFBY1krQjNOCELjdg9B++MtQo2cB0IAAJ+3Pb07D0+/kxIWPwSaikGttzRC7is3QmuSikGiuDNCvss1Qh1DlkHl2TRCEtE3QgAAGAiZPDkMZb+6eeQ+HUOWQeXZNEIS0TdCa5KKQaK4M0K+yzVCuHGTQY1uM0KqBzVCAAAjrH2/h073vTICc73jdg9B++MtQo2cB0K1rhJB8egqQrs9AEJUABNB+UApQttHAkIAAKqESz/W2zs+wQUUP+hKvUFfijU+ggxWQaHYuUGFMqe/kA5nQVrZvUFUkT2/iy1ZQQAA77+LPrTcSD9+gQ4/6ptMQf4O2cA9UBpCd4lTQVmA4cCj8xpCHCRXQcCL2cC3GxlCAAAq2jo/aiB7PqNXIz+h2LlBhTKnv5AOZ0HoSr1BX4o1PoIMVkHPIrJBW0ULwNwLfkEAAKaQWL/Blti+QDqmPkrnKUFDpCVC/iURQo2GH0FInSdCZPUMQm7XJkF65iFCakcKQgAAdvD7vmtUMr8PqgU/HsEyQQC+HULRsQhCSucpQUOkJUL+JRFC6pYpQbuZHEIZAwVCAADGN5s+dyc4PxQAIL813MZAVVohP4MDgkEdabxA5gGpPgn3e0FyCa5AbGgcP8KmfUEAALXtVb8EL+C+v8apPkrnKUFDpCVC/iURQm7XJkF65iFCakcKQuqWKUG7mRxCGQMFQgAA3+t/v6SAx7wId5a7NvkSQb4GFEIQX6ZBLbITQQAAFEIAADBBwbETQWncDUJMTJlBAABNYwy4AACAP2FHAzeD/SVB+P8TQglqnkFNbUdBCwAUQkmDnUEtshNBAAAUQgAAMEEAAPzDVD85w6m9asUMP6l3XkGQpvXAhfUXQu8WWkEDquzAWMgZQpAuXkF8iQLBvsYXQgAACB4BPwDDMr/UCAK/C8q7Qa/swb/jMl9BDmO3QcQaC8CX8GRBMiO7QQF2lb+IQ1ZBAAAPF48+FgFHP9JFED+xLIRB81g3QrYaOEIBLoFBon44QrZDN0JSbnFBNAw3QvFbO0IAAH5HZT/NHeO+U1cHvbMmXEFvTQbBKqcWQpAuXkF8iQLBvsYXQolGWEEAsQ/BzeYbQgAAlHBmP6k02b6nN8o9euFVQU41FcHi1x9CcsBRQTSHHMEzZCFCfHRaQXlPFMHfYRZCAAArBLI92G0xv3kxN78OY7dBxBoLwJfwZEH/DrhBoDtVvytUUEEyI7tBAXaVv4hDVkEAAJYXfT90hcC9bSrwPYlGWEEAsQ/BzeYbQnrhVUFONRXB4tcfQnx0WkF5TxTB32EWQgAA4nh6P9VQPj0EO04+iUZYQQCxD8HN5htCpIJdQekHDsGychVCsyZcQW9NBsEqpxZCAADW2BI/A8cnv5+T+74yI7tBAXaVv4hDVkFrdb1BqJF7v2O8V0ELyrtBr+zBv+MyX0EAALpoSz8vBxu/o1c0PXx0WkF5TxTB32EWQnLAUUE0hxzBM2QhQrIHVUGwFRvBa5AXQgAAmp9+vur9Dr+Zk0q//w64QaA7Vb8rVFBBDJuuQdC/KcBJ0WpB09mpQbj0Ur9HKFlBAACinNA+3FZPP2AG2L7bVqJAE/MEP1swdUFyCa5AbGgcP8KmfUEdabxA5gGpPgn3e0EAAJIy07zqpp6+Zk9zPwEkSkG2Yz1BTVLdQb22SEHVxkdB0v7eQZ6RLkFAWkJBr8HdQQAA3CPLPjV5UT+M+9S+cgmuQGxoHD/Cpn1B21aiQBPzBD9bMHVB0ZKSQIcLRD9ibXVBAADvcbg8zs0Av0wpXT/ZxS1Bsx1YQb0a5EGekS5BQFpCQa/B3UG9tkhB1cZHQdL+3kEAAPFDkz0Qk589l45+P9UKJEFMiiJBTd/eQU3hUUHXbDNBqY3cQTBZO0Fq7TFBPW3dQQAAssXpPhupXL7i+Vw/vbZIQdXGR0HS/t5BASRKQbZjPUFNUt1Bp4dQQSTQSUGyLt1BAAC62PK8J1x0P2Dglz4ECp1AZJcSP2RfhEGWZ6ZAPI4wP+yXgUFlcoBA8jlmPwF/dkEAAFTo7T4x2Io++MpXP7EshEHzWDdCtho4QlJucUE0DDdC8Vs7QoxPg0Gp+DVC/8g4QgAA8l9fPhkseT9OeZG9lmemQDyOMD/sl4FBcgmuQGxoHD/Cpn1B0ZKSQIcLRD9ibXVBAAC+9GE+vf14P4VSlb3RkpJAhwtEP2JtdUFlcoBA8jlmPwF/dkGWZ6ZAPI4wP+yXgUEAAPZUzD1PVCs/Zn48PwEugUGifjhCtkM3QrEshEHzWDdCtho4QpPcj0GcfjdCxi03QgAA9TMYPpnORz7mLXg/k9yPQZx+N0LGLTdCsSyEQfNYN0K2GjhCgoyOQbL1NUKeljdCAACBlEU+MYTFPgD2Zj+MT4NBqfg1Qv/IOEKCjI5BsvU1Qp6WN0KxLIRB81g3QrYaOEIAAKbLXD34z3I/rdifPgEugUGifjhCtkM3QudvkEFHoThCRIk1QvMAdkE3fDlC2sk0QgAACRPvPUqrTj8uFxQ/k9yPQZx+N0LGLTdC52+QQUehOEJEiTVCAS6BQaJ+OEK2QzdCAAApjH0/ID+CvdwG+71li5pBxmMhQKHvuEH9rplB0S1YQPpsrkEGmJpBHzqbQK+qr0EAAJOotj5WySa+431rPwEkSkG2Yz1BTVLdQQZOWEH3L0FBP+naQaeHUEEk0ElBsi7dQQAAUTVwP4vpB74Je6O+/a6ZQdEtWED6bK5BMMOVQVRsh0DyD6BBGiGaQakeyED4K6ZBAAARhX0/nweCvUvs/L0GmJpBHzqbQK+qr0H9rplB0S1YQPpsrkEaIZpBqR7IQPgrpkEAAPqqqT0worW9kht+PzBZO0Fq7TFBPW3dQU3hUUHXbDNBqY3cQQEkSkG2Yz1BTVLdQQAAvKWZPhposT0nMXM/Bk5YQfcvQUE/6dpBASRKQbZjPUFNUt1BTeFRQddsM0GpjdxBAAAoTso+IBAiPuWmZz8vAVtBlRJhQYeI10EGTlhB9y9BQT/p2kFbkW9BRV1bQQCL00EAADBfe79wzUy882hBPrpIIkEFi1xBk53cQYBaJ0EPUHJBYYPqQa9jIUEaM3BBuPDaQQAA95Ntv1ZGRL7zhaM+gFonQQ9QckFhg+pBukgiQQWLXEGTndxB9h4lQcfuVEEVdN5BAADeiVK/ogilvgoB8D6AWidBD1ByQWGD6kH2HiVBx+5UQRV03kHKOitB0r5nQb9H6kEAAKKLv77q1di+dTVTv+8ipUGgpAg/70dSQfIHt0GRkbw/M1Y6QdPZqUG49FK/RyhZQQAArz0Sv7xpEL8QoBg/yjorQdK+Z0G/R+pB9h4lQcfuVEEVdN5B2cUtQbMdWEG9GuRBAAAYP3w/pDQnPsCdSj3sQXdB/xcIQlNwskG7tIBB1Nr0QTGHp0HzrYJBin7sQaPQm0EAAO0DbD+ekrO+V1coPolGWEEAsQ/BzeYbQnx0WkF5TxTB32EWQqSCXUHpBw7BsnIVQgAAcjVJP00KFr9hjUk+G/1oQR/n8sBjwBNCkC5eQXyJAsG+xhdCvVhkQUDa/8DNkBNCAADKd3g/cxu7PfsgZD6MWHRBRwUFQjxNu0G7tIBB1Nr0QTGHp0HsQXdB/xcIQlNwskEAAICtBb+WRuO+t2s6P9nFLUGzHVhBvRrkQYpbKEGByUtBuWfeQZ6RLkFAWkJBr8HdQQAAgyBjPx+69jveLuw+xmd1QaLe8EGWsbpB73yBQfBx40HN3K1BjFh0QUcFBUI8TbtBAABydzq/9GWHvs/PIT/ZxS1Bsx1YQb0a5EH2HiVBx+5UQRV03kGKWyhBgclLQbln3kEAAOkxeT813Ow9jW9KPoxYdEFHBQVCPE27Qe98gUHwceNBzdytQbu0gEHU2vRBMYenQQAAofolv4LSsr3OnUG/KrWlQUqTnD/j505BKVmcQb+/G749fmFBSNGdQUgBLz8vbl1BAAADKhO/Ic08vt0VTL8qtaVBSpOcP+PnTkHvIqVBoKQIP+9HUkEpWZxBv78bvj1+YUEAAJOJ1r4ZVt6+iiJMvylZnEG/vxu+PX5hQe8ipUGgpAg/70dSQdPZqUG49FK/RyhZQQAAtX9/P+cGMbxZUHy9BpiaQR86m0Cvqq9BGiGaQakeyED4K6ZBZbKZQbS+DkH7a5tBAABH+Gc/eUprPR+R1j7vfIFB8HHjQc3crUHGZ3VBot7wQZaxukFZzHpBR3XUQQbCuEEAAJA2eT/4xGQ+nwVJvXoKcUE4MA5CTEWsQexBd0H/FwhCU3CyQfOtgkGKfuxBo9CbQQAAf1/XPiv9Or+1vwk/RjFKQdosJUKFhhFCUy5DQX/THELyjwdCsRhKQegKHkKr3AdCAADYAag7FK1Ev0TeIz9TLkNBf9McQvKPB0IewTJBAL4dQtGxCELRfTNBfP0VQjfH/kEAAG5Nbz8BlCE+lvSiPu98gUHwceNBzdytQb/shkHhkNVBhcakQbu0gEHU2vRBMYenQQAAfCx1P+f/LT6Sxm0+v+yGQeGQ1UGFxqRB9HCJQT8P0UG6sZ1Bu7SAQdTa9EExh6dBAAC2Pc6+yGbVvoibUL+BCbZBLoMUQJRiNEHyB7dBkZG8PzNWOkH6QrNBoB8CQAN7OUEAAOq0kr4aD9e+AHBcv5IquUF39qM/f2o6QfIHt0GRkbw/M1Y6QYEJtkEugxRAlGI0QQAAxlVCP70TIL/6Qzk+syZcQW9NBsEqpxZCvVhkQUDa/8DNkBNCkC5eQXyJAsG+xhdCAACtj2482tV2P2+Qhz5lcoBA8jlmPwF/dkGQiUpA/E52P0aVc0EECp1AZJcSP2RfhEEAANisiL4UR0U/myUUP5+AWkBkjOA+LUqAQQQKnUBklxI/ZF+EQZCJSkD8TnY/RpVzQQAAkE1ovv8PST9ebxM/kIlKQPxOdj9GlXNBKgYgQKeEgD9ve25Bn4BaQGSM4D4tSoBBAAAIz1a/tlzevr62pz5u1yZBeuYhQmpHCkLHzB1BnjweQlBD/0HqlilBu5kcQhkDBUIAANaV6j7KTN++PEZGP4xPg0Gp+DVC/8g4QiDSbEE8XTRCJLI7Qo4lgUGQpjRCea44QgAAo/lyvEoIsb4aLnC/gQm2QS6DFECUYjRBI127QezuMkDyaTFBkiq5QXf2oz9/ajpBAADD13s/cvqDvTWJK75lsplBtL4OQftrm0EaIZpBqR7IQPgrpkGfCZlBlNrrQORSnEEAAFisVz+H10e+t4wAv8lYj0HIhghBZBOEQRArkUFZYjxB3Bt6QShhlkEqyyVBATCKQQAAkhpovwZ2+TxZb9c+ukgiQQWLXEGTndxBr2MhQRozcEG48NpB7cgdQTITb0H7GNdBAAA11Vo/QlZavq868r4oYZZBKsslQQEwikFE7pFBTa+8QBBAkkHJWI9ByIYIQWQThEEAAJlNZT8Y3k2+lgzLvihhlkEqyyVBATCKQZ8JmUGU2utA5FKcQUTukUFNr7xAEECSQQAARTB0PxvzJb4CaYG+nwmZQZTa60DkUpxBGiGaQakeyED4K6ZBMMOVQVRsh0DyD6BBAAC0KTE+dZUMv0RPUT+MT4NBqfg1Qv/IOEIEmopBrbc0Qu4rN0KCjI5BsvU1Qp6WN0IAAEY7Rz6uoku/g+0SP44lgUGQpjRCea44QmuSikGiuDNCvss1QgSaikGttzRC7is3QgAAMheWPiBHn74wb2c/jiWBQZCmNEJ5rjhCBJqKQa23NELuKzdCjE+DQan4NUL/yDhCAACPTBI/LwlQv2C96T2yB1VBsBUbwWuQF0KSoVFBfmwewQvgFUKT7mRBs4oUwQdOD0IAABfmYz8Fzza+cZDWvjDDlUFUbIdA8g+gQUTukUFNr7xAEECSQZ8JmUGU2utA5FKcQQAAuoFbvfg7ZT/rROI+GPrEQGajOEKO8jVCUp7gQGMDOEIKojdCB6X/QHFaOUJVYzVCAAAa7yi/Hs83P42uYr78OrBBiMQRQO2nPkHqPatBeV/sP28IRkER5qtBKZYBQF1cS0EAACYacT+Mw4k+TFdOvnoKcUE4MA5CTEWsQfOtgkGKfuxBo9CbQcAOdEEshgJCfyuUQQAA31vhvVZHVj9BNgk/Up7gQGMDOEIKojdCGPrEQGajOEKO8jVC6ZWwQM6FN0KYKjdCAAC45BS/9BFNP83wEL5kl7FBIN0bQHzBQUH8OrBBiMQRQO2nPkER5qtBKZYBQF1cS0EAACHDOb4n7mQ+Gyl1P+mVsEDOhTdCmCo3QnoltEDB/jVCeJs3QuEo2kD7GzZCE3s4QgAAmq7XvQAF4j5GHmQ/6ZWwQM6FN0KYKjdC4SjaQPsbNkITezhCUp7gQGMDOEIKojdCAAAikns/m/b6PIQLOz6MWHRBRwUFQjxNu0HsQXdB/xcIQlNwskE1WWxBCokSQvdHzEEAAN3WI7+4Puc9spFCv+o9q0F5X+w/bwhGQfw6sEGIxBFA7ac+QRo7r0GIVuI/6iA/QQAAwlVdv9oYrj18j/0+ukgiQQWLXEGTndxB7cgdQTITb0H7GNdB4WkdQTtSU0HOJ9lBAAD7Sss+I5tRP21Q1L7bVqJAE/MEP1swdUH6EpdAMcvhPi9SbUHRkpJAhwtEP2JtdUEAAJ+KPr/jkdw92LooP+3IHUEyE29B+xjXQZfTGUFjwX1Bw6nTQeFpHUE7UlNBzifZQQAApTsgP4dOOT+MoZS+0ZKSQIcLRD9ibXVB+hKXQDHL4T4vUm1BPceHQLNESj9fwmpBAAA1dD2/QIAxPuxaJr+BCbZBLoMUQJRiNEH6QrNBoB8CQAN7OUGq3bRBwo8mQKlBOEEAAEjQGr8oCts9jwlKv/w6sEGIxBFA7ac+QardtEHCjyZAqUE4QfpCs0GgHwJAA3s5QQAAO0Ubv+cQ0z280Um/+kKzQaAfAkADezlBGjuvQYhW4j/qID9B/DqwQYjEEUDtpz5BAACYPI0+ePcvv5UALD8QjXhB9pkzQq2bOEJrkopBorgzQr7LNUKOJYFBkKY0QnmuOEIAAP2yTr9+B4S8bvoWP/YeJUHH7lRBFXTeQbpIIkEFi1xBk53cQeFpHUE7UlNBzifZQQAAG8jHPV08eb/EbVM+EI14QfaZM0KtmzhCnKKFQf//MkKrjzNCa5KKQaK4M0K+yzVCAACj/Wm8uXR3P+/3gj7nb5BBR6E4QkSJNUL6cZ9BIyE5QlwRNEIk2IhBrGM5Qmh0MkIAAKcKwzxa7H8/V0O7u/pxn0EjITlCXBE0QkpDqEFM/jhCN6EuQiTYiEGsYzlCaHQyQgAARlpuP1ZIIb6ggKi+/a6ZQdEtWED6bK5BvDGWQeveB0DFW6lBMMOVQVRsh0DyD6BBAAAcXPi74ftyv1wioT64cZNBjW4zQqoHNUJrkopBorgzQr7LNUKcooVB//8yQquPM0IAAE42iz3x4H6/GXeDPQ+yo0Eo/jJCo50lQrhxk0GNbjNCqgc1QiXghkHMVzJCxssqQgAAjt1Kv+1pBL7GmBg/slAkQQC5RUGhRNxB9h4lQcfuVEEVdN5B4WkdQTtSU0HOJ9lBAAAC/Ay/gVRQvnI8Tz/2HiVBx+5UQRV03kGyUCRBALlFQaFE3EGKWyhBgclLQbln3kEAAMz8rr7JgP2+pnxMv/IHt0GRkbw/M1Y6QZIquUF39qM/f2o6Qf8OuEGgO1W/K1RQQQAAJCaKPcogfD+tbCM+JNiIQaxjOUJodDJC8wB2QTd8OULayTRC52+QQUehOEJEiTVCAAAhF6u+EahWPp49az+X0xlBY8F9QcOp00EElwlBQV+NQYZnzUHhaR1BO1JTQc4n2UEAADjoqzvFbzs/Y1wuP+mVsEDOhTdCmCo3Qhj6xEBmozhCjvI1QsvxlkBemThCsAg2QgAAo4xhPjT0eD+mn5u90ZKSQIcLRD9ibXVBPceHQLNESj9fwmpBZXKAQPI5Zj8Bf3ZBAABx+bg+Dl9uv4MrS70AE0ZBFWolwXajIUIoDUlBRZQhwZAPFUKSoVFBfmwewQvgFUIAAN9IGz+sc0u/eFqvPAATRkEVaiXBdqMhQrIHVUGwFRvBa5AXQnLAUUE0hxzBM2QhQgAAiCDWPqyIaD++J5e7nDBEQFZRqj87aWVBZXKAQPI5Zj8Bf3ZBPceHQLNESj9fwmpBAADMSIS+HVMBv5/MUr/yB7dBkZG8PzNWOkH/DrhBoDtVvytUUEHT2alBuPRSv0coWUEAAE4hwb5sbsu+UylWvxo7r0GIVuI/6iA/QfpCs0GgHwJAA3s5QfIHt0GRkbw/M1Y6QQAANkvCvmsc1L6lx1O/8ge3QZGRvD8zVjpB7yKlQaCkCD/vR1JBGjuvQYhW4j/qID9BAAAphmu8kDFsPyZVxT6QiUpA/E52P0aVc0FlcoBA8jlmPwF/dkGcMERAVlGqPztpZUEAAFRLJr+iTjs9+0dCvyq1pUFKk5w/4+dOQeo9q0F5X+w/bwhGQRo7r0GIVuI/6iA/QQAA0yslP5zhID/LdN6+PceHQLNESj9fwmpBJqF3QIt1Oz+piWBB5lVnQDhriD/7NGJBAADL6Ru+eIR8P7fNfb2t/pBBBdcrP7uagkGrf5pBOeJQP8Rbe0Fc45NB15guP6W7eUEAACo7Lb7+1VC/SZcNP1oG7UBbnTRCs+k4Qi3A0EBPEDRC7QQ3QnqC8kDaiDNCkIc3QgAAQ8duP678qL32t7M+NVlsQQqJEkL3R8xBxJhsQRhnBULrxsVBjFh0QUcFBUI8TbtBAADq8wG+9vwGvxMUVz8rmMJAH6w0QkoiN0ItwNBATxA0Qu0EN0LhKNpA+xs2QhN7OEIAAOgncD9pejo8AzuxPoxYdEFHBQVCPE27QcSYbEEYZwVC68bFQcZndUGi3vBBlrG6QQAA/ck+PUXxfr8loZ89nKKFQf//MkKrjzNCMTpvQQzmMULarSlCJeCGQcxXMkLGyypCAACmMLw9J5R8PybKCb6wuZdBUSE4QmOnIkJKQ6hBTP44QjehLkJVCalBZT04QmleKUIAAPQ6Xz+7mS++RsDqvk4Bj0FtiFA/pG+dQTPFjEHwIxtAvV6UQTDDlUFUbIdA8g+gQQAAoT9ZP1n2eL7livC+Y2SLQXWndUC29Y5BRO6RQU2vvEAQQJJBMMOVQVRsh0DyD6BBAACwSDs9KvR+vyKDnz0l4IZBzFcyQsbLKkK4cZNBjW4zQqoHNUKcooVB//8yQquPM0IAAEcKKT03JH6/xGDnPbuIj0HrSjFCQvwfQiXghkHMVzJCxssqQjE6b0EM5jFC2q0pQgAAtaw7PYZcfj8edtO9VnlpQSqxOUK56ylCSkOoQUz+OEI3oS5CsLmXQVEhOEJjpyJCAAC8X9c8sOh/P9fykjsk2IhBrGM5Qmh0MkJKQ6hBTP44QjehLkJWeWlBKrE5QrnrKUIAAAynQz+BzpW+1h8Tv0TukUFNr7xAEECSQS9QhUHck6tA96WDQclYj0HIhghBZBOEQQAAz+2QPZiUbj9hEbY+q3+aQTniUD/EW3tBrf6QQQXXKz+7moJBEieWQWgTCD/OgYRBAADtsFs/U80HvjLs/b4ww5VBVGyHQPIPoEEzxYxB8CMbQL1elEFjZItBdad1QLb1jkEAAMRno70SGn8/MQHPvK3+kEEF1ys/u5qCQVzjk0HXmC4/pbt5QUs6jEE2eB4/Ai6BQQAAC5rePtcKPD9VXwW/J9umQX5ANkIkMiNCsd+bQX9KNUI2Qh1CCAKhQWsiN0L+/yFCAADiWX2/XGrSPU8fzT23cf5AL6YFQllPs0EgrQtB+l4XQjZ7zEEugfFARUz8QcS7okEAAJ2m5zwjnJS8Adt/PzBZO0Fq7TFBPW3dQQEkSkG2Yz1BTVLdQZ6RLkFAWkJBr8HdQQAAvyd5v6VEgT0FJ2I+O1AIQYJNCkKXrsRBt3H+QC+mBUJZT7NBn5T+QLIq/0Fn7bZBAABpo0C91G+BPjtkdz8TBiBBcgY7QWKS20HVCiRBTIoiQU3f3kEwWTtBau0xQT1t3UEAAA8KvL5CLbi+3ZRbP4pbKEGByUtBuWfeQbJQJEEAuUVBoUTcQZ6RLkFAWkJBr8HdQQAAqBYUvo+iAL9nN1o/K5jCQB+sNEJKIjdC4SjaQPsbNkITezhCeiW0QMH+NUJ4mzdCAAAjb2y/aRJLvcSqwj6flP5Asir/QWfttkHWPQhBJ0L0QXJgwEE7UAhBgk0KQpeuxEEAAFm80b6CPVQ/rdzCviY0kkG5Uug+MWd1QbPdjEG105E+VAF7QVzjk0HXmC4/pbt5QQAAhjvBvk1zNz9NKBa/SzqMQTZ4Hj8CLoFBXOOTQdeYLj+lu3lBs92MQbXTkT5UAXtBAADaWHa/9PB7PnqV7b1e9AhB6aAQQtX7rEHW+PNAJBP8QTU1nEFODApBgfgUQt7dukEAAMIieL6jJHM/9b9KPkmlpUEdEK8/u0tmQWYfoEFZh5Y/+3xnQViemEHggVA/FN5wQQAAE5MmP34EQr85aUE9ABNGQRVqJcF2oyFCkqFRQX5sHsEL4BVCsgdVQbAVG8FrkBdCAAC+IAc9aih/v6Kbl70oDUlBRZQhwZAPFUIAE0ZBFWolwXajIUJk9TNBvCUmwWkWIkIAAKo3kb5YKXQ/WdPLPat/mkE54lA/xFt7QUmlpUEdEK8/u0tmQViemEHggVA/FN5wQQAAqIjaO0oTf7/4Xq29620vQWrZIcHZWRVCKA1JQUWUIcGQDxVCZPUzQbwlJsFpFiJCAABxjJC+PkE+vGGRdT8TBiBBcgY7QWKS20GekS5BQFpCQa/B3UGyUCRBALlFQaFE3EEAAJy0r745Lhc+7nZtPxMGIEFyBjtBYpLbQeFpHUE7UlNBzifZQbK3CkFUiUlBy3nWQQAAXUEKvxUw3T3QrFU/EwYgQXIGO0FikttBslAkQQC5RUGhRNxB4WkdQTtSU0HOJ9lBAAB3ztQ+llWkPh7cWb8dabxA5gGpPgn3e0GkodVANuvyPl5/gUH9ruBAIxL8PCCCgUEAAGkAWDxzDGC/ZZr3PtXinEC81TRCf443QgDcp0BTizNC+C41QiuYwkAfrDRCSiI3QgAA1NqgPSXWdL6iwnc/eiW0QMH+NUJ4mzdC1eKcQLzVNEJ/jjdCK5jCQB+sNEJKIjdCAABYd8+7+Bp1v0+9kz7qu9tAq/MyQi9cM0ItwNBATxA0Qu0EN0IA3KdAU4szQvguNUIAAKJFP74yXC2/ZjI2PwDcp0BTizNC+C41Qi3A0EBPEDRC7QQ3QiuYwkAfrDRCSiI3QgAAqHp3v1xlcT7MqMu9LoHxQEVM/EHEu6JBTgwKQYH4FELe3bpB1vjzQCQT/EE1NZxBAAAE0JO+57dpP4Skkz4zFS5BZDsAwSHPKULJ8zVB/Kj3wGtLKEL4zStBNKbuwE4wIkIAAIdAc7+0V7E9dEWZPp+U/kCyKv9BZ+22Qbdx/kAvpgVCWU+zQVg96UCaE+hB9qusQQAAFOISvQfiej8KYUg+yfM1Qfyo98BrSyhCNPZGQUOM7MAOHiJC+M0rQTSm7sBOMCJCAABrjAi9bqFyP8xmoj409kZBQ4zswA4eIkIVLUVB94zYwPeZGkL4zStBNKbuwE4wIkIAANRx1b5KTFw/UN6VPmy5LEFpytjAw3saQotqJUG4UerAp1IeQvjNK0E0pu7ATjAiQgAA+K1mPrC0SD8zFBQ/Ib2GQPtDN0JeoThCy/GWQF6ZOEKwCDZCNuUsQGI6N0I1CDtCAAA6BrQ+bDiXPtxpYz8hvYZA+0M3Ql6hOEI25SxAYjo3QjUIO0IFEoxAXR82QiC/OEIAAGcvtT7VUbw+lyRcPzblLEBiOjdCNQg7QqEWMUAe9TVCuHc7QgUSjEBdHzZCIL84QgAAmQ5FP37pO75ghBy/Y2SLQXWndUC29Y5BL1CFQdyTq0D3pYNBRO6RQU2vvEAQQJJBAAB2Zgy/0gu5vnMJQb+doAlBpgeXQM66bkGp0Q1BWo0dQC3/fEHxX+9AdCARQI9Kh0EAADntJb/tK46+R4Y1v6tBw0Dfz8c/L5aTQW4F6kDr07RAs9R7QfFf70B0IBFAj0qHQQAAfmUmvyvzjb4wIzW/bgXqQOvTtECz1HtBnaAJQaYHl0DOum5B8V/vQHQgEUCPSodBAACnZ0a+ifVBvmBsdj8TBiBBcgY7QWKS20EwWTtBau0xQT1t3UGekS5BQFpCQa/B3UEAAKTYGr6+tW8+oNt1P9UKJEFMiiJBTd/eQRMGIEFyBjtBYpLbQZdKD0EZsxlB6FDeQQAAgxLNvkPsnD6PDl0/zmXjQB4oP0EuztBB51PuQF7DC0GRMdtBl0oPQRmzGUHoUN5BAAAc2ng/eZ9pvnTUYL1li5pBxmMhQKHvuEFJipVBZfwjv1p2yUGotpZBjU3oPsXauUEAAOg8ej/4i1a+3p3KvGWLmkHGYyFAoe+4QZJhmkFpzhRAn82/QUmKlUFl/CO/WnbJQQAAJZv1vqYcbT70qFg/zmXjQB4oP0EuztBBl0oPQRmzGUHoUN5BsrcKQVSJSUHLedZBAABAnSq+6f17P+eTaz1c45NB15guP6W7eUGrf5pBOeJQP8Rbe0FYnphB4IFQPxTecEEAANZzuj7SLQA8yGluvx1pvEDmAak+Cfd7Qf2u4EAjEvw8IIKBQcH0y0ByQ9u+BOd+QQAAX8H1vnVxUT9oHqK+JjSSQblS6D4xZ3VBXOOTQdeYLj+lu3lBWJ6YQeCBUD8U3nBBAADj/xs/GNtRPq4URL/B9MtAckPbvgTnfkF2k5pAeplfveTbbEEdabxA5gGpPgn3e0EAAGjl774331o/8s5jvliemEHggVA/FN5wQWYfoEFZh5Y/+3xnQVg+mkFrUU4/K39pQQAAYGYkvy78ND+yspe+WJ6YQeCBUD8U3nBBWD6aQWtRTj8rf2lB9H6VQa2IvD7oXW1BAABTglw/4k5GvB0CAj9pVG1BfWHfQSAgwUHGZ3VBot7wQZaxukHyWGRBcBX4Qe5UyUEAAD6kPD9ilbW9GZErP0lpZEFboOBBfDHGQWlUbUF9Yd9BICDBQfJYZEFwFfhB7lTJQQAANp9XPzgDrb25Sgg/8lhkQXAV+EHuVMlBxmd1QaLe8EGWsbpBxJhsQRhnBULrxsVBAAB7ziO/SH8bPwgI8b5YPppBa1FOPyt/aUEo65lBOygTP/qbZUH0fpVBrYi8PuhdbUEAAK5nLb9TFRY/9IXjvijrmUE7KBM/+ptlQVg+mkFrUU4/K39pQcLAn0G/9ZA/IphfQQAA2Dz+voEIMT9fTAa/JjSSQblS6D4xZ3VBWJ6YQeCBUD8U3nBB9H6VQa2IvD7oXW1BAADqrU6+CXFGP1pBGb+z3YxBtdORPlQBe0E1CIdBVNjlPlsrgUFLOoxBNngePwIugUEAAJqUFj/qmzm8iwJPv4/hgUDQx3i+Z+tjQXaTmkB6mV+95NtsQcH0y0ByQ9u+BOd+QQAA5xoeP/5ROT6G8EO/dpOaQHqZX73k22xB+hKXQDHL4T4vUm1BHWm8QOYBqT4J93tBAADLWdA+QZhPP1lL177bVqJAE/MEP1swdUEdabxA5gGpPgn3e0H6EpdAMcvhPi9SbUEAAIVP3D4H6jw/UxcFvwgCoUFrIjdC/v8hQrHfm0F/SjVCNkIdQuJxmEHFoDZCx7wdQgAA6v9EP9wm3D3PJiG/uEmiQTVuNEK6FyBCJ9umQX5ANkIkMiNCrKGpQf8vNULltSRCAACOVjw/U9DivqMpA7+soalB/y81QuW1JEKuGKdBjf8zQi7rI0K4SaJBNW40QroXIEIAAL30LD+Eppk+K2UsvyfbpkF+QDZCJDIjQrhJokE1bjRCuhcgQrHfm0F/SjVCNkIdQgAAwgoaP+B9KL8zq+e+c+mbQYIZM0L4yR1CuEmiQTVuNEK6FyBCrhinQY3/M0Iu6yNCAADpQ4A+EjV3PuMBcD8hvYZA+0M3Ql6hOEIFEoxAXR82QiC/OELplbBAzoU3QpgqN0IAAByj0j16lFk/Q0sEPyG9hkD7QzdCXqE4QumVsEDOhTdCmCo3QsvxlkBemThCsAg2QgAA1hDEPoYZab/ogB++D7KjQSj+MkKjnSVC6VOaQcgzMkLGuB5CrhinQY3/M0Iu6yNCAABhmV4+50KoPhpKaz/plbBAzoU3QpgqN0IFEoxAXR82QiC/OEJ6JbRAwf41QnibN0IAAHFqgb6/FY8+PSFtP7K3CkFUiUlBy3nWQZdKD0EZsxlB6FDeQRMGIEFyBjtBYpLbQQAAREVxPykxor4Oytq9qLaWQY1N6D7F2rlBSYqVQWX8I79adslBfLmNQcRmRMBhHb5BAAAA7kw/XzcQPXUpGT9pVG1BfWHfQSAgwUFZzHpBR3XUQQbCuEHGZ3VBot7wQZaxukEAAKW9cj8RM22+DpVevqi2lkGNTeg+xdq5QbwxlkHr3gdAxVupQWWLmkHGYyFAoe+4QQAAcnPzvmfZWj4sdlo/srcKQVSJSUHLedZBO2zmQFsNiEEjF8dBzmXjQB4oP0EuztBBAABNUXM/fkhgvhjfYb5li5pBxmMhQKHvuEG8MZZB694HQMVbqUH9rplB0S1YQPpsrkEAAE+4C786rzM+1cBRP7K3CkFUiUlBy3nWQQSXCUFBX41BhmfNQTts5kBbDYhBIxfHQQAAl6a6vtn2Sj6E62g/srcKQVSJSUHLedZB4WkdQTtSU0HOJ9lBBJcJQUFfjUGGZ81BAABPG2k/W+yBvmIPp75OAY9BbYhQP6RvnUG8MZZB694HQMVbqUEUrpFBnu8nvVg5qkEAAEHobz+ZLoO+1ZhyvhSukUGe7ye9WDmqQbwxlkHr3gdAxVupQai2lkGNTeg+xdq5QQAA/+FqP1/rhb4AZZm+C52MQWllXb82dqBBFK6RQZ7vJ71YOapBkmGOQZ8bx78Hs6pBAAC5plE/U/HxPULDDz8ZQXxB04q2QU/9vUFqGoZBHc27QWpAsUFZzHpBR3XUQQbCuEEAABd59r4si1E/iICgPotqJUG4UerAp1IeQrWrKEF0eATBIZEpQvjNK0E0pu7ATjAiQgAA5qJwv+9whz5isVw+n88ZQdBlAsET2BhCrHMoQXl5BsEUDypCzTciQbQI/MCdqiBCAAAAP3e/Xt0VPkomWz6fzxlB0GUCwRPYGEJV8CFBHNUMwT3MI0KscyhBeXkGwRQPKkIAAN6ZNr7Bqi8/J4k0vzUIh0FU2OU+WyuBQdWJhEEvQDw/lAeEQUs6jEE2eB4/Ai6BQQAAJ+M0P1TfDT4opTE/97VvQYyxw0H9v8FBGUF8QdOKtkFP/b1BWcx6QUd11EEGwrhBAABhk1i/l3ZjvcDABz9xIhFBBpPlQcvuxUEHHhhBcAj4QZRvzUHWPQhBJ0L0QXJgwEEAABCzTL95bXW8pq8ZP9Y9CEEnQvRBcmDAQYsa/UDfTd1B2lm5QXEiEUEGk+VBy+7FQQAAHIRvP1Qih758F3C+qLaWQY1N6D7F2rlBkmGOQZ8bx78Hs6pBFK6RQZ7vJ71YOapBAAChKXw/MvDgvb0zCL7aRY1BFCiqv27/oEGSYY5BnxvHvwezqkGPAo5BWt0jwMKWrkEAAGFhT79SBJg8zwUWP3EiEUEGk+VBy+7FQYsa/UDfTd1B2lm5QcAPC0Ha6NVBOzvCQQAA4DgAP0O7S7+COa6+rhinQY3/M0Iu6yNC6VOaQcgzMkLGuB5Cc+mbQYIZM0L4yR1CAAB/+2G/15UwPQKN7z6LGv1A303dQdpZuUHWPQhBJ0L0QXJgwEGflP5Asir/QWfttkEAAM73Jj/z8m69+3pBv7Hfm0F/SjVCNkIdQrhJokE1bjRCuhcgQoNxlEEIEzNCQDkaQgAAvgUkPwhwwb7FGyu/uEmiQTVuNEK6FyBCc+mbQYIZM0L4yR1Cg3GUQQgTM0JAORpCAAC7+Cc+fFpyPwPzjb6wuZdBUSE4QmOnIkIIAqFBayI3Qv7/IULicZhBxaA2Qse8HUIAAEBftz4n5OO+ExxSP6EWMUAe9TVCuHc7QrOCc0A/0zRCwwo5QgUSjEBdHzZCIL84QgAAApc5PhmY+74uFFo/1eKcQLzVNEJ/jjdCeiW0QMH+NUJ4mzdCBRKMQF0fNkIgvzhCAAC2Ips+X5GpvnDCZD/V4pxAvNU0Qn+ON0IFEoxAXR82QiC/OEKzgnNAP9M0QsMKOUIAAN7jJj4qN12/ZcvzPrOCc0A/0zRCwwo5Qi+KhUD7ezNCvho2QtXinEC81TRCf443QgAArEgAPorhVr/RZgc/L4qFQPt7M0K+GjZCANynQFOLM0L4LjVC1eKcQLzVNEJ/jjdCAAABYW4/3zalvpDILb6SYY5BnxvHvwezqkGotpZBjU3oPsXauUF8uY1BxGZEwGEdvkEAAL9UeL/Vdte9pTlgPsYkJUGIFxDBqPQmQlXwIUEc1QzBPcwjQkjUI0G8GRbBOsckQgAAVrkLv71Jsr5FG0O/KVmcQb+/G749fmFB+AmSQXfO/b+DpH1BJx6PQZoNtb6J6nVBAACF53u/F1ZivXhwLT6fzxlB0GUCwRPYGEIDthxBvvwKwftaHEJV8CFBHNUMwT3MI0IAAIShWD9V0xE+GnIDP+98gUHwceNBzdytQVnMekFHddRBBsK4QWoahkEdzbtBakCxQQAA3KhtPzvlDD7WyLA+73yBQfBx40HN3K1BahqGQR3Nu0FqQLFBv+yGQeGQ1UGFxqRBAAAeA9A+gbkRPuYQZ792k5pAeplfveTbbEE9x4dAs0RKP1/CakH6EpdAMcvhPi9SbUEAAN+Eez97Pzy+1Ib2vCCgi0FxuZTAk77GQY8CjkFa3SPAwpauQXy5jUHEZkTAYR2+QQAAOZR8PyhheL1j3Bo+If6KQXFbi8DWz8tBIKCLQXG5lMCTvsZBfLmNQcRmRMBhHb5BAABxUS+/qi8tPs5zNb+08ZRBduR0vYnMbEH0fpVBrYi8PuhdbUEo65lBOygTP/qbZUEAAMxaKj95SkI+ONA4P6H+fUF8s5ZBT47FQfISikHwT3tBmu3BQRlBfEHTirZBT/29QQAA1sFtPyIplr4WOWg+1faLQZfsrsBc/sVBjjWLQaXwt8CsK8ZB24eOQcDVq8BWe7xBAAAQAnc/Pr2iPCQfhj7V9otBl+yuwFz+xUHbh45BwNWrwFZ7vEEgoItBcbmUwJO+xkEAAGLpST+qVlM+Yj4UP2oahkEdzbtBakCxQRlBfEHTirZBT/29Qag9jUHhXYRBeUm7QQAAQk5JP+xpUj6xJRU/qD2NQeFdhEF5SbtBGUF8QdOKtkFP/b1B8hKKQfBPe0Ga7cFBAACy0h4+ealyP/h4jr7icZhBxaA2Qse8HUJSPY9BDV82QipMGkKwuZdBUSE4QmOnIkIAAFLtvD1ooXy/6AEIPg+yo0Eo/jJCo50lQiXghkHMVzJCxssqQruIj0HrSjFCQvwfQgAA/0sfP//DST7r8kE/of59QXyzlkFPjsVBGUF8QdOKtkFP/b1B8wVuQSwOrEGlj8ZBAAAr1Fk9mrF2v6kOhj486ElAGww0QvkAOUJ4RhlAVEszQoPZNkIvioVA+3szQr4aNkIAAEXsdb/8ZcM9KZaFPrdx/kAvpgVCWU+zQScI30CBeuZBN9yjQVg96UCaE+hB9qusQQAAFjkqPilwfL8zmwk5u4iPQetKMUJC/B9C6VOaQcgzMkLGuB5CD7KjQSj+MkKjnSVCAABpbkI+nM15v8063j3mlJJBQDAxQuFhHELpU5pByDMyQsa4HkK7iI9B60oxQkL8H0IAAKpBI7/Eh8s9WYpDv7TxlEF25HS9icxsQScej0GaDbW+iep1QbPdjEG105E+VAF7QQAA7HB6vx81VD6Mp107LoHxQEVM/EHEu6JBJwjfQIF65kE33KNBt3H+QC+mBUJZT7NBAAAxE3O/wLCuPXKUmj5YPelAmhPoQfarrEFvP+lArs/WQViOsUGflP5Asir/QWfttkEAACwFXL/epTs9ElgCP28/6UCuz9ZBWI6xQYsa/UDfTd1B2lm5QZ+U/kCyKv9BZ+22QQAAO/JmPyp4rD7+CIq+wA50QSyGAkJ/K5RBYDxmQSgXFkKA8K1BegpxQTgwDkJMRaxBAACX/38/Dvwqu9+kHLupzGNBBwAGQn80jEEtsmNBAAAUQgAAMEFC9mNBALwOQk8gm0EAAKH7Y792meK+VxrXPcW/JkE/dhrBiV8mQkjUI0G8GRbBOsckQrzMJEHUpBvB8v4gQgAAc1tnv6q31b7gfcI9MIMcQd7+EsFkyBZCvMwkQdSkG8Hy/iBCSNQjQbwZFsE6xyRCAACId3u/WBAhvp930D2cih5BOHsOwfL2GkJI1CNBvBkWwTrHJEJV8CFBHNUMwT3MI0IAAIGBTb/BSRa/EjDWPZyKHkE4ew7B8vYaQlXwIUEc1QzBPcwjQgO2HEG+/ArB+1ocQgAA/clFPyMO0j75Efi+TpVxQWGE9UFCKIRBqcxjQQcABkJ/NIxBQvZjQQC8DkJPIJtBAABfJeU+gqlNvzgeyb7mlJJBQDAxQuFhHEJz6ZtBghkzQvjJHULpU5pByDMyQsa4HkIAAIRQCD9vabS+WwVFv4/hgUDQx3i+Z+tjQcH0y0ByQ9u+BOd+QWd5t0BJZtu/Pp6AQQAA/j9eP/AbRz54x+k+qD2NQeFdhEF5SbtB+ACSQWfKhEHmDLJBahqGQR3Nu0FqQLFBAADYBl4/DPFGPmKp6j74AJJBZ8qEQeYMskG/7IZB4ZDVQYXGpEFqGoZBHc27QWpAsUEAAGYodz4r1lS/oiIAPy+KhUD7ezNCvho2QrOCc0A/0zRCwwo5QjzoSUAbDDRC+QA5QgAAV5VvP6qVNj6gl5s++ACSQWfKhEHmDLJBPUySQSeloEE0zaBBv+yGQeGQ1UGFxqRBAACEwEA/Ks/lPjRp9r49x4dAs0RKP1/CakF2k5pAeplfveTbbEEmoXdAi3U7P6mJYEEAALo/mrzugae9xBh/PxUtRUH3jNjA95kaQswnNUHPdcTAXLsaQmy5LEFpytjAw3saQgAAjXc3vu1SVz1uf3s/zRcxQXqipMByVRpCbLksQWnK2MDDexpCzCc1Qc91xMBcuxpCAADtWtk+QKNnP5YPBb09x4dAs0RKP1/CakHmVWdAOGuIP/s0YkGcMERAVlGqPztpZUEAAF6mpr6T6aI9ozNxP80XMUF6oqTAclUaQpuyHkGJOcrATCQZQgAAJkFT2dfAjeoZQgAA7tegvhRImD0RS3I/bLksQWnK2MDDexpCzRcxQXqipMByVRpCAAAmQVPZ18CN6hlCAAB7lXg/XZZ0PrCD4bu7tIBB1Nr0QTGHp0H0cIlBPw/RQbqxnUHzrYJBin7sQaPQm0EAAJdAP7/EwTE+Z0QkvyY0kkG5Uug+MWd1QfR+lUGtiLw+6F1tQbTxlEF25HS9icxsQQAA3OihvT+CeT/+WlY+B6X/QHFaOUJVYzVCADulQERGOUKWfDFCGPrEQGajOEKO8jVCAAD4whu/gVb0vG4ES7+08ZRBduR0vYnMbEEpWZxBv78bvj1+YUEnHo9Bmg21vonqdUEAABFWlbsoSX0/IqUUPgA7pUBERjlClnwxQsvxlkBemThCsAg2Qhj6xEBmozhCjvI1QgAAPdR3P4vseT58cmm97dWMQewWw0HlhptBrLiHQWR+1EEHMI9B9HCJQT8P0UG6sZ1BAAD8XHg/CbBwPt80c730cIlBPw/RQbqxnUGsuIdBZH7UQQcwj0HzrYJBin7sQaPQm0EAAHK8dz87IXw+0WJcve3VjEHsFsNB5YabQV4Zj0GapLhBbW6UQay4h0FkftRBBzCPQQAAEA9yP831kD4sciS+wA50QSyGAkJ/K5RB862CQYp+7EGj0JtBrLiHQWR+1EEHMI9BAABUQ20/9ZWSPtfZeL5gfoJBQzPVQWgqeEHADnRBLIYCQn8rlEGsuIdBZH7UQQcwj0EAAAIBdT+Qt0E+g/xgPvRwiUE/D9FBurGdQb/shkHhkNVBhcakQT1MkkEnpaBBNM2gQQAATIEAvxDR4j4UKT6/tPGUQXbkdL2JzGxBs92MQbXTkT5UAXtBJjSSQblS6D4xZ3VBAADWhHg/tE4GPlXLTT7bh45BwNWrwFZ7vEEJio1BMO2NwChkvEEgoItBcbmUwJO+xkEAAGbUPT9uXiu/ac04PduHjkHA1avAVnu8QY41i0Gl8LfArCvGQRLHikFhZLvAlnXAQQAAtk93P+GiIT4wY1E+jwKOQVrdI8DClq5BIKCLQXG5lMCTvsZBCYqNQTDtjcAoZLxBAACYvvG+45KDPpzdV7/zLIhB30PsPH4Cf0E1CIdBVNjlPlsrgUGz3YxBtdORPlQBe0EAAA+7Cr9R4Eo+RRZRP+aNFUG1CsnA2JYXQpuyHkGJOcrATCQZQib8J0GxcZ/AmGIZQgAAdPsnvz39yL21iT8/m7IeQYk5ysBMJBlCmpAZQT522cA9xBdCzKMeQT0o2sAs3hhCAABbSO2+2EpkPjWNW7/zLIhB30PsPH4Cf0Gz3YxBtdORPlQBe0EnHo9Bmg21vonqdUEAAHInPj4oTga/VLFUPwDcp0BTizNC+C41Qi+KhUD7ezNCvho2Quq720Cr8zJCL1wzQgAA5YJhPc35ez/l1is+hVwPQLr2OEJDJTdCy/GWQF6ZOEKwCDZCADulQERGOUKWfDFCAACgUQS97kt/v4uHiD0vioVA+3szQr4aNkKnCIhAIlYyQrQVJULqu9tAq/MyQi9cM0IAAHdYCb/hAxI9O9hXv8LagUHmcva+wVqDQfMsiEHfQ+w8fgJ/QScej0GaDbW+iep1QQAAeYDIvh2rbr4z32O/wtqBQeZy9r7BWoNBQMJ6QasYBD/vO4NB8yyIQd9D7Dx+An9BAAC9/y+++H/HPuifZ781CIdBVNjlPlsrgUHzLIhB30PsPH4Cf0FAwnpBqxgEP+87g0EAABGJdr1jgn0/d3kAvrkqFkFTNThCiFYaQj6hgEB1DzhCl3cjQqueykCXDzlCVu0mQgAABC4cv+gn1r28EEm/tPGUQXbkdL2JzGxBSNGdQUgBLz8vbl1BKVmcQb+/G749fmFBAABH0jm/qlaFPjT6Ir8o65lBOygTP/qbZUFI0Z1BSAEvPy9uXUG08ZRBduR0vYnMbEEAAPFrcj9AbUI+Cr6EPvRwiUE/D9FBurGdQT1MkkEnpaBBNM2gQe3VjEHsFsNB5YabQQAAJYJOPymiyD7lguK+TpVxQWGE9UFCKIRBQvZjQQC8DkJPIJtBwA50QSyGAkJ/K5RBAABv0Hs/kH4qPniXjD09TJJBJ6WgQTTNoEFeGY9BmqS4QW1ulEHt1YxB7BbDQeWGm0EAAKao9L7hJu697eZePwAAJkFT2dfAjeoZQpuyHkGJOcrATCQZQsyjHkE9KNrALN4YQgAArx4Pv1SNUL7KwE0/5o0VQbUKycDYlhdCmpAZQT522cA9xBdCm7IeQYk5ysBMJBlCAACCHnw/Q2wmPsZTeD09TJJBJ6WgQTTNoEFXU5dBOY6EQdttmkFeGY9BmqS4QW1ulEEAAO7/fz8zXyK6cWutuue9Y0GtqfhBmfJ+QS2yY0EAABRCAAAwQanMY0EHAAZCfzSMQQAAo41rP7OIAT7mwb0+24eOQcDVq8BWe7xB9gSRQSDllMB/WLRBCYqNQTDtjcAoZLxBAADkNmK/yrm3Pjbwmb42+RJBvgYUQhBfpkEEKQhBKHoFQluIk0Fe9AhB6aAQQtX7rEEAANjLcb9XoYs+vXY7vtb480AkE/xBNTWcQV70CEHpoBBC1fusQRHe3UBdmdpB2tmGQQAAjPUcPoT5d78jMUg+u4iPQetKMUJC/B9CLGFrQUHPLkJg0B1CHBaEQTNKL0K8jBpCAAAT9k2/3HTXPi2T1r42+RJBvgYUQhBfpkHBsRNBadwNQkxMmUEEKQhBKHoFQluIk0EAAL9AR78jOdo+twrsvgQpCEEoegVCW4iTQcGxE0Fp3A1CTEyZQfb+D0EW9gZCjKmPQQAAEd1jPgWed798APo9HBaEQTNKL0K8jBpC5pSSQUAwMULhYRxCu4iPQetKMUJC/B9CAADdiFM/m/PkvkRSrz7bh45BwNWrwFZ7vEESx4pBYWS7wJZ1wEEcxI1B6Qi4wA5YukEAAFD+YT+74Fg+TrHWPp7ukkG6EanAyN2yQfYEkUEg5ZTAf1i0QduHjkHA1avAVnu8QQAAeelqv52fnD7P6oG+BCkIQSh6BUJbiJNBEd7dQF2Z2kHa2YZBXvQIQemgEELV+6xBAAD+/3+/pnkFOrY8rjjBsRNBadwNQkxMmUEtshNBAAAUQgAAMEF2qxNByTIDQk0QiEEAAL4QCr9ajQc/FKEnv8GxE0Fp3A1CTEyZQXarE0HJMgNCTRCIQfb+D0EW9gZCjKmPQQAA/qxSP4875r5vw7E+24eOQcDVq8BWe7xBHMSNQekIuMAOWLpBA5+PQeOYt8CrFrZBAABWsWA//+eUvh7/wj7bh45BwNWrwFZ7vEFJ65NBo4e0wGJnrkGe7pJBuhGpwMjdskEAABbELj86byI/uI65viahd0CLdTs/qYlgQbF4NkCUT6Q/xUxRQeZVZ0A4a4g/+zRiQQAAuavJPqd+Nj8KihS/4nGYQcWgNkLHvB1Csd+bQX9KNUI2Qh1CUj2PQQ1fNkIqTBpCAAA2hzQ/WmGxPVsmNL8moXdAi3U7P6mJYEHKD1BAlVg5P9ebVkGxeDZAlE+kP8VMUUEAAOPBGj8hWim+xHtHv3aTmkB6mV+95NtsQY/hgUDQx3i+Z+tjQcoPUECVWDk/15tWQQAA328yP4fKLT52WTK/JqF3QIt1Oz+piWBBdpOaQHqZX73k22xByg9QQJVYOT/Xm1ZBAACC5DY/JFgmv2znhL6DcZRBCBMzQkA5GkLmlJJBQDAxQuFhHEIoYZJBI6cxQhPxGkIAAEqD5z7pV0K/wbnvvoNxlEEIEzNCQDkaQnPpm0GCGTNC+MkdQuaUkkFAMDFC4WEcQgAAXRBDPx53B78eKL8+SeuTQaOHtMBiZ65B24eOQcDVq8BWe7xBA5+PQeOYt8CrFrZBAAADldU+WREfP5rKKb9szYtB+nU0QkVtF0JSPY9BDV82QipMGkKx35tBf0o1QjZCHUIAAJPEo71zoH6/UmGGPZFdEUCvUjNCZWMqQqcIiEAiVjJCtBUlQi+KhUD7ezNCvho2QgAAGF41vIRKcT8J9ao+bLksQWnK2MDDexpC+M0rQTSm7sBOMCJCFS1FQfeM2MD3mRpCAADtu0c//NUjPiPOGj8cIbVBgzUpwGdNeEHPIrJBW0ULwNwLfkEWk69BoORXwLPchEEAADs4hr5dito+W5FdP2y5LEFpytjAw3saQgAAJkFT2dfAjeoZQivUH0G8MuXAmEUaQgAAbIvcvrFNWz/OWpE+bLksQWnK2MDDexpCK9QfQbwy5cCYRRpCi2olQbhR6sCnUh5CAABk+vC+sM0TP7fMKj/Mox5BPSjawCzeGEIr1B9BvDLlwJhFGkIAACZBU9nXwI3qGUIAAK5WNb+FGB4/PQWvPotqJUG4UerAp1IeQivUH0G8MuXAmEUaQs03IkG0CPzAnaogQgAA8jRkv/79wD4DyIA+K9QfQbwy5cCYRRpCKvUbQUqG9sBwFhpCzTciQbQI/MCdqiBCAADTz3U//e9jPgfCLL4Pj41BzM+tQZK/ekGsuIdBZH7UQQcwj0FeGY9BmqS4QW1ulEEAAOHHeD/OEzo+H+MZvl4Zj0GapLhBbW6UQRCBk0EvjZJBiduCQQ+PjUHMz61Bkr96QQAAGVUlPycoOD2xHEM/2/xmQcv8y0Hg9MRB97VvQYyxw0H9v8FBaVRtQX1h30EgIMFBAAAxFRI/3tMYPh26Tr+x35tBf0o1QjZCHUKDcZRBCBMzQkA5GkJszYtB+nU0QkVtF0IAAOVSDj+3yCi/YJUBv+nIjUGciDFC5JIYQoNxlEEIEzNCQDkaQihhkkEjpzFCE/EaQgAAN8EyvzyE1T6b8hS/dqsTQckyA0JNEIhB9t0HQTMd8kG/m4BB9v4PQRb2BkKMqY9BAACxULo+evZgvzUbnr7pyI1BnIgxQuSSGEIoYZJBI6cxQhPxGkLmlJJBQDAxQuFhHEIAAKuVR7/Gy8M+u+n9vgQpCEEoegVCW4iTQfb+D0EW9gZCjKmPQfbdB0EzHfJBv5uAQQAAqqHwPidQTb8KwLy+5pSSQUAwMULhYRxCTpSJQU81MELIxhhC6ciNQZyIMULkkhhCAACYQlc/DI+1PtZc0b7ADnRBLIYCQn8rlEFgfoJBQzPVQWgqeEFOlXFBYYT1QUIohEEAAFwN7D1vaHU/bkWFvlI9j0ENXzZCKkwaQlmrX0FYRjhCyVoaQrC5l0FRIThCY6ciQgAAj2pAP+g18jsm2Cg/aVRtQX1h30EgIMFBSWlkQVug4EF8McZB2/xmQcv8y0Hg9MRBAAAwA2I/d0GXvpnruj503bBB1FtcwCVKgUEcIbVBgzUpwGdNeEEWk69BoORXwLPchEEAALDCfz+lqi69jNfrO5JhjkGfG8e/B7OqQXy5jUHEZkTAYR2+QY8CjkFa3SPAwpauQQAANaVQv1uToj4TKPg+Kg0XQf5k7MDXKxdCK9QfQbwy5cCYRRpCzKMeQT0o2sAs3hhCAACTzE4/p4xEPZllFj9ZzHpBR3XUQQbCuEFpVG1BfWHfQSAgwUH3tW9BjLHDQf2/wUEAAMRvUL/nQqU+9xT3Pir1G0FKhvbAcBYaQivUH0G8MuXAmEUaQioNF0H+ZOzA1ysXQgAAnR4LP3Lenz7Zekc/x7dRP/yzNkJKfkBCvUnqPx7hNUKqAD5CNuUsQGI6N0I1CDtCAACSspc+pkRSP8+P+T425SxAYjo3QjUIO0IMShJAVCA4Qn2HOkLHt1E//LM2Qkp+QEIAAFMcED/rpoC+zpFJP71J6j8e4TVCqgA+Qi6XDD+RKTVCDXBBQuLKoD9CaTRCFC0/QgAAde1rv0AlqDqevMY+Kg0XQf5k7MDXKxdCku4UQXkL/MBv6xVCKvUbQUqG9sBwFhpCAADa8ie/M9N/vJwqQT8qDRdB/mTswNcrF0LMox5BPSjawCzeGEKakBlBPnbZwD3EF0IAAO8jQ7/oSMo+5T8Dv/bdB0EzHfJBv5uAQSpk/ECyX+tBnJqCQQQpCEEoegVCW4iTQQAA9uF3vntaQj8qqxo/avQGQLvwvj+PKmJBKgYgQKeEgD9ve25BkIlKQPxOdj9GlXNBAACYmm4/NJVqPum7jz6PAo5BWt0jwMKWrkEJio1BMO2NwChkvEFDNZBBCXU3wCtKqUEAAOsaJz870T6/pJkKvvCRrkHQOWvAsnSAQas0skGufkrAo+p2QXTdsEHUW1zAJUqBQQAAUGspP+X8PL9/qwW+dN2wQdRbXMAlSoFBqzSyQa5+SsCj6nZBzjO1QeA5M8ASZ3RBAADtFmM/78i+vrSFiz4cIbVBgzUpwGdNeEF03bBB1FtcwCVKgUHOM7VB4DkzwBJndEEAAIfVDL+MxvQ+nUcvP5w7tz9m4UY/MK5mQbvhWECW1wHA8ZePQaxji0BeRI2/dKSQQQAAvn9Uvy3VCb2/fw4/ixr9QN9N3UHaWblBbz/pQK7P1kFYjrFBwA8LQdro1UE7O8JBAAD/iBs/M6/OvmgdLz+9Seo/HuE1QqoAPkLiyqA/Qmk0QhQtP0KG+/o/AVI0QoOePEIAAEIBwj4ghE+/k5fkPiAGVT9umTNCSSQ/Qob7+j8BUjRCg548QuLKoD9CaTRCFC0/QgAArIo5v/vYmb4buR4/mpAZQT522cA9xBdC5o0VQbUKycDYlhdCQ28KQeYYzMCOJxRCAABcGC2/m4tCPfM3PD+zMQdB2S/CQSe6wUEY7hFB7EO1QaB/x0HADwtB2ujVQTs7wkEAADIj375gRhw/408pP5w7tz9m4UY/MK5mQaxji0BeRI2/dKSQQZ+AWkBkjOA+LUqAQQAAK7hoP4Pytz7tF1g+2kWNQRQoqr9u/6BBjwKOQVrdI8DClq5BQzWQQQl1N8ArSqlBAADBBiK/ODgtPZbnRT+zMQdB2S/CQSe6wUHADwtB2ujVQTs7wkHTfu9Agom1QZgYvEEAAHN4Ub+fqA0+ntcOP9N+70CCibVBmBi8QcAPC0Ha6NVBOzvCQW8/6UCuz9ZBWI6xQQAAOfwGP80Aur7NokQ/oRYxQB71NUK4dztCvUnqPx7hNUKqAD5CesAzQOKxNEKXwTpCAAAD2gM/yQS+PoDMRT+hFjFAHvU1Qrh3O0I25SxAYjo3QjUIO0K9Seo/HuE1QqoAPkIAAIK2ZT/ABJo+/mClPgmKjUEw7Y3AKGS8QfYEkUEg5ZTAf1i0QUM1kEEJdTfAK0qpQQAAAsZFP3Kr1D7u4fU+9gSRQSDllMB/WLRBGDeXQdrYj8B9SalBQzWQQQl1N8ArSqlBAACoKz2/ep8jPgiQJz+zMQdB2S/CQSe6wUHTfu9Agom1QZgYvEGoPv1AsIqqQTCpwkEAAIicUb9V5vc9g6kPPwYuUj5MHea/PSFoQUO6BT8Xzt2/Fk9vQbkro746Cjm/QTBYQQAARv01v0Uw2r1k9zE/Q28KQeYYzMCOJxRCku4UQXkL/MBv6xVCmpAZQT522cA9xBdCAADaflg/Qi9hPUblBz8cIbVBgzUpwGdNeEFcmLlBWon5vzjsaEGh2LlBhTKnv5AOZ0EAAOV7ZT/YvLa+tIiGPhwhtUGDNSnAZ014Qc4ztUHgOTPAEmd0QVyYuUFaifm/OOxoQQAA4rSKPkuhdb8qZJ69HBaEQTNKL0K8jBpCTpSJQU81MELIxhhC5pSSQUAwMULhYRxCAAD4vyE/COTZPsvXJb/nvWNBran4QZnyfkGpzGNBBwAGQn80jEFOlXFBYYT1QUIohEEAAP7/fz84UkE4BKIJum+7Y0HjBeNBLsZoQS2yY0EAABRCAAAwQee9Y0GtqfhBmfJ+QQAAMiENPz+6wj4TGj6/iUp4QZCf1EFtSWlBb7tjQeMF40EuxmhB571jQa2p+EGZ8n5BAADdeSE/xO/DPqnPLL9OlXFBYYT1QUIohEGJSnhBkJ/UQW1JaUHnvWNBran4QZnyfkEAAP7/f79VjAc64tS5OAKlE0GBS/BBw691QXarE0HJMgNCTRCIQS2yE0EAABRCAAAwQQAAjuwSP0yfMj5o1Ey/I8V+QZEQMUKiOxJCbM2LQfp1NEJFbRdCg3GUQQgTM0JAORpCAADjSD0/aYjLPoQbCz++w5pBWgdOwEj9nEFDNZBBCXU3wCtKqUEYN5dB2tiPwH1JqUEAAKVDcj4TE0U/H8EXPzblLEBiOjdCNQg7QsvxlkBemThCsAg2QgxKEkBUIDhCfYc6QgAAx+t+PR04eD9ATXI+DEoSQFQgOEJ9hzpCy/GWQF6ZOEKwCDZChVwPQLr2OEJDJTdCAACKe/c+9psdP19SHz/Ht1E//LM2Qkp+QEIMShJAVCA4Qn2HOkI+i5g/7MA3QvVLPkIAAL2s8T0pJHc/bCVuPoVcD0C69jhCQyU3Qj6LmD/swDdC9Us+QgxKEkBUIDhCfYc6QgAAY/kXPnQCdT/Z9X4+PouYP+zAN0L1Sz5ChVwPQLr2OEJDJTdC0DsSPxNwOEJyJT1CAADVnXe/lcaBPnAnWjyS7hRBeQv8wG/rFUIqDRdB/mTswNcrF0KakBlBPnbZwD3EF0IAAMW0Rj8BuRo+2LMcP6HYuUGFMqe/kA5nQc8iskFbRQvA3At+QRwhtUGDNSnAZ014QQAAO3d2v+MT+D1IhHc+zTciQbQI/MCdqiBCKvUbQUqG9sBwFhpCn88ZQdBlAsET2BhCAADNbzU/dUwvv1DDLb4OY7dBxBoLwJfwZEELyrtBr+zBv+MyX0FcmLlBWon5vzjsaEEAAGSmDz/naxO/gzUYvyPFfkGREDFCojsSQoNxlEEIEzNCQDkaQunIjUGciDFC5JIYQgAAIumzPigrKz8KxCe/FYl1QR+QNELN9hJCUj2PQQ1fNkIqTBpCbM2LQfp1NEJFbRdCAAA1QFA/RwIUv108gb3OM7VB4DkzwBJndEHhWrZB5dIiwP2MbEFcmLlBWon5vzjsaEEAACwqZ780h9u+TeTjvLxEG0HUkwbBsBEXQpyKHkE4ew7B8vYaQgO2HEG+/ArB+1ocQgAAr7upPr/bNj9DyR2/bHZ7QVndMkL5yhFCFYl1QR+QNELN9hJCbM2LQfp1NEJFbRdCAAA9HB4/NxjSvhXDK78jxX5BkRAxQqI7EkLpyI1BnIgxQuSSGELKg3xBHekvQndrEkIAAIot7z6yjEy/RNjBvk6UiUFPNTBCyMYYQsqDfEEd6S9Cd2sSQunIjUGciDFC5JIYQgAAFOj+Pm/6Q7+Tp9C+Kel4Qce/LkI5gBNCyoN8QR3pL0J3axJCTpSJQU81MELIxhhCAACN1XE/LqIRPm5Zlz74AJJBZ8qEQeYMskGk25RB+iNBQQFbukFRC5hB1DlqQS9KpkEAAAElEL8LU9k+FoY1vwKlE0GBS/BBw691QfbdB0EzHfJBv5uAQXarE0HJMgNCTRCIQQAAIlcVv8rNwz6Mbze/izcFQW1r10FH4WZB9t0HQTMd8kG/m4BBAqUTQYFL8EHDr3VBAAD+8R0+OptMv2O0FL8Mm65B0L8pwEnRakEOY7dBxBoLwJfwZEHhWrZB5dIiwP2MbEEAAPQuPj+uURy/zm+MvuFatkHl0iLA/YxsQQ5jt0HEGgvAl/BkQVyYuUFaifm/OOxoQQAA87FUv0qACb+fJBU+vEQbQdSTBsGwERdCn88ZQdBlAsET2BhCku4UQXkL/MBv6xVCAABMlVk/9fo0PiUj/j4YN5dB2tiPwH1JqUH2BJFBIOWUwH9YtEGe7pJBuhGpwMjdskEAAAL+6j7oY/++2zY8P4b7+j8BUjRCg548QnrAM0DisTRCl8E6Qr1J6j8e4TVCqgA+QgAAaaa9PoM91r63S1Q/oRYxQB71NUK4dztCesAzQOKxNEKXwTpCs4JzQD/TNELDCjlCAADXo8o+/O82v4ypEz96wDNA4rE0QpfBOkKG+/o/AVI0QoOePEI86ElAGww0QvkAOUIAAIt5Vz99gkY+twIBPxg3l0Ha2I/AfUmpQZ7ukkG6EanAyN2yQeB4mEG+v6LAZQGpQQAAH7eLPk6Ndb990Ze9HBaEQTNKL0K8jBpCKel4Qce/LkI5gBNCTpSJQU81MELIxhhCAAB8JXK/WSOmvogjTrufzxlB0GUCwRPYGEK8RBtB1JMGwbARF0IDthxBvvwKwftaHEIAABsxIz8UZT6/uxNOvuFatkHl0iLA/YxsQc4ztUHgOTPAEmd0Qas0skGufkrAo+p2QQAA9UIVvw/DT7+sbxk9rbglQRhRHsHgGhZCvMwkQdSkG8Hy/iBCPoAgQcCoGsEPmhVCAADL3h4+PNxFv+aCHb8Mm65B0L8pwEnRakHhWrZB5dIiwP2MbEGrNLJBrn5KwKPqdkEAAPPJfb8nruq8lw0DPkjUI0G8GRbBOsckQpyKHkE4ew7B8vYaQjCDHEHe/hLBZMgWQgAAdxgyPv75Ub/2ggu/XmOsQd1OUsCnJHZBqzSyQa5+SsCj6nZB8JGuQdA5a8CydIBBAABiwF2/sDv9vglxkT28zCRB1KQbwfL+IEIwgxxB3v4SwWTIFkI+gCBBwKgawQ+aFUIAAOb/cL9o246+jQlCPjCDHEHe/hLBZMgWQpyKHkE4ew7B8vYaQv1xGkFdqgzBp4sWQgAAQuktPp8uRL8SnR6/qzSyQa5+SsCj6nZBXmOsQd1OUsCnJHZBDJuuQdC/KcBJ0WpBAABggnc+LBtVv7BJ/z56wDNA4rE0QpfBOkI86ElAGww0QvkAOUKzgnNAP9M0QsMKOUIAALeEPL+Xhbc+5uMSvypk/ECyX+tBnJqCQfbdB0EzHfJBv5uAQXn060Bpcs9BHN1sQQAAcElTP2iav77tetg+SeuTQaOHtMBiZ65Ble2ZQcTmrsBq66NBnu6SQboRqcDI3bJBAAARdlk/dTGevj8A2z6V7ZlBxOauwGrro0HgeJhBvr+iwGUBqUGe7pJBuhGpwMjdskEAAI+/eL/nXFU9uAxsPpyKHkE4ew7B8vYaQrxEG0HUkwbBsBEXQv1xGkFdqgzBp4sWQgAAonpbv7Tsrj7oIcW+BCkIQSh6BUJbiJNBKmT8QLJf60GcmoJBMsbjQDQD1kGvtHpBAACqPF8/ydAxPvVO6j6oPY1B4V2EQXlJu0Gk25RB+iNBQQFbukH4AJJBZ8qEQeYMskEAAFY+9j5rrly/YMsjPmAmlEEj1LjA/+qnQZXtmUHE5q7AauujQUnrk0Gjh7TAYmeuQQAArE+lPWHkYj+EfOk+qc+tP3JFCEDTd1BBavQGQLvwvj+PKmJBUqAeQHOjzz/oD11BAAAG80w/2x/FvgAY6z5m2pxBd7igwNDKoUHgeJhBvr+iwGUBqUGV7ZlBxOauwGrro0EAAJXh8T6JpV6/hU4SPpXtmUHE5q7AauujQWAmlEEj1LjA/+qnQcV5l0HA3LTAEPWiQQAAHfZVv+O8Ar8hdk4+vEQbQdSTBsGwERdCku4UQXkL/MBv6xVCHjgWQXJgAsEUfxRCAABuA2y/kS3xO0NLxj6S7hRBeQv8wG/rFUKfzxlB0GUCwRPYGEIq9RtBSob2wHAWGkIAAMQEJb9ZObo+8iUsv4s3BUFta9dBR+FmQXn060Bpcs9BHN1sQfbdB0EzHfJBv5uAQQAAKRY+vzU3Gr8X8ZU+ku4UQXkL/MBv6xVCJqgMQRj688CyvxJCHjgWQXJgAsEUfxRCAADllu++K36/Pon7TL8QoRNBf8nXQfPMXkGLNwVBbWvXQUfhZkECpRNBgUvwQcOvdUEAAP//f7+j4MU56TINuRChE0F/yddB88xeQQKlE0GBS/BBw691QS2yE0EAABRCAAAwQQAAbcR1PtA0ZL9mzcQ+POhJQBsMNEL5ADlChvv6PwFSNEKDnjxCnqW1P+tPM0JQojtCAABgepk++tNpv88EjT6epbU/608zQlCiO0KG+/o/AVI0QoOePEIgBlU/bpkzQkkkP0IAAPTaGz5M5Hq/sOkCPp6ltT/rTzNCUKI7QnhGGUBUSzNCg9k2QjzoSUAbDDRC+QA5QgAAu9ZZP5onLD4ly/4+bUiPQYadQUHnzsNBpNuUQfojQUEBW7pBqD2NQeFdhEF5SbtBAAAPMde+MavhvrILS7/T2alBuPRSv0coWUGfpp9BZD8QwDmucEEpWZxBv78bvj1+YUEAAAVEHD+EHrQ9/oRJvyPFfkGREDFCojsSQmx2e0FZ3TJC+coRQmzNi0H6dTRCRW0XQgAAtBN2v/mfgz7/F8y9LoHxQEVM/EHEu6JB1vjzQCQT/EE1NZxB/WXQQEta2UELa5hBAACqoXm/jBZXPmkJkT0ugfFARUz8QcS7okH9ZdBAS1rZQQtrmEEnCN9AgXrmQTfco0EAAK4mbj9jXgM+lfivPrKzmEHHah9Btj62QaTblEH6I0FBAVu6QbzKlkEyuQtBGxe/QQAA/3lnv0finz7aLpW+Ed7dQF2Z2kHa2YZBBCkIQSh6BUJbiJNBMsbjQDQD1kGvtHpBAADivXE/03QSPr29lz6k25RB+iNBQQFbukGys5hBx2ofQbY+tkFRC5hB1DlqQS9KpkEAAPENvz6XPGw/g2nEPZwwREBWUao/O2llQfzDLEDQdco/Z4lVQVKgHkBzo88/6A9dQQAA2uEEPtmpaz+/oLw+kIlKQPxOdj9GlXNBnDBEQFZRqj87aWVBUqAeQHOjzz/oD11BAABx6Ac9szhpP3dx0j5SoB5Ac6PPP+gPXUFq9AZAu/C+P48qYkGQiUpA/E52P0aVc0EAAOUoQD+VrEI+bP4hvyPFfkGREDFCojsSQhBPcUGLtDBCCiIOQmx2e0FZ3TJC+coRQgAAuOArP/cqJz+EbrO+sXg2QJRPpD/FTFFB/MMsQNB1yj9niVVB5lVnQDhriD/7NGJBAADX6uY+D/xjPzLDcT2cMERAVlGqPztpZUHmVWdAOGuIP/s0YkH8wyxA0HXKP2eJVUEAABvJ3L4xNx4//0YoP5w7tz9m4UY/MK5mQZ+AWkBkjOA+LUqAQSoGIECnhIA/b3tuQQAAzD9KvkGQRz/5KRg/6FijP4IK4j9Z/FdBKgYgQKeEgD9ve25BavQGQLvwvj+PKmJBAAD78CI/cpE6vypIgb5WHnNB4OMuQphxD0LKg3xBHekvQndrEkIp6XhBx78uQjmAE0IAAKRajb4vgR6/tTE8v5+mn0FkPxDAOa5wQQybrkHQvynASdFqQQtco0EYLXvAdDSCQQAAP6AUvm9ONb8B3zC/DJuuQdC/KcBJ0WpBXmOsQd1OUsCnJHZBC1yjQRgte8B0NIJBAABoKTc+cohRv6zEC79LhKlBenJ6wBangUFeY6xB3U5SwKckdkHwka5B0DlrwLJ0gEEAAE9qNb8FtDK/cRfSPcW/JkE/dhrBiV8mQrzMJEHUpBvB8v4gQjbcLUE28yLB1DYkQgAA2Mt+PwKihT1fm5I98IGZQadQTEFZk59BUQuYQdQ5akEvSqZBSOyZQXY2HEEGua9BAACfnHs/U4mxPTadJj6ys5hBx2ofQbY+tkFI7JlBdjYcQQa5r0FRC5hB1DlqQS9KpkEAAP5o8L4+BWK/gTucu2T1M0G8JSbBaRYiQjbcLUE28yLB1DYkQq24JUEYUR7B4BoWQgAA5qknv8pGQb+V/AQ9vMwkQdSkG8Hy/iBCrbglQRhRHsHgGhZCNtwtQTbzIsHUNiRCAAD0xXI/x5MjPpdajD5RC5hB1DlqQS9KpkE9TJJBJ6WgQTTNoEH4AJJBZ8qEQeYMskEAAIqAtb6REW+/+Z5BvWT1M0G8JSbBaRYiQq24JUEYUR7B4BoWQuttL0Fq2SHB2VkVQgAAkMxmP24bDD2h09w+C8q7Qa/swb/jMl9Bodi5QYUyp7+QDmdBXJi5QVqJ+b847GhBAACWQJy+h7lxv9Uq/T3rbS9BatkhwdlZFUKtuCVBGFEeweAaFkKQOShBU7ogwcMLE0IAANNkfz0YjTG/8bo3v/8OuEGgO1W/K1RQQQ5jt0HEGgvAl/BkQQybrkHQvynASdFqQQAAJqiLvhGID7+OJUi/n6afQWQ/EMA5rnBB09mpQbj0Ur9HKFlBDJuuQdC/KcBJ0WpBAABtcNy+8vsJvwlVOb/dsZVBM7NuwDINh0H4CZJBd879v4OkfUGfpp9BZD8QwDmucEEAAGUBbj467sQ+PLFkP8e3UT/8szZCSn5AQh0aSD5YuzZCUSFBQi6XDD+RKTVCDXBBQgAAnwt7P+RoFT7IrwU+V1OXQTmOhEHbbZpBPUySQSeloEE0zaBBUQuYQdQ5akEvSqZBAADfhXw/Qv8WPj0ylL0QgZNBL42SQYnbgkFeGY9BmqS4QW1ulEFXU5dBOY6EQdttmkEAAAAc4L6I7BI/VS4xP+hYoz+CCuI/WfxXQZw7tz9m4UY/MK5mQSoGIECnhIA/b3tuQQAAtVl9P1HT1T3snsm9c2uWQdfnckFmjIVBEIGTQS+NkkGJ24JBV1OXQTmOhEHbbZpBAACxeOU9fxJUP31+DD+atUBBewmUQc8RCELvekFBDGaWQXM/BkIeazZBtB6VQQ3HB0IAAB4lpjzvdSw/tR49P71nWEFqODhCnXo8QjB4VEGUyzZCOs49QtqwYUFNrzZCyNA9QgAAwH7cPoTNZD/hawA+UqAeQHOjzz/oD11B/MMsQNB1yj9niVVB/gjXP5mtCkDd1EpBAABOeeu+A0lNv5JDw74VEY9B0v6vwG6Ln0ECooNBolq5wKdAskEK3otB3aGgwLxTm0EAAIu41b6pGFS/fB+/vvz2eUH7Fa3A0uGyQQrei0HdoaDAvFObQQKig0GiWrnAp0CyQQAAWgwwPwo3JT9GQqq+/MMsQNB1yj9niVVBsXg2QJRPpD/FTFFBwOD/P44H5T+OzkRBAADNm0E/DaIDPzQez77A4P8/jgflP47OREEA0vY/c88AQJ87R0H8wyxA0HXKP2eJVUEAABTNBT/UWwQ//ogtP1iYpUGRYyk/ppd2QYivmUEXvPK+rmiLQeHBp0GxyQC/b7yAQQAAN9ADP9XNCT/Kyyo/4cGnQbHJAL9vvIBBiK+ZQRe88r6uaItBqISdQUtQA8BzopJBAABucDu+/PpKP8zKFD9q9AZAu/C+P48qYkGpz60/ckUIQNN3UEHoWKM/ggriP1n8V0EAAMFq4r5RNuG+ZxlIv5+mn0FkPxDAOa5wQfgJkkF3zv2/g6R9QSlZnEG/vxu+PX5hQQAAOft+Py38oD1SAiw98IGZQadQTEFZk59BV1OXQTmOhEHbbZpBUQuYQdQ5akEvSqZBAACq938/LzgDPNL8YbxlsplBtL4OQftrm0HwgZlBp1BMQVmTn0FI7JlBdjYcQQa5r0EAALsyWz64YW4/cheXPlKgHkBzo88/6A9dQf4I1z+ZrQpA3dRKQanPrT9yRQhA03dQQQAAXO7WPitdsb4Kw1a/vrtmQQ8ORD9ll4NBXI9gQYmwDEAzoXpBjY9uQdBddkDruXZBAACvePk+95WwvothTb+Nj25B0F12QOu5dkH8hW9Be1GWPwzbhEG+u2ZBDw5EP2WXg0EAAMSeqj6jW9++BPpVv1yPYEGJsAxAM6F6Qb+bXUFHXos/3luBQa/GSUGEPIdAoZxgQQAADp0ePnw6A79bM1i/bnQ6QYSuREDF/2hBr8ZJQYQ8h0ChnGBBv5tdQUdeiz/eW4FBAACqPt89s84Mv+H3U783HjlBm/lOP1NygEFudDpBhK5EQMX/aEG/m11BR16LP95bgUEAAH4DCj/sGAc+GPNUP71J6j8e4TVCqgA+Qse3UT/8szZCSn5AQi6XDD+RKTVCDXBBQgAAiW9CPd9faT/UCtE+XjbLPQLAN0LD5j5CHRpIPli7NkJRIUFC0DsSPxNwOEJyJT1CAADuPw0+OpVaP01+AD8dGkg+WLs2QlEhQULHt1E//LM2Qkp+QEI+i5g/7MA3QvVLPkIAAKWhdD3OxWg/++TSPj6LmD/swDdC9Us+QtA7Ej8TcDhCciU9Qh0aSD5YuzZCUSFBQgAAuEXAvhgZUT+iP+A+XjbLPQLAN0LD5j5CvU43voJ3NkIWV0BCHRpIPli7NkJRIUFCAAAIfSe/r4k9P2rwHT5j3HW+NvU2QljyPEK9Tje+gnc2QhZXQEJeNss9AsA3QsPmPkIAAAcOEL/AIFM/S21nPV42yz0CwDdCw+Y+QkeNtz3CDjhCZAc6QmPcdb429TZCWPI8QgAA/yZAP13CS76JTSE/SqZvQadMzMCsShNCdsphQf8z4cAEmBZCG/1oQR/n8sBjwBNCAAB+p009/x9xPiB4eD8ulww/kSk1Qg1wQUIdGkg+WLs2QlEhQUIIi8s81hw1QuuOQUIAAG9OWD9ZQny+IRHzPkqmb0GnTMzArEoTQhv9aEEf5/LAY8ATQqrCeEEESdvACkQOQgAAVBkXv6v1lz5uLUA/Hms2QbQelUENxwdCWZMyQfzmk0FNQwdC2Og1QW90k0G1AQhCAACL03c/WqEfO8BWgL4jspVB9QVUQU2agkFza5ZB1+dyQWaMhUHSNZhBlmVJQQlDjEEAABjYfj9oC3E9GIeYvXNrlkHX53JBZoyFQVdTl0E5joRB222aQfCBmUGnUExBWZOfQQAA0PxBPzb6E78zBJs+dwlzQSbA78BxNw5CG/1oQR/n8sBjwBNCvVhkQUDa/8DNkBNCAABD9VO9F3CLPo/3dT+atUBBewmUQc8RCEIeazZBtB6VQQ3HB0LY6DVBb3STQbUBCEIAAICNIz86fC++iv4/PwTVQkGRm5FBB1cHQnAyREFiF5RBQVUHQpq1QEF7CZRBzxEIQgAAa9Z+P1NygD2UpZK9c2uWQdfnckFmjIVB8IGZQadQTEFZk59B0jWYQZZlSUEJQ4xBAAAchVM/5bPvvvNioD6qwnhBBEnbwApEDkJ3CXNBJsDvwHE3DkKlw3ZBtDL1wLq9CkIAANhffz+JL3s8e5qLvfCBmUGnUExBWZOfQWWymUG0vg5B+2ubQdI1mEGWZUlBCUOMQQAAV7tnPy2SP76CX8O+MMOVQVRsh0DyD6BBvDGWQeveB0DFW6lBTgGPQW2IUD+kb51BAACX1HQ/+XWFvYXRkb7SNZhBlmVJQQlDjEEoYZZBKsslQQEwikEjspVB9QVUQU2agkEAAEUFeD+cfJO9C7dyvihhlkEqyyVBATCKQdI1mEGWZUlBCUOMQZ8JmUGU2utA5FKcQQAASLR4P1KBi718fGi+ZbKZQbS+DkH7a5tBnwmZQZTa60DkUpxB0jWYQZZlSUEJQ4xBAABr3lM/S4iHvltr/b4P/opB77CkP/G0lEFOAY9BbYhQP6RvnUFIHItB+/gLv56/nEEAAHbGUT86iYW+TakCv04Bj0FtiFA/pG+dQQudjEFpZV2/NnagQUgci0H7+Au/nr+cQQAAzyBcP6IPPr6LffO+TgGPQW2IUD+kb51BD/6KQe+wpD/xtJRBM8WMQfAjG0C9XpRBAAAWpAI/og5cP23A07z8wyxA0HXKP2eJVUEA0vY/c88AQJ87R0H+CNc/ma0KQN3USkEAABKu8D7gmgu/KKoxPyDSbEE8XTRCJLI7QlfJYkFzXjVCPi8+QtHSX0EgBjRCIKE9QgAAiLPJO6zZij7EZnY/V8liQXNeNUI+Lz5C2rBhQU2vNkLI0D1CMHhUQZTLNkI6zj1CAAAW3AY/B5lZP5H+i7opN7I/6gkWQHwLQUH+CNc/ma0KQN3USkEA0vY/c88AQJ87R0EAAJ/osj1rcte+ESdnP1fJYkFzXjVCPi8+Qv6BV0H20jNCxbw9QtHSX0EgBjRCIKE9QgAAjsgJvQYKYr5biXk/wqJTQYFfNUIFDj5C/oFXQfbSM0LFvD1CV8liQXNeNUI+Lz5CAAAmSm49S8Qtv8ZmOz8ulww/kSk1Qg1wQUIIi8s81hw1QuuOQUJKq747ekc0QqHKQEIAAB+l/L1VDwG/7tFav98+HUEQIQpAoi14QTceOUGb+U4/U3KAQaKHEEHUCT8/UauDQQAAAjYjvv0TCr9drFO/Nx45QZv5Tj9TcoBB3z4dQRAhCkCiLXhBbnQ6QYSuREDF/2hBAABHJ6U+620zvzrbIj8gBlU/bpkzQkkkP0LiyqA/Qmk0QhQtP0Iulww/kSk1Qg1wQUIAAG43wr4ctLe+NlVav98+HUEQIQpAoi14QaKHEEHUCT8/UauDQanRDUFajR1ALf98QQAAkLfDvl1Awb6N7Fe/naAJQaYHl0DOum5B3z4dQRAhCkCiLXhBqdENQVqNHUAt/3xBAAAUAV0+2wspPkFedr/9ruBAIxL8PCCCgUGkodVANuvyPl5/gUHLSPtAOTozPxHrg0EAAN9ACb3QgjU+0cx7P1fJYkFzXjVCPi8+QjB4VEGUyzZCOs49QsKiU0GBXzVCBQ4+QgAAlZ11P48Ifz7aSAc+G+pFQUwVlUGvRwNCcDJEQWIXlEFBVQdC3zVGQYk+kUF1XAZCAABECdc+l5k9P29EBj+atUBBewmUQc8RCEJwMkRBYheUQUFVB0LvekFBDGaWQXM/BkIAANW1bj91xYc+JDx7vmhNhkFzS8VB6btyQWB+gkFDM9VBaCp4Qay4h0FkftRBBzCPQQAApssxP2ksuj7J7h6/iUp4QZCf1EFtSWlBTpVxQWGE9UFCKIRBYH6CQUMz1UFoKnhBAAA7au4+cjLAPvooTT9SbnFBNAw3QvFbO0LasGFBTa82QsjQPUKMT4NBqfg1Qv/IOEIAABI46T6R9xq+H5VgvxyM+kDexLe+RWeFQcH0y0ByQ9u+BOd+Qf2u4EAjEvw8IIKBQQAANl7xPpzMpz6jmVE/jE+DQan4NUL/yDhC2rBhQU2vNkLI0D1CV8liQXNeNUI+Lz5CAABVrdY9GCd2P/7+gT7c12xB4Zg4QtYYOUIBLoFBon44QrZDN0LzAHZBN3w5QtrJNEIAABoiaz+IwHC+O8yivhSukUGe7ye9WDmqQQudjEFpZV2/NnagQU4Bj0FtiFA/pG+dQQAAwMI7PscVWj9gK/s+3NdsQeGYOELWGDlCUm5xQTQMN0LxWztCAS6BQaJ+OEK2QzdCAAD8X3g+RnNaP7VN7D7c12xB4Zg4QtYYOUK9Z1hBajg4Qp16PEJSbnFBNAw3QvFbO0IAANEFfD4cHlI/FvkDP71nWEFqODhCnXo8QtqwYUFNrzZCyNA9QlJucUE0DDdC8Vs7QgAANGTnPXRGdD/T1I0+3NdsQeGYOELWGDlCyWFUQY1cOUJW9ThCvWdYQWo4OEKdejxCAACgAg8+kv9Iv2B1Gj8gBlU/bpkzQkkkP0Iulww/kSk1Qg1wQUJKq747ekc0QqHKQEIAAFBrOT+UBki+M0cpPwTVQkGRm5FBB1cHQt81RkGJPpFBdVwGQnAyREFiF5RBQVUHQgAA5zlLP2NFBT64ERg/syZcQW9NBsEqpxZCdwlzQSbA78BxNw5CvVhkQUDa/8DNkBNCAAB8sLI9WOZYv/khBj8gBlU/bpkzQkkkP0JKq747ekc0QqHKQELelf0+UlgzQnH0PkIAAHv+WD9RUim+lRABP6SCXUHpBw7BsnIVQncJc0EmwO/AcTcOQrMmXEFvTQbBKqcWQgAARcHavbeieD+q8Fk+Hms2QbQelUENxwdC73pBQQxmlkFzPwZCelozQfYvlkEd9QRCAAB2P+c+gB8Sv9+KLz8g0mxBPF00QiSyO0KMT4NBqfg1Qv/IOEJXyWJBc141Qj4vPkIAAD/7VT/K4ea+MUSgPrIHVUGwFRvBa5AXQpPuZEGzihTBB04PQnx0WkF5TxTB32EWQgAAungbvq3cb7/FI6E+2/srPnBXM0IdUD5C3pX9PlJYM0Jx9D5CSqu+O3pHNEKhykBCAACrt3s/7Y0mPjPqp73aRY1BFCiqv27/oEELnYxBaWVdvzZ2oEGSYY5BnxvHvwezqkEAAOWpYz8P+lE+50fRvoa3hkHlR7dBLHpmQWhNhkFzS8VB6btyQQ+PjUHMz61Bkr96QQAA2Vg4P1tJlD5ZaiG/hreGQeVHt0EsemZBqG2CQVO/tUHdRVtBiUp4QZCf1EFtSWlBAACzlTc/idSTPsxiIr9gfoJBQzPVQWgqeEGGt4ZB5Ue3QSx6ZkGJSnhBkJ/UQW1JaUEAALRAIT68Vni/UUI9PiAGVT9umTNCSSQ/Qt6V/T5SWDNCcfQ+Qp6ltT/rTzNCUKI7QgAAXftAP5tPkD4r8he/aE2GQXNLxUHpu3JBhreGQeVHt0EsemZBYH6CQUMz1UFoKnhBAACDbzA/WA0uv0dBgD6SoVFBfmwewQvgFUIeWV1BzdUdwRw3DkKT7mRBs4oUwQdOD0IAAMzXaD+703a+PlmtPqSCXUHpBw7BsnIVQnx0WkF5TxTB32EWQpPuZEGzihTBB04PQgAAuRQXv3b20T7tAzI/MzDxQIc7yEAoteRBd6/VQMyUwz8yL/VB6CbyQKY05z9C6flBAAD7PhI/cy5TvplfS7+P4YFA0Md4vmfrY0HVKvE/UzW5Py/hQ0HKD1BAlVg5P9ebVkEAABpzFT9M5pQ+ig5CvyqfbEFA28dB+4BWQYlKeEGQn9RBbUlpQahtgkFTv7VB3UVbQQAAycdbP2iJvL6htrY+dwlzQSbA78BxNw5CpIJdQekHDsGychVCk+5kQbOKFMEHTg9CAAD/CV8/tILDvqnnnT6T7mRBs4oUwQdOD0Klw3ZBtDL1wLq9CkJ3CXNBJsDvwHE3DkIAAMF29r7N39A+IZpGPx0aSD5YuzZCUSFBQr1ON76CdzZCFldAQgiLyzzWHDVC645BQgAArd1gv5Ku4r38D+4+JlvHvo2dNUJGjD5CCIvLPNYcNULrjkFCvU43voJ3NkIWV0BCAACqcVW/IuUIP/i0DD69Tje+gnc2QhZXQEJj3HW+NvU2QljyPEImW8e+jZ01QkaMPkIAAPS6Wr8xYJ2+8HzWPiZbx76NnTVCRow+Qkqrvjt6RzRCocpAQgiLyzzWHDVC645BQgAAh70PP1cMFL+Kgxc/0gBCQST0iEH6TgNC3zVGQYk+kUF1XAZCBNVCQZGbkUEHVwdCAACdBww9z+sAv7L+XD+atUBBewmUQc8RCELY6DVBb3STQbUBCEIE1UJBkZuRQQdXB0IAAP7HU7/dN/O+7JGZPiZbx76NnTVCRow+QknVdr4sfTRCcmY+Qkqrvjt6RzRCocpAQgAAt/WSvPsuIL/ao0c/2Og1QW90k0G1AQhC5GM1QQPvjEE0YwVCBNVCQZGbkUEHVwdCAACIng+/nuZPv7JHJD5Kq747ekc0QqHKQEJJ1Xa+LH00QnJmPkLb+ys+cFczQh1QPkIAAE2PRz+wPhs/qosgPhvqRUFMFZVBr0cDQu96QUEMZpZBcz8GQnAyREFiF5RBQVUHQgAAME9yP7MOAD6XR5i+SByLQfv4C7+ev5xBC52MQWllXb82dqBB2kWNQRQoqr9u/6BBAADn/HU/ST59Pso1/71UoopBfuUCv1mjmUFIHItB+/gLv56/nEHaRY1BFCiqv27/oEEAALVDKD8AWLw8z9dAv7F4NkCUT6Q/xUxRQcoPUECVWDk/15tWQdUq8T9TNbk/L+FDQQAAo+wkPwOEs71ugUK/1SrxP1M1uT8v4UNBwOD/P44H5T+OzkRBsXg2QJRPpD/FTFFBAACFbvM+58AYv/Z9JT/fNUZBiT6RQXVcBkLSAEJBJPSIQfpOA0LaxkdB70CJQahiAkIAAMt3JT/bNUO/KJ7gPB5ZXUHN1R3BHDcOQmiWXEEW7R7B1RwLQr+Ma0GhuBLBncoHQgAAWrLRvvPbFT9+HzM/6FijP4IK4j9Z/FdBMq8AvxhyPEDujDdBnDu3P2bhRj8wrmZBAABw6xk+L8Vqv5sVvT4g0mxBPF00QiSyO0Ls22tB2UozQtQhOUIQjXhB9pkzQq2bOEIAAE3Vpz7Z5ku/zBECP44lgUGQpjRCea44QiDSbEE8XTRCJLI7QhCNeEH2mTNCrZs4QgAAcFUSvvR7Sz88+BY/qc+tP3JFCEDTd1BBIG9+Pl6eI0Cd80JB6FijP4IK4j9Z/FdBAACbKp8+kw1jvxHsrj4g0mxBPF00QiSyO0KZ9VdBUoEyQoadO0Ls22tB2UozQtQhOUIAAMb93T0re1e/FmcHP5n1V0FSgTJChp07QtHSX0EgBjRCIKE9Qv6BV0H20jNCxbw9QgAAWKidPnwrYb+isbk+INJsQTxdNEIksjtC0dJfQSAGNEIgoT1CmfVXQVKBMkKGnTtCAACQOYi+qTJTvwpI/z7+h0xBE4QyQsgbOkKZ9VdBUoEyQoadO0L+gVdB9tIzQsW8PUIAANmI0b3hulM/U34NP6nPrT9yRQhA03dQQWM0sT7RnS9AncA+QSBvfj5eniNAnfNCQQAA/NphP0xj675fnM89hyp/QZ3b48BvSgJCpcN2QbQy9cC6vQpCv4xrQaG4EsGdygdCAAAO1Ce+ZpZIP6ltGT/oWKM/ggriP1n8V0Egb34+Xp4jQJ3zQkEyrwC/GHI8QO6MN0EAAOFpPT/nUSm/a577PZPuZEGzihTBB04PQh5ZXUHN1R3BHDcOQr+Ma0GhuBLBncoHQgAAFViUvsF+dD/xKIA9R423PcIOOEJkBzpCXjbLPQLAN0LD5j5C0DsSPxNwOEJyJT1CAACpvCm/5NCbPnUWLz9MhNNAAaLLQGEj3UEzMPFAhzvIQCi15EHnU+5AXsMLQZEx20EAAOLLJL8QY5k+ZUQ0P+dT7kBewwtBkTHbQaNzyEBwV/lAa7/VQUyE00ABostAYSPdQQAADIgev0t5cj4Lpj8/o3PIQHBX+UBrv9VB51PuQF7DC0GRMdtBzmXjQB4oP0EuztBBAADob3A/JQqAPsfpcL4Pj41BzM+tQZK/ekFoTYZBc0vFQem7ckGsuIdBZH7UQQcwj0EAAE61dT8uWCc+1LBpvkTUkEGA6ZZBu3V1QQ+PjUHMz61Bkr96QRCBk0EvjZJBiduCQQAASjlJvXONfz9IkAY9hVwPQLr2OEJDJTdC+ae9P7P6OEJhIzJC0DsSPxNwOEJyJT1CAABZ906/pqQkPurvED8NiZpAF3cXQR2NwUGjc8hAcFf5QGu/1UGfcLRA8URLQWtxw0EAAEl2WL/Lfv4+MIdHvmPcdb429TZCWPI8QkeNtz3CDjhCZAc6QjQ5Ar4ZLTZCDv44QgAAhk51v5b1dD6FgyC+NDkCvhktNkIO/jhCJlvHvo2dNUJGjD5CY9x1vjb1NkJY8jxCAACvcUa/tOBmPtcTFz+jc8hAcFf5QGu/1UENiZpAF3cXQR2NwUEcrb5AraC1QFQB2UEAACPmVL916wE/+NpmvjQ5Ar4ZLTZCDv44QkeNtz3CDjhCZAc6QsvBsz4QPzdCMlg0QgAAIulOPSSeLr9FwTo/BNVCQZGbkUEHVwdC5GM1QQPvjEE0YwVC0gBCQST0iEH6TgNCAADbqEa+3iJ7P30ghzlHjbc9wg44QmQHOkLQOxI/E3A4QnIlPUImOAU/Q2Y4Qmr3NUIAACj0OT+dNR8/SsuVPk/VkEFljNO/RKidQVSiikF+5QK/WaOZQdpFjUEUKKq/bv+gQQAAWGNiP3lxND7EWt2+hreGQeVHt0EsemZBD4+NQczPrUGSv3pBRNSQQYDplkG7dXVBAAA0VRM/nqMfPwRxBz9Fa5JBxeCJv1mBlkFUoopBfuUCv1mjmUFP1ZBBZYzTv0SonUEAAGc0CD5CTXa/97NzPpyihUH//zJCq48zQhCNeEH2mTNCrZs4Quzba0HZSjNC1CE5QgAAGRIjP6i5u74+ly2/D/6KQe+wpD/xtJRBSByLQfv4C7+ev5xBxTuIQQxY4z1WM5dBAADB0Fw/nZr1vpe9JD6T7mRBs4oUwQdOD0K/jGtBobgSwZ3KB0Klw3ZBtDL1wLq9CkIAAAfCHj/Pv0i/bQ60vNfPY0FnWRjBv2gDQr+Ma0GhuBLBncoHQmiWXEEW7R7B1RwLQgAAcSGjvpEaQT/38hI/vWdYQWo4OEKdejxCifxLQV1ZOEInljpCMHhUQZTLNkI6zj1CAABY11U/YRcNPro/CL8fAIdB60KYQXZOV0GGt4ZB5Ue3QSx6ZkFE1JBBgOmWQbt1dUEAALYYQz8gNiQ+IZYgv6htgkFTv7VB3UVbQYa3hkHlR7dBLHpmQR8Ah0HrQphBdk5XQQAAWaotP0czHT4u7ze/qG2CQVO/tUHdRVtBHwCHQetCmEF2TldBQXB4Qbs8pEHAEEhBAADetQG/JkHuvpvLOT/+gVdB9tIzQsW8PULColNBgV81QgUOPkJACk1BWMMzQg3fO0IAAPr/fz+PMQs6HjsrOm+7Y0HjBeNBLsZoQSLLY0GTHrxBIiVKQS2yY0EAABRCAAAwQQAA44qfPm5Qsj6DU2K/Kp9sQUDbx0H7gFZBIstjQZMevEEiJUpBb7tjQeMF40EuxmhBAAC43AE/LTmyPqzRSb8qn2xBQNvHQfuAVkFvu2NB4wXjQS7GaEGJSnhBkJ/UQW1JaUEAAOoVCT9iHoE+sFZOv6htgkFTv7VB3UVbQUFweEG7PKRBwBBIQSqfbEFA28dB+4BWQQAAHtFEvljTbD9prKc+ifxLQV1ZOEInljpCyWFUQY1cOUJW9ThC01A+QdmKOUK2NTVCAADk1z2/7eppPsl6IT+jc8hAcFf5QGu/1UEcrb5AraC1QFQB2UFMhNNAAaLLQGEj3UEAAM1pYb/quHM+EeHRPhixrEAd6ZtAlhTTQY7VwUDqMZM/UbnvQRytvkCtoLVAVAHZQQAA8SBGv10Vpj76Ogs/jtXBQOoxkz9Rue9BTITTQAGiy0BhI91BHK2+QK2gtUBUAdlBAAA7c22/BtjxPUSLtb7LwbM+ED83QjJYNEJuEmc+FYg1Qv0VNUI0OQK+GS02Qg7+OEIAABtSK78IWzU/+J5lviY4BT9DZjhCavc1QsvBsz4QPzdCMlg0QkeNtz3CDjhCZAc6QgAA8i3WPrNBZ7/1A8K9CLZZQbgJHcGibwNC189jQWdZGMG/aANCaJZcQRbtHsHVHAtCAACoPxO/RltQv7sSqL3b+ys+cFczQh1QPkJJ1Xa+LH00QnJmPkKFFJY9Ew00QjnuOUIAAPu6u7qu/X+/ZNkHPN6V/T5SWDNCcfQ+Qtv7Kz5wVzNCHVA+Qp6ltT/rTzNCUKI7QgAA742ePgAPcr+eVM09kqFRQX5sHsEL4BVCKA1JQUWUIcGQDxVCHlldQc3VHcEcNw5CAACs5zc8ZPR/v8OJdzzrbS9BatkhwdlZFULy90xBrD4iwSJSCUIoDUlBRZQhwZAPFUIAABP8Hr97yzg/rlecPlmTMkH85pNBTUMHQh5rNkG0HpVBDccHQnpaM0H2L5ZBHfUEQgAAn4ktvyFsn75wfSo/WZMyQfzmk0FNQwdCf78wQYY7kEGg8AVC2Og1QW90k0G1AQhCAACI8eO+vscMvzXoND/Y6DVBb3STQbUBCEJ/vzBBhjuQQaDwBULkYzVBA++MQTRjBUIAABWxiT5C9HW/TTaLPSgNSUFFlCHBkA8VQmiWXEEW7R7B1RwLQh5ZXUHN1R3BHDcOQgAADitHPhz+er+3wfY8KA1JQUWUIcGQDxVC8vdMQaw+IsEiUglCaJZcQRbtHsHVHAtCAAA363g+kW13vxpaqL1ollxBFu0ewdUcC0Ly90xBrD4iwSJSCUIItllBuAkdwaJvA0IAACww4D5aisy+By9Ov5s1b0CWOcq/gLxrQblO5D9l+Wc+NmdMQY/hgUDQx3i+Z+tjQQAAjzVqP7enxz7FI9a9SByLQfv4C7+ev5xBVKKKQX7lAr9Zo5lBxTuIQQxY4z1WM5dBAACSe3m/4chjPuuw5TxZkzJB/OaTQU1DB0J6WjNB9i+WQR31BEJ/vzBBhjuQQaDwBUIAAOtSd787Qnc+vee6PX+/MEGGO5BBoPAFQnpaM0H2L5ZBHfUEQslZLkH/S5NBRxX3QQAAXTniPoZEx77U6k6/1SrxP1M1uT8v4UNBj+GBQNDHeL5n62NBuU7kP2X5Zz42Z0xBAAA76Wk/uyWhPg+Zg75UoopBfuUCv1mjmUFodIhBw5WEvexDlkHFO4hBDFjjPVYzl0EAAAsn6jySr3+/RKwlPXhGGUBUSzNCg9k2Qtv7Kz5wVzNCHVA+QoEz5T9AKzNCvHY1QgAAa6Vav1ZoCT5jpQA/HK2+QK2gtUBUAdlBDYmaQBd3F0EdjcFBGLGsQB3pm0CWFNNBAABSpwW/W9kTv1mqID9/vzBBhjuQQaDwBUIioTBBva2IQY1wAkLkYzVBA++MQTRjBUIAADuXYj+5O7E+qz6fvtslhkHTA9E+ZemTQcU7iEEMWOM9VjOXQWh0iEHDlYS97EOWQQAA4sdTvyS6wb7+n9Q+ZkUtQYfQhEF9A/5BIqEwQb2tiEGNcAJCf78wQYY7kEGg8AVCAAD0p2q/bIYZPvu6vT6HKohAHWQbQIZnxEEYsaxAHembQJYU00Hva41AcUCnQJWYvkEAANpVQL8V+LQ+W6wOvzLG40A0A9ZBr7R6QSpk/ECyX+tBnJqCQXn060Bpcs9BHN1sQQAAiEsyvk7Laz8wVLI+vWdYQWo4OEKdejxCyWFUQY1cOUJW9ThCifxLQV1ZOEInljpCAAA9bh2/FyDxPg/qIT+J/EtBXVk4QieWOkKlzkBBsJk3QjhtOEIweFRBlMs2QjrOPUIAAJg5GL8Lc8s+3e0yPxcDaL+lYt0/KDE+Qct7yT92NzjAc++EQZw7tz9m4UY/MK5mQQAAtrFvv0peMb5yapw+pSI2vbuJur/6+F5BBi5SPkwd5r89IWhBuSujvjoKOb9BMFhBAAC5OhM/ExY4P6+3xz5Fa5JBxeCJv1mBlkFodIhBw5WEvexDlkFUoopBfuUCv1mjmUEAACrcQD7ZtmM/uCTVPqt/mkE54lA/xFt7QRInlkFoEwg/zoGEQViYpUGRYyk/ppd2QQAANMvgu1n+f79RSvK62/srPnBXM0IdUD5CeEYZQFRLM0KD2TZCnqW1P+tPM0JQojtCAAB6f2G/F3DZvjEsVr6FFJY9Ew00QjnuOUImW8e+jZ01QkaMPkI0OQK+GS02Qg7+OEIAADt1/j3TFnc/V6trPhOjjUGAxA0/vluIQRInlkFoEwg/zoGEQa3+kEEF1ys/u5qCQQAAOIBgv1DE3r6T9lC+JlvHvo2dNUJGjD5ChRSWPRMNNEI57jlCSdV2vix9NEJyZj5CAAAjJV6/gUzevjyod740OQK+GS02Qg7+OEJuEmc+FYg1Qv0VNUKFFJY9Ew00QjnuOUIAAHv/f79agsM6UHpxOxChE0F/yddB88xeQS2yE0EAABRCAAAwQcxzE0EPaLhBTDhIQQAA+faovgOZb78u7fu92/srPnBXM0IdUD5ChRSWPRMNNEI57jlCjKCAP8KpM0KQ4jJCAADEvCg/0nDtPk2OFz/+goBBJtyhv5c4A0Jn7nJBs8GZvZ5qA0Jr83pBZHDjv0KEBkIAAKz9P789rhm/YjyOvoUUlj0TDTRCOe45Qm4SZz4ViDVC/RU1QhLI+j4DRTRC5/U0QgAAg4gQv99WJz+rAgE/pc5AQbCZN0I4bThCifxLQV1ZOEInljpC01A+QdmKOUK2NTVCAADbpQs/O0ohP/t9DT9vnjlBXws5Qu4mNkIOpidBBVQ4QgtnO0JFbTpB3Wo3Qq/ON0IAAAEJNL+CB/O+bX0HP2fC6kCzu4e/eIcCQjc74kCNYom/ABEBQoPHyEBufNG/56L1QQAAnnwkP5MxfT0thkM/TEp1QZripMDrABFCR4t5QZVLwMDgYhBC/th/QdiFocDKvw5CAAAD/b++qqSYPqS2YD9FbTpB3Wo3Qq/ON0LQ0zlBDpM1QopeOEKlzkBBsJk3QjhtOEIAALPpR78JrnY+5YkTPzc74kCNYom/ABEBQnev1UDMlMM/Mi/1QY7VwUDqMZM/UbnvQQAAc1lev25d2D3Z6fc+YZ2zQAcSML34betBNzviQI1iib8AEQFCjtXBQOoxkz9Rue9BAACV6eS+HdtfvyXYQL6FFJY9Ew00QjnuOUISyPo+A0U0Quf1NEKMoIA/wqkzQpDiMkIAAPkXGr9rIZg+HMA9v3n060Bpcs9BHN1sQYs3BUFta9dBR+FmQbML/EA9vrdBbVNTQQAABSwfv5D1kj7kjDq/efTrQGlyz0Ec3WxBswv8QD2+t0FtU1NBu63hQGYGtkGaOF1BAADTJkq/mYZvPtw0ET9nwupAs7uHv3iHAkJ3r9VAzJTDPzIv9UE3O+JAjWKJvwARAUIAAPNG9L6KzZ0+IrJSvxChE0F/yddB88xeQbML/EA9vrdBbVNTQYs3BUFta9dBR+FmQQAAMA7ovjYWmz4Jnla/swv8QD2+t0FtU1NBEKETQX/J10HzzF5BzHMTQQ9ouEFMOEhBAAAXVzq/R8Umvy4fWz4mqAxBGPrzwLK/EkI7XPpAD8PiwHcjDEIeOBZBcmACwRR/FEIAAFJnYr9lPgk+d+nkPmfC6kCzu4e/eIcCQoPHyEBufNG/56L1QS0J4UDEdwHAckcBQgAAju9jvwD8prseEOk+YZ2zQAcSML34betBg8fIQG580b/novVBNzviQI1iib8AEQFCAACz9kW/j4Uhvm42HT9Dy/xAgSrBwEy3EEKS7hRBeQv8wG/rFUJDbwpB5hjMwI4nFEIAAF7mVb+F4Ke+17fhPkPL/ECBKsHATLcQQiaoDEEY+vPAsr8SQpLuFEF5C/zAb+sVQgAAzTb+PhxngD4/vVS/Kp9sQUDbx0H7gFZBQXB4Qbs8pEHAEEhBIstjQZMevEEiJUpBAAAC0tu9IBF+vzctc73b+ys+cFczQh1QPkKMoIA/wqkzQpDiMkKBM+U/QCszQrx2NUIAAIC1Gb5vGX0/foqGutA7Ej8TcDhCciU9QvmnvT+z+jhCYSMyQiY4BT9DZjhCavc1QgAAtv5/P81Xobm5Zc27o69jQRGLnkEY6jtBLbJjQQAAFEIAADBBIstjQZMevEEiJUpBAADMxZ68eex/P5caczyFXA9AuvY4QkMlN0IAO6VAREY5QpZ8MUL5p70/s/o4QmEjMkIAAC7Fzj7IZ1o+1r1jvyLLY0GTHrxBIiVKQUFweEG7PKRBwBBIQaOvY0ERi55BGOo7QQAAstauvDzUfz+b+PK8ADulQERGOUKWfDFCq57KQJcPOUJW7SZC+ae9P7P6OEJhIzJCAAD80pC90qZ9P/TY672rnspAlw85QlbtJkJBU9U/CYI4QuygLUL5p70/s/o4QmEjMkIAAKtcir1H9n0/4aXZvT6hgEB1DzhCl3cjQkFT1T8JgjhC7KAtQqueykCXDzlCVu0mQgAAWtvhPusYET453WK/wpNtQRSvikG6fDpBo69jQRGLnkEY6jtBQXB4Qbs8pEHAEEhBAAAXe+u+WmVaPrmpXL+zC/xAPb63QW1TU0HMcxNBD2i4QUw4SEHTgBNBiMSeQU2BO0EAANLJHr+4Ujw+6zRDvyTG8UAdZ5hB0GJIQbut4UBmBrZBmjhdQbML/EA9vrdBbVNTQQAAsrD/vioIQT5peli/swv8QD2+t0FtU1NB04ATQYjEnkFNgTtBJMbxQB1nmEHQYkhBAAAhZfo8frR/vymJFz2BM+U/QCszQrx2NUIvioVA+3szQr4aNkJ4RhlAVEszQoPZNkIAAM32f78AAAAAD0CJvC2yE0EAAIhBAAAwQdOAE0GIxJ5BTYE7QS2yE0EAABRCAAAwQQAA4P5/v5XF7znNkb+7LbITQQAAFEIAADBB04ATQYjEnkFNgTtBzHMTQQ9ouEFMOEhBAAAVy6++N2GKPmFEZj/Q0UBBG5M1QlgJOUKlzkBBsJk3QjhtOELQ0zlBDpM1QopeOEIAANHcRT85UUe+fpsav2Nki0F1p3VAtvWOQTPFjEHwIxtAvV6UQQzDhkH4q+A/t2eOQQAAagJxv/IXrL6r/dk8uSujvjoKOb9BMFhBd9COvoapWb/W8FRBpSI2vbuJur/6+F5BAADEc0M/pTNEvjjjHb9jZItBdad1QLb1jkEMw4ZB+KvgP7dnjkEvUIVB3JOrQPelg0EAAIhjRD925TC+miYevzPFjEHwIxtAvV6UQQ/+ikHvsKQ/8bSUQQzDhkH4q+A/t2eOQQAAq1VIv/A1pD61mgg/jtXBQOoxkz9Rue9Bd6/VQMyUwz8yL/VBTITTQAGiy0BhI91BAAAGAyg/JQu8vnW5KL8P/opB77CkP/G0lEHFO4hBDFjjPVYzl0EMw4ZB+KvgP7dnjkEAAI+dHb9qJiu/GY3VvqUiNr27ibq/+vheQXfQjr6GqVm/1vBUQY7T4T2rk7C/fFJZQQAABr+YvsVaSj+m8wg/RW06Qd1qN0KvzjdCpc5AQbCZN0I4bThC01A+QdmKOUK2NTVCAACdvHC/N1YWvskWnT5Dy/xAgSrBwEy3EEJyp/dAldi+wLTiDkJ3D/ZAa3POwHRXDUIAAKrxRr/nCiA/0E2Uvfig9UDlMsTActMLQnKn90CV2L7AtOIOQgZc+UBwQ77AAToNQgAAGxJ/v0jNND3LEpU9cqf3QJXYvsC04g5C+KD1QOUyxMBy0wtCdw/2QGtzzsB0Vw1CAAB4HAg/IoTRvoXUPb/bJYZB0wPRPmXpk0GhaYRB2f1EP5MSkUEMw4ZB+KvgP7dnjkEAAHeDIT8pMsO+UPwsvwzDhkH4q+A/t2eOQcU7iEEMWOM9VjOXQdslhkHTA9E+ZemTQQAAsklrP3wwe74t450+R4t5QZVLwMDgYhBC64h8QeR0tcBJPA9C/th/QdiFocDKvw5CAACKwGo/+/dsPslYpr7bJYZB0wPRPmXpk0GsfoVBX6HSPiIWkkGhaYRB2f1EP5MSkUEAAOqZcD6SFzU/CKgqP0VtOkHdajdCr843QtNQPkHZijlCtjU1Qm+eOUFfCzlC7iY2QgAAGKhvP2T7sz6XGMO7rH6FQV+h0j4iFpJBIReFQdtYCj9Ob49BoWmEQdn9RD+TEpFBAACFwxs/cWLSviDOLb+haYRB2f1EP5MSkUHFh4FBP2F4P3+EjUEMw4ZB+KvgP7dnjkEAAOaRAb4Bx32/aHISvYyggD/CqTNCkOIyQpFdEUCvUjNCZWMqQoEz5T9AKzNCvHY1QgAAskEWve/VZj+5kdw+fic1QZ3kOULlRzRCb545QV8LOULuJjZC01A+QdmKOUK2NTVCAAA0ADS/SsJiPtD6LD8weFRBlMs2QjrOPUKlzkBBsJk3QjhtOELColNBgV81QgUOPkIAAGnjNb+/tU4+KZMsP9DRQEEbkzVCWAk5QsKiU0GBXzVCBQ4+QqXOQEGwmTdCOG04QgAAkts9P/YEFD9KIa6+oWmEQdn9RD+TEpFBIReFQdtYCj9Ob49BxYeBQT9heD9/hI1BAABd8Ti/W1ktviyfKz9ACk1BWMMzQg3fO0LColNBgV81QgUOPkLQ0UBBG5M1QlgJOUIAACxydT9jd6M9h6OLvjmpk0G/g3VBEeR4QUTUkEGA6ZZBu3V1QRCBk0EvjZJBiduCQQAA9wDBvp86Pr+6jA0//odMQROEMkLIGzpC/oFXQfbSM0LFvD1CQApNQVjDM0IN3ztCAAB0BGo/qWuKPZirzL4f4I9BFiWMQQZ1bUFE1JBBgOmWQbt1dUE5qZNBv4N1QRHkeEEAADEVVj+YwP49mrYIvx/gj0EWJYxBBnVtQR8Ah0HrQphBdk5XQUTUkEGA6ZZBu3V1QQAAe/90P4qOpj0Xh46+EIGTQS+NkkGJ24JBc2uWQdfnckFmjIVBOamTQb+DdUER5HhBAACbu/s+UpahPq/DTz/Vb3hBiwSCwAfVDkJMSnVBmuKkwOsAEUI6BoFBdH6RwPIgDkIAALFGDj7XRwq/0ntUv9R7zT7pZ3m/tFBSQcH5jj4uFaI/rKg6QR4TjD8nLRe/DC1QQQAAtxczv+LNlT5A4yY/Et0uvyct6z6QJUtBy3vJP3Y3OMBz74RBFwNov6Vi3T8oMT5BAADXjjm/FNOEPsZhIz9DugU/F87dvxZPb0HLe8k/djc4wHPvhEES3S6/Jy3rPpAlS0EAABpOID9VJBg/sTEBP9VveEGLBILAB9UOQjoGgUF0fpHA8iAOQlFXfkG/imjAIvoKQgAAFK4JPdbYf78jHAS8L4qFQPt7M0K+GjZCgTPlP0ArM0K8djVCkV0RQK9SM0JlYypCAABhwU6/8qEUPh5QEj8S3S6/Jy3rPpAlS0G5K6O+Ogo5v0EwWEFDugU/F87dvxZPb0EAAA0Rab+CUy0+KEXBPo7VwUDqMZM/UbnvQTGCm0D9o0A/fwraQWGds0AHEjC9+G3rQQAA8Chmv6YcxzyU0d8+Et0uvyct6z6QJUtBBZsLv1UKWr7jRlBBuSujvjoKOb9BMFhBAACXdXK/Yl2wPbpInj4dguZAEbRowAwsBUItCeFAxHcBwHJHAUKP9tJA8WhcwEvy+kEAAGcpR7+Sv/++8yDDvnfQjr6GqVm/1vBUQQWbC79VClq+40ZQQa2+y75I0Su+JIRKQQAAiBlFvzCh177dd/U++KD1QOUyxMBy0wtCBlz5QHBDvsABOg1CYaDwQHMQucBgCwxCAABF+1m/6FW1vuH7xT53D/ZAa3POwHRXDUImqAxBGPrzwLK/EkJDy/xAgSrBwEy3EEIAADzyWb9bsLi+cQTDPiaoDEEY+vPAsr8SQncP9kBrc87AdFcNQjtc+kAPw+LAdyMMQgAAr1AnP/yJ5T3Unj+/HwCHQetCmEF2TldByW19QQ7GikEWzERBQXB4Qbs8pEHAEEhBAACXgz2/Zk8Tv5L9sb78JwFAbVc0QkJlJ0IjT5Q/i5s0QoNGLkIxa3E/SsY1QjIuLkIAACpra79T+Nc9X8HBvm4SZz4ViDVC/RU1QsvBsz4QPzdCMlg0QjFrcT9KxjVCMi4uQgAAnCJLP+M90Dy5qBu/H+CPQRYljEEGdW1B+DSGQb/mc0Fvs1JBHwCHQetCmEF2TldBAAD/pGS/blAJvbqk5T68RBtB1JMGwbARF0LPzQxBk+wFwWfhD0L9cRpBXaoMwaeLFkIAAAExRb9RvBK/eByPPj6AIEHAqBrBD5oVQjCDHEHe/hLBZMgWQr2fFEHvZRnB0BAOQgAARjx7v04LDL7bCgo+EUI0vz2WwT6sX0dBBZsLv1UKWr7jRlBBEt0uvyct6z6QJUtBAAC6Luy9h3J4vxrTWD6Z9VdBUoEyQoadO0L+h0xBE4QyQsgbOkJ8qDxB94MxQqlcM0IAAPuuPr+caw2/b5W/vhFCNL89lsE+rF9HQa2+y75I0Su+JIRKQQWbC79VClq+40ZQQQAAQ62ivthO6L6iI1U/0NM5QQ6TNUKKXjhChhw+QeXrM0KQ4DdC0NFAQRuTNUJYCTlCAADeo+6+ufAmv0YRGb930I6+hqlZv9bwVEGtvsu+SNErviSESkGO0+E9q5Owv3xSWUEAAPiQUb70mCW/vxA8v9R7zT7pZ3m/tFBSQY7T4T2rk7C/fFJZQa2+y75I0Su+JIRKQQAAJeBtv7+du77IxkQ9BZsLv1UKWr7jRlBBd9COvoapWb/W8FRBuSujvjoKOb9BMFhBAAAk5XW/lMGEvXuCij7cXdBAeOmKwAvs9kGP9tJA8WhcwEvy+kFE5cFAnrlZwH7g60EAAK3VZ7/CwHK7pSTZPo/20kDxaFzAS/L6QS0J4UDEdwHAckcBQoPHyEBufNG/56L1QQAAqcw2P0WjCD/R8+e+wOD/P44H5T+OzkRBdjuJPypkHkCzWjpBANL2P3PPAECfO0dBAAAOLyM/goA5P/Qahr4A0vY/c88AQJ87R0F2O4k/KmQeQLNaOkEpN7I/6gkWQHwLQUEAAMiUk77PQnI/XbIVviY4BT9DZjhCavc1QvmnvT+z+jhCYSMyQkFT1T8JgjhC7KAtQgAA00sav3ZRPz9SMY++y8GzPhA/N0IyWDRCJjgFP0NmOEJq9zVClQWYP/E7N0KwGS1CAACar16/TyeSPmv6zb6VBZg/8Ts3QrAZLUIxa3E/SsY1QjIuLkLLwbM+ED83QjJYNEIAAL95+L5SBlY/PRCDviY4BT9DZjhCavc1QkFT1T8JgjhC7KAtQpUFmD/xOzdCsBktQgAAfjU4PyGsCj2kjzG/yW19QQ7GikEWzERBHwCHQetCmEF2TldB+DSGQb/mc0Fvs1JBAAAg9Fq/dTBrPunO7b6VEwZAGWs1QguFJUIxa3E/SsY1QjIuLkKVBZg/8Ts3QrAZLUIAADvHUz8x/Ja7RNIPv1Uaj0Gd+F9ByqRrQR/gj0EWJYxBBnVtQTmpk0G/g3VBEeR4QQAAHRs5v4YEMb4fNis/QApNQVjDM0IN3ztC0NFAQRuTNUJYCTlChhw+QeXrM0KQ4DdCAAC5EPm+nURXv3bkcr6MoIA/wqkzQpDiMkISyPo+A0U0Quf1NEIjT5Q/i5s0QoNGLkIAACWTPb8vbha/Q/OmvhLI+j4DRTRC5/U0Qm4SZz4ViDVC/RU1QiNPlD+LmzRCg0YuQgAAnPk+v5MHFL/nIqm+MWtxP0rGNUIyLi5CI0+UP4ubNEKDRi5CbhJnPhWINUL9FTVCAAAr8Sk/ilRtvvoHNr8Mw4ZB+KvgP7dnjkFFcnhBC2t7QJzMfUEvUIVB3JOrQPelg0EAAEO4DD8flrO+LBdCv4mVeUG/G6k/jMiIQQzDhkH4q+A/t2eOQcWHgUE/YXg/f4SNQQAAaqIMP1jpsL7uw0K/RXJ4QQtre0CczH1BDMOGQfir4D+3Z45BiZV5Qb8bqT+MyIhBAADR/mM+tNNuP7nlkD4hF4VB21gKP05vj0ETo41BgMQNP75biEGUaoZBfIpDP+5/iEEAAE/lEL+xNye/8cIAP/6HTEEThDJCyBs6QkAKTUFYwzNCDd87QoYcPkHl6zNCkOA3QgAA4kisOyJmdD/9W5i+rf6QQQXXKz+7moJBSzqMQTZ4Hj8CLoFB1YmEQS9APD+UB4RBAAATB2Q+LOBuPymQkD6t/pBBBdcrP7uagkGUaoZBfIpDP+5/iEETo41BgMQNP75biEEAAOS9CT1zUH8/qAeFva3+kEEF1ys/u5qCQdWJhEEvQDw/lAeEQZRqhkF8ikM/7n+IQQAAeYwkP1+zdT1kgkM//th/QdiFocDKvw5COgaBQXR+kcDyIA5CTEp1QZripMDrABFCAAAMBUi/teMOv336jj4wgxxB3v4SwWTIFkKywA5BsysTwRgSDUK9nxRB72UZwdAQDkIAAOSYab9WWH++KQ2mPv1xGkFdqgzBp4sWQrLADkGzKxPBGBINQjCDHEHe/hLBZMgWQgAAWU0hP6jF9z3nXES/stVXP15pDUC3rDZBdjuJPypkHkCzWjpBwOD/P44H5T+OzkRBAAC15Xm/SmgDvWvQWz4C0d1AMX2PwFEFA0KP9tJA8WhcwEvy+kHcXdBAeOmKwAvs9kEAAIpDQD6N5Ws/thuuPlFgVD89RSlAusc+QWM0sT7RnS9AncA+QanPrT9yRQhA03dQQQAAL9lxv0aZ2D1x5p4+AtHdQDF9j8BRBQNCHYLmQBG0aMAMLAVCj/bSQPFoXMBL8vpBAAClNAM+EYt3P9qmYT6pz60/ckUIQNN3UEH+CNc/ma0KQN3USkEpN7I/6gkWQHwLQUEAAOQs1j4EGmI/Zh5ZPik3sj/qCRZAfAtBQVFgVD89RSlAusc+QanPrT9yRQhA03dQQQAA1+h5vzNd6rwbGFw+AtHdQDF9j8BRBQNC3F3QQHjpisAL7PZBmU3gQIW7rsCn6QNCAACv9HK/Q8UuvmKjhz6P9tJA8WhcwEvy+kGEwLFAwOUCwD1p5EFE5cFAnrlZwH7g60EAAGYWdT+87yY8Lc2Tvjmpk0G/g3VBEeR4QXNrlkHX53JBZoyFQSOylUH1BVRBTZqCQQAAx05dP8mXzL2bOvy+ECuRQVliPEHcG3pBVRqPQZ34X0HKpGtBI7KVQfUFVEFNmoJBAADsUl8/eAyTvbeV975VGo9BnfhfQcqka0E5qZNBv4N1QRHkeEEjspVB9QVUQU2agkEAAEpAb78yAvW9lYurPoPHyEBufNG/56L1QWGds0AHEjC9+G3rQYTAsUDA5QLAPWnkQQAA26BhP5EN/b3TeOm+KGGWQSrLJUEBMIpBECuRQVliPEHcG3pBI7KVQfUFVEFNmoJBAADtHEc/tQxZvmR6F7+ju4hBn49HQRIvYEHJWI9ByIYIQWQThEHmMYdB5pQhQdS+aUEAACrVcb+v80C9GTmmPoPHyEBufNG/56L1QYTAsUDA5QLAPWnkQY/20kDxaFzAS/L6QQAAqzf6PlzCXT8GqtS9djuJPypkHkCzWjpBUWBUPz1FKUC6xz5BKTeyP+oJFkB8C0FBAACvbRc/+Pp/vTTKTb/VKvE/UzW5Py/hQ0Gy1Vc/XmkNQLesNkHA4P8/jgflP47OREEAAEf1RT/O81y+eaIYv6O7iEGfj0dBEi9gQRArkUFZYjxB3Bt6QclYj0HIhghBZBOEQQAAWBFQP00PaLsOJBW/+DSGQb/mc0Fvs1JBH+CPQRYljEEGdW1BVRqPQZ34X0HKpGtBAACuEv+8jDF9v3DPEz6bIT9B+dwwQpkGL0KZ9VdBUoEyQoadO0J8qDxB94MxQqlcM0IAADHFVL/6NJG+cuX0Ph44FkFyYALBFH8UQjtc+kAPw+LAdyMMQs/NDEGT7AXBZ+EPQgAAQV8Qv0NPKb/6Mf0+H1o/QTcoMkIL3zVC/odMQROEMkLIGzpChhw+QeXrM0KQ4DdCAADR5Jq+lJpmv1d/nz4fWj9BNygyQgvfNUJ8qDxB94MxQqlcM0L+h0xBE4QyQsgbOkIAAIeCAz0fM4i+naN2P9evOEEY1DNCkOU3QoYcPkHl6zNCkOA3QtDTOUEOkzVCil44QgAADs3pvjkuUz92kKq+njIhQA1vNkIC0iNClQWYP/E7N0KwGS1CQVPVPwmCOELsoC1CAADaS06+M9RzP6MLar4+oYBAdQ84Qpd3I0LsgFZAyRE3QnixIUJBU9U/CYI4QuygLUIAALCIZL8cyeo8b0HmPh44FkFyYALBFH8UQs/NDEGT7AXBZ+EPQrxEG0HUkwbBsBEXQgAAmMpZv6d10L5XKqo+ssAOQbMrE8EYEg1C/XEaQV2qDMGnixZCz80MQZPsBcFn4Q9CAAAmAVq/HQnQvn6XqT7PzQxBk+wFwWfhD0I7XPpAD8PiwHcjDEKywA5BsysTwRgSDUIAAE06Z7/h7da+lJ62Pfig9UDlMsTActMLQmGg8EBzELnAYAsMQpZd7UBEx7bAvUIJQgAA6S1nvwuCsj1bWtc+ll3tQETHtsC9QglC/ZTqQLt1wsD20AhC+KD1QOUyxMBy0wtCAAAQaG+/ycqVvmhlTD53D/ZAa3POwHRXDUL9lOpAu3XCwPbQCEI7XPpAD8PiwHcjDEIAAI/ETb8QOeE+ChTNPncP9kBrc87AdFcNQvig9UDlMsTActMLQv2U6kC7dcLA9tAIQgAAIydgP5MQ5r6vgTW+0a95QSsbtsDOqQ1C4j59QT7Jo8DIQAxC/th/QdiFocDKvw5CAADMjFs/Vuq2vqlpvb7+2H9B2IWhwMq/DkLriHxB5HS1wEk8D0LRr3lBKxu2wM6pDUIAALRCbD9eQaq+MM5GPv7Yf0HYhaHAyr8OQo4EgkHDHprAalsLQqeTgkExoJPAQWsLQgAAa1lxP/4uLr5E1pI+p5OCQTGgk8BBawtCOgaBQXR+kcDyIA5C/th/QdiFocDKvw5CAADD07u+CkpgP9khoL7sgFZAyRE3QnixIUKeMiFADW82QgLSI0JBU9U/CYI4QuygLUIAADjiez4rD3U/k8YbvpRqhkF8ikM/7n+IQdWJhEEvQDw/lAeEQUMjf0FFmYI/r1aKQQAAG4IPP5aRU79otVa9jgSCQcMemsBqWwtC/th/QdiFocDKvw5C4j59QT7Jo8DIQAxCAABeBUC/2P7tPmHc8L6VBZg/8Ts3QrAZLUKeMiFADW82QgLSI0KVEwZAGWs1QguFJUIAAHm/gD392km//58cP4YcPkHl6zNCkOA3QtevOEEY1DNCkOU3QkrYOEFfIDJC+bI1QgAAerTovgLXW7/9RXK+jKCAP8KpM0KQ4jJCI0+UP4ubNEKDRi5CkV0RQK9SM0JlYypCAAD78s+++e9lv4c8LL6RXRFAr1IzQmVjKkIjT5Q/i5s0QoNGLkL8JwFAbVc0QkJlJ0IAALhqSb+4BPG+O2bMvvwnAUBtVzRCQmUnQjFrcT9KxjVCMi4uQpUTBkAZazVCC4UlQgAAUIEnP1C5q7yfhEG/vKd5Qa1eZkHO1kJByW19QQ7GikEWzERB+DSGQb/mc0Fvs1JBAAB26DE/7cwKviDHNL+YqnRBlyA8QUUJRkH4NIZBv+ZzQW+zUkGju4hBn49HQRIvYEEAAKvlMT9VxQq+Pso0v5iqdEGXIDxBRQlGQbyneUGtXmZBztZCQfg0hkG/5nNBb7NSQQAA5Xtvv+JShb4inHQ+4jXwQGn52sAtOwhCO1z6QA/D4sB3IwxC/ZTqQLt1wsD20AhCAAANRXS/80eKvrzuAz5E5cFAnrlZwH7g60G1hNJASiehwAZA70HcXdBAeOmKwAvs9kEAAOU5aL+jhkk+r3W+Po7VwUDqMZM/UbnvQRixrEAd6ZtAlhTTQTGCm0D9o0A/fwraQQAA/dYzP7EsaL6tsiy/o7uIQZ+PR0ESL2BB5jGHQeaUIUHUvmlBmKp0QZcgPEFFCUZBAACuxkw/IWsTvlglFb8QK5FBWWI8QdwbekGju4hBn49HQRIvYEFVGo9BnfhfQcqka0EAAGauRD8nAda9Sqshv6O7iEGfj0dBEi9gQfg0hkG/5nNBb7NSQVUaj0Gd+F9ByqRrQQAA/pVhvTsCQb/alSc/hhw+QeXrM0KQ4DdCStg4QV8gMkL5sjVCH1o/QTcoMkIL3zVCAADokAo/4T7aPWCFVb/JbX1BDsaKQRbMREHCk21BFK+KQbp8OkFBcHhBuzykQcAQSEEAAHj3fz8Gri06mw2EPKOvY0ERi55BGOo7QXfGY0Gu7Y5Brao3QS2yY0EAABRCAAAwQQAAdUq/PoYWAT4gQmu/o69jQRGLnkEY6jtBwpNtQRSvikG6fDpBd8ZjQa7tjkGtqjdBAADrF/g9d8x8Pxqgzj1YeF1BBcg5Qh8fMkLJYVRBjVw5Qlb1OELc12xB4Zg4QtYYOUIAAID8fz8AAAAA6lwpvC2yY0EAABRCAAAwQXfGY0Gu7Y5Brao3QS2yY0EAAIhBAAAwQQAA8i0ZO39Q9r6UbWA/LbJjQQAAiEEAADBBOhNaQQFTjUF+3jVBnGdTQdC/ikGSDzNBAABWS5c8q+5/P3OCYDwk2IhBrGM5Qmh0MkJWeWlBKrE5QrnrKULzAHZBN3w5QtrJNEIAAJcZB72UcXs/C1k9Plh4XUEFyDlCHx8yQtzXbEHhmDhC1hg5QvMAdkE3fDlC2sk0QgAAZiE7PXO6fz+4dL87WHhdQQXIOUIfHzJC8wB2QTd8OULayTRCVnlpQSqxOUK56ylCAAB8kCQ/EwzTPdVQQr+y1Vc/XmkNQLesNkHeuBk/uV4WQOqwM0F2O4k/KmQeQLNaOkEAACppPT/41Aw/akDGvsWHgUE/YXg/f4SNQSEXhUHbWAo/Tm+PQUMjf0FFmYI/r1aKQQAAhpDBPCRCsL62RnC/wfmOPi4Voj+sqDpB7gQQvx0hoD/LaDpBt0A5v72IQ0ClwS9BAAD/kiw/dB25PrTiJL9DI39BRZmCP69WikG6B3ZBQoGCP7eRhUGJlXlBvxupP4zIiEEAALDVNz90GRc/d8i8vsWHgUE/YXg/f4SNQUMjf0FFmYI/r1aKQYmVeUG/G6k/jMiIQQAANz+xPr/uYz8KYJc+QyN/QUWZgj+vVopBIReFQdtYCj9Ob49BlGqGQXyKQz/uf4hBAACE/AS7Lt33vlcAYD8tsmNBAACIQQAAMEF3xmNBru2OQa2qN0E6E1pBAVONQX7eNUEAAG7Jcb99Fd69MM2ePmGds0AHEjC9+G3rQT89oUCL4ze/OY3bQYTAsUDA5QLAPWnkQQAAHVBzv2fOnb2AN5o+MYKbQP2jQD9/CtpBPz2hQIvjN785jdtBYZ2zQAcSML34betBAAC/tbu8vO27vjcPbr/B+Y4+LhWiP6yoOkG3QDm/vYhDQKXBL0HeuBk/uV4WQOqwM0EAAAAAAACRq/a+xVRgPy2yE0EAAIhBAAAwQS2yY0EAAIhBAAAwQVCNTUG6A4hBGQQwQQAAerAbthhd977hI2A/UI1NQboDiEEZBDBBLbJjQQAAiEEAADBB8o9NQRHliUFPFzJBAADIXcG6pbv6vrEzXz/yj01BEeWJQU8XMkEtsmNBAACIQQAAMEGcZ1NB0L+KQZIPM0EAAFgxsD5lN4U9cMlvv5xnU0HQv4pBkg8zQToTWkEBU41Bft41Qd8uWEFeU2lBr78xQQAAa8ETvyO42z7e3DE/FwNov6Vi3T8oMT5BnDu3P2bhRj8wrmZBMq8AvxhyPEDujDdBAAAcKha/TeXbPk/HLz8yrwC/GHI8QO6MN0G9OE2/HxBEQNlFMkEXA2i/pWLdPygxPkEAANIMSz9soIQ9owUbP9GveUErG7bAzqkNQp5BgEHcQ7XAu2oLQuI+fUE+yaPAyEAMQgAATVVKP7MQxj4OOvM+lv58QWb3LMBMgQhC1W94QYsEgsAH1Q5CUVd+Qb+KaMAi+gpCAABrQW2/dNtBPr0Ypj4xgptA/aNAP38K2kEYsaxAHembQJYU00GHKohAHWQbQIZnxEEAADPeeb+HwL+9sxhJPjGCm0D9o0A/fwraQQn5l0CFKLa+rGvRQT89oUCL4ze/OY3bQQAAeo0fPuDjpD0vCHy/CgNiQV7udkFKNDRBOhNaQQFTjUF+3jVBd8ZjQa7tjkGtqjdBAAA86uI8F9V+v1/2uj2cooVB//8yQquPM0Ls22tB2UozQtQhOUIxOm9BDOYxQtqtKUIAAL5uDD61YHy/omfFPTE6b0EM5jFC2q0pQuzba0HZSjNC1CE5QmDwSEFKtTBCTR8rQgAAo9wGP+vK4Lvqllm/UQJlQYiRWUFcJTZByW19QQ7GikEWzERBvKd5Qa1eZkHO1kJBAACnlws//JyNvAOMVr/Ck21BFK+KQbp8OkHJbX1BDsaKQRbMREFRAmVBiJFZQVwlNkEAAH9VTz1I5H4/N6ifPclhVEGNXDlCVvU4Qlh4XUEFyDlCHx8yQvZmPEFASzpCMfEwQgAAY4q8vc2Vej/QFjs+9mY8QUBLOkIx8TBC01A+QdmKOUK2NTVCyWFUQY1cOUJW9ThCAABZfjk/Yd7oPBRIML9RAmVBiJFZQVwlNkEKA2JBXu52QUo0NEF3xmNBru2OQa2qN0EAAGhnmD5gJ9o89Ex0v1ECZUGIkVlBXCU2QXfGY0Gu7Y5Brao3QcKTbUEUr4pBunw6QQAAbEAPPkzmnT2Itny/CgNiQV7udkFKNDRB3y5YQV5TaUGvvzFBOhNaQQFTjUF+3jVBAABi/38/v6W3ucGajbvyj01BEeWJQU8XMkFkik1BGEBtQYkxMEFQjU1BugOIQRkEMEEAAOw5rD3doHs/nponPvZmPEFASzpCMfEwQn4nNUGd5DlC5Uc0QtNQPkHZijlCtjU1QgAAvf9xPdCAfz8sLKE8WHhdQQXIOUIfHzJC9/c8QctpOkISdypC9mY8QUBLOkIx8TBCAACkRwy8F1D0vub2YD9hqiVBrJqJQdDqMUHFUh1BWDuNQYzGNUEtshNBAACIQQAAMEEAAHWfrTcnVwO/dL1bP2GqJUGsmolB0OoxQS2yE0EAAIhBAAAwQVCNTUG6A4hBGQQwQQAA0dZ7v4goRL0uNjE+04ATQYjEnkFNgTtBLbITQQAAiEEAADBBOGsUQSaHj0F6RjhBAABJfio/74UAP24+DT/Pf25BpqMfwBMfDELVb3hBiwSCwAfVDkKW/nxBZvcswEyBCEIAAF1cf78VHVK9VdJGvRcDaL+lYt0/KDE+Qfz+ab9I4x5AzgE0QZg9Y79hmqw//oE+QQAA6bVqP1kELz48vrg+/oKAQSbcob+XOANClv58QWb3LMBMgQhCeL6DQbdcCcD/yABCAACQNFK+HLe1vlt+ab/uBBC/HSGgP8toOkH8/mm/SOMeQM4BNEG3QDm/vYhDQKXBL0EAAD+rND8LC9E+BTkUP5b+fEFm9yzATIEIQv6CgEEm3KG/lzgDQmvzekFkcOO/QoQGQgAAG56QPgjg9L5u4FS/wfmOPi4Voj+sqDpBuU7kP2X5Zz42Z0xBHhOMPyctF78MLVBBAAAxnL8+OuvgvuwRUb/B+Y4+LhWiP6yoOkHeuBk/uV4WQOqwM0Gy1Vc/XmkNQLesNkEAAEvfsj5oN8y+CA1Zv9Uq8T9TNbk/L+FDQblO5D9l+Wc+NmdMQcH5jj4uFaI/rKg6QQAAIwqyPsAr274kjFW/wfmOPi4Voj+sqDpBstVXP15pDUC3rDZB1SrxP1M1uT8v4UNBAADBYXu/g5iTvXgCMz4xgptA/aNAP38K2kGHKohAHWQbQIZnxEEJ+ZdAhSi2vqxr0UEAACe0c7+Z54W+jBAjPkTlwUCeuVnAfuDrQQAHq0AZUxbAaYnXQbWE0kBKJ6HABkDvQQAAhMR0v7JpdL6p8y0+ROXBQJ65WcB+4OtBhMCxQMDlAsA9aeRBAAerQBlTFsBpiddBAADcGXa/2WNpvp9IHj4AB6tAGVMWwGmJ10E/PaFAi+M3vzmN20EJ+ZdAhSi2vqxr0UEAALlBdb/HPW2+xNosPgAHq0AZUxbAaYnXQYTAsUDA5QLAPWnkQT89oUCL4ze/OY3bQQAAI8OFPXxufz+QnFU8VnlpQSqxOUK56ylC9/c8QctpOkISdypCWHhdQQXIOUIfHzJCAABf/3W/Ugx7vk2VAz7iNfBAafnawC07CEL9lOpAu3XCwPbQCEKZTeBAhbuuwKfpA0IAAMq6db4LTna/E2wEPoKRpUCLLjFC7O4bQi5Z0kD1sC9CAjsbQv5qu0Cw6zBC+w4fQgAAd1EGvHzgd78VxX8+fKg8QfeDMUKpXDNCH1o/QTcoMkIL3zVCStg4QV8gMkL5sjVCAACloz8+f/B6vxR3gz1g8EhBSrUwQk0fK0Ls22tB2UozQtQhOUKZ9VdBUoEyQoadO0IAABk8bD9F0RY+jkq2Pg05gkHJGXLA43YFQni+g0G3XAnA/8gAQpb+fEFm9yzATIEIQgAAbhdxP6awdj7qPnA+lv58QWb3LMBMgQhCUVd+Qb+KaMAi+gpCDTmCQckZcsDjdgVCAABSfqQ9MSJ+v8oPuD2bIT9B+dwwQpkGL0Jg8EhBSrUwQk0fK0KZ9VdBUoEyQoadO0IAACzFYz/Dm9E+/8tOPg05gkHJGXLA43YFQlFXfkG/imjAIvoKQqeTgkExoJPAQWsLQgAASwxjPw+q0T7t61o+OgaBQXR+kcDyIA5Cp5OCQTGgk8BBawtCUVd+Qb+KaMAi+gpCAAC++po9hZJ0P1Y4kr7x8n1BILFQPzWxhEFDI39BRZmCP69WikHViYRBL0A8P5QHhEEAAFy5nT6mhmc/iymXvroHdkFCgYI/t5GFQUMjf0FFmYI/r1aKQfHyfUEgsVA/NbGEQQAAB28dvVHVCT+MgFe/8fJ9QSCxUD81sYRB1YmEQS9APD+UB4RBQMJ6QasYBD/vO4NBAABCxtS9MeQ6P7TqLL/ViYRBL0A8P5QHhEE1CIdBVNjlPlsrgUFAwnpBqxgEP+87g0EAAJXypTzcnwI/+Bpcv7oHdkFCgYI/t5GFQfHyfUEgsVA/NbGEQUDCekGrGAQ/7zuDQQAABPwcP0Mver4vTUA/tdmDQTn+ncD7YQhCrzGCQVmlrMCNdghCuD6CQXbLtsCZBwhCAACRYma+6djFPmj7ZL9AwnpBqxgEP+87g0F+bHRBfCbRPseog0G6B3ZBQoGCP7eRhUEAACvQnz44AZo+sbJmv/yFb0F7UZY/DNuEQboHdkFCgYI/t5GFQX5sdEF8JtE+x6iDQQAAgWlsv7duw764cx09ghC/QGQHgsAIrcdBtYTSQEonocAGQO9BAAerQBlTFsBpiddBAAAGr2i/hyXTvuFDfD0WAedAwVPUwPUq5UG1hNJASiehwAZA70F/B8VAVJeYwLjQy0EAALEBd7/MAwq9FWiFPhcDaL+lYt0/KDE+QZg9Y79hmqw//oE+QRFCNL89lsE+rF9HQQAAKTp2v2Elir68Vjs9AAerQBlTFsBpiddBCfmXQIUotr6sa9FButmYQH1/ML+qScZBAABnAB+/EMlHv6+Tkz2KRRpBNEQewfINDUK9nxRB72UZwdAQDkKWFhNB2EoawdxVCEIAAKxIcb9WCKu+7OcPvLrZmEB9fzC/qknGQYIQv0BkB4LACK3HQQAHq0AZUxbAaYnXQQAALEYZu9+S9r5aW2A/xVIdQVg7jUGMxjVBOGsUQSaHj0F6RjhBLbITQQAAiEEAADBBAADdLJs8OuzYPYSDfr8BZRBBBe6IQe/KNkHTgBNBiMSeQU2BO0E4axRBJoePQXpGOEEAAF4Ier+NlEu+CcSlPX8HxUBUl5jAuNDLQbWE0kBKJ6HABkDvQYIQv0BkB4LACK3HQQAAtnRrv9gxsr2G9sM+4q/VQPuLx8BzJ9NBfwfFQFSXmMC40MtB12XKQCLvtsDpUM1BAADzOfa+ZOICPhwOXr/TgBNBiMSeQU2BO0EBZRBBBe6IQe/KNkEkxvFAHWeYQdBiSEEAAHfHu77qlJI9j3Rtv2GqJUGsmolB0OoxQSzcHUFyJWxBSP0xQcVSHUFYO41BjMY1QQAAlT4xvtlBoD3CVnu/LNwdQXIlbEFI/TFBUEYVQb94cUFs7TNBxVIdQVg7jUGMxjVBAADUNmi+zL+0PQ1OeL/FUh1BWDuNQYzGNUFQRhVBv3hxQWztM0E4axRBJoePQXpGOEEAAHZlVT3ILcQ9OHl+vwFlEEEF7ohB78o2QThrFEEmh49BekY4QVBGFUG/eHFBbO0zQQAAdCoRv1eZCr+d6R6/zKMpv5TNTj9TxUBBrb7LvkjRK74khEpBEUI0vz2WwT6sX0dBAACw6Hy/DxDFvYWu+D0XA2i/pWLdPygxPkERQjS/PZbBPqxfR0ES3S6/Jy3rPpAlS0EAAOpROb8bZ+G+NfsHv8yjKb+UzU4/U8VAQRFCNL89lsE+rF9HQZg9Y79hmqw//oE+QQAARFotv4u1br1WyDu/XjUAQV5mbkGJ3z9BNPjRQEdUbUG4ZVVB0aPeQKdKg0Hkik1BAADteCO/IgTLvoXYKL/uBBC/HSGgP8toOkGYPWO/YZqsP/6BPkH8/mm/SOMeQM4BNEEAAEFxIr8eE92+gBokv+4EEL8dIaA/y2g6QcyjKb+UzU4/U8VAQZg9Y79hmqw//oE+QQAASRQkvk/UcT9PlpK+QJ2lQBtRNkJ+IBtC7IBWQMkRN0J4sSFCPqGAQHUPOEKXdyNCAACglxi/9PkXPRVVTb9eNQBBXmZuQYnfP0HRo95Ap0qDQeSKTUEkxvFAHWeYQdBiSEEAAOOHD79a+TQ9NK1TvyTG8UAdZ5hB0GJIQQFlEEEF7ohB78o2QV41AEFeZm5Bid8/QQAAveHLvtKjD7/nxTm/7gQQvx0hoD/LaDpBrb7LvkjRK74khEpBzKMpv5TNTj9TxUBBAABCWdA8XLUMv2fDVb/Ue80+6Wd5v7RQUkHuBBC/HSGgP8toOkHB+Y4+LhWiP6yoOkEAAElZxr1lWRW/yW9Ov+4EEL8dIaA/y2g6QdR7zT7pZ3m/tFBSQa2+y75I0Su+JIRKQQAAIEVivwTk4r6GQhk+O1z6QA/D4sB3IwxCd/D4QNnW88DnxARCssAOQbMrE8EYEg1CAABZdr4+iuEkvyQeK7+InFtAfNRTwGZTfUF15KZAwshQwBM9hkE+m3NALy2OwCwRiUEAAFCB7T5p8/q+1eo8v2d5t0BJZtu/Pp6AQXXkpkDCyFDAEz2GQZs1b0CWOcq/gLxrQQAAkc8/vx9tKL9FYJs9vZ8UQe9lGcHQEA5CssAOQbMrE8EYEg1ClhYTQdhKGsHcVQhCAABfMMK9pZp+v7bYMT2RXRFAr1IzQmVjKkKUyIhAGA4yQvrXHkKnCIhAIlYyQrQVJUIAAG+8zz5mUAq/R7k8v4icW0B81FPAZlN9QZs1b0CWOcq/gLxrQXXkpkDCyFDAEz2GQQAAI/vIvso8Z78bZjG+kV0RQK9SM0JlYypCaL52QBHWMkLIkR5ClMiIQBgOMkL61x5CAACOa/w+UiDNvte0Rb+P4YFA0Md4vmfrY0FnebdASWbbvz6egEGbNW9AljnKv4C8a0EAAPCXyb49Eme/PhUyvmi+dkAR1jJCyJEeQpFdEUCvUjNCZWMqQvwnAUBtVzRCQmUnQgAAUa9dvxhc+r6579Y9d/D4QNnW88DnxARCDzUGQXziCsFCGAVCssAOQbMrE8EYEg1CAAAS5jW+6bN7v+qoKj2nCIhAIlYyQrQVJUKUyIhAGA4yQvrXHkL+artAsOswQvsOH0IAAJ6tXL+YO/a+H+0jPjtc+kAPw+LAdyMMQuI18EBp+drALTsIQnfw+EDZ1vPA58QEQgAAyF5Bv8GcJ7//aeK8lhYTQdhKGsHcVQhCDzUGQXziCsFCGAVCtqoOQSssFMH6TAJCAACodEm/LWsdv8U1UT2ywA5BsysTwRgSDUIPNQZBfOIKwUIYBUKWFhNB2EoawdxVCEIAAMdSl7yA9H+/oIpMu+ttL0Fq2SHB2VkVQvHDIkFThCHBAHgNQvL3TEGsPiLBIlIJQgAAt5wcv2dsRL9PCUU+ikUaQTREHsHyDQ1CrbglQRhRHsHgGhZCPoAgQcCoGsEPmhVCAADVAY++y2p0vwom0T3xwyJBU4QhwQB4DULrbS9BatkhwdlZFUKQOShBU7ogwcMLE0IAAI8wrL7cRW+/ZkLsPZA5KEFTuiDBwwsTQq24JUEYUR7B4BoWQvHDIkFThCHBAHgNQgAAS3jePgy+Lz+VQRU/iK+ZQRe88r6uaItB7WqPQaA6ZL7nsZBBRWuSQcXgib9ZgZZBAAA96L++Tm5rvzMp8D2tuCVBGFEeweAaFkKKRRpBNEQewfINDULxwyJBU4QhwQB4DUIAAAObD7/rbk6/Ecg/Pj6AIEHAqBrBD5oVQr2fFEHvZRnB0BAOQopFGkE0RB7B8g0NQgAAzoKcvE7zf78aFJu78vdMQaw+IsEiUglC8cMiQVOEIcEAeA1CAfwoQa6JIcEsTAhCAABpI8q+YPJqv84GML2KRRpBNEQewfINDUKWFhNB2EoawdxVCEId1x1BwE8ewWcZBUIAAKo6Gj7u0ne/lTxNPjE6b0EM5jFC2q0pQmDwSEFKtTBCTR8rQjEKT0H8cC9Cf9sjQgAACoyzvqqLb79epxu9HdcdQcBPHsFnGQVC8cMiQVOEIcEAeA1CikUaQTREHsHyDQ1CAACQ5Ac+YCp3v0p4ZT67iI9B60oxQkL8H0IxOm9BDOYxQtqtKUIxCk9B/HAvQn/bI0IAAPLbV768vHm/9I1/vQH8KEGuiSHBLEwIQvHDIkFThCHBAHgNQh3XHUHATx7BZxkFQgAAYK+FPgvFTD+SVgo/E6ONQYDEDT++W4hB7WqPQaA6ZL7nsZBBEieWQWgTCD/OgYRBAADroZI+vZsLvSAfdb8KA2JBXu52QUo0NEFRAmVBiJFZQVwlNkHfLlhBXlNpQa+/MUEAADIe3j4pVTA/oLAUPxInlkFoEwg/zoGEQe1qj0GgOmS+57GQQYivmUEXvPK+rmiLQQAAFuSqPjWlMT/iVCM/iK+ZQRe88r6uaItBWJilQZFjKT+ml3ZBEieWQWgTCD/OgYRBAADjmQ4/pAShvXSmU78mbHFBarFOQTaLP0FRAmVBiJFZQVwlNkG8p3lBrV5mQc7WQkEAAMjG7z7uXVg/m+GDPiEXhUHbWAo/Tm+PQax+hUFfodI+IhaSQe1qj0GgOmS+57GQQQAASZJiP6zvsD48r5++2yWGQdMD0T5l6ZNBaHSIQcOVhL3sQ5ZBrH6FQV+h0j4iFpJBAADgFRs/Rb5AP7Csgz6sfoVBX6HSPiIWkkFodIhBw5WEvexDlkFFa5JBxeCJv1mBlkEAAFuHij6u8US95iR2v/kkV0E1elBB97IyQd8uWEFeU2lBr78xQVECZUGIkVlBXCU2QQAAvbPdPoXHLz9+fxU/RWuSQcXgib9ZgZZB7WqPQaA6ZL7nsZBBrH6FQV+h0j4iFpJBAABDq8s+oTlGP/n4+z4To41BgMQNP75biEEhF4VB21gKP05vj0Htao9BoDpkvuexkEEAALnIJT6MZkY9dVF8v98uWEFeU2lBr78xQWSKTUEYQG1BiTEwQfKPTUER5YlBTxcyQQAAMOoDPvdAMb0EoH2/3y5YQV5TaUGvvzFB+SRXQTV6UEH3sjJBZIpNQRhAbUGJMTBBAAD1wGI/aOCovhEzpz612YNBOf6dwPthCEKnk4JBMaCTwEFrC0KOBIJBwx6awGpbC0IAAFy8Ij+j/D6/Yg9LPo4EgkHDHprAalsLQuI+fUE+yaPAyEAMQl28f0FPWqTArP0JQgAASUPlPtIITb+tiMs+Xbx/QU9apMCs/QlCWgOCQX1zn8BlBApCjgSCQcMemsBqWwtCAACyIuW9CyKfvSKdfb9AwnpBqxgEP+87g0HC2oFB5nL2vsFag0F+bHRBfCbRPseog0EAADgRv710Q34/vSKOvbzqOkHyfzlCCBUeQtdcJUGh9jlC2/UrQvf3PEHLaTpCEncqQgAA3GfpvvlM4b5yDka/Jx6PQZoNtb6J6nVBOSh9QQEagb8ar4dBwtqBQeZy9r7BWoNBAACQEwC/VsexvvINS78nHo9Bmg21vonqdUH4CZJBd879v4OkfUE5KH1BARqBvxqvh0EAAOOKej526zG/9hQtv9liHEBWDF/AGH16QYicW0B81FPAZlN9QT6bc0AvLY7ALBGJQQAAfjrwPeuVfL9EJOc9myE/QfncMEKZBi9ClF86QbAlMEK/ACpCYPBIQUq1MEJNHytCAAAu9ye/FIG9Po9cKD+cO7c/ZuFGPzCuZkHLe8k/djc4wHPvhEG74VhAltcBwPGXj0EAANsHb7+wssa9mnKwPn8HxUBUl5jAuNDLQc8Dv0Dri7TAIsbFQddlykAi77bA6VDNQQAAjQMyP2/aJL+IWKM+tdmDQTn+ncD7YQhCjgSCQcMemsBqWwtCWgOCQX1zn8BlBApCAADsrFQ/bLu2vhuz2j6vMYJBWaWswI12CEK12YNBOf6dwPthCEJaA4JBfXOfwGUECkIAAGDjvD0RPHq/211CPmDwSEFKtTBCTR8rQpRfOkGwJTBCvwAqQjEKT0H8cC9Cf9sjQgAA7Lv6PZYVeL9FYFs+MQpPQfxwL0J/2yNClF86QbAlMEK/ACpCrPg3QVuXLkLDTiNCAACRPm8/hgiCPk83fz7iPn1BPsmjwMhADEKeQYBB3EO1wLtqC0JdvH9BT1qkwKz9CUIAAJoNfT/MDgs+PpmIPV28f0FPWqTArP0JQp5BgEHcQ7XAu2oLQmNcgEFmt6/A2DoJQgAAfPs2v+537D3wkzC/FwF3QFzyM0JsaB1CxwwvQMVlNELEJCJCZN9uQMB8NUJEMR5CAAAqMje//4VyPjc5KL/HDC9AxWU0QsQkIkKeMiFADW82QgLSI0Jk325AwHw1QkQxHkIAADagsD6EMiK/KEgxP128f0FPWqTArP0JQq8xgkFZpazAjXYIQloDgkF9c5/AZQQKQgAAY+MYv05XE7+EAg+/FwF3QFzyM0JsaB1CiDWKQBSiMkLCyxxCaL52QBHWMkLIkR5CAACyRS4/f1SAvls0MD+vMYJBWaWswI12CEJdvH9BT1qkwKz9CUJjXIBBZrevwNg6CUIAAMvO2L7hiSk/iz4ev2TfbkDAfDVCRDEeQkCdpUAbUTZCfiAbQq8xkEA76zRCo3YbQgAAsFdSv8pfhz3w7hA/Q7oFPxfO3b8WT29BxpV4P8+HO8DF9ntBy3vJP3Y3OMBz74RBAAA8c1K/m9kdPaptET/GlXg/z4c7wMX2e0EY4tk/q7NwwMflhkHLe8k/djc4wHPvhEEAAEzwTb/SEBK/xTwpPhji2T+rs3DAx+WGQSjXnT8inlbAqMZ/Qbms1j+2RHPAXdCEQQAApJq/vqawAb/D10a/OSh9QQEagb8ar4dBmnVtQejWw77cMohBwtqBQeZy9r7BWoNBAABOMBo+Et06PcfPfL/fLlhBXlNpQa+/MUHyj01BEeWJQU8XMkGcZ1NB0L+KQZIPM0EAAI8oAj3+Apy9YCB/v/kkV0E1elBB97IyQfffTUHqaDVB93g0QWSKTUEYQG1BiTEwQQAAdLlgvxqOwb4JlpY+GOLZP6uzcMDH5YZBxpV4P8+HO8DF9ntBKNedPyKeVsCoxn9BAADxm8E+nkGvPQL6az+zOxxBa1I1QgyAPkKzYSZBRk41Qv11PULUKh9BAL02QloRPkIAAL4RcT2cvH4/YpijPWZbNkGtbZdBIk3rQYtbQ0GFDpZBaZn3QewjREE/7ZZBE3nsQQAAwHKoPnCzF75LwW6/+SRXQTV6UEH3sjJBUQJlQYiRWUFcJTZBnn9iQakLMEEm2ztBAAB68JY+OI4mvo8Ncb/3301B6mg1Qfd4NEH5JFdBNXpQQfeyMkGef2JBqQswQSbbO0EAADRSLT9C8wm+Sjg5vyZscUFqsU5BNos/QbyneUGtXmZBztZCQZiqdEGXIDxBRQlGQQAAMAADP5HfFr42r1i/JmxxQWqxTkE2iz9Bnn9iQakLMEEm2ztBUQJlQYiRWUFcJTZBAADMzhE/hzY5vtRCTb8mbHFBarFOQTaLP0GYqnRBlyA8QUUJRkGef2JBqQswQSbbO0EAAF+FXr/kifi+GELAPcaVeD/PhzvAxfZ7QSZOdz+Cmj/APfV1QSjXnT8inlbAqMZ/QQAAP50Ov4qVTL8CQme+KNedPyKeVsCoxn9BJk53P4KaP8A99XVBbOK2P/blV8DKL3lBAADa4Ae/2F1Mvxy0kb4mTnc/gpo/wD31dUFY4Vg/C+sywLWbcEFs4rY/9uVXwMoveUEAAOsrfb+GJ088pD4XPt/gi0BQhA9B8k25QdJehkDKwBhBbrCvQcGOh0CRr9xA5X2zQQAA45ShPkn8BL9HSEu/uU7kP2X5Zz42Z0xBmzVvQJY5yr+AvGtB3Ov1P/X6HMC6UmlBAADGcac+vSIMv64zRb+bNW9AljnKv4C8a0GInFtAfNRTwGZTfUHc6/U/9focwLpSaUEAAIIzfz+gQqq4LKmhvWSKTUEYQG1BiTEwQfffTUHqaDVB93g0QWmFTUFPeiFBlQYwQQAAinA7vVwuBz2bl3+/la4lQSbLNkFkODBBmaYlQfNbVUFqOzFBZIpNQRhAbUGJMTBBAAAPHXo+oPkiv+JBO7/c6/U/9focwLpSaUGInFtAfNRTwGZTfUHZYhxAVgxfwBh9ekEAAKmwZr34qz4/ezYqPzNlHUH5PjhCYlc8QkIbFkEfvzZC2909QtQqH0EAvTZCWhE+QgAAeOJ/P/cqtrx8LKU8aYVNQU96IUGVBjBB999NQepoNUH3eDRBYU1NQfxxIEHGvDlBAADmk6i9HNWoPtHCcD/UKh9BAL02QloRPkJCGxZBH782QtvdPUKzOxxBa1I1QgyAPkIAAEinLT7TQnq+SWl0v6C6UUE3zBZBSf48QWFNTUH8cSBBxrw5QfffTUHqaDVB93g0QQAAPS73vIi/QL98TCi/2WIcQFYMX8AYfXpBbOK2P/blV8DKL3lBvQEsPxuiFsBQDmdBAACiAiK/Y38zPjYRQb8XAXdAXPIzQmxoHUJk325AwHw1QkQxHkKvMZBAO+s0QqN2G0IAAE4nxL4/iUQ/TH4Dv2TfbkDAfDVCRDEeQuyAVkDJETdCeLEhQkCdpUAbUTZCfiAbQgAA5XO4PBcEN79Y6DK/2WIcQFYMX8AYfXpBvQEsPxuiFsBQDmdB3Ov1P/X6HMC6UmlBAADs1K6+qPNMv+Ma/L5Y4Vg/C+sywLWbcEG9ASw/G6IWwFAOZ0Fs4rY/9uVXwMoveUEAABfQUr9Es4I91FAQP64IJD9hMyDAmHhzQcaVeD/PhzvAxfZ7QUO6BT8Xzt2/Fk9vQQAAjKU2vgIve78RU5c9lMiIQBgOMkL61x5CgpGlQIsuMULs7htC/mq7QLDrMEL7Dh9CAAC3RcW+uT5mv1BwU76UyIhAGA4yQvrXHkJovnZAEdYyQsiRHkKCkaVAiy4xQuzuG0IAAJbMLT9UiGa+mOgyP7g+gkF2y7bAmQcIQq8xgkFZpazAjXYIQmNcgEFmt6/A2DoJQgAAzTIHvqL8cz8bfIu+QJ2lQBtRNkJ+IBtCPqGAQHUPOEKXdyNC558RQVNqN0LsWxdCAAAhZM29sWZ4P+lXYb4+oYBAdQ84Qpd3I0K5KhZBUzU4QohWGkLnnxFBU2o3QuxbF0IAACphvD6rdmi+49ZmP/dJH0Hk5DNCOtQ9QrNhJkFGTjVC/XU9QrM7HEFrUjVCDIA+QgAAOC2FvslfFD6gY3Q/QhsWQR+/NkLb3T1CbJ8QQcJ/NUK0rj1CszscQWtSNUIMgD5CAABBuSm+p0X7vkb6Wj+zOxxBa1I1QgyAPkKphxRBGCs0QhR3PUL3SR9B5OQzQjrUPUIAAB12Ir7QLVC/cFgPP8PjHEEo0DJC0RY8QvdJH0Hk5DNCOtQ9QqmHFEEYKzRCFHc9QgAAbzeMvo3lsb6flWU/szscQWtSNUIMgD5CbJ8QQcJ/NUK0rj1CqYcUQRgrNEIUdz1CAADz8zY/f8oZPnfjLj/Q0zlBDpM1QopeOEJFbTpB3Wo3Qq/ON0JcHypBNPQ2Ql0sPEIAAEP+Dz+UExU/o0IWP1wfKkE09DZCXSw8QkVtOkHdajdCr843Qg6mJ0EFVDhCC2c7QgAAs3oFP3GqpD54Vko/XB8qQTT0NkJdLDxC1CofQQC9NkJaET5Cs2EmQUZONUL9dT1CAABI7tw+P8cUP3ehMD9cHypBNPQ2Ql0sPEIOpidBBVQ4QgtnO0LUKh9BAL02QloRPkIAAG/EGb7bAmw/M9W2vkCdpUAbUTZCfiAbQuefEUFTajdC7FsXQqJt2EAIxjVCqw0XQgAAPv15P7AEVj4C21U99SiEQUFPmcCmfQNCcqeEQZGhn8CMCAJCDTmCQckZcsDjdgVCAABoVHc/c0mHPSJwfz4NOYJByRlywON2BUJyp4RBkaGfwIwIAkJ4voNBt1wJwP/IAEIAAE9xdz/LsXA+orrRPbXZg0E5/p3A+2EIQg05gkHJGXLA43YFQqeTgkExoJPAQWsLQgAA9Qd6P3xNVD6oNGQ9tdmDQTn+ncD7YQhC9SiEQUFPmcCmfQNCDTmCQckZcsDjdgVCAAAXO26/qCdVPZ2FuT7va41AcUCnQJWYvkEYsaxAHembQJYU00Hf4ItAUIQPQfJNuUEAAFtebL8m8Ic956vBPhixrEAd6ZtAlhTTQQ2JmkAXdxdBHY3BQd/gi0BQhA9B8k25QQAAjPxRPzWf0L5LiM0+W26iQUXvlcCvIZlBZtqcQXe4oMDQyqFBnD6gQaQepMDz/5lBAACRWlA/7zQIPinLED9m2pxBd7igwNDKoUFbbqJBRe+VwK8hmUHT0J5BEL6KwAqtnUEAADBuTz9Yk9u+gYDMPpXtmUHE5q7AauujQZw+oEGkHqTA8/+ZQWbanEF3uKDA0MqhQQAAcTh9v5j6Vjy04hU+72uNQHFAp0CVmL5B3+CLQFCED0HyTblBwY6HQJGv3EDlfbNBAAC8VoS9VVw1PAJzf7+ZpiVB81tVQWo7MUEs3B1BciVsQUj9MUFhqiVBrJqJQdDqMUEAAOHCBb2jhDU8Bdl/v5mmJUHzW1VBajsxQWGqJUGsmolB0OoxQWSKTUEYQG1BiTEwQQAAvFYBPe72eD+mNmw+7CNEQT/tlkETeexB2DlFQTWTmUHQO+FBZls2Qa1tl0EiTetBAABOoIG+jTpoveA7d7+xLhRBszdTQWn9NUFQRhVBv3hxQWztM0Es3B1BciVsQUj9MUEAAE4Zg74MNGO91Q53v7EuFEGzN1NBaf01QSzcHUFyJWxBSP0xQZmmJUHzW1VBajsxQQAA/Lt2P1bPg74w7I09cqeEQZGhn8CMCAJCtdmDQTn+ncD7YQhCuD6CQXbLtsCZBwhCAACrPHo/ioBQPph9Yj31KIRBQU+ZwKZ9A0K12YNBOf6dwPthCEJyp4RBkaGfwIwIAkIAAOmrRL24g6a7kLN/v2GqJUGsmolB0OoxQVCNTUG6A4hBGQQwQWSKTUEYQG1BiTEwQQAA73IMv6aoz739c1S/sS4UQbM3U0Fp/TVB3dAIQTzpP0Hq3D9BXjUAQV5mbkGJ3z9BAAC4sMM+7ZkLPy/7Pj9sWFdBJrhAwMC0E0Lr5UlBbxNBwNhxFULjN1VBRh+CwDwQF0IAAOH1dDxCyic/wU5BP1TQRkEIkW/AafsXQuvlSUFvE0HA2HEVQlmkL0GanEzAUzMWQgAA8LL8vpK6KDt0pV6/UEYVQb94cUFs7TNBXjUAQV5mbkGJ3z9BAWUQQQXuiEHvyjZBAACKbxu/cODlvddeSb/d0AhBPOk/QercP0Hj6vdAbHpSQUUjR0FeNQBBXmZuQYnfP0EAAPLUFL899Eo/a2Q7Pp9+L0GBEJZBTPrsQeciM0FTE5ZB97byQf3DMUE1splBJNrgQQAA2jaePXNLej+x5Uc+5yIzQVMTlkH3tvJBZls2Qa1tl0EiTetB/cMxQTWymUEk2uBBAABlySy/TPuzvYiMO79eNQBBXmZuQYnfP0Hj6vdAbHpSQUUjR0E0+NFAR1RtQbhlVUEAAP73+b5dNiu9+Chfv7EuFEGzN1NBaf01QV41AEFeZm5Bid8/QVBGFUG/eHFBbO0zQQAA6HmEvihDd7+c6Ui8zGHJQIQDMEJPehlCLlnSQPWwL0ICOxtCgpGlQIsuMULs7htCAAAkV9I+irDSvZ/oZz9sxUtBh9HmQU9izkEjEFdBS0nVQSbVyUFInltBBFHiQYpHykEAAIt6TT5fSEM/4VsdP9QqH0EAvTZCWhE+Qg6mJ0EFVDhCC2c7QjNlHUH5PjhCYlc8QgAAqiYlP6rbDb7ZXEA/SWlkQVug4EF8McZBSJ5bQQRR4kGKR8pBIxBXQUtJ1UEm1clBAABqkgO/mSI9v/wu3767ObpAb5MxQoo4GEIQ6MBAh44wQq32GEKCkaVAiy4xQuzuG0IAANg4t745RGi/Ph9ivoKRpUCLLjFC7O4bQhDowECHjjBCrfYYQsxhyUCEAzBCT3oZQgAAoD8BP1F3pbyc6lw/IxBXQUtJ1UEm1clB2/xmQcv8y0Hg9MRBSWlkQVug4EF8McZBAAAMo8E9U4VvPyAgrj4zZR1B+T44QmJXPEIOpidBBVQ4QgtnO0IJXiFB0jo5QtZbOUIAANT5Aj+rUUu8Qe9bP9v8ZkHL/MtB4PTEQSMQV0FLSdVBJtXJQXXjWUF3KMZB1MXIQQAAc516PrMYLb7NaXQ/bMVLQYfR5kFPYs5BCrNKQXVB1EEcPMtBIxBXQUtJ1UEm1clBAAABSn6+RHLlvRtRdr+PKiBB2yg3QfspNkGxLhRBszdTQWn9NUGZpiVB81tVQWo7MUEAAAUme7/YW+o9pBwgPu9rjUBxQKdAlZi+QRLQg0C/I5JA9WKzQY8Ug0AZ8GJAGDe4QQAADGNyu98rETtk/3+/la4lQSbLNkFkODBBZIpNQRhAbUGJMTBBaYVNQU96IUGVBjBBAAAICTO/Q8uuvtjCIL81ByhBmfMfQXwGOkGPKiBB2yg3QfspNkGVriVBJss2QWQ4MEEAAJ2UprxPwRq+jwF9P8pBKkEm2uBBfCDNQfH/KkF39dNBtynLQWzFS0GH0eZBT2LOQQAAk1KXvlu6gb4azmu/jyogQdsoN0H7KTZBNQcoQZnzH0F8BjpBgrAUQXWSL0EA7ztBAADwbju/rn2yPMNHLr+VriVBJss2QWQ4MEGPKiBB2yg3QfspNkGZpiVB81tVQWo7MUEAABkzt74SVyK+spRrv4KwFEF1ki9BAO87QbEuFEGzN1NBaf01QY8qIEHbKDdB+yk2QQAAvGmvuvc8K74dZXw/8f8qQXf100G3KctBCrNKQXVB1EEcPMtBbMVLQYfR5kFPYs5BAAClCec+x+OZPaCkYz9141lBdyjGQdTFyEFQA2NBQYK+QaEax0Hb/GZBy/zLQeD0xEEAAIyBer8YPNQ9bmE2Pu9rjUBxQKdAlZi+QY8Ug0AZ8GJAGDe4QYcqiEAdZBtAhmfEQQAAKtJ9v5orAD0DagE+hyqIQB1kG0CGZ8RBjxSDQBnwYkAYN7hBvxyEQBneFkD1l7xBAAC664g+mfEtvcNvdj9141lBdyjGQdTFyEEjEFdBS0nVQSbVyUFNikxBffzCQad8ykEAAPDsf7/1dhc8wXi2vBLQg0C/I5JA9WKzQWrbg0AY6YFAmjSxQY8Ug0AZ8GJAGDe4QQAAV5t/v83lTD0vF8M8wY6HQJGv3EDlfbNB15KFQDHEzkBhAaZBEtCDQL8jkkD1YrNBAABqJyE/8vL8PODARj9QA2NBQYK+QaEax0H3tW9BjLHDQf2/wUHb/GZBy/zLQeD0xEEAAHgx+747tRm++Lxbv7EuFEGzN1NBaf01QYKwFEF1ki9BAO87Qd3QCEE86T9B6tw/QQAA1iIrv9CGOL6Dtzi/4+r3QGx6UkFFI0dB3dAIQTzpP0Hq3D9BZqn/QNoMNkFppkpBAACw4x+/OrN4vs0DPr/d0AhBPOk/QercP0HAWgtBBJMKQeAtT0Fmqf9A2gw2QWmmSkEAAJUne79iiEU9CQpAPu9rjUBxQKdAlZi+QcGOh0CRr9xA5X2zQRLQg0C/I5JA9WKzQQAAF09QPg9/bj8SMJo+fic1QZ3kOULlRzRCDqYnQQVUOEILZztCb545QV8LOULuJjZCAABLGCw+KW9xP+7kkj4JXiFB0jo5QtZbOUIOpidBBVQ4QgtnO0J+JzVBneQ5QuVHNEIAAMdFAz/jgei+W4Q6P7NhJkFGTjVC/XU9QvdJH0Hk5DNCOtQ9QmdRKkGYyTNCbNI7QgAAw/rQPlu3ML987xg/oHUlQSixMkLTYjtCZ1EqQZjJM0Js0jtC90kfQeTkM0I61D1CAAAv7hw/Q8SPPvkNPT8kmWtBKcCMwJ7sEkLjN1VBRh+CwDwQF0K4o15BH1HDwPg0GEIAAI5/ED9RgYs+9XlHP7ijXkEfUcPA+DQYQuM3VUFGH4LAPBAXQrcoT0G0ZZbABQwZQgAAdCMKv8lFnj45eki/KtbLQHeENEJYcxZCSubeQJhEMkKy6xNC6KOYQNmgM0JZghpCAABA6qq+3rk2P9aeHb9AnaVAG1E2Qn4gG0KibdhACMY1QqsNF0Iq1stAd4Q0QlhzFkIAAGUfUD8D3AI+zW4RPzCVqEFLTofAZ4GPQdPQnkEQvorACq2dQVtuokFF75XAryGZQQAA2jVSP13bPz2FnRE/MJWoQUtOh8BngY9B08aoQW0cb8C85o5B09CeQRC+isAKrZ1BAAC8vro+iJDbPhKUUz9U0EZBCJFvwGn7F0K3KE9BtGWWwAUMGULjN1VBRh+CwDwQF0IAAOyziT6ec8g+OEdhP1qQQ0GFGJfAxPgZQrcoT0G0ZZbABQwZQlTQRkEIkW/AafsXQgAA+sspPV5O5D7c5GQ/VNBGQQiRb8Bp+xdCtskyQZ8WhcArCxlCWpBDQYUYl8DE+BlCAACkx868ljoXP7x0Tj9U0EZBCJFvwGn7F0JZpC9BmpxMwFMzFkK2yTJBnxaFwCsLGUIAAJ3XJ71tHKE+2sRyP1qQQ0GFGJfAxPgZQrbJMkGfFoXAKwsZQs0XMUF6oqTAclUaQgAAyZlqv64Wm74t8oU+4m+wPiLJCcBlXGlBrggkP2EzIMCYeHNBBi5SPkwd5r89IWhBAABVTWc++872vK1DeT8jEFdBS0nVQSbVyUEKs0pBdUHUQRw8y0FNikxBffzCQad8ykEAAJe/Ub81+Yc9e8gRP0O6BT8Xzt2/Fk9vQQYuUj5MHea/PSFoQa4IJD9hMyDAmHhzQQAAlIK3vlFHaL96/GC+EOjAQIeOMEKt9hhC04DcQLPNL0JmchZCzGHJQIQDMEJPehlCAAA9XeU+pkA2v9pyCj+gdSVBKLEyQtNiO0K2DixBrbkyQkEQOkJnUSpBmMkzQmzSO0IAAOPR+b4zakC/pj7jvvre2UDlujBCUT0VQtOA3ECzzS9CZnIWQhDowECHjjBCrfYYQgAAYIR8v0Hxu70hqwu+EtCDQL8jkkD1YrNB15KFQDHEzkBhAaZBLUuJQNewn0CqMqdBAAA1xHu/jHQSvmyO471VFYhAP55kQM/frEGPFINAGfBiQBg3uEFq24NAGOmBQJo0sUEAAN/yGL/f5je/dHW2vr0BLD8bohbAUA5nQVjhWD8L6zLAtZtwQeJvsD4iyQnAZVxpQQAAkdUmv0wMQT7SEzw/zmXjQB4oP0EuztBBO2zmQFsNiEEjF8dBmLjFQJqZTEHZf8hBAADRcE2/ckcYv3YgPj2uCCQ/YTMgwJh4c0Hib7A+IskJwGVcaUFY4Vg/C+sywLWbcEEAAOukfb+rdZ+92r3ivb8chEAZ3hZA9Ze8QY8Ug0AZ8GJAGDe4QVUViEA/nmRAz9+sQQAADcdTv2t+D78Tmhy9WOFYPwvrMsC1m3BBJk53P4KaP8A99XVBrggkP2EzIMCYeHNBAAByn5Y+AJw2PvRfcD9d3UpBM8TAwKBjGkK3KE9BtGWWwAUMGUJakENBhRiXwMT4GUIAADeS0D4MZxU+CMtmP13dSkEzxMDAoGMaQrijXkEfUcPA+DQYQrcoT0G0ZZbABQwZQgAA0vhXvwsDB7+EIc49Jk53P4KaP8A99XVBxpV4P8+HO8DF9ntBrggkP2EzIMCYeHNBAADwIkK/KwxGPihcHz+YuMVAmplMQdl/yEGfcLRA8URLQWtxw0Gjc8hAcFf5QGu/1UEAAOpMLLz1FZw9wT1/PxUtRUH3jNjA95kaQl3dSkEzxMDAoGMaQlqQQ0GFGJfAxPgZQgAA7KdTvoOdXr+BmOW+kCEMQD7Nh8B8SodBbOK2P/blV8DKL3lBku1DQPeak8BqzIlBAABeZBK/OhVMv4s2Rr6QIQxAPs2HwHxKh0G5rNY/tkRzwF3QhEFs4rY/9uVXwMoveUEAALYWCL+04VG/2dNZvijXnT8inlbAqMZ/QWzitj/25VfAyi95Qbms1j+2RHPAXdCEQQAAneM1vVvLUb+HQxK/2WIcQFYMX8AYfXpBku1DQPeak8BqzIlBbOK2P/blV8DKL3lBAAC88K0+BZEDvzqmSb/c6/U/9focwLpSaUEeE4w/Jy0XvwwtUEG5TuQ/ZflnPjZnTEEAAFL7MT54xBa/hA1Kv9zr9T/1+hzAulJpQdR7zT7pZ3m/tFBSQR4TjD8nLRe/DC1QQQAAsj7sPPt3Lr8RMju/3Ov1P/X6HMC6UmlBvQEsPxuiFsBQDmdB1HvNPulneb+0UFJBAADNjWy/68OhvphoXD7ib7A+IskJwGVcaUEGLlI+TB3mvz0haEGlIja9u4m6v/r4XkEAADR1Vj44k6893Ft5P0t3XEGFXLFBeVPKQXXjWUF3KMZB1MXIQU2KTEF9/MJBp3zKQQAAxbk0PzfPgr7ZGik/s2EmQUZONUL9dT1CZ1EqQZjJM0Js0jtC0NM5QQ6TNUKKXjhCAADQHzU/SniUvnv7JD/XrzhBGNQzQpDlN0LQ0zlBDpM1QopeOEJnUSpBmMkzQmzSO0IAAAw8Gz1XY989m0l+P80XMUF6oqTAclUaQswnNUHPdcTAXLsaQlqQQ0GFGJfAxPgZQgAAZdwXP9KgHb/fxAQ/1JEzQRqYMkJ6wjdCZ1EqQZjJM0Js0jtCtg4sQa25MkJBEDpCAACFqak9oeqkPSpJfj/MJzVBz3XEwFy7GkIVLUVB94zYwPeZGkJakENBhRiXwMT4GUIAABKeNj/N/Ac+CSgwP9DTOUEOkzVCil44QlwfKkE09DZCXSw8QrNhJkFGTjVC/XU9QgAA2YPFPnjwCz9IQz4/4zdVQUYfgsA8EBdC6+VJQW8TQcDYcRVCVNBGQQiRb8Bp+xdCAADuEx+/rKNyPqIuPz+YuMVAmplMQdl/yEGjc8hAcFf5QGu/1UHOZeNAHig/QS7O0EEAABVllT7yuWS/CtKuPqB1JUEosTJC02I7Qml8KUHJNTJCxkM5QrYOLEGtuTJCQRA6QgAA3TURP88PJb+IKgM/Z1EqQZjJM0Js0jtC1JEzQRqYMkJ6wjdC1684QRjUM0KQ5TdCAAApd7G+UUYTPyWqPT+IYytBNuqAwChJGEJZpC9BmpxMwFMzFkJnpR9BiGRJwGMsFEIAABt56T32aly/EMb9PqB1JUEosTJC02I7QvdJH0Hk5DNCOtQ9QsPjHEEo0DJC0RY8QgAAaOgwvozvDz9WCE8/iGMrQTbqgMAoSRhCtskyQZ8WhcArCxlCWaQvQZqcTMBTMxZCAABbc36/W2FMPUZvyL0S0INAvyOSQPVis0EtS4lA17CfQKoyp0Fq24NAGOmBQJo0sUEAAFY3e7+SJYS9faA5vi1LiUDXsJ9AqjKnQVUViEA/nmRAz9+sQWrbg0AY6YFAmjSxQQAAxsT+PO4Ad7/9l4U+oHUlQSixMkLTYjtCw+McQSjQMkLRFjxChHshQXkQMkL4LjlCAACk33+/e4qUPEs30rwC4IlAILkpQeeOk0HXkoVAMcTOQGEBpkHSXoZAysAYQW6wr0EAAPH+d7+sUcS96lNqvteShUAxxM5AYQGmQQLgiUAguSlB546TQd4pkkCXkiJBrUiMQQAAls1/v+yj57tNAB49wY6HQJGv3EDlfbNB0l6GQMrAGEFusK9B15KFQDHEzkBhAaZBAAA6Ehy/Cwy3vnAcNb+7ObpAb5MxQoo4GEJK5t5AmEQyQrLrE0L63tlA5bowQlE9FUIAACSR/76jJz2/zsHnvvre2UDlujBCUT0VQhDowECHjjBCrfYYQrs5ukBvkzFCijgYQgAAD2ILvyLhJj7/olK/rzGQQDvrNEKjdhtCKtbLQHeENEJYcxZC6KOYQNmgM0JZghpCAAD7D3S/VxY2PqG2eT5ovchASarEQZm6pkFYPelAmhPoQfarrEEnCN9AgXrmQTfco0EAAM7yHb/MpZg9So9Iv+ijmEDZoDNCWYIaQhcBd0Bc8jNCbGgdQq8xkEA76zRCo3YbQgAAelbSvr6vID9oRym/KtbLQHeENEJYcxZCrzGQQDvrNEKjdhtCQJ2lQBtRNkJ+IBtCAABZ8MO+wa5fvwetmb5ovnZAEdYyQsiRHkKINYpAFKIyQsLLHEK7ObpAb5MxQoo4GEIAADVid7/VoNG9Tq9xvt4pkkCXkiJBrUiMQVezjUAACcdAaIaeQdeShUAxxM5AYQGmQQAA23kWv5NC7L7PHCq/6KOYQNmgM0JZghpCuzm6QG+TMUKKOBhCiDWKQBSiMkLCyxxCAABMoBW/pWnZvmgBMb+7ObpAb5MxQoo4GELoo5hA2aAzQlmCGkJK5t5AmEQyQrLrE0IAAJIy5r53wky/5pXLvrs5ukBvkzFCijgYQoKRpUCLLjFC7O4bQmi+dkAR1jJCyJEeQgAA8bMRv4kI+r4mWCm/iDWKQBSiMkLCyxxCFwF3QFzyM0JsaB1C6KOYQNmgM0JZghpCAABp8fC+LIM1P1ByBr+eMiFADW82QgLSI0LsgFZAyRE3QnixIUJk325AwHw1QkQxHkIAAIEpdz2pgHe/NT1+PqB1JUEosTJC02I7QoR7IUF5EDJC+C45Qml8KUHJNTJCxkM5QgAA29WHPWHxfL/UaQ4+aXwpQck1MkLGQzlChHshQXkQMkL4LjlChessQfJiMUIOATNCAABR9me//uE/vhIzwr7IvZlAvJOmQMJXm0FXs41AAAnHQGiGnkHeKZJAl5IiQa1IjEEAAG3vTb9f42y+wBEMvya2pUCZVTBBLYCAQYPYw0AIVxJB6od3QU/0rEBemuVAw9iKQQAAjJubvnOpG74JxHA/xBYdQQfp1UEPO8lB8f8qQXf100G3KctBykEqQSba4EF8IM1BAABgeBE/FUUlv3WdAj/UkTNBGpgyQnrCN0JK2DhBXyAyQvmyNULXrzhBGNQzQpDlN0IAADjSpT6xZmS/Gy6hPtSRM0EamDJCesI3QrYOLEGtuTJCQRA6Qml8KUHJNTJCxkM5QgAAgAIdv/XSSTs7Mko/xBYdQQfp1UEPO8lBwA8LQdro1UE7O8JBvU8bQetpxEHbm8hBAAAGOcM+54ZRvxAP3D5pfClByTUyQsZDOUJK2DhBXyAyQvmyNULUkTNBGpgyQnrCN0IAACrajr5Y2Ta9cpF1P/H/KkF39dNBtynLQcQWHUEH6dVBDzvJQeBrK0Ec2cRBY4XKQQAADQxdv1DPW75JtOm+3imSQJeSIkGtSIxBT/SsQF6a5UDD2IpByL2ZQLyTpkDCV5tBAACPdVq/vqVXvjgs9L7eKZJAl5IiQa1IjEEmtqVAmVUwQS2AgEFP9KxAXprlQMPYikEAABgCGTcr0H2/KY8FPoXrLEHyYjFCDgEzQpshP0H53DBCmQYvQml8KUHJNTJCxkM5QgAADkNiv0NMAj5Je+Y+WD3pQJoT6EH2q6xBaL3IQEmqxEGZuqZBbz/pQK7P1kFYjrFBAAAjPaA+oT1hv3Iftz5pfClByTUyQsZDOUJ8qDxB94MxQqlcM0JK2DhBXyAyQvmyNUIAAD9QZr/6lCQ+idXPPm8/6UCuz9ZBWI6xQWi9yEBJqsRBmbqmQUoB0UDz0LFBicWyQQAAJrEPP1PIU7+REMI8MdufQVynpcDgzpVBCA+kQbFsmsAERZRBnD6gQaQepMDz/5lBAABn3lM/4WnWvkhbvz6cPqBBpB6kwPP/mUEID6RBsWyawARFlEFbbqJBRe+VwK8hmUEAAMIyQL+wI0w+1Dchv5UTBkAZazVCC4UlQp4yIUANbzZCAtIjQscML0DFZTRCxCQiQgAAmOYCP3DbW7+goP88MdufQVynpcDgzpVBnD6gQaQepMDz/5lBumybQcEqr8Dg95xBAABrQ2u+FLW7vDkVeT/EFh1BB+nVQQ87yUG9TxtB62nEQdubyEHgaytBHNnEQWOFykEAAJwixj35/3W/6cOEvrpsm0HBKq/A4PecQS1Hn0F8XJ/AQ8OPQTHbn0Fcp6XA4M6VQQAALbd0uwgNLr1ZxH8/CrNKQXVB1EEcPMtB8f8qQXf100G3KctB4GsrQRzZxEFjhcpBAACmPU48r+6/PVrafj/gaytBHNnEQWOFykHBkUpBHJ63QdORy0FNikxBffzCQad8ykEAAGEAObsG1TG98sF/P+BrK0Ec2cRBY4XKQU2KTEF9/MJBp3zKQQqzSkF1QdRBHDzLQQAAy5xAv96rAr8XLtW+/CcBQG1XNEJCZSdClRMGQBlrNUILhSVCxwwvQMVlNELEJCJCAACyCQO/JC1Pv9GNk75ovnZAEdYyQsiRHkL8JwFAbVc0QkJlJ0LHDC9AxWU0QsQkIkIAANufIL9C9A6/k+wKv8cML0DFZTRCxCQiQhcBd0Bc8jNCbGgdQmi+dkAR1jJCyJEeQgAA8z1Lv8wDGT7E4RY/bz/pQK7P1kFYjrFBSgHRQPPQsUGJxbJB037vQIKJtUGYGLxBAAC51hW/k/4yv5Ex0r6O0+E9q5Owv3xSWUG9ASw/G6IWwFAOZ0GlIja9u4m6v/r4XkEAAC8a4b2xKDG/96Q2v70BLD8bohbAUA5nQY7T4T2rk7C/fFJZQdR7zT7pZ3m/tFBSQQAAkJkZvwztMr/ZSMe+pSI2vbuJur/6+F5BvQEsPxuiFsBQDmdB4m+wPiLJCcBlXGlBAABuKnU/GwaBvjhvDj7JS4hB92iBwJIu9UGHKn9BndvjwG9KAkJi04dBXTKVwE9170EAAIx8Xr/x0Uc+ornoPmi9yEBJqsRBmbqmQQ9fo0A234FBkoqxQUoB0UDz0LFBicWyQQAA4spFPU6XfL9wCx8+fKg8QfeDMUKpXDNCaXwpQck1MkLGQzlCmyE/QfncMEKZBi9CAAAcOXQ/B3CUvgN+nD3JS4hB92iBwJIu9UFpq35BNGTYwFpHCUKHKn9BndvjwG9KAkIAAB738r5U860+xuBPPyb8J0GxcZ/AmGIZQohjK0E26oDAKEkYQs/VH0GEtYPAc74WQgAABBKPvgtIpT5Vfmc/JvwnQbFxn8CYYhlCtskyQZ8WhcArCxlCiGMrQTbqgMAoSRhCAAAKbVs/jNwDv7tGZbvAl4BB1lDcwHtb5kGHKn9BndvjwG9KAkK/jGtBobgSwZ3KB0IAADjvkL5csqY+AfNmPyb8J0GxcZ/AmGIZQs0XMUF6oqTAclUaQrbJMkGfFoXAKwsZQgAAfcZmP/6c3b44C0w7MY6EQWMsu8BI5epBhyp/QZ3b48BvSgJCwJeAQdZQ3MB7W+ZBAABgZ3e/J3/NvZA9cr5Xs41AAAnHQGiGnkEtS4lA17CfQKoyp0HXkoVAMcTOQGEBpkEAAEsARD/+rSK/t7nMPdChrEFdb3/AetaFQXTdsEHUW1zAJUqBQejnrUFLa3LAp2yGQQAABrsHv1ejlj6dkUs/JvwnQbFxn8CYYhlCz9UfQYS1g8BzvhZCJS4XQUlFocAgqxZCAACisWM/FESNvvySuj4Wk69BoORXwLPchEHo561BS2tywKdshkF03bBB1FtcwCVKgUEAABmutb6UBOU9bJ9tP80XMUF6oqTAclUaQib8J0GxcZ/AmGIZQpuyHkGJOcrATCQZQgAALzwKv013SD5dj1E/5o0VQbUKycDYlhdCJvwnQbFxn8CYYhlCJS4XQUlFocAgqxZCAAB4VWQ/0KWQvpfDtD7o561BS2tywKdshkEWk69BoORXwLPchEEePK1BKmFuwBaGiEEAAEeY6b7pzfk+ZYI+P4hjK0E26oDAKEkYQmelH0GIZEnAYywUQs/VH0GEtYPAc74WQgAAcl1qv/JhUL5itbG+LUuJQNewn0CqMqdBV7ONQAAJx0Bohp5ByL2ZQLyTpkDCV5tBAAAO6mq++iVRP5NwBz8j2wBBCE04QqwpOUJCGxZBH782QtvdPUIzZR1B+T44QmJXPEIAADgBrrsfFJU9N1F/P8GRSkEcnrdB05HLQeBrK0Ec2cRBY4XKQQo3KkGDkrZBTo/LQQAApLZtv3LjOD7CCKY+DeW+QN3Ew0EeLqBBaL3IQEmqxEGZuqZBJwjfQIF65kE33KNBAADRVvi+e9aCPkkZVj//d/1A7yQ3QjpbOkLuOvtAnrE1QiSjOkJCGxZBH782QtvdPUIAAFYjeL/HBlg+0moBPicI30CBeuZBN9yjQe7PvkB04MdBSSqZQQ3lvkDdxMNBHi6gQQAANhZ4vxvpej5Ml+s8JwjfQIF65kE33KNB/WXQQEta2UELa5hB7s++QHTgx0FJKplBAADJbJu+pIQ/Pw0OFz//d/1A7yQ3QjpbOkJCGxZBH782QtvdPUIj2wBBCE04QqwpOUIAADrz7L3UQHQ/jGiNPgleIUHSOjlC1ls5QiPbAEEITThCrCk5QjNlHUH5PjhCYlc8QgAAuLt2v3z3cj4kDPm9/WXQQEta2UELa5hBkKe8QOa1vUG7molB7s++QHTgx0FJKplBAAA/9W++MaakPf4EeD+9TxtB62nEQdubyEEKNypBg5K2QU6Py0HgaytBHNnEQWOFykEAACU4+b7cNrI9aYNePxjuEUHsQ7VBoH/HQT01GUH8obJByczJQb1PG0HracRB25vIQQAAcxT7vmLYtD3g9F0/GO4RQexDtUGgf8dBvU8bQetpxEHbm8hBwA8LQdro1UE7O8JBAAB+Uco+GkxeP0Zzmb6KkVRBybczQkSHBELK7VNBDMcwQryY90FWOkhB8qgyQnjK+kEAAFPYFj4GEnM/odqNvi5uPkFggTVCNdgFQh4eTkHgRTRCyLQDQlY6SEHyqDJCeMr6QQAAkCJev1uBV74mj+a+vYurQKIQm0BiHJRB9yW2QFeLaUA4epNByL2ZQLyTpkDCV5tBAABjATY/G6u8PlBVGT/T0J5BEL6KwAqtnUHTxqhBbRxvwLzmjkG+w5pBWgdOwEj9nEEAAIWaOD+MkYo+NUUjP88iskFbRQvA3At+Qb7DmkFaB07ASP2cQdPGqEFtHG/AvOaOQQAA+tQbP+B4AD8SUB0/vsOaQVoHTsBI/ZxBzyKyQVtFC8DcC35BqISdQUtQA8BzopJBAABbCnA/AHOwvs6FOD0xjoRBYyy7wEjl6kFi04dBXTKVwE9170GHKn9BndvjwG9KAkIAALd/bb/bcxa+Ha2vvsi9mUC8k6ZAwlebQVUViEA/nmRAz9+sQS1LiUDXsJ9AqjKnQQAAYHZpv4VZPL5ExLu+VRWIQD+eZEDP36xByL2ZQLyTpkDCV5tBie6zQNTOfT8q+JtBAADHJl6/fvlUvkAV5769i6tAohCbQGIclEHIvZlAvJOmQMJXm0FP9KxAXprlQMPYikEAADVNoT7qQWU/NeegPuOnSkHNM5tB8N/ZQdg5RUE1k5lB0DvhQZulSUEfJJZBnc3oQQAApL4GPx9TUj+PQ2A+2DlFQTWTmUHQO+FB7CNEQT/tlkETeexBm6VJQR8klkGdzehBAAAabiM/mNnSPkF4Jj/PIrJBW0ULwNwLfkHhwadBsckAv2+8gEGohJ1BS1ADwHOikkEAAKUYSz/rYBE/+JpgPuOnSkHNM5tB8N/ZQZulSUEfJJZBnc3oQd+3TUFPj5hBmC3bQQAAXEJRPzB8hT0shRI/08aoQW0cb8C85o5BHjytQSphbsAWhohBFpOvQaDkV8Cz3IRBAAAu4Ew/hJ4QPisuFT8Wk69BoORXwLPchEHPIrJBW0ULwNwLfkHTxqhBbRxvwLzmjkEAAHA1fjs3OHo/5FZYPv3DMUE1splBJNrgQWZbNkGtbZdBIk3rQdg5RUE1k5lB0DvhQQAA2NK/Puh4XT8vuqq+yu1TQQzHMEK8mPdBjIJLQRC7LkILP+hBVjpIQfKoMkJ4yvpBAABE6LK7Z5FnP9JE2j7YOUVBNZOZQdA74UGrfzJBCuicQYgL2kH9wzFBNbKZQSTa4EEAAN09Ury0l2Y/EEjePr03REFtNp1B7qvZQat/MkEK6JxBiAvaQdg5RUE1k5lB0DvhQQAAtMURPWLZaz81Rsa+VjpIQfKoMkJ4yvpBjIJLQRC7LkILP+hB/joyQfhaL0KCDupBAAAxUPU+IJRNP+BstT69N0RBbTadQe6r2UHYOUVBNZOZQdA74UHjp0pBzTObQfDf2UEAANiDJj/SFUC/v5jxvXTdsEHUW1zAJUqBQdChrEFdb3/AetaFQfCRrkHQOWvAsnSAQQAAPZvevraCAz8FWT0/4SjaQPsbNkITezhC/3f9QO8kN0I6WzpCUp7gQGMDOEIKojdCAAB9C9u+3V2APiFPXj/uOvtAnrE1QiSjOkL/d/1A7yQ3QjpbOkLhKNpA+xs2QhN7OEIAACPejL6opj8/DGsaP/93/UDvJDdCOls6QiPbAEEITThCrCk5QlKe4EBjAzhCCqI3QgAA9hF5v7zrSj4FgvM97s++QHTgx0FJKplBYzuvQAQys0HxwptBDeW+QN3Ew0EeLqBBAABIF0W/y3SLvja/E7+9i6tAohCbQGIclEFP9KxAXprlQMPYikGXhsdAr0W1QAuwh0EAADSCc79p5IU+GrQnvtb480AkE/xBNTWcQRHe3UBdmdpB2tmGQf1l0EBLWtlBC2uYQQAALrxzv/4YhD6/ISi+Ed7dQF2Z2kHa2YZBkKe8QOa1vUG7molB/WXQQEta2UELa5hBAACCyGS/5BjWPuaaJr4frxZBZhcvQjkjAkL3hxRB/JgvQh5lBkI0QxlBbmczQkeuCUIAADVFYb5+KGw/DWeivn+XJUGCBjVCw88HQmt/J0F40S5CgtvqQZ/vIUFCjTJCWUABQgAAPZoSvULzbz8xfrG++Y0sQfm4M0KX+wBCVjpIQfKoMkJ4yvpB/joyQfhaL0KCDupBAAC8sr+8xgNyPyJ7pr5WOkhB8qgyQnjK+kH5jSxB+bgzQpf7AEIubj5BYIE1QjXYBUIAAFGkHL/rdko/05suPMCxQEEWJde/sA4NQiDYQEGi/9a/q94OQl/rRUHtN7e/WwQOQgAAANPMvlgZLz+6Khw/fKxHQe/z1b+rYQ9CulZJQYZxfL+dlAxCX+tFQe03t79bBA5CAADR9ju/VidXvqpDJb+rQcNA38/HPy+Wk0GXhsdAr0W1QAuwh0FuBepA69O0QLPUe0EAAC9vT78zHkC+mCAOv72Lq0CiEJtAYhyUQZeGx0CvRbVAC7CHQfcltkBXi2lAOHqTQQAAOWBUv204Kr73dQi/l4bHQK9FtUALsIdBq0HDQN/Pxz8vlpNB9yW2QFeLaUA4epNBAABJF3m/6JwnvmWOJr6K7Y1A5BfFP99+tEG/HIRAGd4WQPWXvEFVFYhAP55kQM/frEEAAHjder8DC0q+hVTlPAn5l0CFKLa+rGvRQb8chEAZ3hZA9Ze8QbrZmEB9fzC/qknGQQAAVq9iP0h2676nFYg9wJeAQdZQ3MB7W+ZBvISFQe4wvcAKktpBMY6EQWMsu8BI5epBAACuimk/8vXHvujA/D213YFBSuzWwD824UG8hIVB7jC9wAqS2kHAl4BB1lDcwHtb5kEAAJ7UaD/15cy+kX7mPbsZg0E7SNLAjVzbQbyEhUHuML3ACpLaQbXdgUFK7NbAPzbhQQAABkkcP1KhSr+3oOa8td2BQUrs1sA/NuFB95h8QZYc4cBmeNtBuxmDQTtI0sCNXNtBAACq1m2/ffg0PnVlpj5ovchASarEQZm6pkEN5b5A3cTDQR4uoEFBKZdAt+mIQQTKo0EAAEA0RT+GfyG/4CO+vdvdb0EX/AfB40D2QfeYfEGWHOHAZnjbQcCXgEHWUNzAe1vmQQAArrErvkZUcj+T/4w+B6X/QHFaOUJVYzVCUp7gQGMDOEIKojdCI9sAQQhNOEKsKTlCAACc3uy9xiZ8P/5jAz4j2wBBCE04QqwpOUIJXiFB0jo5QtZbOULi9iFBCbY5QnLMNUIAANh+Wr1OAHY/2gmLPgel/0BxWjlCVWM1QiPbAEEITThCrCk5QuL2IUEJtjlCcsw1QgAAB+F2vwchMz7iOUs+QSmXQLfpiEEEyqNBDeW+QN3Ew0EeLqBBYzuvQAQys0HxwptBAAAcOXW/QwFVPuOeSr794KtANBWnQbMehkGQp7xA5rW9QbuaiUFx1bZABnyqQRbgeEEAAHzueb8n5Uc+hni/vf3gq0A0FadBsx6GQWXgo0AxwqRBeyiWQe7PvkB04MdBSSqZQQAANep5v90SSD5zHsC9kKe8QOa1vUG7molB/eCrQDQVp0GzHoZB7s++QHTgx0FJKplBAAC6c3u/u3g/PiAUgjxjO69ABDKzQfHCm0Huz75AdODHQUkqmUFl4KNAMcKkQXsolkEAADqPVD9oytO+pza/PggPpEGxbJrABEWUQTCVqEFLTofAZ4GPQVtuokFF75XAryGZQQAAOwE0P6/3GD+XVcU+my1RQT4Um0HGHdRB46dKQc0zm0Hw39lB37dNQU+PmEGYLdtBAADNIGg/Io6MPn/foz7ft01BT4+YQZgt20E0DVFBUhiVQZ1t2UGbLVFBPhSbQcYd1EEAADh3L7+Bey8/jYN7vu9NHEEtfi5Cd7TzQTRDGUFuZzNCR64JQp/vIUFCjTJCWUABQgAAY6lAPJ+zTT9UXBg/vTdEQW02nUHuq9lB/HhFQQhfoEEPZdVBJe4xQYd7oEEDcNVBAAD67BK/+1NCP5dLnb6f7yFBQo0yQllAAUJrfydBeNEuQoLb6kHvTRxBLX4uQne080EAAKc4IT+cfEa/+cpBvbXdgUFK7NbAPzbhQcCXgEHWUNzAe1vmQfeYfEGWHOHAZnjbQQAAaJakvo4fX7/nhb0+w+McQSjQMkLRFjxCqYcUQRgrNEIUdz1Cc/YIQUhlNEIxfTtCAAC0cgS/XX9OP5RRkr5/lyVBggY1QsPPB0L5jSxB+bgzQpf7AEJrfydBeNEuQoLb6kEAAG08YL95AOU+ujM5vh+vFkFmFy9COSMCQjRDGUFuZzNCR64JQu9NHEEtfi5Cd7TzQQAAXMr5vn1y9L48FDs/qYcUQRgrNEIUdz1CbJ8QQcJ/NUK0rj1C7jr7QJ6xNUIkozpCAAADe/W+0jbTPqFJRj9snxBBwn81QrSuPUJCGxZBH782QtvdPULuOvtAnrE1QiSjOkIAAN0K8r53XyC/3aYeP+46+0CesTVCJKM6QnP2CEFIZTRCMX07QqmHFEEYKzRCFHc9QgAAx7dnP85zx77mPS4+uxmDQTtI0sCNXNtB+w2FQT6fzMDNNNRBvISFQe4wvcAKktpBAACld3u/X4ciPmvVy71l4KNAMcKkQXsolkH94KtANBWnQbMehkGeNJhADDyOQRIJj0EAAG92fL/l4sS9vCcKPgn5l0CFKLa+rGvRQYcqiEAdZBtAhmfEQb8chEAZ3hZA9Ze8QQAANOBLv7BMWj4T4xA/O6vCQL2Bg0H+K79B037vQIKJtUGYGLxBSgHRQPPQsUGJxbJBAACgRTG/64JKPredMT/Tfu9Agom1QZgYvEE7q8JAvYGDQf4rv0GoPv1AsIqqQTCpwkEAALqJNL/Gw1A+ZtUtP6g+/UCwiqpBMKnCQTurwkC9gYNB/iu/QTts5kBbDYhBIxfHQQAAr3xxvydAl75B9hq+YWO1QOpyC8ByE7FButmYQH1/ML+qScZBiu2NQOQXxT/ffrRBAACimgQ8+YS8PoMBbj8W9kFBVWaavwDyDEK6VklBhnF8v52UDEJscjhBN0WAv4SkDEIAALuPKL+nCR0+mKE8Pxb2QUFVZpq/APIMQsCxQEEWJde/sA4NQl/rRUHtN7e/WwQOQgAALPAzvi7wKj+yLjk/ulZJQYZxfL+dlAxCFvZBQVVmmr8A8gxCX+tFQe03t79bBA5CAACDf1E/EORCPWKfEj8ePK1BKmFuwBaGiEHTxqhBbRxvwLzmjkEwlahBS06HwGeBj0EAALuMRjzMFWk9/JB/P8CxQEEWJde/sA4NQhb2QUFVZpq/APIMQo1ENkEz6te/IxcNQgAASf+FvXzRMT68jXs/FvZBQVVmmr8A8gxCbHI4QTdFgL+EpAxCjUQ2QTPq178jFw1CAABnJdU+MgeGPYooaD+NRDZBM+rXvyMXDUJscjhBN0WAv4SkDEIUNjJBDmGov+ByDUIAAN34b76QYWc/gky3vvmNLEH5uDNCl/sAQv46MkH4Wi9Cgg7qQWt/J0F40S5CgtvqQQAAK6C+uso4Sj9z+hw/vTdEQW02nUHuq9lBJe4xQYd7oEEDcNVBq38yQQronEGIC9pBAABoYVM/RgLwvvepoD4wlahBS06HwGeBj0EID6RBsWyawARFlEEv7KdBc+2PwNEFjkEAAKryvjz4OGQ/KKXnvjfrLUFOXStCzDfaQf46MkH4Wi9Cgg7qQYyCS0EQuy5CCz/oQQAAnXocP1uXSr9N4So8uxmDQTtI0sCNXNtB95h8QZYc4cBmeNtB+w2FQT6fzMDNNNRBAABzbHY/8IGKvhNlejyJfGRBc+wpQu+a/kFCsWdBd0ItQhnfB0JOi2VB51srQicOCEIAAC8ufj9eyfK9Ee8svJI4ZEHmFylCcGICQol8ZEFz7ClC75r+QU6LZUHnWytCJw4IQgAArehjP4Km1L5CWj8+vISFQe4wvcAKktpB+w2FQT6fzMDNNNRBGdOHQd9AwsBexcxBAAAJFmQ/1TDQvnD0Tj7X2FxBl8spQlHdC0IwH1VBU54nQrb/D0LC5WNBuBUmQghC+UEAAIFPYz+PRtO+ORlQPpI4ZEHmFylCcGICQtfYXEGXyylCUd0LQsLlY0G4FSZCCEL5QQAA0LRlP7bSzL5NHj8+2VCJQeOBtcCJbsxBvISFQe4wvcAKktpBGdOHQd9AwsBexcxBAAA9gRo/waxLvwwnV737DYVBPp/MwM001EHWg4RBNgvNwGGaz0EZ04dB30DCwF7FzEEAAGbOb7/MtqW+gHMIvrrZmEB9fzC/qknGQWFjtUDqcgvAchOxQRPLtUB7iTTAy9a8QQAAShV3v7RFeb5oWMS9vxyEQBneFkD1l7xBiu2NQOQXxT/ffrRButmYQH1/ML+qScZBAAC9Sm2/eLJlvpgGmr6K7Y1A5BfFP99+tEFVFYhAP55kQM/frEFvOLdAMQKOv7d9pEEAAJ6Ybr8i65C+2sZnvortjUDkF8U/3360QW84t0AxAo6/t32kQWFjtUDqcgvAchOxQQAA0nsvP60d+T1mxTc/8wVuQSwOrEGlj8ZBGUF8QdOKtkFP/b1B97VvQYyxw0H9v8FBAAA85RA/dnQUPlrCTz/zBW5BLA6sQaWPxkH3tW9BjLHDQf2/wUFQA2NBQYK+QaEax0EAACE45D7DyNo9GIZjP/MFbkEsDqxBpY/GQVADY0FBgr5BoRrHQUt3XEGFXLFBeVPKQQAA2a+kvopyYb8QF7I+fHYLQX1YM0KeaDlCw+McQSjQMkLRFjxCc/YIQUhlNEIxfTtCAADB6/Q+RkDCPaB+Xz9QA2NBQYK+QaEax0F141lBdyjGQdTFyEFLd1xBhVyxQXlTykEAAOhOTL7zyGW/kEHJPnqC8kDaiDNCkIc3Qnx2C0F9WDNCnmg5QnP2CEFIZTRCMX07QgAAO5SevjdcUb+RVfg+eoLyQNqIM0KQhzdCc/YIQUhlNEIxfTtCWgbtQFudNEKz6ThCAAC6NOS+Mzv0vhLrQT/uOvtAnrE1QiSjOkJaBu1AW500QrPpOEJz9ghBSGU0QjF9O0IAAOhxb7/fXKy+z7HevbrZmEB9fzC/qknGQRPLtUB7iTTAy9a8QYIQv0BkB4LACK3HQQAAHcB8v1SwA74C4749Vpu8QAnqg8BlhMBBghC/QGQHgsAIrcdBE8u1QHuJNMDL1rxBAAAp13q/9Hw+vj4Rlb1Wm7xACeqDwGWEwEETy7VAe4k0wMvWvEFhY7VA6nILwHITsUEAAF08er98SEC+oyPFPX8HxUBUl5jAuNDLQYIQv0BkB4LACK3HQVabvEAJ6oPAZYTAQQAANKZ6v0BNGz3nnUw+Vpu8QAnqg8BlhMBBzwO/QOuLtMAixsVBfwfFQFSXmMC40MtBAAAPXly/xl5FPuwo8T4PX6NANt+BQZKKsUE7q8JAvYGDQf4rv0FKAdFA89CxQYnFskEAAETZb7/r5jc+VI6ZPmi9yEBJqsRBmbqmQUEpl0C36YhBBMqjQQ9fo0A234FBkoqxQQAAbsM5PrrqJT/ZVz0/CUhXQZnMrj+17AJCsj9KQTkV5z+6LgJC1dRKQTiC0TyTYghCAAAPu38/8dE3veNeGjzC5WNBuBUmQghC+UGJfGRBc+wpQu+a/kGSOGRB5hcpQnBiAkIAAPQYPTyl5iY/UBdCP7I/SkE5Fec/ui4CQvMkJ0Gp7SBA8MD/QZ/ZLkGf09I+hRQHQgAAQoORO+gtKD/xAEE/n9kuQZ/T0j6FFAdC1dRKQTiC0TyTYghCsj9KQTkV5z+6LgJCAACcD6I+O85yv2j/e7z7DYVBPp/MwM001EGm3ntBYpXVwPvWy0HWg4RBNgvNwGGaz0EAAG3e8T4KYF2/84guvvsNhUE+n8zAzTTUQfeYfEGWHOHAZnjbQabee0FildXA+9bLQQAAFQQOP2k4Ur8bGwm+GdOHQd9AwsBexcxB1oOEQTYLzcBhms9BRmiEQahMx8BsWcZBAAB/cSU/BytDv3uRCT0v84dBEIbCwE/TyEGONYtBpfC3wKwrxkEZ04dB30DCwF7FzEEAADHj4r767PW+BMVBP1oG7UBbnTRCs+k4Qu46+0CesTVCJKM6QuEo2kD7GzZCE3s4QgAAM+HvPj3tBz+xwjQ/cetsQVPFo78OLwhCMv1oQTD2kT+xjgFCCDxYQaBzTr8+MQpCAACri8i+HgrAvsUVVz/hKNpA+xs2QhN7OEItwNBATxA0Qu0EN0JaBu1AW500QrPpOEIAANseGT96+ky/55cJPS/sp0Fz7Y/A0QWOQQgPpEGxbJrABEWUQcNMpEFcgZrAv36PQQAA1DAQP0ZfU79azwI9w0ykQVyBmsC/fo9BCA+kQbFsmsAERZRBMdufQVynpcDgzpVBAACmYTS/8uFLPoRbLj+YuMVAmplMQdl/yEE7bOZAWw2IQSMXx0E7q8JAvYGDQf4rv0EAAMEPaL7MVnm/Mm0BO4R7IUF5EDJC+C45Qnx2C0F9WDNCnmg5QoXrLEHyYjFCDgEzQgAAW59evupndr8JBCY+fHYLQX1YM0KeaDlChHshQXkQMkL4LjlCw+McQSjQMkLRFjxCAAD7ghi+wdV1v2aTcT56gvJA2ogzQpCHN0ItwNBATxA0Qu0EN0Lqu9tAq/MyQi9cM0IAAMMhYD9mWcG+FVaaPo41i0Gl8LfArCvGQdlQiUHjgbXAiW7MQRnTh0HfQMLAXsXMQQAAi6cBPyaCBT+XyS8/cetsQVPFo78OLwhCZ+5yQbPBmb2eagNCMv1oQTD2kT+xjgFCAADyGRU/rwfyPglLKT9n7nJBs8GZvZ5qA0Jx62xBU8Wjvw4vCEJr83pBZHDjv0KEBkIAAJ16ZD5PCCE/rqI+PwlIV0GZzK4/tewCQtXUSkE4gtE8k2IIQgg8WEGgc06/PjEKQgAA13iwPpCbGz9TITc/Mv1oQTD2kT+xjgFCCUhXQZnMrj+17AJCCDxYQaBzTr8+MQpCAAAYgAi+fQl3v61QZz7qu9tAq/MyQi9cM0J8dgtBfVgzQp5oOUJ6gvJA2ogzQpCHN0IAAHxQWj5Wu3C/3rmHvi1Hn0F8XJ/AQ8OPQcNMpEFcgZrAv36PQTHbn0Fcp6XA4M6VQQAAJlUKvjcHW79R3f++IZycQfxsj8DQqYlBLUefQXxcn8BDw49BO+mVQZAkoMAfoZJBAACSHMQ86sY0P2AoNT9scjhBN0WAv4SkDELV1EpBOILRPJNiCEKf2S5Bn9PSPoUUB0IAAOlqQr/vJTg+tA4gPzurwkC9gYNB/iu/QZ9wtEDxREtBa3HDQZi4xUCamUxB2X/IQQAAqHpav98aMD7B6Ps+n3C0QPFES0FrccNBO6vCQL2Bg0H+K79BKcCZQIvOQEGmsrlBAAC4+JK9wU1/P/CeiTzXXCVBofY5Qtv1K0L2ZjxBQEs6QjHxMEL39zxBy2k6QhJ3KkIAAJbPXL9buTU+eJvyPinAmUCLzkBBprK5QTurwkC9gYNB/iu/QQ9fo0A234FBkoqxQQAA3H2fO6OufT+eZAk+4vYhQQm2OUJyzDVCCV4hQdI6OULWWzlCfic1QZ3kOULlRzRCAAAzqyk/x9wmv8a8vD7QoaxBXW9/wHrWhUHo561BS2tywKdshkEePK1BKmFuwBaGiEEAAL+lVj8Y++q+FXKWPi/sp0Fz7Y/A0QWOQR48rUEqYW7AFoaIQTCVqEFLTofAZ4GPQQAAKRZUPyecA78RemM+L+ynQXPtj8DRBY5B0KGsQV1vf8B61oVBHjytQSphbsAWhohBAAD/VXO/2c6oPVhXmT4EP7ZAm4WrwA0yvkHPA79A64u0wCLGxUFWm7xACeqDwGWEwEEAAIMgcj8Ev4K+72ZNPsLlY0G4FSZCCEL5QTAfVUFTnidCtv8PQuTXZUHg1CBCekvnQQAAuh9wP1sRj76yHlI+5NdlQeDUIEJ6S+dBMB9VQVOeJ0K2/w9CN4pXQeIkIEKfDgNCAAAE2yg/Rbs/v2yygT0v84dBEIbCwE/TyEESx4pBYWS7wJZ1wEGONYtBpfC3wKwrxkEAAOljqTgsLH4/X0X0PfZmPEFASzpCMfEwQuL2IUEJtjlCcsw1Qn4nNUGd5DlC5Uc0QgAAzvo4vfcZfz8OW5A94vYhQQm2OUJyzDVCvzwGQT3OOUJNBTBCB6X/QHFaOUJVYzVCAADdMZe9DkF/P/JBnTzi9iFBCbY5QnLMNUL2ZjxBQEs6QjHxMELXXCVBofY5Qtv1K0IAAKFCQj5CPJ095JR6P8GRSkEcnrdB05HLQUt3XEGFXLFBeVPKQU2KTEF9/MJBp3zKQQAAB5mNPg4kVj6pHnA/wZFKQRyet0HTkctBuNVQQUTXp0HUKc5BS3dcQYVcsUF5U8pBAAB8BGa/z8DVvkLfCj7PA79A64u0wCLGxUEEP7ZAm4WrwA0yvkF7NbtATimzwD6JwEEAAH2DlD4nIFg+HPZuP7jVUEFE16dB1CnOQcGRSkEcnrdB05HLQS5JSUFwL6tBgpTOQQAAn8R+v/Jjprx+UcQ9YWO1QOpyC8ByE7FBFnq2QL2aSMAnSLJBVpu8QAnqg8BlhMBBAADUsnS/9LWzPSiVjz5Wm7xACeqDwGWEwEGygq9ArdKRwBZytkEEP7ZAm4WrwA0yvkEAAAF4az8cMbc+qPQkvsSsY0E9ux5CrUTFQZYOXUG+gihC/NDdQR0vYkH6pS5C9NsDQgAAYm1qP83nuz5qdie+AlBcQdDuLkJ8jvhBHS9iQfqlLkL02wNClg5dQb6CKEL80N1BAAAMQCs/9VUvP/ffk74Hu1ZBpgssQuZl5EHK7VNBDMcwQryY90ECUFxB0O4uQnyO+EEAAMmFQT8kGRg/irqMvgJQXEHQ7i5CfI74QZYOXUG+gihC/NDdQQe7VkGmCyxC5mXkQQAA2q03up9DOD8XtzE/ulZJQYZxfL+dlAxC1dRKQTiC0TyTYghCbHI4QTdFgL+EpAxCAACpVZs+ZBUsP+fjLD/V1EpBOILRPJNiCEK6VklBhnF8v52UDEIIPFhBoHNOvz4xCkIAAE8yATwqf32/cJ8OPoXrLEHyYjFCDgEzQpRfOkGwJTBCvwAqQpshP0H53DBCmQYvQgAAOEwQP71lUr8sKKm90KGsQV1vf8B61oVBL+ynQXPtj8DRBY5BqnupQYT+iMCybIdBAABF0xA/XQ5Svwdxp73DTKRBXIGawL9+j0Gqe6lBhP6IwLJsh0Ev7KdBc+2PwNEFjkEAAPDaez+oUwG+2DQCPol8ZEFz7ClC75r+QcLlY0G4FSZCCEL5QeTXZUHg1CBCekvnQQAAiVQzvX4BSb/ZIh6/S4SpQXpyesAWp4FBC1yjQRgte8B0NIJBXmOsQd1OUsCnJHZBAADVllq/4wU2PrV4+j4NiZpAF3cXQR2NwUGfcLRA8URLQWtxw0EpwJlAi85AQaayuUEAANPnfz/3gdE8VMwVPIl8ZEFz7ClC75r+QeTXZUHg1CBCekvnQVhDZkHD1B9CHPLVQQAAxYMCPyWvVb8cNFW+qnupQYT+iMCybIdB8JGuQdA5a8CydIBB0KGsQV1vf8B61oVBAABEiMI+utNpv2etFb7Wg4RBNgvNwGGaz0Gm3ntBYpXVwPvWy0FGaIRBqEzHwGxZxkEAAKkamz5Z4XO/OnzUPEZohEGoTMfAbFnGQS/zh0EQhsLAT9PIQRnTh0HfQMLAXsXMQQAARYdwvyW9Ej63M58+KcCZQIvOQEGmsrlBD1+jQDbfgUGSirFBts+MQNdcQEGRBrBBAACkiHK/p0cVPoPikT5BKZdAt+mIQQTKo0G2z4xA11xAQZEGsEEPX6NANt+BQZKKsUEAAFu4er+qoOY9ZMgrPrbPjEDXXEBBkQawQUEpl0C36YhBBMqjQXrih0A9ZktBdSGlQQAA5IBxv70w4T0IP6A+KcCZQIvOQEGmsrlBts+MQNdcQEGRBrBBDYmaQBd3F0EdjcFBAADdmW2/3kcPPr6esD62z4xA11xAQZEGsEHf4ItAUIQPQfJNuUENiZpAF3cXQR2NwUEAAFp4Bb0kKH8/qhaYPQA7pUBERjlClnwxQgel/0BxWjlCVWM1Qr88BkE9zjlCTQUwQgAAvYl6vyIduz25czw+euKHQD1mS0F1IaVB0l6GQMrAGEFusK9B3+CLQFCED0HyTblBAADtyny/X3mDPe2bEz62z4xA11xAQZEGsEF64odAPWZLQXUhpUHf4ItAUIQPQfJNuUEAAODrHL02h38/IMdAvaueykCXDzlCVu0mQr88BkE9zjlCTQUwQuOCIEG8cTlCswIjQgAAa7J7v2JAIT7QO709YzuvQAQys0HxwptBZeCjQDHCpEF7KJZBQSmXQLfpiEEEyqNBAACJb+y7yel/P0LrzDy/PAZBPc45Qk0FMELi9iFBCbY5QnLMNULXXCVBofY5Qtv1K0IAAGW/Pb1x936/83WdPeq720Cr8zJCL1wzQqcIiEAiVjJCtBUlQsZ3CkES5TFCy/kpQgAAuK19v1idCD7uw4K8ZeCjQDHCpEF7KJZBnjSYQAw8jkESCY9B28ePQJnNf0Eq/plBAAAJedw++PFav1Wbk75i3G1ByOv4wO+V20Eg5HFBCYjXwAfVxUGm3ntBYpXVwPvWy0EAAMIJfb9gBBA+06JoPUEpl0C36YhBBMqjQWXgo0AxwqRBeyiWQdvHj0CZzX9BKv6ZQQAA91lxv2dSlz6GCB6+94cUQfyYL0IeZQZCH68WQWYXL0I5IwJCta4SQfHoKkK7PQBCAAAQclC/dWAPvxlwHD5UABNB+UApQttHAkKNhh9BSJ0nQmT1DEL8wRFBY1krQjNOCEIAALrpSj/tTBu/J/d5vcCXgEHWUNzAe1vmQb+Ma0GhuBLBncoHQtvdb0EX/AfB40D2QQAAeq7TPscBZb8/4C2+CLZZQbgJHcGibwNChklfQWxIFME8mfZB189jQWdZGMG/aANCAABp72M+lHtevzEw4r5LhKlBenJ6wBangUHwka5B0DlrwLJ0gEGqe6lBhP6IwLJsh0EAAOnZxD4EMCs/wOsiPygdMkHZZ7+/MjgOQhQ2MkEOYai/4HINQnf0LkFAnIu/8/4MQgAATcYRvbHtV7/5Ngm/C1yjQRgte8B0NIJBS4SpQXpyesAWp4FBLUefQXxcn8BDw49BAACMPA69I/dXv9ErCb8tR59BfFyfwEPDj0EhnJxB/GyPwNCpiUELXKNBGC17wHQ0gkEAAC82TT6my2i/W6i6vsNMpEFcgZrAv36PQS1Hn0F8XJ/AQ8OPQap7qUGE/ojAsmyHQQAA6EdKP+no3j6N39w+KB0yQdlnv78yOA5CjUQ2QTPq178jFw1CFDYyQQ5hqL/gcg1CAAAn7hc/rgpOP6jg/LiNRDZBM+rXvyMXDUIoHTJB2We/vzI4DkJ8JTZBvTDXv57lDkIAAAtL7z0jlGK/Rq7mvkuEqUF6cnrAFqeBQap7qUGE/ojAsmyHQS1Hn0F8XJ/AQ8OPQQAAoppCPzLJ9D7rQeE+2kWNQRQoqr9u/6BBQzWQQQl1N8ArSqlBT9WQQWWM079EqJ1BAADqOGc9VJf6PhrGXj939C5BQJyLv/P+DEIUNjJBDmGov+ByDUJscjhBN0WAv4SkDEIAAOkiZL+J1NC+HXZLPlXjEkE2fCZC1vD4QY2GH0FInSdCZPUMQlQAE0H5QClC20cCQgAAgDltv6GqKD6gAK0+BD+2QJuFq8ANMr5BsoKvQK3SkcAWcrZBkmGwQEVLrMC8RLpBAADjNUk/wmEgPi0cGT9m01dBMSycQYF+z0FciFVBRlWVQcHK0kGlsllB+jWMQa1x0kEAAEcE3z43vUA+LVhhP59CaUHZgoZB+c/PQWbTV0ExLJxBgX7PQaWyWUH6NYxBrXHSQQAA3t5/v59g2bwye488VeMSQTZ8JkLW8PhBVAATQflAKULbRwJCta4SQfHoKkK7PQBCAAANRk+/m3HzvggnsD4HpbhAxDe4wLICu0GSYbBARUuswLxEukENsK9ALmW3wGkGtkEAAE4XUL+5ufa+LYWnPgeluEDEN7jAsgK7QQQ/tkCbhavADTK+QZJhsEBFS6zAvES6QQAAd1AhvuChe7+wcsI9hessQfJiMUIOATNCfHYLQX1YM0KeaDlCxncKQRLlMULL+SlCAACPMMO8bst+v69pwD18dgtBfVgzQp5oOULqu9tAq/MyQi9cM0LGdwpBEuUxQsv5KUIAAFJBFT8dJgU/LsgfP77DmkFaB07ASP2cQaiEnUFLUAPAc6KSQUVrkkHF4Im/WYGWQQAAu+kxP+lIBj9IzPs+vsOaQVoHTsBI/ZxBRWuSQcXgib9ZgZZBT9WQQWWM079EqJ1BAACgNjM/93sHP6B19T5DNZBBCXU3wCtKqUG+w5pBWgdOwEj9nEFP1ZBBZYzTv0SonUEAAE7OQD9288M+G/oIPxg3l0Ha2I/AfUmpQdPQnkEQvorACq2dQb7DmkFaB07ASP2cQQAA1UJZP091sz3XhwU/ZtqcQXe4oMDQyqFB09CeQRC+isAKrZ1B4HiYQb6/osBlAalBAAAGKlA/0cU7PuNrDT/T0J5BEL6KwAqtnUEYN5dB2tiPwH1JqUHgeJhBvr+iwGUBqUEAABCAWL9Oqdi+dnimPsfMHUGePB5CUEP/QW7XJkF65iFCakcKQo2GH0FInSdCZPUMQgAAa+t0v4jdY74UDUA+x8wdQZ48HkJQQ/9BjYYfQUidJ0Jk9QxCzwYSQU4mJELoQ+9BAABnZmy/Z9+nvmwvTD5V4xJBNnwmQtbw+EHPBhJBTiYkQuhD70GNhh9BSJ0nQmT1DEIAAED4DD95OVO/xXkBPpXtmUHE5q7AauujQbpsm0HBKq/A4PecQZw+oEGkHqTA8/+ZQQAAAwDOPqRRMz6fCWY/ZtNXQTEsnEGBfs9Bn0JpQdmChkH5z89BS3dcQYVcsUF5U8pBAABx1fQ+9MM5Phv8Wz9Ld1xBhVyxQXlTykGfQmlB2YKGQfnPz0HzBW5BLA6sQaWPxkEAAKLuGb/Zqjo/TUmnvqPyHUELkipCe6/gQe9NHEEtfi5Cd7TzQWt/J0F40S5CgtvqQQAAU99AvU9gfz9r3FK944IgQbxxOUKzAiNCvzwGQT3OOUJNBTBC11wlQaH2OULb9StCAACvDzu9DoZ/PwB9Jb2rnspAlw85QlbtJkIAO6VAREY5QpZ8MUK/PAZBPc45Qk0FMEIAAMGLE75vdXy/SM6nPYXrLEHyYjFCDgEzQsZ3CkES5TFCy/kpQpRfOkGwJTBCvwAqQgAAGS9+vxsyq73bK609ta4SQfHoKkK7PQBCzwYSQU4mJELoQ+9BVeMSQTZ8JkLW8PhBAAAnloy9lyl8v+4MIj7GdwpBEuUxQsv5KUKnCIhAIlYyQrQVJUL+artAsOswQvsOH0IAANs2EL4rI3a/pb5xPpRfOkGwJTBCvwAqQsZ3CkES5TFCy/kpQqz4N0Fbly5Cw04jQgAArIUSvn1Gdr+zFG4+xncKQRLlMULL+SlC/mq7QLDrMEL7Dh9CrPg3QVuXLkLDTiNCAACDgH2/gJDiPcePrT1BKZdAt+mIQQTKo0Hbx49Amc1/QSr+mUF64odAPWZLQXUhpUEAAI4Fhr7Nrhc/cwhDP/MkJ0Gp7SBA8MD/QXfwFUGQrLA/cO0BQp/ZLkGf09I+hRQHQgAAXKhEPS54fj+f1ci9VnlpQSqxOUK56ylCsLmXQVEhOEJjpyJCWatfQVhGOELJWhpCAABUZTU/VzszvwA6tL3Xz2NBZ1kYwb9oA0Lb3W9BF/wHweNA9kG/jGtBobgSwZ3KB0IAAL1Bfr+GiK49Yq6ivdvHj0CZzX9BKv6ZQZ40mEAMPI5BEgmPQTcOkEBWYWNBDeOJQQAAo7RVv/KZ474XUaY+gLGmQDu3qcAw7bRBDbCvQC5lt8BpBrZBkmGwQEVLrMC8RLpBAABVTH+/JWlaPWYlUr164odAPWZLQXUhpUHbx49Amc1/QSr+mUE3DpBAVmFjQQ3jiUEAAHDhf7+wHhM723r5vALgiUAguSlB546TQdJehkDKwBhBbrCvQXrih0A9ZktBdSGlQQAAk4rGPs+eNj+kbxU/Jy5NQe11oEGxudJB/HhFQQhfoEEPZdVBvTdEQW02nUHuq9lBAAC2M646uZUzPzZxNj+f2S5Bn9PSPoUUB0J39C5BQJyLv/P+DEJscjhBN0WAv4SkDEIAAM9F+j7Cofo+4ds4P2ytR0HvUKVB3UvRQfx4RUEIX6BBD2XVQScuTUHtdaBBsbnSQQAAm89/v2jdFz1JNiW8zwYSQU4mJELoQ+9Bta4SQfHoKkK7PQBCuh4SQenRIkKT2+BBAACAbK89A0l7vxDbLr7y90xBrD4iwSJSCUIbaUtBDvgZweZ2+kEItllBuAkdwaJvA0IAAIVdPj451HS/j9Fmvgi2WUG4CR3Bom8DQhtpS0EO+BnB5nb6QYZJX0FsSBTBPJn2QQAA+sMUP9UlS7/W2zi+189jQWdZGMG/aANChklfQWxIFME8mfZB291vQRf8B8HjQPZBAAAFUGW+y584P8zRJz9pNCZBGrkiwDOjEkJ39C5BQJyLv/P+DEL1hCBBTjIYv1+UCUIAAJSWDj4QZnS/sa2GPjEKT0H8cC9Cf9sjQixha0FBzy5CYNAdQruIj0HrSjFCQvwfQgAAwO/vvo9XBz8NLjU/9YQgQU4yGL9flAlCd/AVQZCssD9w7QFCNAYHQalgEr+QSgVCAACUgo6+YlQsP4djLz939C5BQJyLv/P+DEKf2S5Bn9PSPoUUB0L1hCBBTjIYv1+UCUIAAHAaVr4etSQ/6YY8P/WEIEFOMhi/X5QJQp/ZLkGf09I+hRQHQnfwFUGQrLA/cO0BQgAAxXnevow0HT/Tqig/NAYHQalgEr+QSgVCOI0RQSCl778R4AtC9YQgQU4yGL9flAlCAADrks49bux9P/Jnnr339zxBy2k6QhJ3KkJZq19BWEY4QslaGkK86jpB8n85QggVHkIAAIC0cz0gRH4//GPMvVZ5aUEqsTlCuespQlmrX0FYRjhCyVoaQvf3PEHLaTpCEncqQgAAAeI/vfFgfz9W/1K911wlQaH2OULb9StCvOo6QfJ/OUIIFR5C44IgQbxxOUKzAiNCAADqf8Y9zc5pv8mGyj4+YkFBEUstQu+7H0IxCk9B/HAvQn/bI0Ks+DdBW5cuQsNOI0IAAN2RzL41VgQ/Ws5BP+gm8kCmNOc/Qun5QTQGB0GpYBK/kEoFQnfwFUGQrLA/cO0BQgAA13FEPl5abb87xqQ+335gQbwOLUJyYxpCLGFrQUHPLkJg0B1CMQpPQfxwL0J/2yNCAAAjMkY+bzRtv28apT4xCk9B/HAvQn/bI0I+YkFBEUstQu+7H0LffmBBvA4tQnJjGkIAACzRLb1QnXK/yvChPi/6KkErjyxChsgcQj5iQUERSy1C77sfQqz4N0Fbly5Cw04jQgAAqqcbv4UZ/T5mCR8/NAYHQalgEr+QSgVCZ8LqQLO7h794hwJCp2L6QL0I9L9LIgdCAAC8TxM/xLxJv4kMYL6GSV9BbEgUwTyZ9kFH52JBLmgEwZPD3kHb3W9BF/wHweNA9kEAAD0EiD49qGu/b6aSvkfnYkEuaATBk8PeQYZJX0FsSBTBPJn2QRBsVEGXNhDBMAXrQQAASswVP0CsDD8rqxg/z39uQaajH8ATHwxCbFhXQSa4QMDAtBNCiMdrQWLgdsD+zxFCAAB+MBA/AYjwPh0ELj9sWFdBJrhAwMC0E0LjN1VBRh+CwDwQF0KIx2tBYuB2wP7PEUIAAPaMnbvgcHS//heYvi3DJ0G+gwvBtoXjQRtpS0EO+BnB5nb6QctSLEHPzxrBDxL8QQAAYIkzPkfMc7+rn3++EGxUQZc2EMEwBetBhklfQWxIFME8mfZBG2lLQQ74GcHmdvpBAACVsxc8t058v/UILb7LUixBz88awQ8S/EEbaUtBDvgZweZ2+kHy90xBrD4iwSJSCUIAAJkEXr9V5/6+JeFxuhYB50DBU9TA9SrlQQ81BkF84grBQhgFQnfw+EDZ1vPA58QEQgAAYhNuv3JWu76m+RA94jXwQGn52sAtOwhCFgHnQMFT1MD1KuVBd/D4QNnW88DnxARCAAC+aHi/PjlqPD4Ud76bDJpA3Dp6QSyEgEFkJZNAdnJNQUchhkE3DpBAVmFjQQ3jiUEAAKpuur3gRXu/UEUsvgH8KEGuiSHBLEwIQh3XHUHATx7BZxkFQstSLEHPzxrBDxL8QQAA+9ylvldSbL/WDVS+Pf0SQT5hFMGljPxBWgwXQSG5D8HL/u5BHdcdQcBPHsFnGQVCAABxpXe/Iyl0vVwsfL4C4IlAILkpQeeOk0FkJZNAdnJNQUchhkHeKZJAl5IiQa1IjEEAAKNv9L53mF6/35wBvh3XHUHATx7BZxkFQpYWE0HYShrB3FUIQj39EkE+YRTBpYz8QQAAINB7v5S3+rv8Rji+AuCJQCC5KUHnjpNBNw6QQFZhY0EN44lBZCWTQHZyTUFHIYZBAADyZH+/tlwIPVJfdr0C4IlAILkpQeeOk0F64odAPWZLQXUhpUE3DpBAVmFjQQ3jiUEAAHPCY7+5DrE+KaKYPhgRtkDjjxTA+W2qQVbLrEBh8UvAroqrQRZ6tkC9mkjAJ0iyQQAAkoVtv6dNhD6Jvom+MsbjQDQD1kGvtHpBf0fQQJYtwEHUYHJBEd7dQF2Z2kHa2YZBAAAWKHC/Q1t8PlUteb5/R9BAli3AQdRgckGQp7xA5rW9QbuaiUER3t1AXZnaQdrZhkEAAIdhqj5Go94+NzZWP2ytR0HvUKVB3UvRQScuTUHtdaBBsbnSQbjVUEFE16dB1CnOQQAAKEByv379aT46OGo+Fnq2QL2aSMAnSLJBsoKvQK3SkcAWcrZBVpu8QAnqg8BlhMBBAADQ7Jc+wDBIPuZKbz9m01dBMSycQYF+z0FLd1xBhVyxQXlTykG41VBBRNenQdQpzkEAAN+qyj4GUq4+/1VaPy5JSUFwL6tBgpTOQWytR0HvUKVB3UvRQbjVUEFE16dB1CnOQQAAN7smP3EtjT76+jQ/ZtNXQTEsnEGBfs9BuNVQQUTXp0HUKc5BJy5NQe11oEGxudJBAAC1pWg/7t+Svm4nmz43ildB4iQgQp8OA0KsdldBC4sSQnV67EEwBmJBc1YVQhrv4UEAANcjf79/Dj29Bo6KvW84t0AxAo6/t32kQRZ6tkC9mkjAJ0iyQWFjtUDqcgvAchOxQQAAebPEPn8SMr/uaRs/M3xFQSNxFUJRef1BsRhKQegKHkKr3AdCUy5DQX/THELyjwdCAAASRSk/7GQPv4iD/z5qbE5BRroWQtRv/EGLN09BtpggQk0ICUKxGEpB6AoeQqvcB0IAAFpfXT+O7cG+iNuoPmpsTkFGuhZC1G/8QTeKV0HiJCBCnw4DQos3T0G2mCBCTQgJQgAAKqQiPmqye79Zari9hgmVQR88tcBQrJ9BxXmXQcDctMAQ9aJBYCaUQSPUuMD/6qdBAAArzj0+Fvx5v1Yk4b26bJtBwSqvwOD3nEHFeZdBwNy0wBD1okGGCZVBHzy1wFCsn0EAALyE9z4+Pl6/MSbmPZXtmUHE5q7AauujQcV5l0HA3LTAEPWiQbpsm0HBKq/A4PecQQAA/vUBPyV2KL+fXA4/amxOQUa6FkLUb/xBsRhKQegKHkKr3AdCM3xFQSNxFUJRef1BAACbl+i5mVdEv/tFJD9TLkNBf9McQvKPB0LRfTNBfP0VQjfH/kEzfEVBI3EVQlF5/UEAAAC1NT7adF4/XYXsvjYNZUH+GDdCIyYWQlI9j0ENXzZCKkwaQhWJdUEfkDRCzfYSQgAA6/XtPa0qdz9xqG6+Uj2PQQ1fNkIqTBpCNg1lQf4YN0IjJhZCWatfQVhGOELJWhpCAAAtjXC/q5h0Ps/Qer5x1bZABnyqQRbgeEGQp7xA5rW9QbuaiUF/R9BAli3AQdRgckEAAP2WUD4PgW2/9RqgPt9+YEG8Di1CcmMaQhwWhEEzSi9CvIwaQixha0FBzy5CYNAdQgAAEVybPorNcr+5YLu9CaVhQR2OLEJE9BZCKel4Qce/LkI5gBNCHBaEQTNKL0K8jBpCAAD+sEq/vIqEPnaiDb/ko89AUveyQcR4ZkF/R9BAli3AQdRgckF59OtAaXLPQRzdbEEAAP16Rb//m4M+WQUVv+Sjz0BS97JBxHhmQXn060Bpcs9BHN1sQbut4UBmBrZBmjhdQQAAbnJbPni4dr/RuyI+335gQbwOLUJyYxpCCaVhQR2OLEJE9BZCHBaEQTNKL0K8jBpCAADbBVG/xK6OPsVxAb8yxuNANAPWQa+0ekF59OtAaXLPQRzdbEF/R9BAli3AQdRgckEAAK3SbT5+EnQ/oStFvjYNZUH+GDdCIyYWQlk+TUH0FTdCOOkOQlmrX0FYRjhCyVoaQgAAs4srPGHVHT+fiUk/Je4xQYd7oEEDcNVB/HhFQQhfoEEPZdVBkrExQebcpUG7OdFBAADF+nQ80CbWPu5/aD+SsTFB5tylQbs50UFsrUdB71ClQd1L0UEuSUlBcC+rQYKUzkEAADS22TwBZyI/jcZFP5KxMUHm3KVBuznRQfx4RUEIX6BBD2XVQWytR0HvUKVB3UvRQQAARWztvknDMr/wmAu/Ct6LQd2hoMC8U5tBlDCKQWFAh8DWoJRBO+mVQZAkoMAfoZJBAABYFEw/MDDSPvKm4j7jp0pBzTObQfDf2UGbLVFBPhSbQcYd1EEnLk1B7XWgQbG50kEAANWCfr9TDZw9qd6bPRgRtkDjjxTA+W2qQRZ6tkC9mkjAJ0iyQW84t0AxAo6/t32kQQAAkZJIP+0wIj6K0xk/ZtNXQTEsnEGBfs9Bmy1RQT4Um0HGHdRBXIhVQUZVlUHBytJBAADxsH2/MsxBvQthAL5vOLdAMQKOv7d9pEEEFblAhCGsv9OFoUEYEbZA448UwPltqkEAAEdDR7+3zwA/iDrAPgQVuUCEIay/04WhQaNOqUDCxeu/a62eQRgRtkDjjxTA+W2qQQAAyL1ev5LtsT64+LI+GBG2QOOPFMD5bapBo06pQMLF679rrZ5BVsusQGHxS8CuiqtBAACzwSu/3LwLP8p8AD+jTqlAwsXrv2utnkFRH5lAU+UEwB9Pm0FWy6xAYfFLwK6Kq0EAAFYHMT9lK9I+ICoYP5stUUE+FJtBxh3UQWbTV0ExLJxBgX7PQScuTUHtdaBBsbnSQQAAt0xDv/Hr4T718PE+h2SGQPVZicBDTaRBVsusQGHxS8CuiqtBUR+ZQFPlBMAfT5tBAADohf0+6KEcv4TnHT9qbE5BRroWQtRv/EEzfEVBI3EVQlF5/UEWE09Ba5gRQmL+8UEAAJ6Kdz/obwa+y8VfPjAGYkFzVhVCGu/hQeTXZUHg1CBCekvnQTeKV0HiJCBCnw4DQgAAdqg/vuRldb+P0Vu+HdcdQcBPHsFnGQVCtl8eQe8eE8Hj+vBBy1IsQc/PGsEPEvxBAADMl0o/hvjWvtN/4z43ildB4iQgQp8OA0JqbE5BRroWQtRv/EGsdldBC4sSQnV67EEAADhBar+qT4I+bDGgPrKCr0Ct0pHAFnK2QRZ6tkC9mkjAJ0iyQVbLrEBh8UvAroqrQQAArAxhvzuaXT5db9k+soKvQK3SkcAWcrZBgLGmQDu3qcAw7bRBkmGwQEVLrMC8RLpBAABY1Bw+K5t4v+tZO766bJtBwSqvwOD3nEGGCZVBHzy1wFCsn0GR8JhB/amtwMrkmEEAAAx6Xz5dWnO/ew9ivpHwmEH9qa3AyuSYQS1Hn0F8XJ/AQ8OPQbpsm0HBKq/A4PecQQAATq7mva1sZb+it9u+LUefQXxcn8BDw49BkfCYQf2prcDK5JhBO+mVQZAkoMAfoZJBAABbEQG/pcdavxqb/r2WFhNB2EoawdxVCEK2qg5BKywUwfpMAkI9/RJBPmEUwaWM/EEAAGafzT6W1TM/52oWPycuTUHtdaBBsbnSQb03REFtNp1B7qvZQeOnSkHNM5tB8N/ZQQAAGJWePfjrfD+uCAm+WT5NQfQVN0I46Q5CvOo6QfJ/OUIIFR5CWatfQVhGOELJWhpCAAD+3/A+sAoUPyyhKj9x62xBU8Wjvw4vCEIIPFhBoHNOvz4xCkLPf25BpqMfwBMfDEIAAJJPCj/GXBw/vS0UPwg8WEGgc06/PjEKQmxYV0EmuEDAwLQTQs9/bkGmox/AEx8MQgAAfogoP7mwAD9fbQ8/iMdrQWLgdsD+zxFC1W94QYsEgsAH1Q5Cz39uQaajH8ATHwxCAABCrIm+Lz81P4osJz/r5UlBbxNBwNhxFUK6VklBhnF8v52UDEJ8rEdB7/PVv6thD0IAAAAbpj6zLjM/3OIiP2xYV0EmuEDAwLQTQrpWSUGGcXy/nZQMQuvlSUFvE0HA2HEVQgAAF6TTvdIIdD9tX5E+INhAQaL/1r+r3g5CRl8vQSeE9r82lhBCfKxHQe/z1b+rYQ9CAADT36G+kOtsvyKxVb5aDBdBIbkPwcv+7kG2Xx5B7x4TweP68EEd1x1BwE8ewWcZBUIAACcHUDu1KF0/KO8AP3wlNkG9MNe/nuUOQkZfL0EnhPa/NpYQQiDYQEGi/9a/q94OQgAAYhtDvv3WZ78Y+8G+hgmVQR88tcBQrJ9BFRGPQdL+r8Bui59BO+mVQZAkoMAfoZJBAAD2V2K+HCFmv+6kwb6R8JhB/amtwMrkmEGGCZVBHzy1wFCsn0E76ZVBkCSgwB+hkkEAAPNozjtGiT8/SNgpP3ysR0Hv89W/q2EPQkZfL0EnhPa/NpYQQuvlSUFvE0HA2HEVQgAAbaSGu4K7PT+i3Cs/WaQvQZqcTMBTMxZC6+VJQW8TQcDYcRVCRl8vQSeE9r82lhBCAAD7GsK+ehxPv6z45b4K3otB3aGgwLxTm0E76ZVBkCSgwB+hkkEVEY9B0v6vwG6Ln0EAAGTbDL9WsCu/rrP+vgrei0HdoaDAvFObQduLeEHcQ3XAicSfQZQwikFhQIfA1qCUQQAASa1oP5f4ij77GaI+NA1RQVIYlUGdbdlBXIhVQUZVlUHBytJBmy1RQT4Um0HGHdRBAACCFA6/vyA0vy8v477bi3hB3EN1wInEn0EK3otB3aGgwLxTm0H89nlB+xWtwNLhskEAAFo0hb7Im2a/r/yxPi/6KkErjyxChsgcQuJDDkEfti1CnWUaQhZXG0GunytC+W4XQgAAI8DRvhKwTL852+A+SDomQUdOKkKvkhdCL/oqQSuPLEKGyBxCFlcbQa6fK0L5bhdCAADp+T86ICF0v/AZmr4twydBvoMLwbaF40EQbFRBlzYQwTAF60EbaUtBDvgZweZ2+kEAANk7gL3QWXS/wEmVvstSLEHPzxrBDxL8QbZfHkHvHhPB4/rwQS3DJ0G+gwvBtoXjQQAAWG71PnpaRb/zvda+JKbAQKDrlsDTHJhBa6L5QALnpsAlva9BSyKwQPsOrsCsBp5BAAC9nlG/KnsSvxFxPL0PNQZBfOIKwUIYBUIWAedAwVPUwPUq5UH2Qe9A46jfwCeu40EAAFZcR7+ujB+/RXuSvbaqDkErLBTB+kwCQg81BkF84grBQhgFQvZB70DjqN/AJ67jQQAAu2lUv3e3wL65A9M+UwaZQD3mp8Asdq5BC1GcQOF5tMA3P61BgLGmQDu3qcAw7bRBAAC3Riy/M7c4vxa2Jr4S/AlB3NX+wCVJ4EG2qg5BKywUwfpMAkL2Qe9A46jfwCeu40EAAMNWXL+KI0s+YBDwPoCxpkA7t6nAMO20QbKCr0Ct0pHAFnK2QVMGmUA95qfALHauQQAAy12BurKgfL+TqCW+8vdMQaw+IsEiUglCAfwoQa6JIcEsTAhCy1IsQc/PGsEPEvxBAACQuVC/6f/Nvvss1T4LUZxA4Xm0wDc/rUENsK9ALmW3wGkGtkGAsaZAO7epwDDttEEAACCUSD8Qjty+ZUnlPhYTT0FrmBFCYv7xQax2V0ELixJCdXrsQWpsTkFGuhZC1G/8QQAAW49MPwEutb4B4Pg+FhNPQWuYEUJi/vFBSHNVQfMCCEKWzN5BrHZXQQuLEkJ1euxBAACBP2+9a5d9P1N1/b3jgiBBvHE5QrMCI0K5KhZBUzU4QohWGkKrnspAlw85QlbtJkIAAE6HHT8g8EO/pApBvmLcbUHI6/jA75XbQfeYfEGWHOHAZnjbQdvdb0EX/AfB40D2QQAA6A1EvtOWd79uRCs+4kMOQR+2LUKdZRpC/mq7QLDrMEL7Dh9CLlnSQPWwL0ICOxtCAAD5Sxi+ia1zv8Q4iT7+artAsOswQvsOH0LiQw5BH7YtQp1lGkKs+DdBW5cuQsNOI0IAANgCjb69z16/av/QPuJDDkEfti1CnWUaQi/6KkErjyxChsgcQqz4N0Fbly5Cw04jQgAAhTi1vTpNfT+Twuq944IgQbxxOUKzAiNCxKEvQS0BOEJUqhNCuSoWQVM1OEKIVhpCAABlpcK9lRl9P3Xq7b286jpB8n85QggVHkLEoS9BLQE4QlSqE0LjgiBBvHE5QrMCI0IAAJeDBr/Ly1M/H1lLPp9+L0GBEJZBTPrsQf3DMUE1splBJNrgQa8kK0Ek8ZdBKWbfQQAAoD5jv2nNSj5N19S+f0fQQJYtwEHUYHJB5KPPQFL3skHEeGZBcdW2QAZ8qkEW4HhBAAAj7GG/m0gtPrup4L5x1bZABnyqQRbgeEHko89AUveyQcR4ZkFi9q1A+4yVQWumcUEAAG5Ndr/ysy8+efJYvnHVtkAGfKpBFuB4QZSZpEAkHJRBJQl+Qf3gq0A0FadBsx6GQQAAG+B6v7GFFD7mpQu+lJmkQCQclEElCX5BnjSYQAw8jkESCY9B/eCrQDQVp0GzHoZBAADYUgI/qfoZvzCdHT8WE09Ba5gRQmL+8UEzfEVBI3EVQlF5/UFk3UdBZPQPQsLE8UEAAMYPWb+4V+s9pX4EP7KCr0Ct0pHAFnK2QdV+h0Ca5aLAKQGnQVMGmUA95qfALHauQQAAKx+mvrZKHr8EQDe/3bGVQTOzbsAyDYdBn6afQWQ/EMA5rnBBC1yjQRgte8B0NIJBAACz+BU/Q30HPyMfHT+ohJ1BS1ADwHOikkGIr5lBF7zyvq5oi0FFa5JBxeCJv1mBlkEAAOpfBL8opwG/1qQwvwUQjUEfEUzATqGJQTkofUEBGoG/Gq+HQfgJkkF3zv2/g6R9QQAA8DkXv77qD7+oKxS/lDCKQWFAh8DWoJRB24t4QdxDdcCJxJ9BBRCNQR8RTMBOoYlBAADinwW/sYMCv7MPL78FEI1BHxFMwE6hiUH/NnNBY6TRvzk7j0E5KH1BARqBvxqvh0EAAC20Db8/MR2/aQkQvwUQjUEfEUzATqGJQduLeEHcQ3XAicSfQf82c0FjpNG/OTuPQQAAGQGSPjcYMz+1uSc/CDxYQaBzTr8+MQpCulZJQYZxfL+dlAxCbFhXQSa4QMDAtBNCAABWTyo8Cpw6vxA7Lz9k3UdBZPQPQsLE8UEzfEVBI3EVQlF5/UHRfTNBfP0VQjfH/kEAALbIBj/dqQy/2BQmP4IESkEsEQhCwYjjQSwFUEEZQwxCWDToQWTdR0Fk9A9CwsTxQQAAmvukvrlXcj9vFow7wLFAQRYl17+wDg1CiA48QYHO479PSQ1CINhAQaL/1r+r3g5CAADOg0q+PqB2PwBnOb7nnxFBU2o3QuxbF0K5KhZBUzU4QohWGkLMEi5Bgdw2QoukDEIAAOzz+D52PBS/uIgnPxYTT0FrmBFCYv7xQWTdR0Fk9A9CwsTxQSwFUEEZQwxCWDToQQAALsPTvqdXWj/kHaO+558RQVNqN0LsWxdCzBIuQYHcNkKLpAxCkRYXQXRONUKt8A9CAABRHQ092RArv8I/Pj+CBEpBLBEIQsGI40Fk3UdBZPQPQsLE8UHPEjJB0nAHQnj24kEAAOH+jL5hAWk/k2yevgjyD0FdhDZCIhcVQuefEUFTajdC7FsXQpEWF0F0TjVCrfAPQgAAaXgDvojdej/zEBy+uSoWQVM1OEKIVhpCxKEvQS0BOEJUqhNCzBIuQYHcNkKLpAxCAAAR4Q2/tys/P3FBvL6RFhdBdE41Qq3wD0IBLg9BcYI0Qj9NEUII8g9BXYQ2QiIXFUIAADKq6T6aLxe/BWEqPxYTT0FrmBFCYv7xQSwFUEEZQwxCWDToQUhzVUHzAghClszeQQAAThcNv50IRD8Mtak+ryQrQSTxl0EpZt9B/cMxQTWymUEk2uBBq38yQQronEGIC9pBAAClQK6+6WRLP0S/AD+vJCtBJPGXQSlm30GrfzJBCuicQYgL2kH+jCtByCeeQZC41UEAAOMHSb4WYUU/9RUbPyDYQEGi/9a/q94OQnysR0Hv89W/q2EPQl/rRUHtN7e/WwQOQgAAnYAbvh6kbT8xzK2+CPIPQV2ENkIiFxVCom3YQAjGNUKrDRdC558RQVNqN0LsWxdCAABmEqC+1Zs7vyO0Gj/RfTNBfP0VQjfH/kEewTJBAL4dQtGxCEIBWytB9bcVQs8D/EEAAJODHj99/0S/Mw4gvqbee0FildXA+9bLQfeYfEGWHOHAZnjbQWLcbUHI6/jA75XbQQAAstoVvyKzGL9AlAw/HsEyQQC+HULRsQhC6pYpQbuZHEIZAwVCAVsrQfW3FULPA/xBAACA6P0+WkFYv5EATr7b3W9BF/wHweNA9kFH52JBLmgEwZPD3kFi3G1ByOv4wO+V20EAAKuVwb53vDK/OKEbvyGcnEH8bI/A0KmJQTvplUGQJKDAH6GSQd2xlUEzs27AMg2HQQAAAOIuv5W+IT58hza/FqTRQDPGl0E/gFdBu63hQGYGtkGaOF1BJMbxQB1nmEHQYkhBAACjPlS/q2MJPnP0Cr9i9q1A+4yVQWumcUHko89AUveyQcR4ZkEWpNFAM8aXQT+AV0EAACP0Qb/EFCQ+I/khv7ut4UBmBrZBmjhdQRak0UAzxpdBP4BXQeSjz0BS97JBxHhmQQAA7RD9vjx0IL8RNRq/BRCNQR8RTMBOoYlB3bGVQTOzbsAyDYdBlDCKQWFAh8DWoJRBAACxYlS/HFqYPU2nDb8IMKtA+KmDQbvrbkFi9q1A+4yVQWumcUEWpNFAM8aXQT+AV0EAAAOX6b7HBSy/rVcVv5QwikFhQIfA1qCUQd2xlUEzs27AMg2HQTvplUGQJKDAH6GSQQAABIJvv0KoHT5QtaK+YvatQPuMlUFrpnFBlJmkQCQclEElCX5BcdW2QAZ8qkEW4HhBAAD+R6K+Yegov41rLr8LXKNBGC17wHQ0gkEhnJxB/GyPwNCpiUHdsZVBM7NuwDINh0EAAH4Y9L5LDAm/En0yv92xlUEzs27AMg2HQQUQjUEfEUzATqGJQfgJkkF3zv2/g6R9QQAABjp8vypZ1T1t8Aq+lJmkQCQclEElCX5BmwyaQNw6ekEshIBBNw6QQFZhY0EN44lBAABosHu/rLPIPYHyHb43DpBAVmFjQQ3jiUGeNJhADDyOQRIJj0GUmaRAJByUQSUJfkEAAKYPQ7+CX90+lN32PrKCr0Ct0pHAFnK2QVbLrEBh8UvAroqrQYdkhkD1WYnAQ02kQQAAp3o3vyT+BL82Mu4+AVsrQfW3FULPA/xB6pYpQbuZHEIZAwVCNwwiQZsXFUJCcvNBAAAXAVm//4QzPusuAD+ygq9ArdKRwBZytkGHZIZA9VmJwENNpEHVfodAmuWiwCkBp0EAAEg7cL+dx689+16rvpsMmkDcOnpBLISAQZSZpEAkHJRBJQl+QWL2rUD7jJVBa6ZxQQAA42cWPn8cbL+2A7e+EGxUQZc2EMEwBetBqZhRQTw8BMGW/NpBR+diQS5oBMGTw95BAAD7uZ88TqBvv57ks74QbFRBlzYQwTAF60EtwydBvoMLwbaF40GpmFFBPDwEwZb82kEAAFIJU79Dv8G+FozXPlMGmUA95qfALHauQdV+h0Ca5aLAKQGnQQtRnEDhebTANz+tQQAAO1BTv90NuL5Q1d4+1X6HQJrlosApAadBCZaNQFl2sMBcF6dBC1GcQOF5tMA3P61BAADui0+/k+NKPg0GDT+AKWBA56uawG2mnUHVfodAmuWiwCkBp0GHZIZA9VmJwENNpEEAAH2ml7v7Zng/zZN3vnwlNkG9MNe/nuUOQiDYQEGi/9a/q94OQogOPEGBzuO/T0kNQgAAp7N/PsDhdz/oGwK8iA48QYHO479PSQ1CjUQ2QTPq178jFw1CfCU2Qb0w17+e5Q5CAABce9c7Zgj5PterXz+NRDZBM+rXvyMXDUKIDjxBgc7jv09JDULAsUBBFiXXv7AODUIAAJ70gb6DlXe/4iOAvMxhyUCEAzBCT3oZQo19EUEoGi1C+MEXQi5Z0kD1sC9CAjsbQgAAWVTmPqPSWL+aEJG+YtxtQcjr+MDvldtBR+diQS5oBMGTw95BIORxQQmI18AH1cVBAAAq+GS/g6fGPkHLYz5uOyNByAiVQQaR1EEW+SdBPtWSQcTv4UGvJCtBJPGXQSlm30EAAE0ZJj6TM2e/XYvLvvzzW0FX7u3ABRTOQSDkcUEJiNfAB9XFQUfnYkEuaATBk8PeQQAASPDJPsruYb/aFIO+IORxQQmI18AH1cVBDX5+QQ+JwMB6uLtBpt57QWKV1cD71stBAAC0Bri+ryMpv4q0KD9YQzBBmNoPQvaX8UHRfTNBfP0VQjfH/kEBWytB9bcVQs8D/EEAAPj1Sr9QMwU/0HyiPv6MK0HIJ55BkLjVQaFpJkFgO5tBlhjUQa8kK0Ek8ZdBKWbfQQAAMzTovve2MD/pURA/q38yQQronEGIC9pBJe4xQYd7oEEDcNVB/owrQcgnnkGQuNVBAACkfW2/9VeEPlDriT6haSZBYDubQZYY1EFuOyNByAiVQQaR1EGvJCtBJPGXQSlm30EAAA7Hf7zmBm4+rfR4P15NLEHSiaxBk/nNQcGRSkEcnrdB05HLQQo3KkGDkrZBTo/LQQAAlrOXvDrhcT7jtXg/wZFKQRyet0HTkctBXk0sQdKJrEGT+c1BLklJQXAvq0GClM5BAADnSmS/B8qgvrjLpj7HzB1BnjweQlBD/0EWLhNBzo8TQnQl3EE3DCJBmxcVQkJy80EAABUwdb7CflC/Ck8Hv+WacUGL2ZzAa4WuQduLeEHcQ3XAicSfQfz2eUH7Fa3A0uGyQQAAUHBcviUjT7+q+Qu/rzJyQdRoucBf+LhB5ZpxQYvZnMBrha5B/PZ5QfsVrcDS4bJBAACd2jW/+yAXv2M3xL6vMnJB1Gi5wF/4uEEJQG5ByFJuwNUdo0HlmnFBi9mcwGuFrkEAAFGZYjv9uuA+KgVmP15NLEHSiaxBk/nNQZKxMUHm3KVBuznRQS5JSUFwL6tBgpTOQQAAGJIDPYuQS7/8Axu/CUBuQchSbsDVHaNBrzJyQdRoucBf+LhBLPBmQfU8kcDBe6tBAAD5K0o79CpNvzobGb8s8GZB9TyRwMF7q0GvMnJB1Gi5wF/4uEEeYgRBgAqxwCzitUEAAHVdRL7/rne/K7UoPo19EUEoGi1C+MEXQuJDDkEfti1CnWUaQi5Z0kD1sC9CAjsbQgAAia6Hvipydb+cINK9zGHJQIQDMEJPehlC/xn8QMMAL0JBjBJCjX0RQSgaLUL4wRdCAABKX2u/hJ+FPWuQxr6bDJpA3Dp6QSyEgEFi9q1A+4yVQWumcUEIMKtA+KmDQbvrbkEAAK6VHr/f2Eo+GnZCv7K7/EBTUzJC/uQQQkrm3kCYRDJCsusTQirWy0B3hDRCWHMWQgAAa+C6vneFVD/9xte+zlUFQaefMkLmtw9CCPIPQV2ENkIiFxVCAS4PQXGCNEI/TRFCAACE3wq/GzL+Pq17Lb/OVQVBp58yQua3D0Kyu/xAU1MyQv7kEEKibdhACMY1QqsNF0IAAAJyO74RNlY/qxwEv6Jt2EAIxjVCqw0XQgjyD0FdhDZCIhcVQs5VBUGnnzJC5rcPQgAA7m+kvgShND8WtSG/KtbLQHeENEJYcxZCom3YQAjGNUKrDRdCsrv8QFNTMkL+5BBCAADiui+/hnCJPS9dOb8WpNFAM8aXQT+AV0EkxvFAHWeYQdBiSEHRo95Ap0qDQeSKTUEAALGlSr+OKbs84FEcv9Gj3kCnSoNB5IpNQQgwq0D4qYNBu+tuQRak0UAzxpdBP4BXQQAAhUYYvwhtBr9E0Bu//xn8QMMAL0JBjBJC+t7ZQOW6MEJRPRVCPWr1QJEuMUIhfBFCAAAWcvq+PbZOvyTTqL7/GfxAwwAvQkGMEkLMYclAhAMwQk96GULTgNxAs80vQmZyFkIAAFBVXb+7562+DZm9PjcMIkGbFxVCQnLzQeqWKUG7mRxCGQMFQsfMHUGePB5CUEP/QQAADvx3vwmE/b32YFw+Fi4TQc6PE0J0JdxBWiwRQT9jH0LvO+VBtfcNQVICGEIYiNVBAADqbXW/LzI9vt1iXT7PBhJBTiYkQuhD70FaLBFBP2MfQu875UHHzB1BnjweQlBD/0EAAPtrd79gzwG+JpJkPhYuE0HOjxNCdCXcQcfMHUGePB5CUEP/QVosEUE/Yx9C7zvlQQAA70cxP/Pkoj6UwCU/iMdrQWLgdsD+zxFCJJlrQSnAjMCe7BJC1W94QYsEgsAH1Q5CAADe9hs/+Vq0PmzgNT/jN1VBRh+CwDwQF0IkmWtBKcCMwJ7sEkKIx2tBYuB2wP7PEUIAACgNPj8IET8+/LkkP9VveEGLBILAB9UOQiSZa0EpwIzAnuwSQkxKdUGa4qTA6wARQgAA9Nc6Pwyt1j2I7iw/R4t5QZVLwMDgYhBCTEp1QZripMDrABFCSqZvQadMzMCsShNCAABVHzs/v4opPst7KT+4o15BH1HDwPg0GEJMSnVBmuKkwOsAEUIkmWtBKcCMwJ7sEkIAAIFFQz/WPaM9Q0gkP0xKdUGa4qTA6wARQrijXkEfUcPA+DQYQkqmb0GnTMzArEoTQgAAYlYwP7Qw1D4YRBg/z39uQaajH8ATHwxClv58QWb3LMBMgQhCa/N6QWRw479ChAZCAADKORc/XVEJP4xOGj/Pf25BpqMfwBMfDEJr83pBZHDjv0KEBkJx62xBU8Wjvw4vCEIAAJkrxL7vZ2y/e9mnPP8Z/EDDAC9CQYwSQlhsDEELby1CYQMPQo19EUEoGi1C+MEXQgAAnztnvw89HrsSs9u+CDCrQPipg0G7625BOoylQC5gXkFSFnVBmwyaQNw6ekEshIBBAAD1FDC/Rk2UvuRjKr89avVAkS4xQiF8EUL63tlA5bowQlE9FUJK5t5AmEQyQrLrE0IAAKj+DL/bVTq/myXRvvre2UDlujBCUT0VQv8Z/EDDAC9CQYwSQtOA3ECzzS9CZnIWQgAA5zBsv8vpz7zdDcW+OoylQC5gXkFSFnVBZCWTQHZyTUFHIYZBmwyaQNw6ekEshIBBAAAkWe0+lRNSPykeq776Y19BfMA1QrfhEELQTVhBAnA2QpobEEI2DWVB/hg3QiMmFkIAAFJjZL8e0+q92rnfvjqMpUAuYF5BUhZ1QSa2pUCZVTBBLYCAQd4pkkCXkiJBrUiMQQAAwi1kvzzP7L2zcuC+OoylQC5gXkFSFnVB3imSQJeSIkGtSIxBZCWTQHZyTUFHIYZBAAC3VE+/L9wXvq5JEb8mtqVAmVUwQS2AgEE6jKVALmBeQVIWdUHo4sVA2Xk1QVSzaEEAAGt0ML97clW+JqExv+jixUDZeTVBVLNoQb291EDaf1FBV+dYQePq90BselJBRSNHQQAAWxI1v+UcOb4Z8y6/4+r3QGx6UkFFI0dBZqn/QNoMNkFppkpB6OLFQNl5NUFUs2hBAACwsU+/hTMDvU5wFb86jKVALmBeQVIWdUEIMKtA+KmDQbvrbkE0+NFAR1RtQbhlVUEAAHqqM79Wm/y9tpszvzT40UBHVG1BuGVVQePq90BselJBRSNHQb291EDaf1FBV+dYQQAAOLtKvzNyDzzdTRy/CDCrQPipg0G7625B0aPeQKdKg0Hkik1BNPjRQEdUbUG4ZVVBAABrmki/SogAvhjDG786jKVALmBeQVIWdUE0+NFAR1RtQbhlVUHo4sVA2Xk1QVSzaEEAAFR8Tr9e9ee9zIUUvzT40UBHVG1BuGVVQb291EDaf1FBV+dYQejixUDZeTVBVLNoQQAAbv23Pt6uKD/eKyk/Ote5QbdDJ0BE70FBcZO/QSqpIkA72DxBTQC+QXZ1P0DtYDdBAABtita+J4Ymv0orIj+n0ilBBswQQoFm8UFYQzBBmNoPQvaX8UEBWytB9bcVQs8D/EEAALLbQL9qi+i+wn7zPgFbK0H1txVCzwP8QTcMIkGbFxVCQnLzQafSKUEGzBBCgWbxQQAAo3syv1G45b4EIg8/GaEkQTS/C0KmDuZBp9IpQQbMEEKBZvFBNwwiQZsXFUJCcvNBAAB0eI43BPonv/guQT9YQzBBmNoPQvaX8UHPEjJB0nAHQnj24kFk3UdBZPQPQsLE8UEAAAx+HTvIazu/uGEuP9F9M0F8/RVCN8f+QVhDMEGY2g9C9pfxQWTdR0Fk9A9CwsTxQQAA1sm4uwsHSL9Iwh+/HmIEQYAKscAs4rVB4HMYQQ0kX8CvTKFBLPBmQfU8kcDBe6tBAABZqCg+ow1nvwOxy75H52JBLmgEwZPD3kGpmFFBPDwEwZb82kH881tBV+7twAUUzkEAAOEASL8Y6cu+YRb2PjcMIkGbFxVCQnLzQcM6GUGdBwlCEkrYQRmhJEE0vwtCpg7mQQAAYkfJvgCKGb9bazI/p9IpQQbMEEKBZvFB6/MqQYWyCEJgx+NBWEMwQZjaD0L2l/FBAABSmha/f0gIv2nTGz/r8ypBhbIIQmDH40Gn0ilBBswQQoFm8UEZoSRBNL8LQqYO5kEAADlwkr7gMCO/OiY3P1hDMEGY2g9C9pfxQevzKkGFsghCYMfjQc8SMkHScAdCePbiQQAAghYAv6jNWb8DfyQ+C1GcQOF5tMA3P61BCZaNQFl2sMBcF6dBTyWUQBuStsByHKRBAADMjkm/5bIcv2julj0WAedAwVPUwPUq5UGQyuBAEAfSwEdZ2UH2Qe9A46jfwCeu40EAAOb2Ur9C1Lq+ItjdPgmWjUBZdrDAXBenQYApYEDnq5rAbaadQaf0dkAnLarA+82fQQAAwGUJv1fNVr+GE7a9Z1bwQKDC2sCKfdZB9kHvQOOo38AnruNBkMrgQBAH0sBHWdlBAADV9dk+pSorP8gUHD939C5BQJyLv/P+DEJGXy9BJ4T2vzaWEEIoHTJB2We/vzI4DkIAAJaqEb88SUu/v8xavhL8CUHc1f7AJUngQWdW8ECgwtrAin3WQe8PAEEkPdXAqdnGQQAAMGnzvkXKV7+y+IC+4RcPQSKL+MCEM9ZBEvwJQdzV/sAlSeBB7w8AQSQ91cCp2cZBAADUpCm/iIw+v59Wqb1nVvBAoMLawIp91kES/AlB3NX+wCVJ4EH2Qe9A46jfwCeu40EAAISVQ75i9Dk/1QMpP1mkL0GanEzAUzMWQkZfL0EnhPa/NpYQQmk0JkEauSLAM6MSQgAAGWldvheTa7+oDae+LcMnQb6DC8G2heNBWgwXQSG5D8HL/u5B4RcPQSKL+MCEM9ZBAADO9aG+Tf4mP+FTMD9pNCZBGrkiwDOjEkJnpR9BiGRJwGMsFEJZpC9BmpxMwFMzFkIAALxxc76c7Gi/Ihuuvi3DJ0G+gwvBtoXjQbZfHkHvHhPB4/rwQVoMF0EhuQ/By/7uQQAAthclPkR4Rj8aVxw/KB0yQdlnv78yOA5CRl8vQSeE9r82lhBCfCU2Qb0w17+e5Q5CAAD1oHK+AI2hPZDjdz+9TxtB62nEQdubyEE9NRlB/KGyQcnMyUEKNypBg5K2QU6Py0EAABycmr6V7EU+9PpuPzs3HUEG259BKynOQV5NLEHSiaxBk/nNQQo3KkGDkrZBTo/LQQAA8mbpPiBFUz/bqqq++mNfQXzANUK34RBCNg1lQf4YN0IjJhZCaDtmQR2QNULCwBJCAADzx4E+zrtjP1KNwr42DWVB/hg3QiMmFkIViXVBH5A0Qs32EkJoO2ZBHZA1QsLAEkIAAFFekL5J6UA+tdRwPzs3HUEG259BKynOQQo3KkGDkrZBTo/LQT01GUH8obJByczJQQAAyrsFv0QwV7+ztRI+CZaNQFl2sMBcF6dBp/R2QCctqsD7zZ9BTyWUQBuStsByHKRBAABJG1O/Edi3vvDJ3z7VfodAmuWiwCkBp0GAKWBA56uawG2mnUEJlo1AWXawwFwXp0EAAM2FW7/ZgS++E1z4vonus0DUzn0/KvibQfcltkBXi2lAOHqTQatBw0Dfz8c/L5aTQQAAxTBav4HjMr4/a/y+yL2ZQLyTpkDCV5tB9yW2QFeLaUA4epNBie6zQNTOfT8q+JtBAAAmOTU/wtEfP1Ajqb4Hu1ZBpgssQuZl5EGWDl1BvoIoQvzQ3UFynFRBlbYmQiD5zUEAAE71Aj8Y8Eg/DP+yvsrtU0EMxzBCvJj3QQe7VkGmCyxC5mXkQYyCS0EQuy5CCz/oQQAA/BnjPqIGUL84ksG+SyKwQPsOrsCsBp5Ba6L5QALnpsAlva9BrjHcQOritsBRsa9BAAAvRPU+FqJIP3lryr6MgktBELsuQgs/6EEHu1ZBpgssQuZl5EFynFRBlbYmQiD5zUEAAMh9Rr+9B6u+rzMJv4nus0DUzn0/KvibQatBw0Dfz8c/L5aTQaDNykCUKFI/KIyUQQAARO/bPndPTT9AhNS+q7JJQbVcK0KOStpBjIJLQRC7LkILP+hBcpxUQZW2JkIg+c1BAABUGyo7pYVmP7+q3r436y1BTl0rQsw32kGMgktBELsuQgs/6EGrsklBtVwrQo5K2kEAAHVgiz2u+ku/QLQZv+BzGEENJF/Ar0yhQR5iBEGACrHALOK1QUSxCEHOS2/AFxajQQAAxDWVPP6SM7+5ZDa/RLEIQc5Lb8AXFqNBbvwPQQgfMsCepptB4HMYQQ0kX8CvTKFBAABCocE+qplBv3GuCL8eYgRBgAqxwCzitUEZNQNB8nGBwOecpEFEsQhBzktvwBcWo0EAAGO7dT7UjU0/Ma0Lv6X3bUG+EjJCxncOQmg7ZkEdkDVCwsASQhWJdUEfkDRCzfYSQgAAmosov5reO79ARyu+Pf0SQT5hFMGljPxBtqoOQSssFMH6TAJCEvwJQdzV/sAlSeBBAABsJcY+TVs6P57iEL+l921BvhIyQsZ3DkIViXVBH5A0Qs32EkJsdntBWd0yQvnKEUIAAHjgCz8DNP8+jk0sv6X3bUG+EjJCxncOQmx2e0FZ3TJC+coRQhBPcUGLtDBCCiIOQgAAr6/1vjsXV79iVIG+WgwXQSG5D8HL/u5BEvwJQdzV/sAlSeBB4RcPQSKL+MCEM9ZBAADGOge/bfJRvzBBYb4S/AlB3NX+wCVJ4EFaDBdBIbkPwcv+7kE9/RJBPmEUwaWM/EEAAEChET8KG0q/PwJsvinpeEHHvy5COYATQoCiakE9aS1CcEYPQlYec0Hg4y5CmHEPQgAAM0SWvBvgYr9f/uy+/PNbQVfu7cAFFM5BqZhRQTw8BMGW/NpBeXcMQQsE0sCdSsJBAADDAmu/5kZbvqHjqr5vOLdAMQKOv7d9pEFVFYhAP55kQM/frEGJ7rNA1M59Pyr4m0EAAGvtrj7llSg/XqcrP3GTv0EqqSJAO9g8QV7dwUEr3DZAfI01QU0AvkF2dT9A7WA3QQAAR42vPhbTNT+FYx0//LnBQbIGRkCfUzFBTQC+QXZ1P0DtYDdBXt3BQSvcNkB8jTVBAAAX3t2+gJIsPwshGT84jRFBIKXvvxHgC0JnpR9BiGRJwGMsFEJpNCZBGrkiwDOjEkIAANrjLr4RCjg/PH4sP2k0JkEauSLAM6MSQkZfL0EnhPa/NpYQQnf0LkFAnIu/8/4MQgAApFb1vrV2ID/ZSR0/aTQmQRq5IsAzoxJC9YQgQU4yGL9flAlCOI0RQSCl778R4AtCAAAPscu+llBmvxwcOL771uNAuVXCwDvZvkHvDwBBJD3VwKnZxkFnVvBAoMLawIp91kEAAMnJfL4OLGO/QVnHvuEXD0Eii/jAhDPWQe8PAEEkPdXAqdnGQZZ4E0FKx+vAQorNQQAA3XQXvhOpcD+qSZ2+Il3BQaB8Q0C1uy9B6U28QdDyQUCibTNB/LnBQbIGRkCfUzFBAABXrZq+BlkQPybFRL8iXcFBoHxDQLW7L0EjXbtB7O4yQPJpMUHpTbxB0PJBQKJtM0EAAFcMWr2ddno/UK5MPulNvEHQ8kFAom0zQU0AvkF2dT9A7WA3Qfy5wUGyBkZAn1MxQQAAnuVjP0p/yj09q+O+1zvDQY6QHkACKzVBIl3BQaB8Q0C1uy9B/LnBQbIGRkCfUzFBAAD/jGE/NzDCPuy2kD78ucFBsgZGQJ9TMUFe3cFBK9w2QHyNNUHXO8NBjpAeQAIrNUEAAPtG5z7V2Ec/5iHdvqt0ZEFoZzJCIZQMQmg7ZkEdkDVCwsASQqX3bUG+EjJCxncOQgAANwYJP2RaPD+BctS++mNfQXzANUK34RBCaDtmQR2QNULCwBJCq3RkQWhnMkIhlAxCAAATAA+/XMgIPrGQUT+oPv1AsIqqQTCpwkEY7hFB7EO1QaB/x0GzMQdB2S/CQSe6wUEAALGh0741Pw4/yaw4P5KxMUHm3KVBuznRQaCDKEFMWqNBdYfQQSXuMUGHe6BBA3DVQQAA1ly/vvY8GT+aYTU//owrQcgnnkGQuNVBJe4xQYd7oEEDcNVBoIMoQUxao0F1h9BBAADl/uA+Sa5dP1aNdL6KkVRBybczQkSHBELQTVhBAnA2QpobEEL6Y19BfMA1QrfhEEIAAM90Wr/LZ4m+8tjkvpbZwEAkggq/KyqdQW84t0AxAo6/t32kQYnus0DUzn0/KvibQQAAe4h2vyJeID5cgGC+ltnAQCSCCr8rKp1BGSS/QGl8Wb9DR51Bbzi3QDECjr+3faRBAAAHZ7k+QwRDv2mECb8ZNQNB8nGBwOecpEEeYgRBgAqxwCzitUFrovlAAuemwCW9r0EAAAMiIT90PJu+/yg3v4mVeUG/G6k/jMiIQfyFb0F7UZY/DNuEQY2PbkHQXXZA67l2QQAAfm8TPwOkrL5/pj6/iZV5Qb8bqT+MyIhBjY9uQdBddkDruXZBRXJ4QQtre0CczH1BAABQ7Ba/MlkNPzbtFj8H6QpB7hR6wOnWEUJnpR9BiGRJwGMsFEI4jRFBIKXvvxHgC0IAACImJL88xwg/qAENPziNEUEgpe+/EeALQl0Z+ECHc3XA3TsNQgfpCkHuFHrA6dYRQgAAapV2Px9QfD6Vntu9HS9iQfqlLkL02wNCWENmQcPUH0Ic8tVBxKxjQT27HkKtRMVBAAAPr3o/FtdBPnWllL0dL2JB+qUuQvTbA0KJfGRBc+wpQu+a/kFYQ2ZBw9QfQhzy1UEAAFS+xT6tVx8/W0Uuv4mVeUG/G6k/jMiIQboHdkFCgYI/t5GFQfyFb0F7UZY/DNuEQQAA+kw6O4wcYD+Qdve+N+stQU5dK0LMN9pBq7JJQbVcK0KOStpBaUY1Qbx6J0J1KsxBAADKa1E92O1bP0deAr+rsklBtVwrQo5K2kG2b0lBpHwlQoZ0xkFpRjVBvHonQnUqzEEAAAzXlz5tIFI/lvP5vnKcVEGVtiZCIPnNQbZvSUGkfCVChnTGQauySUG1XCtCjkraQQAAhAo5P7JgGz9QKKm+yTpcQaF/IULEJcNBcpxUQZW2JkIg+c1Blg5dQb6CKEL80N1BAADhLVg/wOjvPhfehL7ErGNBPbseQq1ExUHJOlxBoX8hQsQlw0GWDl1BvoIoQvzQ3UEAAO8od78GXvw9Hgtrvhkkv0BpfFm/Q0edQQQVuUCEIay/04WhQW84t0AxAo6/t32kQQAAxIOdvkpkoD4PAWY/oIMoQUxao0F1h9BBkrExQebcpUG7OdFBXk0sQdKJrEGT+c1BAADIbPq+729fPlIwWD+ZYCFBIlybQQ+H0EGggyhBTFqjQXWH0EE7Nx1BBtufQSspzkEAAEqsRr8Z6A0/LPuZPuw4t0CGIGS/PaKZQaNOqUDCxeu/a62eQQQVuUCEIay/04WhQQAAKqg1v1iRHz+UOag+BBW5QIQhrL/ThaFBGSS/QGl8Wb9DR51B7Di3QIYgZL89oplBAABKetk9+NlsPuGRd79+bHRBfCbRPseog0G+u2ZBDw5EP2WXg0H8hW9Be1GWPwzbhEEAAIDpPj72nt2+FMlhv1yPYEGJsAxAM6F6Qb67ZkEPDkQ/ZZeDQb+bXUFHXos/3luBQQAAVGsvvzOYhT5HEy4/JS4XQUlFocAgqxZCB+kKQe4UesDp1hFCH+X/QEtOi8AKww9CAABojSG+JLlpv8SlwL6WeBNBSsfrwEKKzUEtwydBvoMLwbaF40HhFw9BIov4wIQz1kEAAFDJijxGi12/ZTMAv3l3DEELBNLAnUrCQamYUUE8PATBlvzaQZZ4E0FKx+vAQorNQQAAvuulvGCbZr+8E96+LcMnQb6DC8G2heNBlngTQUrH68BCis1BqZhRQTw8BMGW/NpBAAAcc0e/SnCtPeIDHz8f5f9AS06LwArDD0JDbwpB5hjMwI4nFELmjRVBtQrJwNiWF0IAAHDIHL9pKrA++TI2PwfpCkHuFHrA6dYRQiUuF0FJRaHAIKsWQs/VH0GEtYPAc74WQgAAw4ISvyOL5T5Dxy8/Z6UfQYhkScBjLBRCB+kKQe4UesDp1hFCz9UfQYS1g8BzvhZCAADuNjS/6YrIPgOsFz8H6QpB7hR6wOnWEUJdGfhAh3N1wN07DUIf5f9AS06LwArDD0IAADt6Db8ZSGg+t0xNPx/l/0BLTovACsMPQoRU7kBmaI3AuVIOQvBF70COlJzA2vAOQgAAyRk3v2TKOz7upCw/5o0VQbUKycDYlhdCJS4XQUlFocAgqxZCH+X/QEtOi8AKww9CAAD+qje/qGINPhvLLj9DbwpB5hjMwI4nFEIf5f9AS06LwArDD0JDy/xAgSrBwEy3EEIAAMe7UT+W2vo+T4aYvqt0ZEFoZzJCIZQMQqRDYkGrXjFCAF8JQud5XUEMZDNCLGcJQgAAPIlFPzVJvb7jgQS/jrptQXASMEJDlwxCI8V+QZEQMUKiOxJCVh5zQeDjLkKYcQ9CAABdCkU/HRrmvmYo6L5WHnNB4OMuQphxD0IjxX5BkRAxQqI7EkLKg3xBHekvQndrEkIAAHJgJz++M/k+JU8Uv466bUFwEjBCQ5cMQhBPcUGLtDBCCiIOQiPFfkGREDFCojsSQgAAUWWvPqlOcL+1/B09EseKQWFku8CWdcBBLSKIQfqkv8AkEr5BHMSNQekIuMAOWLpBAADe5xI/yVNRv+shO71WHnNB4OMuQphxD0KAompBPWktQnBGD0Ifo2xB4dgtQv7BDUIAAP0PRj91cru+BmAEv466bUFwEjBCQ5cMQlYec0Hg4y5CmHEPQh+jbEHh2C1C/sENQgAAX1LYPqJTZL8ZICU+rTiNQVmWvcDmF7RBA5+PQeOYt8CrFrZBHMSNQekIuMAOWLpBAACPwQe/IlunPrFCSD87Nx1BBtufQSspzkGggyhBTFqjQXWH0EFeTSxB0omsQZP5zUEAAL6jVz8AJ+o+Cf+RvsSsY0E9ux5CrUTFQcMRYEH52BpCHnyzQck6XEGhfyFCxCXDQQAAegu0PuvuRz+WIQS/cpxUQZW2JkIg+c1BqexQQfJxH0LOuLZBtm9JQaR8JUKGdMZBAACZOXO+JkxhPxmF0r436y1BTl0rQsw32kFrfydBeNEuQoLb6kH+OjJB+FovQoIO6kEAAMahDL9u/T8/96m8vqPyHUELkipCe6/gQWt/J0F40S5CgtvqQaaaJEEL6idCWOnQQQAAbfz8vmFpGT6BPFs/Q8v8QIEqwcBMtxBCH+X/QEtOi8AKww9C8EXvQI6UnMDa8A5CAAC5NUO/rz+uPlvZDD+ggyhBTFqjQXWH0EGZYCFBIlybQQ+H0EGhaSZBYDubQZYY1EEAAODvP78bp7A+vYwQP6CDKEFMWqNBdYfQQaFpJkFgO5tBlhjUQf6MK0HIJ55BkLjVQQAA1FZdv9RqBr71Ufg+8EXvQI6UnMDa8A5CQt7xQB46qcBbFw9CQ8v8QIEqwcBMtxBCAAAi6Wu/GDmJvqDejz5C3vFAHjqpwFsXD0Jyp/dAldi+wLTiDkJDy/xAgSrBwEy3EEIAADa8Sb9I83o+EJQQP6FpJkFgO5tBlhjUQZlgIUEiXJtBD4fQQW47I0HICJVBBpHUQQAAfExgv25kJT4nheg+ZtYdQX97i0F/wtJBbjsjQcgIlUEGkdRBmWAhQSJcm0EPh9BBAAC09WE/RROKvXsp7j6h2LlBhTKnv5AOZ0ELyrtBr+zBv+MyX0Fa2b1BVJE9v4stWUEAACY0dT+xUH2+67IVPgvKu0Gv7MG/4zJfQWt1vUGokXu/Y7xXQVrZvUFUkT2/iy1ZQQAAK+3TPjeiaL+vL1y9EseKQWFku8CWdcBBL/OHQRCGwsBP08hBLSKIQfqkv8AkEr5BAADVR7U+9vpuv+EqZ71GaIRBqEzHwGxZxkEtIohB+qS/wCQSvkEv84dBEIbCwE/TyEEAAPXDcD9V84i+U6FWPqRRv0ExD+++vZJRQVrZvUFUkT2/iy1ZQWt1vUGokXu/Y7xXQQAA/W3HPkCWa7+YQxm9RmiEQahMx8BsWcZBFQyIQRwhvsBV27NBLSKIQfqkv8AkEr5BAAAr7UY/u3E/Pr3cGT+p3MBB4pnBPtnRS0HoSr1BX4o1PoIMVkFa2b1BVJE9v4stWUEAAFnAcT8KTKO9smijPqRRv0ExD+++vZJRQancwEHimcE+2dFLQVrZvUFUkT2/iy1ZQQAA5nVov7uyhz5EEaa+QcbGQL0yxb5s45hBVCPJQO2c072PE5lBJEDQQGVjxz0EaZVBAAADP8a+G5xSP5Ac1b6mmiRBC+onQljp0EFrfydBeNEuQoLb6kE36y1BTl0rQsw32kEAALh9c795CZE+UZv7vR+vFkFmFy9COSMCQrkYFEHn4R9ChifIQbWuEkHx6CpCuz0AQgAAxDWLPrrOa7+5oY6+DX5+QQ+JwMB6uLtBRmiEQahMx8BsWcZBpt57QWKV1cD71stBAACmL3u/h28zPkO9pb26HhJB6dEiQpPb4EG1rhJB8egqQrs9AEK5GBRB5+EfQoYnyEEAADdiZr9KCcs+6p45vu9NHEEtfi5Cd7TzQbkYFEHn4R9ChifIQR+vFkFmFy9COSMCQgAAyjNcvyYl6j5MNGe+o/IdQQuSKkJ7r+BBuRgUQefhH0KGJ8hB700cQS1+LkJ3tPNBAABAcNI+f5llvwxIJz6tOI1BWZa9wOYXtEEcxI1B6Qi4wA5YukEtIohB+qS/wCQSvkEAAHC3fb+gKvm80NwEPrX3DUFSAhhCGIjVQVosEUE/Yx9C7zvlQSCtC0H6XhdCNnvMQQAAO0fkPPq4f7/psRi9FQyIQRwhvsBV27NBrTiNQVmWvcDmF7RBLSKIQfqkv8AkEr5BAACken6/IVzJPQdAPz1aLBFBP2MfQu875UG6HhJB6dEiQpPb4EEgrQtB+l4XQjZ7zEEAAEeEf7+asHQ9ga9pvM8GEkFOJiRC6EPvQboeEkHp0SJCk9vgQVosEUE/Yx9C7zvlQQAAP95SvtIhVT9NpgO/N+stQU5dK0LMN9pBaUY1Qbx6J0J1KsxBppokQQvqJ0JY6dBBAADMqle/avX0Pjyxfb7OiRlBFbsgQsgtwkG5GBRB5+EfQoYnyEGj8h1BC5IqQnuv4EEAAEZeUr4SSFU/HXUDv6aaJEEL6idCWOnQQWlGNUG8eidCdSrMQSTXKUEqESNCsyLAQQAAgIkMvyBLND6DLFE/ZtYdQX97i0F/wtJBmWAhQSJcm0EPh9BBOzcdQQbbn0ErKc5BAAARLiA/tQ0GP30DFL+Oum1BcBIwQkOXDEKl921BvhIyQsZ3DkIQT3FBi7QwQgoiDkIAAGocED9Ucg4/hHMcv466bUFwEjBCQ5cMQqt0ZEFoZzJCIZQMQqX3bUG+EjJCxncOQgAAxUzjvtZDIT600WE/GO4RQexDtUGgf8dBOzcdQQbbn0ErKc5BPTUZQfyhskHJzMlBAABCb9y+7RpFPkO+YT9m1h1Bf3uLQX/C0kE7Nx1BBtufQSspzkEElwlBQV+NQYZnzUEAAPSH876rp1M/OcWZPiRA0EBlY8c9BGmVQbLV2kAIgRA/TVCPQc0+wkBnvIo9boSQQQAAINp1P2eNWb68zzi+H6NsQeHYLUL+wQ1CQrFnQXdCLUIZ3wdCjrptQXASMEJDlwxCAAB97ag+olpnP2qsi75ZPk1B9BU3QjjpDkI2DWVB/hg3QiMmFkLQTVhBAnA2QpobEEIAABRagjy5+Xw/2RccvswSLkGB3DZCi6QMQrzqOkHyfzlCCBUeQlk+TUH0FTdCOOkOQgAAiInIPCitez8HuDm+WT5NQfQVN0I46Q5CLm4+QWCBNUI12AVCzBIuQYHcNkKLpAxCAABy77M95H57PxvDKL7MEi5Bgdw2QoukDELEoS9BLQE4QlSqE0K86jpB8n85QggVHkIAACZ0LD/U+DA/udCFvvpjX0F8wDVCt+EQQud5XUEMZDNCLGcJQoqRVEHJtzNCRIcEQgAAlJZEPxlXGD/ds3K++mNfQXzANUK34RBCq3RkQWhnMkIhlAxC53ldQQxkM0IsZwlCAACWzXE/GHyVvmbtGT6H8sBBTqWTPgD1R0FsvcFBsu8WP5lbR0Gp3MBB4pnBPtnRS0EAAMFpej+nHzW+7UXfPancwEHimcE+2dFLQaRRv0ExD+++vZJRQYfywEFOpZM+APVHQQAAHjYkPxR4E7+WtAG/0Uy+QeYTjr43jEtBh/LAQU6lkz4A9UdBpFG/QTEP7769klFBAAD5kys+4Z8jv14nQL//DrhBoDtVvytUUEHRTL5B5hOOvjeMS0EyI7tBAXaVv4hDVkEAAFHjET949CO/CM0DvzIju0EBdpW/iENWQdFMvkHmE46+N4xLQaRRv0ExD+++vZJRQQAASzcSPwIEJL90XAO/MiO7QQF2lb+IQ1ZBpFG/QTEP7769klFBa3W9QaiRe79jvFdBAABSVzQ/tVSqPsB/ID/oSr1BX4o1PoIMVkHXO8NBjpAeQAIrNUFxk79BKqkiQDvYPEEAAGP3/r6iDRE/7Q4oPx/l/0BLTovACsMPQl0Z+ECHc3XA3TsNQoRU7kBmaI3AuVIOQgAAw4pYv+xz7z1ROgU/hFTuQGZojcC5Ug5CURnnQNEEk8D1Ag1C8EXvQI6UnMDa8A5CAAAetVC9LGZ9vwftB74Nfn5BD4nAwHq4u0EVDIhBHCG+wFXbs0FGaIRBqEzHwGxZxkEAAOauYb8OMA8+0tbmviRA0EBlY8c9BGmVQcHU00AdUts+MXuUQWLE2EBV6OU+oB6SQQAACQstv40jEj8VoO4+hFTuQGZojcC5Ug5CXRn4QIdzdcDdOw1CHzjyQAi1X8DYgApCAAAp52m/fpU5Pn9Bur7B1NNAHVLbPjF7lEEkQNBAZWPHPQRplUFUI8lA7ZzTvY8TmUEAAK6wFr94tzU/4BDGPiRA0EBlY8c9BGmVQc0+wkBnvIo9boSQQUHGxkC9MsW+bOOYQQAAk4ZJv74Lhr4s8A6/ie6zQNTOfT8q+JtBoM3KQJQoUj8ojJRBltnAQCSCCr8rKp1BAADRZRS/1KHNvoOANb9UI8lA7ZzTvY8TmUGgzcpAlChSPyiMlEHB1NNAHVLbPjF7lEEAAEv0K78Y2be+duIlv1QjyUDtnNO9jxOZQZbZwEAkggq/KyqdQaDNykCUKFI/KIyUQQAAkht0Pwi8zLu7NJq+QrFnQXdCLUIZ3wdCr6VmQfwlLkKXBgdCjrptQXASMEJDlwxCAAB7UW2/SgIUPkQqsb4ZJL9AaXxZv0NHnUGW2cBAJIIKvysqnUFUI8lA7ZzTvY8TmUEAABkzcr+r/IY+OKpAvkHGxkC9MsW+bOOYQRkkv0BpfFm/Q0edQVQjyUDtnNO9jxOZQQAAJ6YHv5q2Kz9W2gQ/rGOLQF5Ejb90pJBB7Di3QIYgZL89oplBiZCpQCCfmr5MDpBBAADTic2+6MhBPwP+Az/sOLdAhiBkvz2imUHNPsJAZ7yKPW6EkEGJkKlAIJ+avkwOkEEAAL2+Ib/0MS0/EK7BPs0+wkBnvIo9boSQQew4t0CGIGS/PaKZQUHGxkC9MsW+bOOYQQAAYMZLvjI+/r7ySVi/fmx0QXwm0T7HqINBmnVtQejWw77cMohBvrtmQQ8ORD9ll4NBAAAyoNa+5CZWvzyntL789nlB+xWtwNLhskECooNBolq5wKdAskENfn5BD4nAwHq4u0EAAIa7Mb0vR2G/RC3yvq8yckHUaLnAX/i4Qfz2eUH7Fa3A0uGyQQ1+fkEPicDAeri7QQAASDgpv7GAMD+rn5c+QcbGQL0yxb5s45hB7Di3QIYgZL89oplBGSS/QGl8Wb9DR51BAAA4ZMi+m8/EvkYKVr+adW1B6NbDvtwyiEF+bHRBfCbRPseog0HC2oFB5nL2vsFag0EAAFKu3z4/gWK/XAwmPq04jUFZlr3A5he0QWAmlEEj1LjA/+qnQUnrk0Gjh7TAYmeuQQAAafbbPqTlY7/TExs+A5+PQeOYt8CrFrZBrTiNQVmWvcDmF7RBSeuTQaOHtMBiZ65BAACyRWO+3zUAvx4sVr++u2ZBDw5EP2WXg0GadW1B6NbDvtwyiEGnQGRB/4VGvj2EiEEAAKKsoz0n1n6/2B5Uva04jUFZlr3A5he0QWv2jUEzbrvAWt+qQWAmlEEj1LjA/+qnQQAA0P8Mv8UESD65vE8/O2zmQFsNiEEjF8dBBJcJQUFfjUGGZ81BqD79QLCKqkEwqcJBAAC3lTY/p8qPPkdoJD9xk79BKqkiQDvYPEHXO8NBjpAeQAIrNUFe3cFBK9w2QHyNNUEAANytKz1ThSa/uyRCvzceOUGb+U4/U3KAQadAZEH/hUa+PYSIQXOOY0EzNoy/9a6OQQAAY3LEPSljDL8KqVS/p0BkQf+FRr49hIhBv5tdQUdeiz/eW4FBvrtmQQ8ORD9ll4NBAAA/eYK+pAwfv2yxPb+nQGRB/4VGvj2EiEGadW1B6NbDvtwyiEFzjmNBMzaMv/WujkEAAAEe6zzsfX+/u5hlvWv2jUEzbrvAWt+qQa04jUFZlr3A5he0QRUMiEEcIb7AVduzQQAA1hfavnQCGb9L4C2/OSh9QQEagb8ar4dB/zZzQWOk0b85O49BmnVtQejWw77cMohBAACRnF0/V9eIvsa62L6V1MJBdYC7P7+/PUFwfMJBaQ/7Pw5TN0HXO8NBjpAeQAIrNUEAAFGfOD8rDg0/nPrWvo66bUFwEjBCQ5cMQq+lZkH8JS5ClwYHQqRDYkGrXjFCAF8JQgAAf3KqPbe7Hb9LgUi/Nx45QZv5Tj9TcoBBc45jQTM2jL/1ro5BknFAQaBlfL/+IIxBAABKqys/5jgqP81nqL6rdGRBaGcyQiGUDEKOum1BcBIwQkOXDEKkQ2JBq14xQgBfCUIAAMo1KL8zBRo/F4voPlEfmUBT5QTAH0+bQaNOqUDCxeu/a62eQew4t0CGIGS/PaKZQQAAB6NxP5/5kL45Cy6+H6NsQeHYLUL+wQ1CTotlQedbK0InDghCQrFnQXdCLUIZ3wdCAADVS9497noLvwfcVL+/m11BR16LP95bgUGnQGRB/4VGvj2EiEE3HjlBm/lOP1NygEEAAJlWGb9i8Ao/tboWP7vhWECW1wHA8ZePQVEfmUBT5QTAH0+bQaxji0BeRI2/dKSQQQAAJ0ATv/m/Dz+1Rxg/UR+ZQFPlBMAfT5tB7Di3QIYgZL89oplBrGOLQF5Ejb90pJBBAADl/TC/ki8hP51ttb6mmiRBC+onQljp0EFGFh9Bh68hQrwowEHOiRlBFbsgQsgtwkEAACkHML/IuyE/Zji3vqPyHUELkipCe6/gQaaaJEEL6idCWOnQQc6JGUEVuyBCyC3CQQAALEHMvkQoMz4qb2Y/OzcdQQbbn0ErKc5BGO4RQexDtUGgf8dBBJcJQUFfjUGGZ81BAABeSFS//cvmPnstqT4fOPJACLVfwNiACkJRGedA0QSTwPUCDUKEVO5AZmiNwLlSDkIAAG+GF7/LhDY+OztJPwSXCUFBX41BhmfNQRjuEUHsQ7VBoH/HQag+/UCwiqpBMKnCQQAA3xb9Pnf4XT6kgVc/FBB7QSpBgkGBrstBof59QXyzlkFPjsVBn0JpQdmChkH5z89BAADkUmm/FMp3vuBkqj5RGedA0QSTwPUCDUINpO5A2SGiwEE4DkLwRe9AjpScwNrwDkIAAL2jMj8qbVY+gFsvP/ISikHwT3tBmu3BQaH+fUF8s5ZBT47FQZnQhEHeyntBWzbHQQAAwpJOvsXfcb9VJoS+hgmVQR88tcBQrJ9Ba/aNQTNuu8Ba36pBFRGPQdL+r8Bui59BAABCVVO8yyVPP/lhFr8k1ylBKhEjQrMiwEFpRjVBvHonQnUqzEG2b0lBpHwlQoZ0xkEAABMpKT8kxDQ/EUyCvud5XUEMZDNCLGcJQgJQXEHQ7i5CfI74QYqRVEHJtzNCRIcEQgAA3eMrP7bPMj81f32+AlBcQdDuLkJ8jvhByu1TQQzHMEK8mPdBipFUQcm3M0JEhwRCAACA/A6/cMmovgHbQr/xX+9AdCARQI9Kh0Gp0Q1BWo0dQC3/fEHMDghBbOmsPxN2hEEAACOnbT/z+ak+ek4rvqRDYkGrXjFCAF8JQh0vYkH6pS5C9NsDQgJQXEHQ7i5CfI74QQAAxPBXPyCqAD9O9EG+pENiQateMUIAXwlCAlBcQdDuLkJ8jvhB53ldQQxkM0IsZwlCAAD8rhW/B/2/vrEpOL/MDghBbOmsPxN2hEErhflA5d+uPxL9iEHxX+9AdCARQI9Kh0EAAOdMCb9K2K++SV5Fv6nRDUFajR1ALf98QaKHEEHUCT8/UauDQcwOCEFs6aw/E3aEQQAAyqpbP8cd6z6YXmu+pENiQateMUIAXwlCr6VmQfwlLkKXBgdCHS9iQfqlLkL02wNCAADKYHo/m9AVPoUAGL6JfGRBc+wpQu+a/kGvpWZB/CUuQpcGB0JCsWdBd0ItQhnfB0IAAL3fyr4gTkQ/M0UBv6aaJEEL6idCWOnQQSTXKUEqESNCsyLAQUYWH0GHryFCvCjAQQAAf819v911BT4JxCg8TgwKQYH4FELe3bpBIK0LQfpeF0I2e8xBuh4SQenRIkKT2+BBAAC0/HO/okORPsRG2L26HhJB6dEiQpPb4EG5GBRB5+EfQoYnyEFODApBgfgUQt7dukEAAP3qYb40nAm9NYt5v6KHEEHUCT8/UauDQcXWBkGQX4A/8rGEQcwOCEFs6aw/E3aEQQAAyRp4P3CFBL43wVY+MAZiQXNWFUIa7+FBiJNoQVhAGkLn29hB5NdlQeDUIEJ6S+dBAAAsEhg/yRZEPqEESD+h/n1BfLOWQU+OxUEUEHtBKkGCQYGuy0GZ0IRB3sp7QVs2x0EAAACjDD/s5yo+W5lRP/MFbkEsDqxBpY/GQZ9CaUHZgoZB+c/PQaH+fUF8s5ZBT47FQQAAykgMv4wgvb5ZIUC/RzrSQIlZ0D+WIY9B8V/vQHQgEUCPSodBK4X5QOXfrj8S/YhBAADLbhe/dhj6voI3JL+AMO5A4TuPP7LIi0H1WuJAswyRP/9sjkFHOtJAiVnQP5Yhj0EAALAd+T7cfEI+Kk5aPxQQe0EqQYJBga7LQZ9CaUHZgoZB+c/PQVuRb0FFXVtBAIvTQQAAIVFEv1irAz7x+CC/q0HDQN/Pxz8vlpNB8V/vQHQgEUCPSodBRzrSQIlZ0D+WIY9BAACMDuM+citcPgrAXj9bkW9BRV1bQQCL00FND2xB7wo2QU8M2UEv03tBYkA8QXRD1EEAANUOEr+hls++mtY2v3qP20CcKUc/X2WRQaDNykCUKFI/KIyUQfVa4kCzDJE//2yOQQAAVUUwP6aC1r5Thxe/ldTCQXWAuz+/vz1Bg73AQaN3sz/ZmDlBcHzCQWkP+z8OUzdBAAC14M27Cr+xvqcScL8jXbtB7O4yQPJpMUGDvcBBo3ezP9mYOUGSKrlBd/ajP39qOkEAAPAt7j7SY5q+Xg9VvyJdwUGgfENAtbsvQdc7w0GOkB5AAis1QXB8wkFpD/s/DlM3QQAAtxgYP3dsRD5n+kc/mdCEQd7Ke0FbNsdBFBB7QSpBgkGBrstBL9N7QWJAPEF0Q9RBAAApTN8+HWpZPtfdXz8UEHtBKkGCQYGuy0FbkW9BRV1bQQCL00Ev03tBYkA8QXRD1EEAAA+qnT7yyLC+TvRivyJdwUGgfENAtbsvQXB8wkFpD/s/DlM3QYO9wEGjd7M/2Zg5QQAArbAxvA27sr4h4W+/g73AQaN3sz/ZmDlBI127QezuMkDyaTFBIl3BQaB8Q0C1uy9BAAD5CWo/Q/pXvtYosT4wBmJBc1YVQhrv4UGsdldBC4sSQnV67EEAqWBBdrwLQtYH2EEAAP2uYz2oQn6/q2fRvWAmlEEj1LjA/+qnQWv2jUEzbrvAWt+qQYYJlUEfPLXAUKyfQQAA360oP10p5z7+Bho/bL3BQbLvFj+ZW0dB6Eq9QV+KNT6CDFZBqdzAQeKZwT7Z0UtBAAAnuV4/xh2YvipzyT4AqWBBdrwLQtYH2EGsdldBC4sSQnV67EFIc1VB8wIIQpbM3kEAAMVoTT9mkX0+NwMLP2y9wUGy7xY/mVtHQZXUwkF1gLs/v789Qdc7w0GOkB5AAis1QQAAcfKUvmupa78Ad4W+a/aNQTNuu8Ba36pBFQyIQRwhvsBV27NBFRGPQdL+r8Bui59BAABT+kI/z/6NPg/uFT/oSr1BX4o1PoIMVkFsvcFBsu8WP5lbR0HXO8NBjpAeQAIrNUEAAIEZ7z6vWQy/Y5wxv9FMvkHmE46+N4xLQYO9wEGjd7M/2Zg5QYfywEFOpZM+APVHQQAA+qPHPFNxC79lmVa//w64QaA7Vb8rVFBBkiq5QXf2oz9/ajpBg73AQaN3sz/ZmDlBAACk12Y/R4mpvkRMjr6V1MJBdYC7P7+/PUFsvcFBsu8WP5lbR0GH8sBBTqWTPgD1R0EAAEB5Lj9kJea+/9MTv5XUwkF1gLs/v789QYfywEFOpZM+APVHQYO9wEGjd7M/2Zg5QQAAVbeyPTRyEL8ILFK/0Uy+QeYTjr43jEtB/w64QaA7Vb8rVFBBg73AQaN3sz/ZmDlBAAAaAAE/bIbkPtRPPT8CsXNB+iLNQApC50Fn7nJBs8GZvZ5qA0JfaYBBD6i/QGLR5EEAAAL3sj4hbPg+Gi9NPwKxc0H6Is1ACkLnQTL9aEEw9pE/sY4BQmfuckGzwZm9nmoDQgAA1hEJP0w/3T4AxTk/Z+5yQbPBmb2eagNCsZeEQZSSMEA4H/FBX2mAQQ+ov0Bi0eRBAADqg2U/Cem3PsK1hL4dL2JB+qUuQvTbA0KvpWZB/CUuQpcGB0KJfGRBc+wpQu+a/kEAAIA8NL/aQae+FWwhv6tBw0Dfz8c/L5aTQUc60kCJWdA/liGPQaDNykCUKFI/KIyUQQAAjWp9v6TEiz1SXv69Blz5QHBDvsABOg1Ccqf3QJXYvsC04g5CoBv6QH3Ur8DmeA1CAACWijS+Wyp1v9H8aL4CooNBolq5wKdAskEVEY9B0v6vwG6Ln0EVDIhBHCG+wFXbs0EAACNTYr9zpOA9NJfovsHU00AdUts+MXuUQXqP20CcKUc/X2WRQWLE2EBV6OU+oB6SQQAAsTkovgLSc7/Pb4O+FQyIQRwhvsBV27NBDX5+QQ+JwMB6uLtBAqKDQaJaucCnQLJBAAACqU0/KGA6PrsmET/yEopB8E97QZrtwUFtSI9Bhp1BQefOw0GoPY1B4V2EQXlJu0EAAFehej1vlly/zPYAvyDkcUEJiNfAB9XFQfzzW0FX7u3ABRTOQa8yckHUaLnAX/i4QQAAqEDWO73DWb98lAa//PNbQVfu7cAFFM5BeXcMQQsE0sCdSsJBrzJyQdRoucBf+LhBAADFIVo/HkcjPjJA/z7N3Y9B4wwGQSRWzEGk25RB+iNBQQFbukFtSI9Bhp1BQefOw0EAAHh6fj/XLNw9oY6MPFhDZkHD1B9CHPLVQYiTaEFYQBpC59vYQTVZbEEKiRJC90fMQQAAMnbYvf0Idj8gs4K+zBIuQYHcNkKLpAxCLm4+QWCBNUI12AVC+Y0sQfm4M0KX+wBCAADNkz+/15koP5+PoT2y1dpACIEQP01Qj0EkQNBAZWPHPQRplUFixNhAVejlPqAekkEAAEiOEr+948q+mcE3v6DNykCUKFI/KIyUQXqP20CcKUc/X2WRQcHU00AdUts+MXuUQQAAsB18P4tgVz0ZWCk+7EF3Qf8XCEJTcLJBWENmQcPUH0Ic8tVBNVlsQQqJEkL3R8xBAAACf9g+ab9fP3cfdb4eHk5B4EU0Qsi0A0LQTVhBAnA2QpobEEKKkVRBybczQkSHBEIAAK2poD68Hmw/utRmvh4eTkHgRTRCyLQDQlk+TUH0FTdCOOkOQtBNWEECcDZCmhsQQgAAkqJ+P7Q00z0PZRE5iJNoQVhAGkLn29hBWENmQcPUH0Ic8tVB5NdlQeDUIEJ6S+dBAAC3owI/WBlrPsIqVD+gbYNB8EIvQZ6q0kGZ0IRB3sp7QVs2x0Ev03tBYkA8QXRD1EEAADNbeT9tv18+7t5xvVhDZkHD1B9CHPLVQexBd0H/FwhCU3CyQXoKcUE4MA5CTEWsQQAAB5AvPvvRdD/waHK+Hh5OQeBFNELItANCLm4+QWCBNUI12AVCWT5NQfQVN0I46Q5CAAACJeY+Wq1VP7/tor6KkVRBybczQkSHBEJWOkhB8qgyQnjK+kEeHk5B4EU0Qsi0A0IAAC+AMz9gXTk+aYswP6Btg0HwQi9BnqrSQfISikHwT3tBmu3BQZnQhEHeyntBWzbHQQAAMa12PzBPtL0jSYE+MAZiQXNWFUIa7+FBNVlsQQqJEkL3R8xBiJNoQVhAGkLn29hBAADObXI/EVcxvk+Lij4AqWBBdrwLQtYH2EE1WWxBCokSQvdHzEEwBmJBc1YVQhrv4UEAAEFLez8Tzi8+scOqPcLFSUFeFZJB6wb2QRvqRUFMFZVBr0cDQt81RkGJPpFBdVwGQgAAF7PDvEbTXL/uXAG/DX5+QQ+JwMB6uLtBIORxQQmI18AH1cVBrzJyQdRoucBf+LhBAABw9mk/wx/PPq4fCD3CxUlBXhWSQesG9kHih0dBXY2UQZjM9kEb6kVBTBWVQa9HA0IAAFt5J7rmQFW/J6ENvx5iBEGACrHALOK1Qa8yckHUaLnAX/i4QXl3DEELBNLAnUrCQQAAt55Bv0j4S756hR+/9VriQLMMkT//bI5BK9/mQP3JZT9jqI1Beo/bQJwpRz9fZZFBAAAVPFS+eBpgv8iX376WeBNBSsfrwEKKzUHvDwBBJD3VwKnZxkF5dwxBCwTSwJ1KwkEAAKjSd7/jBWo++zDTvXqP20CcKUc/X2WRQbLV2kAIgRA/TVCPQWLE2EBV6OU+oB6SQQAAFvwMvy+enb7KnUa/RzrSQIlZ0D+WIY9BK4X5QOXfrj8S/YhBgDDuQOE7jz+yyItBAAA/akq+Ghlpv8Houb771uNAuVXCwDvZvkFqsPJAkIbBwP9RvEHvDwBBJD3VwKnZxkEAABs9Kr/P3cW9J5Y9v4Aw7kDhO48/ssiLQSvf5kD9yWU/Y6iNQfVa4kCzDJE//2yOQQAAPBgivtKnab+c3MC+eXcMQQsE0sCdSsJB7w8AQSQ91cCp2cZBarDyQJCGwcD/UbxBAABpnIu8zdlVv5KoDL8eYgRBgAqxwCzitUF5dwxBCwTSwJ1KwkFqsPJAkIbBwP9RvEEAAGF9Db9Pl9++rrU1v/Va4kCzDJE//2yOQaDNykCUKFI/KIyUQUc60kCJWdA/liGPQQAAgXIsv276PD/NpRO9K9/mQP3JZT9jqI1BsUbpQGtEcD9qIYlBstXaQAiBED9NUI9BAADmmDi/Iq8QPzUyzb6y1dpACIEQP01Qj0F6j9tAnClHP19lkUEr3+ZA/cllP2OojUEAAMHg4z7Pw1C/oW69vmui+UAC56bAJb2vQWqw8kCQhsHA/1G8Qa4x3EDq4rbAUbGvQQAASVcEvgG5eT8SbTY+erDJQDqeOj8Xn4VBBAqdQGSXEj9kX4RB+4fNQL7HID9IvYpBAABV4HK/IFctvqypiD4NpO5A2SGiwEE4DkJC3vFAHjqpwFsXD0LwRe9AjpScwNrwDkIAAC8AS7+fEhK/O7Ravg2k7kDZIaLAQTgOQqAb+kB91K/A5ngNQkLe8UAeOqnAWxcPQgAAkp9ev80VS77yfee+oBv6QH3Ur8DmeA1Ccqf3QJXYvsC04g5CQt7xQB46qcBbFw9CAADYqB+9+TG+Psp4bb+ihxBB1Ak/P1Grg0HLSPtAOTozPxHrg0HF1gZBkF+AP/KxhEEAADt54LxsZNw8qc9/v6KHEEHUCT8/UauDQd5OA0HYitw+VMiDQctI+0A5OjM/EeuDQQAAOeMhP8H80z6mnCc/sZeEQZSSMEA4H/FB4fmFQfpnpUDul+NBX2mAQQ+ov0Bi0eRBAAD4fDm/uJWOPnpkIb8uefdAP0iOP0WtiEErhflA5d+uPxL9iEHXMv9AkR+AP/gQhkEAAEuQ2z5O5Jk+DxdaP00PbEHvCjZBTwzZQf20akEZ+gJBomXiQUokfkHlxQRBSzDdQQAAF//QPs4Llz5VKV0/TQ9sQe8KNkFPDNlBSiR+QeXFBEFLMN1BL9N7QWJAPEF0Q9RBAADqLES/e9SPPr3qE78rhflA5d+uPxL9iEEuefdAP0iOP0WtiEGAMO5A4TuPP7LIi0EAABjnN7+ltjE/8QQ5vSvf5kD9yWU/Y6iNQYAw7kDhO48/ssiLQbFG6UBrRHA/aiGJQQAA6GLCvs4AYD+zx5m+Lnn3QD9Ijj9FrYhBsUbpQGtEcD9qIYlBgDDuQOE7jz+yyItBAAAWyEq/+sYIv/UYl74NpO5A2SGiwEE4DkLaJPdAuXOpwPoFDUKgG/pAfdSvwOZ4DUIAAIpwO78RmCq/+TkQvtok90C5c6nA+gUNQg2k7kDZIaLAQTgOQuhn80DV36PAVycMQgAA66NqvzG0iL5ua5g+URnnQNEEk8D1Ag1Cmq7iQIj+lsCx3QpCDaTuQNkhosBBOA5CAAAQmxO/pSRQv9brpL0NpO5A2SGiwEE4DkKaruJAiP6WwLHdCkLoZ/NA1d+jwFcnDEIAAK9uaL8yktE9BhbQPmGg8EBzELnAYAsMQuhn80DV36PAVycMQuh07EA7hrLAl6wKQgAAaIZYv9nHtj2rpgY/YaDwQHMQucBgCwxC2iT3QLlzqcD6BQ1C6GfzQNXfo8BXJwxCAAD+nAc/QB1ZPxyGIjwb6kVBTBWVQa9HA0KLW0NBhQ6WQWmZ90HvekFBDGaWQXM/BkIAABLPwLzo438/eKSOvItbQ0GFDpZBaZn3QXpaM0H2L5ZBHfUEQu96QUEMZpZBcz8GQgAAF3t4P+G5672+VVg+3zVGQYk+kUF1XAZC2sZHQe9AiUGoYgJC0NlIQSKQjUFbUwJCAAC3ZHs/bootPtCoqj3CxUlBXhWSQesG9kHfNUZBiT6RQXVcBkLQ2UhBIpCNQVtTAkIAAM3WCz4MIWK/g5rlvmui+UAC56bAJb2vQR5iBEGACrHALOK1QWqw8kCQhsHA/1G8QQAAzVR1v76Gib48O8c9mU3gQIW7rsCn6QNCtYTSQEonocAGQO9B4jXwQGn52sAtOwhCAACl64W+0HhrP7O8lT6y1dpACIEQP01Qj0GxRulAa0RwP2ohiUH7h81AvscgP0i9ikEAADqok74xnm8/MaJOPrFG6UBrRHA/aiGJQXqwyUA6njo/F5+FQfuHzUC+xyA/SL2KQQAAEmV3v+05cb5G5NI9mU3gQIW7rsCn6QNC3F3QQHjpisAL7PZBtYTSQEonocAGQO9BAACobLu+js1DP+SzB7+xRulAa0RwP2ohiUEuefdAP0iOP0WtiEHXMv9AkR+AP/gQhkEAAIEca7+O1cm+ngAKPeI18EBp+drALTsIQrWE0kBKJ6HABkDvQRYB50DBU9TA9SrlQQAAee4iPpTFPT9z7Ca/pKHVQDbr8j5ef4FBNdzGQFVaIT+DA4JBg5HcQM4jPz9zZYRBAAD41L+9t7p2P/+sf756sMlAOp46PxefhUGxRulAa0RwP2ohiUGDkdxAziM/P3NlhEEAAL0lpb0QFXo/yLpKvjXcxkBVWiE/gwOCQXqwyUA6njo/F5+FQYOR3EDOIz8/c2WEQQAA0nQfv1Y5kT0ac0e/K4X5QOXfrj8S/YhBzA4IQWzprD8TdoRBxdYGQZBfgD/ysYRBAABehZG+7fwaPzNRPr/XMv9AkR+AP/gQhkErhflA5d+uPxL9iEHF1gZBkF+AP/KxhEEAAJb1gr6JEzM/YtIqv8tI+0A5OjM/EeuDQdcy/0CRH4A/+BCGQcXWBkGQX4A/8rGEQQAAktyQPRzlJT+fIUK/y0j7QDk6Mz8R64NBpKHVQDbr8j5ef4FB1zL/QJEfgD/4EIZBAAAZO26/NoOzvnKJ1z2QyuBAEAfSwEdZ2UEWAedAwVPUwPUq5UF/B8VAVJeYwLjQy0EAAEu6zT6+u9A+N+lRPwKxc0H6Is1ACkLnQUokfkHlxQRBSzDdQf20akEZ+gJBomXiQQAARSBFv828uTreVCM/2iT3QLlzqcD6BQ1CYaDwQHMQucBgCwxCoBv6QH3Ur8DmeA1CAAC+ZD+/W4ZSvd2AKT+gG/pAfdSvwOZ4DUJhoPBAcxC5wGALDEIGXPlAcEO+wAE6DUIAAJM09z4CXro+Y+ZLP19pgEEPqL9AYtHkQUokfkHlxQRBSzDdQQKxc0H6Is1ACkLnQQAAtTdsv2qjv72Rc78+kMrgQBAH0sBHWdlBfwfFQFSXmMC40MtB4q/VQPuLx8BzJ9NBAAA2HRg/TPqCPsk2Qz+gbYNB8EIvQZ6q0kFKJH5B5cUEQUsw3UEw6IZBm0L2QDiz2EEAAEOmHT8aVK0+tyE2PzDohkGbQvZAOLPYQUokfkHlxQRBSzDdQV9pgEEPqL9AYtHkQQAAwWBFP/JWNz6dcxw/bUiPQYadQUHnzsNB8hKKQfBPe0Ga7cFBMOiGQZtC9kA4s9hBAACBsQo/ldiDPtfTTD/yEopB8E97QZrtwUGgbYNB8EIvQZ6q0kEw6IZBm0L2QDiz2EEAAMNLQD+K+Ec+kW0hPzDohkGbQvZAOLPYQc3dj0HjDAZBJFbMQW1Ij0GGnUFB587DQQAA14ANP4xZjT5hSkk/SiR+QeXFBEFLMN1BoG2DQfBCL0GeqtJBL9N7QWJAPEF0Q9RBAAAd8Fw//qgXPpdD9z7N3Y9B4wwGQSRWzEG8ypZBMrkLQRsXv0Gk25RB+iNBQQFbukEAAGipF78OWAM//wEfP10Z+ECHc3XA3TsNQjiNEUEgpe+/EeALQqdi+kC9CPS/SyIHQgAAipMZvzqv/D4xNSE/OI0RQSCl778R4AtCNAYHQalgEr+QSgVCp2L6QL0I9L9LIgdCAAC4MUi/OUfFPtPT+j4fOPJACLVfwNiACkKnYvpAvQj0v0siB0LeE/NApm8owCf1B0IAAAPGWL8AobI+eJrNPl0Z+ECHc3XA3TsNQqdi+kC9CPS/SyIHQh848kAItV/A2IAKQgAAw5FDvlvPdj9I6Dy+sUbpQGtEcD9qIYlB1zL/QJEfgD/4EIZBg5HcQM4jPz9zZYRBAABAFqu9pPJRP2vqEL/XMv9AkR+AP/gQhkGkodVANuvyPl5/gUGDkdxAziM/P3NlhEEAAGSXNT50TC6/nOs1v4YqEkFCY/q+xFaKQW78D0EIHzLAnqabQRR1D0HNoeK/2NKTQQAAT+dpv3VfLD5yZr0+LQnhQMR3AcByRwFC3hPzQKZvKMAn9QdCZ8LqQLO7h794hwJCAAAw9HK/+3hSPpCldD4dguZAEbRowAwsBUIfOPJACLVfwNiACkLeE/NApm8owCf1B0IAACOKTb24WCO/5LFEvzceOUGb+U4/U3KAQZJxQEGgZXy//iCMQYYqEkFCY/q+xFaKQQAATAXuvTfuD780m1G/hioSQUJj+r7EVopBoocQQdQJPz9Rq4NBNx45QZv5Tj9TcoBBAACtam2/V/jtPcQJtj7eE/NApm8owCf1B0ItCeFAxHcBwHJHAUIdguZAEbRowAwsBUIAALmFNb8Gs8c+lmIWP2fC6kCzu4e/eIcCQt4T80CmbyjAJ/UHQqdi+kC9CPS/SyIHQgAA+cSaPk4lK7/W8S2/B0UHQXIuUr87h4pBhioSQUJj+r7EVopBFHUPQc2h4r/Y0pNBAACU52S/4jbMPplWUD5RGedA0QSTwPUCDUIfOPJACLVfwNiACkIdguZAEbRowAwsBUIAAGXYBb93p1m//wR8vWdW8ECgwtrAin3WQZDK4EAQB9LAR1nZQfTB0UCmi8PAokHHQQAA5Akuvz+8O78yD7W79MHRQKaLw8CiQcdBkMrgQBAH0sBHWdlB4q/VQPuLx8BzJ9NBAADbNhe/m4JOvy0VnLwcQs1AA6fAwJiBy0H0wdFApovDwKJBx0Hir9VA+4vHwHMn00EAAMk9aL+usMa+1mUmPhxCzUADp8DAmIHLQeKv1UD7i8fAcyfTQddlykAi77bA6VDNQQAA2I1Lvk4+Qb+vAiA/IqEwQb2tiEGNcAJC0zEzQRaEb0Er2vBB5GM1QQPvjEE0YwVCAAD15RU/CIZPPxjVMTsb6kVBTBWVQa9HA0Lih0dBXY2UQZjM9kGLW0NBhQ6WQWmZ90EAADx6qztV/n8/hcueu3paM0H2L5ZBHfUEQotbQ0GFDpZBaZn3QeciM0FTE5ZB97byQQAAfj4/P2yZ/77TweA+sgBLQex1gkH1TPpB2sZHQe9AiUGoYgJCorxHQSUqg0FQ4f1BAABpbXE+GoM6v82jJD+ivEdBJSqDQVDh/UHaxkdB70CJQahiAkLhj0RBQgF+QTi/+UEAAN1U4T6qTDC/D4QTP+GPREFCAX5BOL/5QdrGR0HvQIlBqGICQtIAQkEk9IhB+k4DQgAA4AaevtcWbr82Nky+9MHRQKaLw8CiQcdB+9bjQLlVwsA72b5BZ1bwQKDC2sCKfdZBAABUIY69uGlFv4sDIj/TMTNBFoRvQSva8EHSAEJBJPSIQfpOA0LkYzVBA++MQTRjBUIAAKwmPz+7fFM+rd4hP//YjEEU8s1AD/rUQc3dj0HjDAZBJFbMQTDohkGbQvZAOLPYQQAAha+PPr2hIL+C7zm/HIz6QN7Et75FZ4VBhioSQUJj+r7EVopBB0UHQXIuUr87h4pBAABmiaY+16YCv5fLS7+ihxBB1Ak/P1Grg0GGKhJBQmP6vsRWikEcjPpA3sS3vkVnhUEAAM3RV78fiuq+Lk2QPtdlykAi77bA6VDNQc8Dv0Dri7TAIsbFQRxCzUADp8DAmIHLQQAAK1IWP5LMuT5HOjk/4fmFQfpnpUDul+NBMOiGQZtC9kA4s9hBX2mAQQ+ov0Bi0eRBAACPKUg/At1/Po43Ej8w6IZBm0L2QDiz2EEct4xBxcanQB5V2UH/2IxBFPLNQA/61EEAAOksTT9KZ4I+HIUKPxy3jEHFxqdAHlXZQTDohkGbQvZAOLPYQeH5hUH6Z6VA7pfjQQAA3lZiP6+9Zj6Mj9E+b0iRQWfTJT9ZtONBYwSTQYnVn0AR0MxBHLeMQcXGp0AeVdlBAACA4EM/2pquPg7PCz+xl4RBlJIwQDgf8UHBT4pBFdCMP3Fl8UEct4xBxcanQB5V2UEAADuxSD9QxaI+mYIIP7GXhEGUkjBAOB/xQRy3jEHFxqdAHlXZQeH5hUH6Z6VA7pfjQQAAANBjPxhzNz4+y9Y+/9iMQRTyzUAP+tRBHLeMQcXGp0AeVdlBYwSTQYnVn0AR0MxBAACH+F4/KObgPQIx9T5jBJNBidWfQBHQzEG8ypZBMrkLQRsXv0HN3Y9B4wwGQSRWzEEAAMBqXD9yKt89/1r+PmMEk0GJ1Z9AEdDMQc3dj0HjDAZBJFbMQf/YjEEU8s1AD/rUQQAA1NHAPaIolL7223O/HIz6QN7Et75FZ4VB3k4DQdiK3D5UyINBoocQQdQJPz9Rq4NBAAC0Gnk/+5sCPdHMaT7+qphBFV8nQM3HxkHr/JRBItmUPpsP2UGSYZpBac4UQJ/Nv0EAAAeWK7/biDe/d1ZEPuhn80DV36PAVycMQpqu4kCI/pbAsd0KQvqA70Cqh6PADJwKQgAAyyHjPnHGob4gs1a/HIz6QN7Et75FZ4VBZ3m3QElm278+noBBwfTLQHJD274E535BAACyZBQ+fWeAPrAGdb/eTgNB2IrcPlTIg0H9ruBAIxL8PCCCgUHLSPtAOTozPxHrg0EAALINB78iLze/x2/qPg407kD0PKjAp4AJQvqA70Cqh6PADJwKQpmK5EDhCaPAciAJQgAADaJ6v/4MTT5A0hg9+oDvQKqHo8AMnApCDjTuQPQ8qMCngAlC6HTsQDuGssCXrApCAABHxW6/I7BMPoizmT76gO9AqoejwAycCkLodOxAO4aywJesCkLoZ/NA1d+jwFcnDEIAABp2Zr/dUNq+yVS0Peh07EA7hrLAl6wKQpZd7UBEx7bAvUIJQmGg8EBzELnAYAsMQgAAXro3v/8RMb+oJKU9zwO/QOuLtMAixsVB/HzDQAmZvMBJdr5BHELNQAOnwMCYgctBAACBLfa+bWVgv1WKszz0wdFApovDwKJBx0EcQs1AA6fAwJiBy0H8fMNACZm8wEl2vkEAABvjfb83EJI94zTavQ407kD0PKjAp4AJQpZd7UBEx7bAvUIJQuh07EA7hrLAl6wKQgAAIHMrvpJXer97OgC+/HzDQAmZvMBJdr5B+9bjQLlVwsA72b5B9MHRQKaLw8CiQcdBAADjMTa/R5IyvyhTqj3PA79A64u0wCLGxUF7NbtATimzwD6JwEH8fMNACZm8wEl2vkEAAK7ndj9Um+i9FD90Pv4bTUFcyINBZWL3QdDZSEEikI1BW1MCQtrGR0HvQIlBqGICQgAAWR62vF9Sfr+LpuW9LzvZQPgIvsDV2bVBarDyQJCGwcD/UbxB+9bjQLlVwsA72b5BAAAosgk+pbN0vym/hb5qsPJAkIbBwP9RvEEvO9lA+Ai+wNXZtUGuMdxA6uK2wFGxr0EAAEvScj+Xija+PAiGPv4bTUFcyINBZWL3QdrGR0HvQIlBqGICQrIAS0HsdYJB9Uz6QQAAm2g1vhFye788J389/HzDQAmZvMBJdr5Bz6W3QCdJvcDxVLNB+9bjQLlVwsA72b5BAADpaAi/JvxUv4xHHj78fMNACZm8wEl2vkEHpbhAxDe4wLICu0HPpbdAJ0m9wPFUs0EAANKFRD+Mze2+thLiPqK8R0ElKoNBUOH9QTh2T0HiOGdB7c3mQbIAS0HsdYJB9Uz6QQAAc/Ucv5xsQL/D7Xg+/HzDQAmZvMBJdr5BezW7QE4ps8A+icBBB6W4QMQ3uMCyArtBAAAit2m/wUC5vkU5QT57NbtATimzwD6JwEEEP7ZAm4WrwA0yvkEHpbhAxDe4wLICu0EAAB6Vcj8uIEW+x42CPrIAS0HsdYJB9Uz6QTh2T0HiOGdB7c3mQf4bTUFcyINBZWL3QQAAO0M8P640/76tCes+9F9LQWcNaEFZh+pBOHZPQeI4Z0HtzeZBorxHQSUqg0FQ4f1BAAA4pKs+0ijDvrCQXL/eTgNB2IrcPlTIg0EcjPpA3sS3vkVnhUH9ruBAIxL8PCCCgUEAAMS+BD8V6fy+HKwyvyMu8kCOZ8m/4bmKQWd5t0BJZtu/Pp6AQRyM+kDexLe+RWeFQQAAhoPQPjYyAb8U30K/Iy7yQI5nyb/huYpBHIz6QN7Et75FZ4VBB0UHQXIuUr87h4pBAACqWW0/Dc4wPoxCqj5vSJFBZ9MlP1m040Guf5dBQVeNQNi3wkFjBJNBidWfQBHQzEEAAAcoeT8+ctk9zIxQPlwEmkF+JZxAruO2Qf6qmEEVXydAzcfGQZJhmkFpzhRAn82/QQAAZOptP6IQLD5+Tqg+rn+XQUFXjUDYt8JBb0iRQWfTJT9ZtONB/qqYQRVfJ0DNx8ZBAACd83Q/N6QXPgwGgD7+qphBFV8nQM3HxkFcBJpBfiWcQK7jtkGuf5dBQVeNQNi3wkEAAMoWPz7M4uk+WqleP/20akEZ+gJBomXiQfHpUkHyrvxAqirmQY/fYUGw3qlAdm/vQQAA0Ri9Pih/zj7kU1Y/j99hQbDeqUB2b+9BArFzQfoizUAKQudB/bRqQRn6AkGiZeJBAADUkw8+tIXkPqdBYj9p4FJBFaO7QL9h7kGP32FBsN6pQHZv70Hx6VJB8q78QKoq5kEAAJYU5Lpt3uY+IX9kP/HpUkHyrvxAqirmQVJKK0FZHNZA6v/qQWngUkEVo7tAv2HuQQAA7v4zv601Rr13nTU/ll3tQETHtsC9QglCgpjiQMc8rsDS/wdC/ZTqQLt1wsD20AhCAAAsnYU9iNgvv0FMOb/oRWlBSzopwAOzmkEUyFZBJVs7wDAEnEFzjmNBMzaMv/WujkEAAN31kD25HDC/Rek4v5JxQEGgZXy//iCMQXOOY0EzNoy/9a6OQRTIVkElWzvAMAScQQAAdXRvv5tosb5tFZE9/ZTqQLt1wsD20AhCgpjiQMc8rsDS/wdCmU3gQIW7rsCn6QNCAADfMOC+lnhiv/0FJD4HpbhAxDe4wLICu0ENsK9ALmW3wGkGtkHPpbdAJ0m9wPFUs0EAAN+6br8DQ6Q+z6IpPpqu4kCI/pbAsd0KQlEZ50DRBJPA9QINQh2C5kARtGjADCwFQgAAAgDbPqpaL79U/BY/4Y9EQUIBfkE4v/lBt8xFQb91Y0Ew4ulB9F9LQWcNaEFZh+pBAAB9Bfg8SA5Kv1EAHT/SAEJBJPSIQfpOA0LTMTNBFoRvQSva8EHhj0RBQgF+QTi/+UEAAO5czL7M+Si/5Ooiv/82c0FjpNG/OTuPQduLeEHcQ3XAicSfQehFaUFLOinAA7OaQQAA7sx1vrlNNr/w5Ci/CUBuQchSbsDVHaNBLPBmQfU8kcDBe6tB6EVpQUs6KcADs5pBAADCa64+aoY5vxFVGT+ivEdBJSqDQVDh/UHhj0RBQgF+QTi/+UH0X0tBZw1oQVmH6kEAADgn9L4bGi6/+Y0Ov+hFaUFLOinAA7OaQduLeEHcQ3XAicSfQQlAbkHIUm7A1R2jQQAAaOeFvLd+OL8ibTG/FMhWQSVbO8AwBJxBbvwPQQgfMsCepptBknFAQaBlfL/+IIxBAAAYqIO8Id82v8UZM7/gcxhBDSRfwK9MoUFu/A9BCB8ywJ6mm0EUyFZBJVs7wDAEnEEAAHSHGj8J/Eo/EHeqPeKHR0FdjZRBmMz2QewjREE/7ZZBE3nsQYtbQ0GFDpZBaZn3QQAANDzsvmtSN79YFAa/24t4QdxDdcCJxJ9B5ZpxQYvZnMBrha5BCUBuQchSbsDVHaNBAAAe5Go/fz/DPre35j2bpUlBHySWQZ3N6EHih0dBXY2UQZjM9kHCxUlBXhWSQesG9kEAAHWi3T7oNWQ/2SMJPuwjREE/7ZZBE3nsQeKHR0FdjZRBmMz2QZulSUEfJJZBnc3oQQAAkoO/vdiaez+a3iI+i1tDQYUOlkFpmfdBZls2Qa1tl0EiTetB5yIzQVMTlkH3tvJBAAB6XHs/C+YCPkBBDz48BVJBXHmPQYZ320HCxUlBXhWSQesG9kH+G01BXMiDQWVi90EAAPJ4fT8A+fk9myqNPdDZSEEikI1BW1MCQv4bTUFcyINBZWL3QcLFSUFeFZJB6wb2QQAASixrPwEQrz4Hs0o+m6VJQR8klkGdzehBNA1RQVIYlUGdbdlB37dNQU+PmEGYLdtBAAAhxRC/xdIov7mV/T6ZiuRA4QmjwHIgCUL6gO9AqoejwAycCkKaruJAiP6WwLHdCkIAAHgiVr+U7e2+EbqUPpqu4kCI/pbAsd0KQsBY30DESJzAi5sIQpmK5EDhCaPAciAJQgAA0mx2v0D2fz6/DNY9mq7iQIj+lsCx3QpCAtHdQDF9j8BRBQNCwFjfQMRInMCLmwhCAAAWQEy/4G6Tvh6WBz+CmOJAxzyuwNL/B0KZiuRA4QmjwHIgCULAWN9AxEicwIubCEIAAPKT+r4Y2vy+af83Pw407kD0PKjAp4AJQpmK5EDhCaPAciAJQoKY4kDHPK7A0v8HQgAAQ3w0v+QOW73lCDU/ll3tQETHtsC9QglCDjTuQPQ8qMCngAlCgpjiQMc8rsDS/wdCAABAUlM/F2sKP0XgJT7CxUlBXhWSQesG9kE0DVFBUhiVQZ1t2UGbpUlBHySWQZ3N6EEAAJDldr884ng+QqbUPZqu4kCI/pbAsd0KQh2C5kARtGjADCwFQgLR3UAxfY/AUQUDQgAAvjp/v7nLnL2GKEg8AtHdQDF9j8BRBQNCmU3gQIW7rsCn6QNCwFjfQMRInMCLmwhCAACmWHq/8hVJvqyJkj2ZTeBAhbuuwKfpA0KCmOJAxzyuwNL/B0LAWN9AxEicwIubCEIAAAMGkT3B3ny/GzcOvm4CpEDCCrfA+KGiQS872UD4CL7A1dm1QfvW40C5VcLAO9m+QQAASw/WvlSTZb+GXBQ+z6W3QCdJvcDxVLNBC1GcQOF5tMA3P61BTyWUQBuStsByHKRBAADrYWw+Wwdxvxdce76uMdxA6uK2wFGxr0EvO9lA+Ai+wNXZtUFuAqRAwgq3wPihokEAAGZWSz87Hba+oy38PkeLeUGVS8DA4GIQQkqmb0GnTMzArEoTQqrCeEEESdvACkQOQgAA84DdvtLnYr/g8Sg+z6W3QCdJvcDxVLNBDbCvQC5lt8BpBrZBC1GcQOF5tMA3P61BAACgNW29DNR+v1Kwm73PpbdAJ0m9wPFUs0FPJZRAG5K2wHIcpEFuAqRAwgq3wPihokEAAB3jhT5hlWy/ZpaOvm4CpEDCCrfA+KGiQUsisED7Dq7ArAaeQa4x3EDq4rbAUbGvQQAAhc7FvAP6fr90IbC9+9bjQLlVwsA72b5Bz6W3QCdJvcDxVLNBbgKkQMIKt8D4oaJBAABG07I9oQs+v1sOKr/oRWlBSzopwAOzmkEs8GZB9TyRwMF7q0EUyFZBJVs7wDAEnEEAAF4n0DoKjkS/tQQkvxTIVkElWzvAMAScQSzwZkH1PJHAwXurQeBzGEENJF/Ar0yhQQAAE53avYZsNL+PizO/6EVpQUs6KcADs5pBc45jQTM2jL/1ro5BmnVtQejWw77cMohBAACViQG/qVsWv3y0Ib//NnNBY6TRvzk7j0HoRWlBSzopwAOzmkGadW1B6NbDvtwyiEEAAFKgej/AzEE9HAJLPgIde0HUtMDADnYOQkeLeUGVS8DA4GIQQsk9fEGyncvA3GQNQgAAsPR5vZ/XLr+3Vjq/bvwPQQgfMsCepptBhioSQUJj+r7EVopBknFAQaBlfL/+IIxBAAA/Yms/V12uvoMvST4CHXtB1LTAwA52DkLriHxB5HS1wEk8D0JHi3lBlUvAwOBiEEIAAOk2aT+IPE27FCfTvgIde0HUtMDADnYOQtGveUErG7bAzqkNQuuIfEHkdLXASTwPQgAAy7VoP0lDhL5mb6c+qsJ4QQRJ28AKRA5CyT18QbKdy8DcZA1CR4t5QZVLwMDgYhBCAAD1Ong/ks1gPn5t3D3Rr3lBKxu2wM6pDULJPXxBsp3LwNxkDUJD4ntBrKfDwF8rDEIAAO2TeD9lqHA+RxkzvQIde0HUtMDADnYOQsk9fEGyncvA3GQNQtGveUErG7bAzqkNQgAAcXVGPybLg76nrBM/Q+J7Qaynw8BfKwxCnkGAQdxDtcC7agtC0a95QSsbtsDOqQ1CAABIlnM/bkpZvp0MZD5rDH9Bqu3LwL1bCkLJPXxBsp3LwNxkDUJpq35BNGTYwFpHCUIAAGmHUT8kue2+4EStPqrCeEEESdvACkQOQhv9aEEf5/LAY8ATQncJc0EmwO/AcTcOQgAAuMxrP99EmL7Ep4A+yT18QbKdy8DcZA1CqsJ4QQRJ28AKRA5Caat+QTRk2MBaRwlCAAB2IjY/EdFiPgy6Kj9rDH9Bqu3LwL1bCkK4PoJBdsu2wJkHCEIomn9BO128wISQCUIAAB7ybT97WqU99Em4PkPie0Gsp8PAXysMQmsMf0Gq7cvAvVsKQiiaf0E7XbzAhJAJQgAAypluP1rQeL6vpIk+aat+QTRk2MBaRwlCuD6CQXbLtsCZBwhCawx/Qarty8C9WwpCAABz92o/0yetPvfTVD5D4ntBrKfDwF8rDELJPXxBsp3LwNxkDUJrDH9Bqu3LwL1bCkIAALCdWz8iNf6+SZ0HPiiaf0E7XbzAhJAJQp5BgEHcQ7XAu2oLQkPie0Gsp8PAXysMQgAAuZx7P7CLOb6AHwu9KJp/QTtdvMCEkAlCY1yAQWa3r8DYOglCnkGAQdxDtcC7agtCAACSsEg/xgvyu+rrHj+4PoJBdsu2wJkHCEJjXIBBZrevwNg6CUIomn9BO128wISQCUIAANShYz94Bsm+YY9wPqrCeEEESdvACkQOQqXDdkG0MvXAur0KQmmrfkE0ZNjAWkcJQgAA";
const BIRD_STL_KOKOPELLI = "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";

const BIRD_BLOCKS = {
  dolphin: {
    label: "🐬 Dolphin",
    getStl: () => BIRD_STL_DOLPHIN,
    attribution: "Dolphin Block by 21Starman12 (Thingiverse) — CC BY-SA",
    // Real source dimensions in the model's native units (mm), used to
    // convert to inches and scale the block to match the flute's actual
    // sound hole (TSH) width/length rather than an arbitrary bore ratio.
    // Measured directly from the base's own footprint geometry (the
    // bottom 5% of the model by height) — X is the across-bore direction,
    // Y is the along-bore direction, matching the same "right"/"forward"
    // convention used for orienting the block on the tube.
    nativeUnitsPerInch: 25.4,
    baseWidthNative: 16.0,   // base footprint X (across bore)
    baseLengthNative: 51.65, // base footprint Y (along bore)
  },
  kokopelli: {
    label: "🪶 Kokopelli",
    getStl: () => BIRD_STL_KOKOPELLI,
    attribution: "Kokopelli totem block",
    nativeUnitsPerInch: 25.4,
    baseWidthNative: 20.96,
    baseLengthNative: 49.92,
  },
};

const FLUTE_CONST = {
  SAC_LEN_RATIO:      4.6,   // SAC (slow air chamber) length = bore * this
  MOUTHPIECE_MARGIN:  2.0,   // inches added to L+sacLen for the trimmed mouthpiece end
  // Sound hole (TSH) width and length — corrected from a flat bore-multiple
  // guess to match real, sourced Native American flute construction data
  // (Flutopedia's "Flute Crafting Dimensions" page, citing Mike Prairie's
  // "Many Dimensions of the NAF" and other flute-maker references):
  //   - TSH WIDTH: "a good starting point is half the bore diameter"
  //     (other makers report a 50-67% range; 50% is the documented anchor).
  //   - TSH LENGTH: "generally falls between about 3/16in and 7/32in" —
  //     i.e. a small, largely FIXED real-world dimension (~0.1875-0.219in)
  //     for a mid-range flute, NOT a value that scales linearly with bore.
  //     Sources note length does vary a little with flute size/key ("I
  //     wouldn't expect a high D flute to have a TSH as long as 7/32, nor
  //     would a bass A have one so short"), so this uses the 7/32in
  //     starting point as an anchor at a representative mid-range bore
  //     (3/4in) with a gentle half-strength scaling either side of that
  //     anchor, clamped to stay within a physically sane real-world range
  //     at both very small and very large bores.
  //   The previous flat SOUND_HOLE_W_RATIO=0.82 / SOUND_HOLE_L_RATIO=1.25
  //   had width and length backwards from every real flute (length was
  //   the LARGER dimension; real flutes have width ~1.7x length at a
  //   typical bore) and, at large bores, produced a sound hole longer
  //   than the tube itself was wide — verified directly against the
  //   sourced numbers before replacing these.
  soundHoleWidth(bore) { return bore * 0.5; },
  soundHoleLength(bore) {
    const base = 0.21875;   // 7/32in — the documented starting point for a mid-range flute
    const midBore = 0.75;   // the bore size (3/4in) that starting point is anchored to
    const scaled = base * (0.5 + 0.5 * (bore / midBore));
    return Math.max(0.15, Math.min(scaled, 0.5)); // real-world sane range at extremes
  },
  // Flue channel dimensions — the shallow channel that carries air from
  // the SAC exit hole, under the block, to the sound hole (TSH). Sourced
  // from Flutopedia's "Flute Crafting Dimensions" reference (citing Mike
  // Prairie's "Many Dimensions of the NAF" and related flute-maker
  // discussions), not invented:
  //   - Flue-Depth: "start with a depth about 3/64in or so" (~0.047in) for
  //     a mid-range flute, shallower for smaller/narrower flutes.
  //   - Flue-Length: "twice the Flue-Width" is the documented recommendation
  //     — this is the flat channel's own length, between the SAC exit hole
  //     and the TSH, not counting the ramp (see SAC_EXIT_RAMP_ANGLE_DEG).
  //   - Flue-Width: matches soundHoleWidth (same source: "the TSH width
  //     also generally matches the width of the flue exit").
  //   - SAC Exit-Top Ramp Angle: ~30° for a mid-range 3/4in-bore flute
  //     (Russ Wolf's recommendation) — a literal angle for the sloped
  //     entry down into the SAC exit hole itself (per real NAF anatomy:
  //     airflow → ramp → SAC exit hole → flue → splitting edge/TSH).
  //     Earlier code here used this "30°" figure as a fraction of the
  //     flue's own length instead of a literal angle applied to a real
  //     hole — before that fix, the app didn't cut an actual SAC exit
  //     hole at all, just a shallow decorative groove that never reached
  //     the bore's interior. See buildChamberMesh's flue-channel section.
  flueDepth(bore) {
    const base = 0.047; // ~3/64in, the documented starting point for a mid-range (~0.75in bore) flute
    const midBore = 0.75;
    const scaled = base * (0.4 + 0.6 * (bore / midBore));
    return Math.max(0.02, Math.min(scaled, 0.09)); // sane real-world range at extremes
  },
  flueLength(bore) { return FLUTE_CONST.soundHoleWidth(bore) * 2; }, // "Flue-Length: twice the Flue-Width" per Flutopedia — the flat channel only
  SAC_EXIT_RAMP_ANGLE_DEG: 30, // Russ Wolf's ~30° recommendation, used directly now (see comment above)
  FLUE_RAMP_FRACTION: 0.4, // retained for reference only — no longer used by buildChamberMesh; superseded by SAC_EXIT_RAMP_ANGLE_DEG
  HOLE_OVERLAP_CLEARANCE: 0.75, // a hole's diameter may use at most this fraction of the gap to its nearest neighbor
  HOLE_MIN_DIAMETER:  0.12,  // absolute floor so the overlap cap never produces an undrillable hole
  // Internal wall/plug thickness (the solid barrier between the SAC and
  // sound chamber — a real, load-bearing part of every NAF: sources
  // describe it as "a hardwood birch dowel plug" or an integral wall left
  // when hollowing the bore). Scales with bore since a wider bore needs a
  // proportionally sturdier plug to seal reliably and resist cracking, with
  // a floor so a tiny bore doesn't get an unrealistically thin (fragile)
  // plug and a ceiling so a huge bore doesn't get an implausibly thick one.
  INTERNAL_WALL_THICKNESS_RATIO: 0.24, // plug thickness = bore * this, clamped below
  INTERNAL_WALL_THICKNESS_MIN: 0.12,
  INTERNAL_WALL_THICKNESS_MAX: 0.5,
  // Antler curve bow amplitude, in real inches — this is the ONE definition;
  // the SVG drilling template needs the same value in on-screen pixels,
  // which it derives by multiplying by its own px-per-inch drawing scale
  // rather than hardcoding a separate pixel constant (previously this same
  // physical curve amplitude was defined THREE separate times: once here,
  // once in the 3D viewer, and once in the G-code generator, in two
  // different unit systems that could silently drift apart).
  CURVE_BOW_HEAVY_IN:  1.4,
  CURVE_BOW_SLIGHT_IN: 0.55,
};
// Returns the real bow amplitude (inches) for a given curve setting —
// call this everywhere a curve amplitude is needed instead of re-writing
// the heavy/slight/straight ternary.
function curveBowAmplitudeIn(curve) {
  return curve === "heavy" ? FLUTE_CONST.CURVE_BOW_HEAVY_IN
       : curve === "slight" ? FLUTE_CONST.CURVE_BOW_SLIGHT_IN
       : 0;
}

// Builds ONE chamber's complete geometry — melody or drone, playable or
// silent — from its root inputs. Returns every downstream consumer needs:
// tube length, SAC length, total length, sound-hole window dimensions,
// and (if playable) the full finger-hole array with overlap-safe
// diameters. This is the ONLY place these formulas should be written.
//
// Params:
//   bore          — bore diameter, inches
//   freq          — target root frequency, Hz (already resolved from key/length/interval upstream)
//   holeCount     — number of finger holes (0 for a silent drone)
//   handSize      — "compact" | "average" | "large" — hole-spacing scale factor
//   holeShapeKey  — key into HOLE_SHAPES for acoustic diameter adjustment
//   ergoOverride  — optional array of {num, adjFromTSH, adjDiameter} from the Ergonomic Hole Adjustment tool
// ═══════════════════════════════════════════════════════════════
//  GEOMETRY VALIDATOR
//  A real, callable self-check — not a promise in a comment. Run against
//  the chambersForDiagram array that every renderer (3D, SVG, PDF, CNC)
//  actually consumes, this asserts the invariants a single-source-of-
//  truth architecture is supposed to guarantee:
//    1. No finger hole's diameter exceeds the overlap-safety clearance
//       against its nearest neighbor (the exact bug class fixed earlier).
//    2. sacLen / shW / shL match FLUTE_CONST exactly for this bore — if a
//       future edit reintroduces a local recomputation that drifts from
//       the shared constants, this catches it immediately rather than
//       relying on someone noticing a rendering discrepancy by eye.
//    3. totalLen = L + sacLen + MOUTHPIECE_MARGIN, exactly.
//    4. Every hole's fromTSH + fromFoot equals the chamber's own L
//       (within floating-point tolerance) — i.e. positions are internally
//       consistent, not just individually plausible.
//  Returns { valid, issues[] }. Called from the dev-facing "Run Geometry
//  Validation" action in the CNC export panel — see wireup below — and
//  safe to call on any chamber object produced by buildChamberGeometry.
// ═══════════════════════════════════════════════════════════════
const GEOMETRY_TOLERANCE = 0.005; // inches — floating point / rounding tolerance for cross-output comparisons

function validateChamberGeometry(chamber, label = "chamber") {
  const issues = [];
  const bore = chamber.bore;
  const L = parseFloat(chamber.L);
  const sacLen = parseFloat(chamber.sacLen);
  const shW = parseFloat(chamber.shW);
  const shL = parseFloat(chamber.shL);
  const totalLen = chamber.totalLen !== null ? parseFloat(chamber.totalLen) : null;

  const expectedSacLen = bore * FLUTE_CONST.SAC_LEN_RATIO;
  if (Math.abs(sacLen - expectedSacLen) > GEOMETRY_TOLERANCE) {
    issues.push(`${label}: sacLen=${sacLen} does not match bore*SAC_LEN_RATIO=${expectedSacLen.toFixed(3)}`);
  }
  const expectedShW = FLUTE_CONST.soundHoleWidth(bore);
  if (Math.abs(shW - expectedShW) > GEOMETRY_TOLERANCE) {
    issues.push(`${label}: shW=${shW} does not match soundHoleWidth(bore)=${expectedShW.toFixed(3)}`);
  }
  const expectedShL = FLUTE_CONST.soundHoleLength(bore);
  if (Math.abs(shL - expectedShL) > GEOMETRY_TOLERANCE) {
    issues.push(`${label}: shL=${shL} does not match soundHoleLength(bore)=${expectedShL.toFixed(3)}`);
  }
  if (totalLen !== null) {
    const expectedTotal = L + sacLen + FLUTE_CONST.MOUTHPIECE_MARGIN;
    if (Math.abs(totalLen - expectedTotal) > GEOMETRY_TOLERANCE) {
      issues.push(`${label}: totalLen=${totalLen} does not match L+sacLen+MOUTHPIECE_MARGIN=${expectedTotal.toFixed(3)}`);
    }
  }

  if (chamber.playable && chamber.holes && chamber.holes.length > 0) {
    const holes = chamber.holes;
    holes.forEach(h => {
      const fromTSH = parseFloat(h.fromTSH), fromFoot = parseFloat(h.fromFoot);
      if (Math.abs((fromTSH + fromFoot) - L) > GEOMETRY_TOLERANCE) {
        issues.push(`${label} H${h.num}: fromTSH(${fromTSH}) + fromFoot(${fromFoot}) = ${(fromTSH+fromFoot).toFixed(3)}, expected chamber length ${L}`);
      }
    });
    const sorted = [...holes].sort((a,b) => parseFloat(a.fromTSH) - parseFloat(b.fromTSH));
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = parseFloat(sorted[i+1].fromTSH) - parseFloat(sorted[i].fromTSH);
      const d1 = parseFloat(sorted[i].diameter), d2 = parseFloat(sorted[i+1].diameter);
      const avgDiam = (d1 + d2) / 2;
      const maxAllowed = gap; // edges touching would be the absolute physical limit
      if (avgDiam > maxAllowed) {
        issues.push(`${label} H${sorted[i].num}/H${sorted[i+1].num}: hole diameters (${d1}"/${d2}") physically overlap at gap ${gap.toFixed(3)}"`);
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

// Validates every chamber in a chambersForDiagram-shaped array (melody +
// any drones) and returns a combined report.
function validateAllChambers(chambers) {
  const allIssues = [];
  chambers.forEach((c, i) => {
    const label = c.label || `Chamber ${i+1}`;
    const { issues } = validateChamberGeometry(c, label);
    allIssues.push(...issues);
  });
  return { valid: allIssues.length === 0, issues: allIssues };
}


function buildChamberGeometry({ bore, freq, holeCount = 0, handSize = "average", holeShapeKey = "round", ergoOverride = null }) {
  const r = bore / 2;
  const L = Math.max(0, tubeLen(freq, r));
  const sacLen = bore * FLUTE_CONST.SAC_LEN_RATIO;
  const totalLen = L > 0 ? L + sacLen + FLUTE_CONST.MOUTHPIECE_MARGIN : 0;
  const shW = FLUTE_CONST.soundHoleWidth(bore);
  const shL = FLUTE_CONST.soundHoleLength(bore);

  let holes = [];
  let theoreticalHoles = [];
  if (holeCount > 0 && L > 0 && SCALE_CONFIGS[holeCount]) {
    const spacingFactor = handSize === "compact" ? 0.93 : handSize === "large" ? 1.07 : 1.0;
    const config = SCALE_CONFIGS[holeCount];

    // Positions first (independent of diameter) so the overlap cap below
    // can measure real gaps between neighbors.
    const rawPositions = config.holes.map(h => ({
      num: h.num, interval: h.interval, ratio: h.ratio,
      fromFootNum: (L / h.ratio) * spacingFactor,
    }));
    const sortedByPos = [...rawPositions].sort((a, b) => a.fromFootNum - b.fromFootNum);
    const minGapByNum = {};
    sortedByPos.forEach((h, i) => {
      const gaps = [];
      if (i > 0) gaps.push(Math.abs(h.fromFootNum - sortedByPos[i-1].fromFootNum));
      if (i < sortedByPos.length - 1) gaps.push(Math.abs(sortedByPos[i+1].fromFootNum - h.fromFootNum));
      minGapByNum[h.num] = gaps.length ? Math.min(...gaps) : Infinity;
    });

    theoreticalHoles = rawPositions.map(h => {
      const rawDiam = holeShapeDiameter(holeDiam(bore, h.num, holeCount), holeShapeKey);
      const gapCap = minGapByNum[h.num] * FLUTE_CONST.HOLE_OVERLAP_CLEARANCE;
      const diameter = isFinite(gapCap)
        ? Math.min(rawDiam, Math.max(FLUTE_CONST.HOLE_MIN_DIAMETER, gapCap))
        : rawDiam;
      return {
        num: h.num,
        interval: h.interval,
        fromFoot: fmt(h.fromFootNum),
        fromTSH:  fmt(L - h.fromFootNum),
        diameter: fmt(diameter, 3),
      };
    });

    holes = (ergoOverride && ergoOverride.length === theoreticalHoles.length)
      ? theoreticalHoles.map(th => {
          const ov = ergoOverride.find(o => o.num === th.num);
          return ov ? { ...th, fromTSH: ov.adjFromTSH, diameter: ov.adjDiameter } : th;
        })
      : theoreticalHoles;
  }

  return {
    bore, freq, L: fmt(L), totalLen: L > 0 ? fmt(totalLen) : null,
    sacLen: fmt(sacLen), shW: fmt(shW), shL: fmt(shL),
    holeCount, holes, theoreticalHoles, playable: L > 0,
  };
}

// ═══════════════════════════════════════════════════════════════
//  SAVE INSTRUMENT LIBRARY
//  Persists full build configurations (every input needed to fully
//  reconstruct a flute or duduk) to the browser's localStorage, so builds
//  survive closing the tab/app. This is per-browser/device storage, not
//  cloud sync — matches this app's offline, no-server design.
// ═══════════════════════════════════════════════════════════════
const LIBRARY_STORAGE_KEY = "naf_calculator_instrument_library_v1";

function loadLibrary() {
  try {
    const raw = localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("[library] Couldn't read saved instruments — storage may be corrupted or unavailable.", e);
    return [];
  }
}

function persistLibrary(items) {
  try {
    localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(items));
    return true;
  } catch (e) {
    console.warn("[library] Couldn't save — browser storage may be full or disabled (e.g. private browsing).", e);
    return false;
  }
}

function saveInstrumentToLibrary(name, kind, config) {
  const items = loadLibrary();
  const entry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    name: name.trim() || "Untitled Instrument",
    kind, // "flute" | "duduk"
    savedAt: new Date().toISOString(),
    config,
  };
  const updated = [entry, ...items];
  const ok = persistLibrary(updated);
  return ok ? entry : null;
}

function deleteInstrumentFromLibrary(id) {
  const items = loadLibrary().filter(i => i.id !== id);
  return persistLibrary(items);
}

function renameInstrumentInLibrary(id, newName) {
  const items = loadLibrary().map(i => i.id === id ? { ...i, name: newName.trim() || i.name } : i);
  return persistLibrary(items);
}

// ═══════════════════════════════════════════════════════════════
//  NEST LIBRARY
//  Persists named "nest" designs (SAC exit ramp angle, flue depth, TSH
//  length, fipple/air-cut angle) so a shape tuned once — here or in the
//  companion Nest Designer tool (fluteview.html) — can be reapplied to
//  any flute. Two independent paths, since this app's whole design is
//  offline single-file HTML and there's no guarantee two such files
//  share a browser origin (and therefore localStorage) when opened
//  separately:
//    1. localStorage under NEST_STORAGE_KEY — automatic IF this file and
//       the Nest Designer happen to be served from the same origin.
//    2. Import/export as a small .json file — works regardless of how
//       the two are hosted or opened; this is the dependable path.
//  Both read/write the same plain-object schema (NEST_SCHEMA_TAG).
// ═══════════════════════════════════════════════════════════════
const NEST_STORAGE_KEY = "naf_nest_library_v1";
const NEST_SCHEMA_TAG = "naf-nest-design-v1";

function loadNestLibrary() {
  try {
    const raw = localStorage.getItem(NEST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("[nest-library] Couldn't read saved nests — storage may be corrupted or unavailable.", e);
    return [];
  }
}

function persistNestLibrary(items) {
  try {
    localStorage.setItem(NEST_STORAGE_KEY, JSON.stringify(items));
    return true;
  } catch (e) {
    console.warn("[nest-library] Couldn't save — browser storage may be full or disabled (e.g. private browsing).", e);
    return false;
  }
}

function saveNestToLibrary(name, nest) {
  const items = loadNestLibrary();
  const entry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    name: name.trim() || "Untitled Nest",
    schema: NEST_SCHEMA_TAG,
    savedAt: new Date().toISOString(),
    rampAngleDeg: nest.rampAngleDeg, flueDepthIn: nest.flueDepthIn,
    tshLengthIn: nest.tshLengthIn, fippleAngleDeg: nest.fippleAngleDeg,
  };
  const updated = [entry, ...items];
  const ok = persistNestLibrary(updated);
  return ok ? entry : null;
}

function deleteNestFromLibrary(id) {
  const items = loadNestLibrary().filter(i => i.id !== id);
  return persistNestLibrary(items);
}

// Validates + normalizes a parsed nest object from an imported .json file
// (or a localStorage entry) into the four numbers this app actually uses.
// Deliberately permissive about the wrapper (name/schema/savedAt are
// optional, and unrecognized extra fields are ignored) since a
// hand-edited or older file might be missing them — only the numeric
// fields matter for actually building the geometry.
function parseNestFile(obj) {
  if (!obj || typeof obj !== "object") throw new Error("Not a valid nest file");
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    name: typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : "Imported Nest",
    rampAngleDeg: num(obj.rampAngleDeg),
    flueDepthIn: num(obj.flueDepthIn),
    tshLengthIn: num(obj.tshLengthIn),
    fippleAngleDeg: num(obj.fippleAngleDeg),
  };
}

function downloadNestFile(name, nest) {
  const payload = {
    schema: NEST_SCHEMA_TAG, name, savedAt: new Date().toISOString(),
    rampAngleDeg: nest.rampAngleDeg, flueDepthIn: nest.flueDepthIn,
    tshLengthIn: nest.tshLengthIn, fippleAngleDeg: nest.fippleAngleDeg,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(name || "nest").trim().replace(/[^\w\-]+/g, "_") || "nest"}.nest.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════
//  FINGER REACH ANALYZER
//  Checks the gap between every pair of adjacent finger holes against
//  typical adult hand-span comfort ranges, and flags both cramped
//  (fingers overlap/collide) and overstretched (can't comfortably span)
//  spacing. Thresholds represent an "average" hand — the handSize
//  spacingFactor already shifts the real computed positions for
//  compact/large, so these constants don't need to change per hand size.
// ═══════════════════════════════════════════════════════════════
const REACH_LIMITS = {
  cramped:     0.55, // below this, adjacent fingers physically collide
  tight:       0.75, // below this, playable but tight for most adult hands
  comfortMax:  1.45, // up to this is a comfortable, relaxed span
  stretchMax:  1.75, // up to this is a stretch but generally reachable
  // above stretchMax = exceeds average hand reach
};

function analyzeFingerReach(holes) {
  // holes must be ordered by physical position along the tube (by fromTSH
  // ascending) for gap analysis to mean "adjacent on the instrument."
  const ordered = [...holes].sort((a, b) => parseFloat(a.fromTSH) - parseFloat(b.fromTSH));

  const gaps = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i], b = ordered[i+1];
    const gap = parseFloat(b.fromTSH) - parseFloat(a.fromTSH);
    let status;
    if (gap < REACH_LIMITS.cramped) status = "cramped";
    else if (gap < REACH_LIMITS.tight) status = "tight";
    else if (gap <= REACH_LIMITS.comfortMax) status = "comfortable";
    else if (gap <= REACH_LIMITS.stretchMax) status = "stretch";
    else status = "exceeds";
    gaps.push({ from: a.num, to: b.num, gap, status });
  }

  const worst = gaps.reduce((worstSoFar, g) => {
    const rank = { comfortable: 0, tight: 1, stretch: 2, cramped: 3, exceeds: 3 };
    return !worstSoFar || rank[g.status] > rank[worstSoFar.status] ? g : worstSoFar;
  }, null);

  const hasProblem = gaps.some(g => g.status === "cramped" || g.status === "exceeds");
  const hasWarning = gaps.some(g => g.status === "tight" || g.status === "stretch");

  return { gaps, worst, hasProblem, hasWarning };
}

// ═══════════════════════════════════════════════════════════════
//  DRILLING TEMPLATE (multi-chamber capable)
// ═══════════════════════════════════════════════════════════════
function DrillingTemplate({ chambers, curve = "straight" }) {
  const n = chambers.length;
  const W = 820;
  const maxBore = Math.max(...chambers.map(c => c.bore), 0.375);
  const isCurved = curve === "slight" || curve === "heavy";
  const mL = 48, mR = 48;
  const drawW = W - mL - mR;

  const maxComb = Math.max(...chambers.map(c => c.sacLen + c.L), 1);
  // sc is the ONE true scale for this drawing (pixels per real inch) — it's
  // derived from fitting the longest tube into the available width, and
  // EVERY other dimension in this component (tube band height, hole
  // diameters, curve amplitude) must use this same scale. Using a second,
  // independent px-per-inch constant for the vertical/diameter axis was a
  // real bug: long tubes compress sc far below a fixed constant, so holes
  // and the tube band ended up rendered several times too large relative
  // to their real horizontal spacing — correct-looking for short tubes,
  // badly distorted (visually overlapping holes) for long ones.
  const sc = drawW / maxComb;
  // Tube band height at true scale, with a readability floor for very
  // compressed drawings (extremely long tubes) and a ceiling so a huge
  // bore doesn't blow out the row — both bounds are visual-only limits on
  // top of the same true `sc`, not a competing scale.
  const TH_MIN = 14, TH_MAX = 150;
  // Curved rows need extra vertical room for the bow of the antler. Bow
  // amplitude is defined ONCE, in real inches (curveBowAmplitudeIn, shared
  // with the 3D viewer and G-code generator) — converted to pixels here
  // using this drawing's own true scale (sc), not a separately-hardcoded
  // pixel constant that could drift out of sync with the inch value.
  const bowAmp = curveBowAmplitudeIn(curve) * sc;
  const rowH   = 96 + Math.max(0, maxBore * sc - 96) * 1.15 + bowAmp * 1.4;
  const topPad = 36;
  const H = topPad + n * rowH + 24;

  // Centerline vertical offset for a curved antler tube, as a function of x
  // position along the row (0 = left edge of drawable area, drawW = right
  // edge). Follows a gentle single bow — antler naturally bends along one
  // sweep from burr to tip, so a simple sine arc reads as "antler" without
  // needing real antler-curvature data. bowAmp=0 collapses back to a
  // perfectly flat centerline (straight pipe / straight-shape antler).
  const curveY = (x) => bowAmp === 0 ? 0 : bowAmp * Math.sin((x / drawW) * Math.PI);
  // Local tube-wall tilt angle at x, used to keep hole markers, TSH tag, and
  // foot cap perpendicular-ish to the bore instead of always vertical.
  const curveSlope = (x) => bowAmp === 0 ? 0 : (bowAmp * (Math.PI / drawW)) * Math.cos((x / drawW) * Math.PI);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",maxWidth:"820px",display:"block",border:"1px solid #3a2a14",background:"#0c0600"}}>
      <defs>
        <pattern id="bone" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" stroke="#3a2510" strokeWidth="1.5"/>
        </pattern>
      </defs>

      <text x={W/2} y="24" textAnchor="middle" fill="#f59e0b" fontSize="14" fontWeight="bold" fontFamily="system-ui">
        {n > 1 ? `${n}-CHAMBER DRONE FLUTE` : "DRILLING TEMPLATE"} — DRILLING TEMPLATE
        {isCurved ? " (CURVED ANTLER — MEASURE ALONG BORE CENTERLINE)" : ""}
      </text>

      {chambers.map((c, idx) => {
        const rowBaseY = topPad + idx * rowH + 28 + bowAmp; // shift down so the upward bow stays on-canvas
        // Draw the tube band at true scale relative to its own bore (px-per-inch),
        // with a floor so thin bores stay visible and a cap so huge bores don't
        // dwarf the row. Hole circles are drawn from actual hole diameter data at
        // this same scale, then clamped so they can never exceed the tube band.
        const TH = Math.min(TH_MAX, Math.max(TH_MIN, c.bore * sc));
        const sacX0 = mL - 22;
        const tshX  = mL + c.sacLen * sc;
        const footX = mL + (c.sacLen + c.L) * sc;
        const color = c.playable ? "#f59e0b" : "#7acc44";

        // Centerline y at absolute x (x measured from mL, matching curveY's
        // drawW-relative input) — TY(x) is the *top* edge of the tube band.
        const cy   = (absX) => rowBaseY - curveY(Math.max(0, absX - mL));
        const TYat = (absX) => cy(absX) - TH/2;

        // Build a smooth tube outline as an SVG path when curved; otherwise
        // fall back to the simple flat rects (unchanged from the straight case).
        const steps = 24;
        const topPts = [], botPts = [];
        for (let i = 0; i <= steps; i++) {
          const absX = sacX0 + (footX - sacX0) * (i / steps);
          const c0 = cy(absX);
          topPts.push([absX, c0 - TH/2]);
          botPts.push([absX, c0 + TH/2]);
        }
        const outlinePath = isCurved
          ? `M ${topPts.map(p=>p.join(",")).join(" L ")} L ${botPts.slice().reverse().map(p=>p.join(",")).join(" L ")} Z`
          : null;

        return (
          <g key={idx}>
            {idx > 0 && <line x1={mL} y1={rowBaseY-TH/2-22} x2={W-mR} y2={rowBaseY-TH/2-22} stroke="#3a2a14" strokeWidth="1" strokeDasharray="6,4"/>}

            <text x={mL} y={TYat(mL)-8-(isCurved?bowAmp*0.5:0)} fill={color} fontSize="11" fontWeight="bold" fontFamily="system-ui">
              ▶ {c.label} — {c.note ? c.note.name : ""} {c.playable ? `(${c.holes.length}-hole)` : "(no finger holes)"} · {fmt(c.bore,3)}" bore
            </text>

            {isCurved ? (
              <>
                {/* Full curved tube outline: SAC + body drawn as one continuous antler-like shape */}
                <path d={outlinePath} fill="url(#bone)" stroke="#c17d1a" strokeWidth="2" strokeLinejoin="round"/>
                <path d={outlinePath} fill="#5a3a18" opacity="0.28"/>
                {/* Darker body segment overlay from TSH to foot, so SAC vs body is still visually distinct */}
                <path d={(() => {
                  const bTop = [], bBot = [];
                  for (let i = 0; i <= steps; i++) {
                    const absX = tshX + (footX - tshX) * (i / steps);
                    const c0 = cy(absX);
                    bTop.push([absX, c0 - TH/2]);
                    bBot.push([absX, c0 + TH/2]);
                  }
                  return `M ${bTop.map(p=>p.join(",")).join(" L ")} L ${bBot.slice().reverse().map(p=>p.join(",")).join(" L ")} Z`;
                })()} fill="#1a1208" opacity="0.6" stroke="#5a3a18" strokeWidth="1.5"/>
                <text x={mL+c.sacLen*sc/2-10} y={TYat(mL+c.sacLen*sc/2)-1} textAnchor="middle" fill="#f59e0b" fontSize="9" fontFamily="system-ui">SAC</text>
                {/* Internal wall/plug marker — same real, solid partition as the
                    straight-tube case, drawn perpendicular to the local bore tilt
                    so it reads correctly on a curved antler section too. */}
                <g transform={`rotate(${-curveSlope(tshX-mL)*(180/Math.PI)}, ${tshX}, ${cy(tshX)})`}>
                  <rect x={tshX-3} y={cy(tshX)-TH/2-3} width="6" height={TH+6} fill="#3a2410" stroke="#f59e0b" strokeWidth="1.5"/>
                </g>
                <text x={tshX} y={cy(tshX)+TH/2+16} textAnchor="middle" fill="#f59e0b" fontSize="8" fontFamily="system-ui">WALL/PLUG</text>
              </>
            ) : (
              <>
                <rect x={sacX0} y={TYat(mL)} width={c.sacLen*sc+22} height={TH} rx="7" fill="url(#bone)" stroke="#c17d1a" strokeWidth="2"/>
                <rect x={sacX0} y={TYat(mL)} width={c.sacLen*sc+22} height={TH} rx="7" fill="#5a3a18" opacity="0.55"/>
                <text x={mL+c.sacLen*sc/2-10} y={TYat(mL)-1} textAnchor="middle" fill="#f59e0b" fontSize="9" fontFamily="system-ui">SAC</text>
                <rect x={tshX} y={TYat(mL)} width={footX-tshX} height={TH} rx="4" fill="#1a1208" stroke="#5a3a18" strokeWidth="6"/>
                {/* Internal wall/plug — the real, solid partition separating the SAC
                    from the sound chamber (a hardwood dowel plug in real construction).
                    Drawn as a bold vertical bar right at the SAC/body boundary so it's
                    unmistakably a distinct build step from the TSH cut beside it. */}
                <rect x={tshX-3} y={TYat(mL)-3} width="6" height={TH+6} fill="#3a2410" stroke="#f59e0b" strokeWidth="1.5"/>
                <text x={tshX} y={TYat(mL)+TH+16} textAnchor="middle" fill="#f59e0b" fontSize="8" fontFamily="system-ui">WALL/PLUG</text>
              </>
            )}

            {/* TSH marker tag, angled to match local tube tilt when curved */}
            <g transform={isCurved ? `rotate(${-curveSlope(tshX-mL)*(180/Math.PI)}, ${tshX}, ${TYat(tshX)})` : undefined}>
              <rect x={tshX-9} y={TYat(tshX)-16} width="24" height="12" fill="#120a00" stroke={color} strokeWidth="2"/>
              <text x={tshX+3} y={TYat(tshX)-21} textAnchor="middle" fill={color} fontSize="9" fontFamily="system-ui">TSH</text>
            </g>

            {/* Foot cap, perpendicular to the local bore tilt when curved */}
            <g transform={isCurved ? `rotate(${-curveSlope(footX-mL)*(180/Math.PI)}, ${footX}, ${cy(footX)})` : undefined}>
              <rect x={footX-3} y={cy(footX)-TH/2} width="6" height={TH} fill="#0a0500" stroke="#c4a97d" strokeWidth="1.5"/>
            </g>

            {c.playable && c.holes.map(h => {
              const hx = tshX + parseFloat(h.fromTSH) * sc;
              const hy = cy(hx);
              // True-scale radius from actual hole diameter (inches) at the
              // SAME scale (sc) used for hole X-positions and the tube band
              // — this keeps diameter and spacing proportionally consistent
              // regardless of how compressed the overall drawing is, then
              // clamped so a hole can never visually exceed the tube band.
              const trueR = (parseFloat(h.diameter) / 2) * sc;
              const hr = Math.max(2, Math.min(trueR, TH/2 - 2));
              return (
                <g key={h.num}>
                  <circle cx={hx} cy={hy} r={hr} fill="#0a0500" stroke="#f59e0b" strokeWidth="3.5"/>
                  <text x={hx} y={hy+TH/2+15} textAnchor="middle" fill="#e5d5b8" fontSize="11" fontWeight="bold" fontFamily="monospace">H{h.num}</text>
                  <text x={hx} y={hy+TH/2+28} textAnchor="middle" fill="#c4a97d" fontSize="9" fontFamily="monospace">{h.fromTSH}"</text>
                </g>
              );
            })}

            {!c.playable && (
              <text x={(tshX+footX)/2} y={cy((tshX+footX)/2)+TH/2+18} textAnchor="middle" fill="#c4a97d" fontSize="10" fontFamily="monospace">
                {fmt(c.L)}" tube — open, no holes
              </text>
            )}
          </g>
        );
      })}

      <line x1={mL} y1={H-22} x2={W-mR} y2={H-22} stroke="#6b5d4a" strokeWidth="2"/>
      <text x={W/2} y={H-8} textAnchor="middle" fill="#6b5d4a" fontSize="10" fontFamily="system-ui">
        {isCurved
          ? "PRINT AT 100% SCALE · MEASUREMENTS IN INCHES, MEASURED ALONG THE BORE CENTERLINE FROM SOUND HOLE (TSH)"
          : "PRINT AT 100% SCALE · MEASUREMENTS IN INCHES FROM SOUND HOLE (TSH)"}
      </text>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════
//  3D ANTLER / FLUTE VIEWER  (Three.js — rotate, zoom, pan)
//  Builds an actual-scale 3D tube from the same chamber/hole data the
//  drilling template uses, so what you see here matches your real
//  numbers: true bore diameter, true tube length, true hole positions,
//  true hole diameters, and now the actual selected hole SHAPE (round /
//  oval / undercut / countersunk) and any ergonomic position adjustment.
//  Curve (straight/slight/heavy) reuses the same single-bow sine model as
//  the 2D template for consistency.
//
//  Holes and the sound-hole window are cut with REAL boolean geometry
//  (three-bvh-csg), not a fake cylinder glued on top — so they visually
//  go INTO the tube and open into the actual hollow bore, the way a
//  drilled hole really looks.
// ═══════════════════════════════════════════════════════════════

// Builds a closed, watertight ("manifold") tube along a curve by merging
// an open TubeGeometry with two circular end caps. CSG requires manifold
// geometry — an open tube alone produces unreliable boolean results.
function buildCappedTubeGeometry(path, radius, segments, radialSegments) {
  const tubeGeo = new THREE.TubeGeometry(path, segments, radius, radialSegments, false);
  const capAt = (t) => {
    const circleGeo = new THREE.CircleGeometry(radius, radialSegments);
    const center = path.getPointAt(t);
    const tangent = path.getTangentAt(t).normalize();
    // CircleGeometry is built facing +Z; rotate it to face along the tube's
    // tangent at this end (flipped at the start so the cap's normal points
    // outward, away from the tube body, matching the other cap).
    const faceDir = t === 0 ? tangent.clone().negate() : tangent;
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), faceDir);
    circleGeo.applyQuaternion(quat);
    circleGeo.translate(center.x, center.y, center.z);
    return circleGeo;
  };
  return mergeGeometries([tubeGeo, capAt(0), capAt(1)], false);
}

// Returns a stable "up" direction (perpendicular to the tube's local
// tangent) at parameter t, biased toward world +Y — this is the direction
// holes are drilled "down into" the tube from, and stays sensible even
// along a curved antler path.
function localUpAt(path, t) {
  const tangent = path.getTangentAt(Math.min(0.999, Math.max(0.001, t))).normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const up = worldUp.clone().sub(tangent.clone().multiplyScalar(worldUp.dot(tangent)));
  return up.lengthSq() > 1e-6 ? up.normalize() : new THREE.Vector3(0, 0, 1);
}

// Builds a solid of revolution from a sequence of cylindrical stages
// stacked along Y, as ONE correct closed manifold — not by merging
// several individually-fully-capped cylinders. That naive approach (used
// in earlier versions of this function) put a real cap at BOTH sides of
// every internal seam between stages: stage A's own bottom cap and stage
// B's own top cap ended up as two coincident, overlapping flat discs at
// the exact same position. That duplicate-face defect didn't break the
// CSG cut itself, but it left two overlapping surfaces with opposite
// winding right at the seam — one that only rendered when viewed from
// outside the tube, and one that only rendered when viewed from inside,
// so each hole looked fine from inside the bore but showed a flat,
// uncut-looking surface from outside. Confirmed directly by raycasting
// from both directions at a known hole and finding two coincident hits
// at the identical position with opposite face normals.
//
// Fix: only the true outer ends of the WHOLE stack get a real cap (built
// explicitly here, once); every internal boundary between stages is left
// open on both sides and stitched together by the shared ring of
// vertices, so there is exactly one surface there, not two. Verified
// separately that the result is a proper closed manifold (every edge
// shared by exactly two triangles) before using it as a CSG brush.
function buildCylindricalStackGeometry(stages, segments) {
  // stages: [{ topR, bottomR, height }], ordered top-to-bottom, contiguous.
  const totalHeight = stages.reduce((sum, s) => sum + s.height, 0);
  const pieces = [];
  let yTop = totalHeight / 2;
  stages.forEach((stage, i) => {
    const yCenter = yTop - stage.height / 2;
    const body = new THREE.CylinderGeometry(stage.topR, stage.bottomR, stage.height, segments, 1, true); // open-ended: no internal duplicate caps
    body.translate(0, yCenter, 0);
    pieces.push(body);
    yTop -= stage.height;
  });
  // Real caps ONLY at the true outer ends of the full stack.
  const firstStage = stages[0], lastStage = stages[stages.length - 1];
  const topCap = new THREE.CircleGeometry(firstStage.topR, segments);
  topCap.rotateX(Math.PI / 2); // CircleGeometry faces +Z by default; orient to face +Y
  topCap.translate(0, totalHeight / 2, 0);
  const bottomCap = new THREE.CircleGeometry(lastStage.bottomR, segments);
  bottomCap.rotateX(-Math.PI / 2);
  bottomCap.translate(0, -totalHeight / 2, 0);
  pieces.push(topCap, bottomCap);
  return mergeGeometries(pieces, false);
}

// ═══════════════════════════════════════════════════════════════
//  BIRD/TOTEM BLOCK — loads the selected STL and positions it directly
//  above the sound hole (TSH), as if resting on the flute an inch above
//  its surface — matching how a real removable NAF bird/block/fetish
//  sits above the flue when placed on the tube. Scales proportionally to
//  bore diameter so the block always looks sized correctly relative to
//  the specific flute, using the block's own real (measured) base width
//  as the reference — a 0.625" bore flute renders the block at very
//  close to its true real-world size; larger/smaller bores scale from
//  that same real-world anchor rather than an arbitrary ratio.
// ═══════════════════════════════════════════════════════════════
const BIRD_STL_CACHE = {}; // parsed-geometry cache so switching birds/rebuilding doesn't re-parse the same base64 STL repeatedly

function loadBirdGeometry(birdKey) {
  const spec = BIRD_BLOCKS[birdKey];
  if (!spec) return null;
  if (BIRD_STL_CACHE[birdKey]) return BIRD_STL_CACHE[birdKey];

  const b64 = spec.getStl();
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const loader = new STLLoader();
  const geo = loader.parse(bytes.buffer);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  BIRD_STL_CACHE[birdKey] = geo;
  return geo;
}

// Builds a positioned, scaled bird-block group for the melody chamber.
// `melodyChamber` needs bore, sacLen, L (all in inches, matching the rest
// of the app's geometry) and the curve path/bowAmp so the block sits
// correctly on a curved antler section too, not just a straight tube.
function buildBirdBlock(birdKey, melodyChamber, curve, heightFraction = 1) {
  const spec = BIRD_BLOCKS[birdKey];
  if (!spec) return null;
  const geo = loadBirdGeometry(birdKey);
  if (!geo) return null;

  const bore = melodyChamber.bore;
  const totalLen = melodyChamber.sacLen + melodyChamber.L;
  const bowAmp = curveBowAmplitudeIn(curve);
  const centerAt = (t) => {
    const x = t * totalLen;
    const y = bowAmp === 0 ? 0 : bowAmp * Math.sin(t * Math.PI);
    return new THREE.Vector3(x, y, 0);
  };
  const segments = 36;
  const pathPoints = [];
  for (let i = 0; i <= segments; i++) pathPoints.push(centerAt(i / segments));
  const curvePath = new THREE.CatmullRomCurve3(pathPoints);
  const tTSH = Math.min(1, Math.max(0, melodyChamber.sacLen / totalLen));
  const tshCenter = centerAt(tTSH);
  const up = localUpAt(curvePath, tTSH);

  // Real-world scale: the block's base footprint is scaled independently
  // in X (across-bore) and Y (along-bore) to match the flute's ACTUAL
  // sound hole (TSH/window) dimensions — shW (width, across the bore) and
  // shL (length, along the bore) — rather than an arbitrary bore ratio,
  // per the request that the block's base match the sound hole's own
  // labeled dimensions. Falls back to the same authoritative formula used
  // everywhere else in the app (FLUTE_CONST.SOUND_HOLE_*_RATIO) if the
  // chamber object doesn't carry precomputed shW/shL for some reason, so
  // this never silently produces an unscaled or wrongly-scaled block.
  const targetWidthIn = parseFloat(melodyChamber.shW) || FLUTE_CONST.soundHoleWidth(bore);
  const targetLengthIn = parseFloat(melodyChamber.shL) || FLUTE_CONST.soundHoleLength(bore);
  const nativeBaseWidthIn = spec.baseWidthNative / spec.nativeUnitsPerInch;
  const nativeBaseLengthIn = spec.baseLengthNative / spec.nativeUnitsPerInch;
  const scaleX = targetWidthIn / nativeBaseWidthIn;
  const scaleY = targetLengthIn / nativeBaseLengthIn;
  // Height scales with the width factor (no independent "target height" to
  // match, so it follows the across-bore scale to stay proportional rather
  // than distorting into a squashed or stretched-tall block).
  const scaleZ = scaleX;

  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: "#8a6a45", roughness: 0.65, metalness: 0.04 });
  const mesh = new THREE.Mesh(geo, mat);

  // The model is Z-up with its base at Z=0 in native units (confirmed by
  // direct inspection of both source files before use). Convert to the
  // scene's inch-based units — independently per axis, matching the real
  // sound-hole width/length rather than one uniform scale — re-orient so
  // the block's "up" aligns with the tube's local "up" (so it sits
  // correctly even on a curved antler section), and lift it so its BASE
  // sits one inch above the tube's outer surface at the sound hole —
  // resting above it, not through it, per the actual request ("as if it
  // was attached but an inch above").
  const unitScaleX = scaleX / spec.nativeUnitsPerInch;
  const unitScaleY = scaleY / spec.nativeUnitsPerInch;
  const unitScaleZ = scaleZ / spec.nativeUnitsPerInch;
  mesh.scale.set(unitScaleX, unitScaleY, unitScaleZ);
  // Re-center the block horizontally on its own footprint (native X/Y
  // center), but keep its base (native Z=0) as the pivot for lifting.
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2;
  mesh.position.set(-cx * unitScaleX, -cy * unitScaleY, 0);

  group.add(mesh);

  // Orient the block with an EXPLICIT basis rather than
  // setFromUnitVectors — that method only constrains which way is "up";
  // the rotation around that up axis (i.e. which way the bird actually
  // faces along the tube) is left arbitrary/unspecified, which meant the
  // bird's facing direction was whatever direction fell out of the
  // computation, not a deliberate choice. Building the basis explicitly
  // fixes the bird facing toward the foot of the flute (a natural
  // default, matching how a real block/fetish sits facing along the
  // tube), then applies a controlled rotation AROUND that up axis for
  // the requested orientation.
  const tangent = curvePath.getTangentAt(Math.min(0.999, Math.max(0.001, tTSH))).normalize();
  // "Forward" (along the tube, toward the foot) projected to be exactly
  // perpendicular to "up", so the basis is orthonormal even on a curved
  // antler section where the raw tangent isn't already perpendicular to up.
  const forward = tangent.clone().sub(up.clone().multiplyScalar(tangent.dot(up))).normalize();
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  // Basis columns: right → local X, up → local Z (block's native up),
  // forward → local -Y (native -Y is the block's own "nose" direction,
  // per direct inspection of both source models before use).
  // NOTE: the combination (right, -forward, up) as basis columns is a
  // REFLECTION (determinant -1), not a rotation — Quaternion.setFromRotationMatrix
  // assumes a proper rotation matrix and silently produces a wrong,
  // unrelated result for a reflection input, which is exactly why the bird
  // faced the wrong way even though the raw forward/right/up vectors
  // logged as correct. Verified by computing the determinant directly and
  // by comparing raw-matrix-transform vs quaternion-transform results on
  // the same input — they only agree once the determinant is +1.
  // (-right, -forward, up) is the equivalent VALID (det=+1) rotation that
  // still sends native -Y (the nose, confirmed by checking which end of
  // the mesh has the sparsest, most tapered cross-section) to `forward`.
  const basis = new THREE.Matrix4().makeBasis(right.clone().negate(), forward.clone().negate(), up);
  const baseQuat = new THREE.Quaternion().setFromRotationMatrix(basis);
  // Requested: rotate the bird 45° counter-clockwise (viewed from above,
  // i.e. around the tube's own "up" axis) from that facing-the-foot default.
  const BIRD_ROTATION_DEG = -1;
  const spinQuat = new THREE.Quaternion().setFromAxisAngle(up, THREE.MathUtils.degToRad(BIRD_ROTATION_DEG));
  group.quaternion.copy(spinQuat).multiply(baseQuat);
  const outerR = bore / 2 + Math.max(0.05, (bore / 2) * 0.28);
  const liftDistance = outerR + 1.0 * Math.max(0, Math.min(1, heightFraction)); // 0 = flush against the surface, 1 = original "attached but an inch above" gap
  const worldPos = tshCenter.clone().add(up.clone().multiplyScalar(liftDistance));
  group.position.copy(worldPos);

  return group;
}


function buildChamberMesh(c, curve, materialColor, holeShape = "round", surfaceRoughness = 0.75, surfaceMetalness = 0.05) {
  const group = new THREE.Group();

  const bowAmp = curveBowAmplitudeIn(curve);
  const totalLen = c.sacLen + c.L; // mouth end through foot, inches
  const segments = 36;

  // Centerline: runs along +X, bows in +Y following a single sine arc
  // (matches the 2D drilling template's curveY so both views agree).
  const centerAt = (t) => {
    const x = t * totalLen;
    const y = bowAmp === 0 ? 0 : bowAmp * Math.sin(t * Math.PI);
    return new THREE.Vector3(x, y, 0);
  };

  const pathPoints = [];
  for (let i = 0; i <= segments; i++) pathPoints.push(centerAt(i / segments));
  const curvePath = new THREE.CatmullRomCurve3(pathPoints);

  const r = c.bore / 2;
  const wallT = Math.max(0.05, r * 0.28); // outer wall thickness, inches
  const tTSH = Math.min(1, Math.max(0, c.sacLen / totalLen)); // t position of the sound hole

  const evaluator = new Evaluator();
  evaluator.useGroups = false;

  // ── Hollow body: outer capped tube minus inner capped tube ──────────
  const outerGeo = buildCappedTubeGeometry(curvePath, r + wallT, segments, 20);
  const innerGeo = buildCappedTubeGeometry(curvePath, r, segments, 16);
  const outerBrush = new Brush(outerGeo); outerBrush.updateMatrixWorld();
  const innerBrush = new Brush(innerGeo); innerBrush.updateMatrixWorld();
  let bodyResult = evaluator.evaluate(outerBrush, innerBrush, SUBTRACTION);

  // ── Cut the flue channel and TSH (sound hole) — a real shallow, ramped
  // channel carved into the top of the tube, not a hole punched straight
  // through the wall. Matches the actual anatomy shown in flute-maker
  // reference diagrams: air travels from the SAC, down a ramp, along a
  // flat shallow channel (the "flue"), to an opening into the bore (the
  // TSH/sound hole) at the channel's far end. The previous version used
  // an elongated cylinder cut straight down through the wall at one spot
  // — visually and physically wrong; there was no channel or ramp at all,
  // just a rounded slot.
  //
  // Real, sourced dimensions (Flutopedia "Flute Crafting Dimensions",
  // citing Mike Prairie's "Many Dimensions of the NAF"): Flue-Width ≈
  // TSH-Width (≈half the bore diameter); Flue-Length ≈ 2× Flue-Width;
  // Flue-Depth starts around 3/64in for a mid-range flute; a ramp
  // transitions from the SAC's full depth up to the shallow flue floor.
  //
  // BORE-SIZE FALLBACK: this channel is built as an extruded profile swept
  // across the flue's width (THREE.ExtrudeGeometry), the same general
  // family of shape (a box-like, non-cylindrical cutter) that was already
  // found — through direct, careful testing — to break the three-bvh-csg
  // library above roughly 2in bore, regardless of the cutter's specific
  // size or shape. Re-tested this specific channel shape the same way
  // before shipping: reliable through 2in bore, silently fails to cut
  // anything above that. Falls back to the old, verified-reliable
  // elongated-cylinder TSH cut at those larger sizes, so nothing silently
  // breaks at any bore this app offers — real flute bores are almost
  // never anywhere near that large regardless.
  let nestTrackingPoints = null; // populated below when the flue-channel path runs; lets the 3D viewer float dimension labels over the ramp/flue/TSH/fipple
  {
    const shW = parseFloat(c.shW) || FLUTE_CONST.soundHoleWidth(c.bore); // across the bore — Flue-Width and TSH-Width
    const shL = parseFloat(c.shL) || FLUTE_CONST.soundHoleLength(c.bore); // along the bore — TSH-Length
    const center = centerAt(tTSH);
    const up = localUpAt(curvePath, tTSH);
    const tangent = curvePath.getTangentAt(Math.min(0.999, Math.max(0.001, tTSH))).normalize();
    const forward = tangent.clone().sub(up.clone().multiplyScalar(tangent.dot(up))).normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();

    const FLUE_CHANNEL_BORE_LIMIT = 2.0; // verified reliable up to and including this bore; fails above it regardless of cutter parameters, same limit found for the earlier elongated-cylinder cutter

    if (c.bore <= FLUE_CHANNEL_BORE_LIMIT) {
      // Flue depth: overridable per-chamber (e.g. by a loaded nest design),
      // falling back to the bore-derived Flutopedia formula otherwise —
      // same override pattern as shW/shL above.
      const flueDepth = (Number.isFinite(c.nestFlueDepthIn) && c.nestFlueDepthIn > 0)
        ? c.nestFlueDepthIn : FLUTE_CONST.flueDepth(c.bore);
      const flueLength = FLUTE_CONST.flueLength(c.bore); // the flat channel's own length only (see FLUTE_CONST comment)
      const outerR = r + wallT;
      const overshoot = Math.max(0.03, r * 0.08);
      const tshCutDepth = wallT + overshoot; // full-depth cut, reaching the bore's hollow interior
      const fippleAngleDeg = Number.isFinite(c.nestFippleAngleDeg) ? c.nestFippleAngleDeg : 0;

      // ── SAC exit hole ────────────────────────────────────────────────
      // Real NAF anatomy (confirmed against a labeled cross-section
      // reference): airflow → ramp → SAC EXIT HOLE → flue → splitting
      // edge (TSH). The exit hole is a genuine opening through the wall,
      // reaching the bore's interior — not a shallow surface groove. This
      // is what the CSG cut below now builds; it previously stopped at
      // flueDepth everywhere upstream of the TSH, so no real hole existed
      // there at all (the SAC's interior read as an unbroken wall).
      //
      // No independent sourced dimension for this hole's own length was
      // available, so it's assumed equal to the TSH length (shL) as a
      // starting point — both are "an opening through the wall" of
      // similar acoustic role — flag/replace if you have a better ratio.
      const sacExitLen = shL;
      // Short, fixed transition runs in/out of the exit hole's floor and
      // the flue's floor (not exposed as their own angle control yet;
      // just enough length to keep the CSG cut numerically well-behaved
      // rather than a razor-thin step).
      const holeTransitionLen = Math.max(0.02, flueLength * 0.12);

      // SAC exit ramp angle: literal, always — this is the sloped entry
      // from the natural outer surface DOWN INTO the exit hole's full
      // depth (tshCutDepth is the rise now, not flueDepth, since the hole
      // must actually reach the bore). Defaults to Russ Wolf's ~30°
      // (FLUTE_CONST.SAC_EXIT_RAMP_ANGLE_DEG) when not overridden by a
      // loaded nest design. Clamped to a sane length range so an extreme
      // angle can't collapse to ~0 or run unreasonably far up the SAC.
      const hasRampAngleOverride = Number.isFinite(c.nestRampAngleDeg) && c.nestRampAngleDeg > 0;
      const rampAngleDegEffective = hasRampAngleOverride ? c.nestRampAngleDeg : FLUTE_CONST.SAC_EXIT_RAMP_ANGLE_DEG;
      const rampRad = rampAngleDegEffective * Math.PI / 180;
      const rampLen = Math.min(Math.max(tshCutDepth / Math.tan(rampRad), 0.02), Math.max(0.05, c.sacLen * 0.6));

      // Cross-section profile in the (forward, up) plane, upstream (SAC
      // side) to downstream (TSH side): natural surface → ramp down into
      // the SAC exit hole (full depth) → flat exit-hole floor → rise back
      // up to the shallow flue floor → flat flue channel → drop into the
      // TSH (full depth) → TSH floor → (optionally beveled) back up to
      // clear the surface.
      const shape = new THREE.Shape();
      const xTshEnd = 0;                                        // downstream edge of the TSH opening at the floor (the splitting edge)
      const xFlueEnd = -shL;                                     // end of flat flue / start of the TSH opening
      const xFlueStart = xFlueEnd - flueLength;                  // start of the flat, shallow flue channel
      const xExitRiseStart = xFlueStart - holeTransitionLen;      // where the rise from the exit hole's floor back up to the flue floor begins
      const xExitHoleStart = xExitRiseStart - sacExitLen;         // upstream edge of the SAC exit hole's flat floor
      const xRampStart = xExitHoleStart - rampLen;                // SAC-side start of the ramp, at the natural surface — upstream-most point

      // Fipple/air-cut angle (default 0 = the original plumb 90° wall).
      // Bevels the splitting edge by shifting the SURFACE-level corner
      // downstream while the sharp edge at the floor (xTshEnd — where the
      // airstream actually splits) stays put, i.e. an undercut from the
      // bore side. This is a modeling choice, not a measured spec — if
      // your reference wants the bevel leaning the other way, negate
      // fippleLean below.
      const fippleRad = fippleAngleDeg * Math.PI / 180;
      const fippleLean = Math.tan(fippleRad) * (tshCutDepth + 0.15);
      const xTshSurface = xTshEnd + fippleLean;

      shape.moveTo(xRampStart, 0);
      shape.lineTo(xExitHoleStart, -tshCutDepth);   // ramp down into the SAC exit hole
      shape.lineTo(xExitRiseStart, -tshCutDepth);   // flat floor of the SAC exit hole (a real opening into the bore)
      shape.lineTo(xFlueStart, -flueDepth);         // rise back up to the shallow flue floor
      shape.lineTo(xFlueEnd, -flueDepth);           // flat flue channel
      shape.lineTo(xFlueEnd, -tshCutDepth);         // drop into the TSH
      shape.lineTo(xTshEnd, -tshCutDepth);          // TSH floor
      shape.lineTo(xTshSurface, 0.15);              // up and well clear of the outer surface, ensuring a clean cut boundary
      shape.lineTo(xRampStart, 0.15);
      shape.closePath();

      const channelGeo = new THREE.ExtrudeGeometry(shape, { depth: shW, bevelEnabled: false, steps: 1 });
      channelGeo.translate(0, 0, -shW / 2); // center the extrusion across the flue's width

      // The shape's local (X, Y, extrudeZ) axes need to map onto the
      // tube's real local (forward, up, right) directions at this point.
      const basis = new THREE.Matrix4().makeBasis(forward, up, right);
      channelGeo.applyMatrix4(basis);
      const originPoint = center.clone().add(up.clone().multiplyScalar(outerR));
      channelGeo.translate(originPoint.x, originPoint.y, originPoint.z);

      // Tracking points for the 3D viewer's optional on-canvas dimension
      // labels — built with the SAME (basis, originPoint) transform used
      // for the visible cut above, so labels line up with the geometry
      // exactly. Left in this group's own local space; the caller
      // converts to world space via group.localToWorld (which correctly
      // folds in this chamber's own position plus every ancestor group's
      // offset — see the world-space-centering note elsewhere in this
      // file for why that matters).
      const toGroupSpace = (xLocal, yLocal) => new THREE.Vector3(xLocal, yLocal, 0).applyMatrix4(basis).add(originPoint);
      const labelLift = Math.max(0.08, r * 0.4); // float labels clear of the surface, scaled to bore so it reads at any size
      nestTrackingPoints = {
        rampAngleDeg: rampAngleDegEffective,
        flueDepthIn: flueDepth,
        tshLengthIn: shL,
        fippleAngleDeg,
        ramp: toGroupSpace((xRampStart + xExitHoleStart) / 2, labelLift),
        sacExit: toGroupSpace((xExitHoleStart + xExitRiseStart) / 2, labelLift),
        flue: toGroupSpace((xFlueStart + xFlueEnd) / 2, labelLift),
        tsh: toGroupSpace((xFlueEnd + xTshEnd) / 2, labelLift),
        fipple: toGroupSpace(xTshSurface, labelLift),
      };

      const channelBrush = new Brush(channelGeo); channelBrush.updateMatrixWorld();
      const currentBrush = new Brush(bodyResult.geometry); currentBrush.updateMatrixWorld();
      bodyResult = evaluator.evaluate(currentBrush, channelBrush, SUBTRACTION);
    } else {
      // Fallback for large bores where the flue channel cutter is known
      // to fail: the old elongated-cylinder TSH cut — a faithful, if
      // simplified, sound hole (no flue channel/ramp) rather than a
      // silently broken flute.
      const overshoot = Math.max(0.03, r * 0.08);
      const cutDepth = wallT + overshoot;
      const cutCenterDist = (r + wallT) - cutDepth / 2;
      const windowGeo = new THREE.CylinderGeometry(1, 1, cutDepth, 32);
      windowGeo.scale(shW / 2, 1, shL / 2);
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), up);
      windowGeo.applyQuaternion(quat);
      const cutCenter = center.clone().add(up.clone().multiplyScalar(cutCenterDist));
      windowGeo.translate(cutCenter.x, cutCenter.y, cutCenter.z);
      const windowBrush = new Brush(windowGeo); windowBrush.updateMatrixWorld();
      const currentBrush = new Brush(bodyResult.geometry); currentBrush.updateMatrixWorld();
      bodyResult = evaluator.evaluate(currentBrush, windowBrush, SUBTRACTION);
    }
  }

  // ── Cut finger holes — a genuine subtractive extrusion straight through
  // the tube wall, at the exact diameter and position computed from the
  // website's own inputs (c.holes: fromTSH distance and diameter, both
  // driven directly by bore/note/hole-count selections). This is real
  // material removal, not a shallow depression or a shaded/colored
  // decal — the cutting cylinder extends well past the tube's true inner
  // bore radius on purpose, so every hole is an unambiguous through-void
  // you can see into or through from any angle, matching the literal
  // request to "extrude the material by subtracting it" rather than
  // relying on any bevel, tint, or lighting trick to make it read as a
  // hole. Earlier attempts trying to make a SHALLOW cut look convincing
  // via chamfers or vertex-color tinting kept running into visibility and
  // shading artifacts across several sessions — cutting genuinely deeper
  // sidesteps that class of problem entirely, since there's a real,
  // unmistakable opening for the eye (and any camera angle) to find.
  if (c.playable) {
    c.holes.forEach(h => {
      const distFromTSH = parseFloat(h.fromTSH);
      const t = Math.min(1, Math.max(0, (c.sacLen + distFromTSH) / totalLen));
      const center = centerAt(t);
      const up = localUpAt(curvePath, t);
      const holeR = Math.max(0.02, parseFloat(h.diameter) / 2); // exact diameter from the website's own hole-diameter calculation, halved

      // Cut depth: from safely outside the outer wall surface down to
      // safely PAST the tube's true inner bore radius — not just barely
      // past it. This guarantees the hole is a real, obviously-open void
      // rather than a shallow dimple that only technically breaches the
      // wall by a hair. The extra depth costs nothing physically (the CSG
      // cutter's own excess length beyond the far wall is simply outside
      // the tube's solid material and has no effect on the result), so
      // there's no reason to cut it any more conservatively than this.
      const outerR = r + wallT;
      const throughMargin = Math.max(0.15, r * 0.5); // how far past the true bore radius the cut extends, guaranteeing a real, obvious opening
      const cutDepth = (outerR - r) + throughMargin;
      const cutCenterDist = outerR - cutDepth / 2;

      const holeGeo = new THREE.CylinderGeometry(holeR, holeR, cutDepth, 32);
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), up);
      holeGeo.applyQuaternion(quat);
      const cutCenter = center.clone().add(up.clone().multiplyScalar(cutCenterDist));
      holeGeo.translate(cutCenter.x, cutCenter.y, cutCenter.z);

      const holeBrush = new Brush(holeGeo); holeBrush.updateMatrixWorld();
      const currentBrush = new Brush(bodyResult.geometry); currentBrush.updateMatrixWorld();
      bodyResult = evaluator.evaluate(currentBrush, holeBrush, SUBTRACTION);
    });
  }

  // ── Internal wall/plug — a REAL, physically-required part of every NAF,
  // not a cosmetic detail. Sources describe this as "a hardwood birch
  // dowel plug" or an integral wall left solid when hollowing the bore: a
  // solid partition separating the slow air chamber from the sound
  // chamber. Without it, air would flow straight through into the sound
  // chamber instead of being forced out through the flue and across the
  // sound hole, and the flute would not produce its two-chamber tone.
  //
  // This MUST be the last CSG operation (added via union after every
  // subtractive cut above, not right after hollowing) — verified by
  // testing that this specific CSG library corrupts a subsequent
  // subtraction (the TSH cut) when performed on a mesh that just had a
  // union applied to it at the same location: the union alone produces a
  // valid solid, and the subtraction alone on an un-unioned mesh works
  // correctly, but chaining union-then-subtract at the same spot silently
  // produced a mesh where the TSH cut punched all the way through
  // everything, including the wall, rather than stopping at it. Doing every
  // subtraction FIRST and adding the wall LAST avoids that combination
  // entirely, verified by raycasting through the exact same test cases.
  //
  // A small SAC-exit hole is then cut through the wall (the "SAC exit
  // hole" per Native American flute construction references) so the two
  // chambers still share a real air path — the actual flue/channel that
  // routes air from there to the sound hole is a feature of the external
  // block/nest sitting on top of the flute, which this app does not
  // separately model, so this exit hole is a simplification of a real
  // component, not the complete flue mechanism.
  {
    const wallThickness = Math.max(
      FLUTE_CONST.INTERNAL_WALL_THICKNESS_MIN,
      Math.min(c.bore * FLUTE_CONST.INTERNAL_WALL_THICKNESS_RATIO, FLUTE_CONST.INTERNAL_WALL_THICKNESS_MAX)
    );
    const wallCenter = centerAt(tTSH);
    const wallTangent = curvePath.getTangentAt(Math.min(0.999, Math.max(0.001, tTSH))).normalize();
    // Slightly over-sized radius (1.02×) guarantees a clean, gap-free union
    // with the surrounding bore wall regardless of curve/segment tessellation.
    const wallGeo = new THREE.CylinderGeometry(r * 1.02, r * 1.02, wallThickness, 20);
    const wallQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), wallTangent);
    wallGeo.applyQuaternion(wallQuat);
    wallGeo.translate(wallCenter.x, wallCenter.y, wallCenter.z);

    const wallBrush = new Brush(wallGeo); wallBrush.updateMatrixWorld();
    let wallCurrentBrush = new Brush(bodyResult.geometry); wallCurrentBrush.updateMatrixWorld();
    bodyResult = evaluator.evaluate(wallCurrentBrush, wallBrush, ADDITION);

    // SAC exit hole: a small radial cylinder through the wall's thickness
    // only (not the outer tube wall — that opening is the TSH cut above),
    // sized as a real, modest exit port rather than the wall's full bore.
    const exitHoleR = Math.max(0.06, r * 0.35);
    const exitDepth = wallThickness + 0.03; // small overshoot to guarantee a clean break-through
    const exitGeo = new THREE.CylinderGeometry(exitHoleR, exitHoleR, exitDepth, 16);
    const exitQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), localUpAt(curvePath, tTSH));
    exitGeo.applyQuaternion(exitQuat);
    exitGeo.translate(wallCenter.x, wallCenter.y, wallCenter.z);
    const exitBrush = new Brush(exitGeo); exitBrush.updateMatrixWorld();
    const exitCurrentBrush = new Brush(bodyResult.geometry); exitCurrentBrush.updateMatrixWorld();
    bodyResult = evaluator.evaluate(exitCurrentBrush, exitBrush, SUBTRACTION);
  }

  // ── Materials: outer surface vs. inner bore read differently so the
  // hollow interior is visually distinct through every opening ──────
  //
  // Finger holes get a genuine color difference in their DEEP,
  // straight-walled interior only — not the small entry bevel near the
  // surface. This is deliberately restricted to avoid repeating an
  // earlier problem: coloring (or even just lighting) the sloped bevel
  // surface produces a visible 4-lobe "bowtie" pattern, since a cone's
  // surface normal sweeps a full circle and two directional lights each
  // light two opposite sides while leaving the other two dark — that
  // artifact is inherent to any sloped surface under this app's lighting,
  // color or no color. The deep, perfectly vertical straight wall doesn't
  // have that problem (its normal doesn't rotate through the light
  // directions the same way), so it's a safe place to add a real color
  // cue that reads consistently from any angle.
  // ── Material: a single, real material — the finger holes are now real,
  // deep through-cuts (see above), so no vertex-color tinting or other
  // visual trick is needed to make them read as physical holes; the
  // actual geometry does that on its own from any angle.
  bodyResult.geometry.computeVertexNormals();
  const outerMat = new THREE.MeshStandardMaterial({ color: materialColor, roughness: surfaceRoughness, metalness: surfaceMetalness });
  const bodyMesh = new THREE.Mesh(bodyResult.geometry, outerMat);
  group.add(bodyMesh);


  // NOTE: a separate dark "inner lining" mesh used to sit here, just inside
  // the bore radius, meant to reinforce the "hollow" read when looking
  // through a hole or the open foot. Verified (by raycasting through an
  // actual finger hole and checking which mesh the ray hits first) that
  // this lining sat almost flush against the true cut surface — close
  // enough that from outside, looking down into any hole, the very first
  // thing visible was this lining's flat, uniformly dark, unbroken
  // cylindrical surface, not the real CSG-cut bore wall beneath it. That
  // made every hole read as a flat dark disc with no visible depth, even
  // though the actual cut geometry was correct and full-depth. Removed —
  // the real cut surface (bodyMesh above) already has correct shading and
  // normals and doesn't need a stand-in.

  // ── SAC block tint (mouthpiece → TSH) — a thin, slightly-larger-radius
  // translucent overlay so that section reads visually distinct, matching
  // the 2D template and PDF shading, without another CSG pass ──────
  if (c.sacLen > 0) {
    const sacSegs = Math.max(4, Math.round(segments * tTSH));
    const sacPts = [];
    for (let i = 0; i <= sacSegs; i++) sacPts.push(centerAt((i / sacSegs) * tTSH));
    const sacPath = new THREE.CatmullRomCurve3(sacPts.length > 1 ? sacPts : [centerAt(0), centerAt(tTSH)]);
    const sacGeo = new THREE.TubeGeometry(sacPath, Math.max(2, sacSegs), r + wallT * 1.015, 20, false);
    const sacMat = new THREE.MeshStandardMaterial({
      color: "#8a6a3a", roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide, transparent: true, opacity: 0.55,
    });
    group.add(new THREE.Mesh(sacGeo, sacMat));
  }

  // Mouth end: a solid plug cap — real NAFs are sealed at this end; air
  // only vents through the TSH window.
  {
    const t = 0;
    const center = centerAt(t);
    const tangent = curvePath.getTangentAt(0.001).normalize();
    const ringGeo = new THREE.CircleGeometry(r + wallT, 20);
    const ringMat = new THREE.MeshStandardMaterial({ color: "#2a1c10", roughness: 0.85 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(center);
    ring.lookAt(center.clone().sub(tangent));
    group.add(ring);
  }

  return { group, totalLen, curvePath, nestTrackingPoints };
}

function Flute3DViewer({
  chambers, curve = "straight", pipeMaterial = "straight", holeShape = "round", birdKey = "none",
  birdHeight = 1, ambientIntensity = 0.55, keyIntensity = 0.9, surfaceRoughness = 0.75, surfaceMetalness = 0.05,
  showNestLabels = true,
}) {
  const mountRef = useRef(null);
  const stateRef = useRef({});
  const [building, setBuilding] = useState(true);
  const [buildError, setBuildError] = useState(null);
  // Refs to the four floating nest-dimension labels (ramp/flue/TSH/fipple).
  // Positioned imperatively every animation frame (see animate() below),
  // bypassing React state on purpose — updating these via setState would
  // mean a full re-render 60x/sec just to move a label, the same reason
  // the fluteview.html reference tool manipulates its labels' DOM directly
  // rather than through a framework.
  const nestLabelRefs = useRef({ ramp: null, sacExit: null, flue: null, tsh: null, fipple: null });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    setBuilding(true);
    setBuildError(null);

    const width = mount.clientWidth || 600;
    const height = 380;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0c0600");

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.05, 500);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    mount.innerHTML = "";
    mount.appendChild(renderer.domElement);

    // Lighting: soft ambient + a couple of directional lights for form.
    // Lighting: ambient + a key/fill directional pair. Intensities are
    // user-adjustable (see the Lighting & Shading controls) rather than
    // fixed, so this just sets up sensible starting values.
    const ambientLight = new THREE.AmbientLight(0xffffff, ambientIntensity);
    scene.add(ambientLight);
    const key = new THREE.DirectionalLight(0xffffff, keyIntensity);
    key.position.set(4, 6, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffe8c0, keyIntensity * (0.4 / 0.9)); // keeps the fill's original ratio to the key light (0.4/0.9) as key intensity is adjusted
    fill.position.set(-5, -2, -4);
    scene.add(fill);

    // Build all chambers, stacked with a small vertical offset so multiple
    // drone chambers are visible side-by-side rather than overlapping.
    // Real CSG solid geometry (hollowing + hole cutting) takes real time —
    // deferred one frame via setTimeout so the "Building..." state actually
    // paints before the (synchronous, blocking) CSG work runs.
    let cancelled = false;
    const buildTimer = setTimeout(() => {
      if (cancelled) return;
      try {
        const materialColor = pipeMaterial === "antler" ? "#c9a876" : "#d8cdb8";
        const rootGroup = new THREE.Group();
        let maxLen = 1;
        let nestLabelState = null; // { group, points } for the melody chamber's nest, if any
        chambers.forEach((c, i) => {
          const chamberHoleShape = c.label === "MELODY" ? holeShape : "round";
          const { group, totalLen, nestTrackingPoints } = buildChamberMesh(c, curve, materialColor, chamberHoleShape, surfaceRoughness, surfaceMetalness);
          group.position.z = i * (Math.max(...chambers.map(cc => cc.bore)) * 2.6);
          if (c.label === "MELODY" && birdKey && birdKey !== "none") {
            try {
              const birdGroup = buildBirdBlock(birdKey, c, curve, birdHeight);
              if (birdGroup) group.add(birdGroup);
            } catch (err) {
              console.warn("[Flute3DViewer] Couldn't build bird block:", err);
            }
          }
          if (c.label === "MELODY" && nestTrackingPoints) nestLabelState = { group, points: nestTrackingPoints };
          rootGroup.add(group);
          maxLen = Math.max(maxLen, totalLen);
        });
        // Center the whole assembly at the origin for orbiting.
        rootGroup.position.x = -maxLen / 2;
        scene.add(rootGroup);

        // Camera framing based on true tube length so short and long flutes
        // both start at a sensible distance.
        const dist = maxLen * 1.15;
        camera.position.set(dist * 0.5, dist * 0.35, dist * 0.7);
        camera.lookAt(0, 0, 0);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 0, 0);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = maxLen * 0.15;
        controls.maxDistance = maxLen * 4;
        controls.update();

        // Projects the melody chamber's nest tracking points (ramp/flue/TSH/
        // fipple, in that chamber's own local space) to on-screen pixel
        // coordinates and positions the four label divs there every frame —
        // same technique as the fluteview.html reference tool's
        // updateScreenSpaceLabels(). group.localToWorld is what correctly
        // folds in this chamber's own position AND the rootGroup centering
        // offset above; using local coordinates directly here was exactly
        // the false-positive trap noted elsewhere in this file for
        // raycasting/geometry checks, and applies just as much to labels.
        const updateNestLabels = () => {
          const refs = nestLabelRefs.current;
          if (!nestLabelState || !stateRef.current.showNestLabels) {
            Object.values(refs).forEach(el => { if (el) el.style.display = "none"; });
            return;
          }
          const { group: nestGroup, points } = nestLabelState;
          const w = mount.clientWidth || 600;
          const place = (key, localPoint, text) => {
            const el = refs[key];
            if (!el || !localPoint) return;
            const world = localPoint.clone();
            nestGroup.localToWorld(world);
            world.project(camera);
            if (world.z > 1 || world.z < -1) { el.style.display = "none"; return; } // behind/outside camera frustum
            el.style.display = "block";
            el.style.left = `${(world.x * 0.5 + 0.5) * w}px`;
            el.style.top = `${(-world.y * 0.5 + 0.5) * height}px`;
            el.textContent = text;
          };
          place("ramp",    points.ramp,    `Ramp ${points.rampAngleDeg.toFixed(0)}°`);
          place("sacExit", points.sacExit, `SAC Exit`);
          place("flue",    points.flue,    `Flue ${points.flueDepthIn.toFixed(3)}"`);
          place("tsh",     points.tsh,     `TSH ${points.tshLengthIn.toFixed(3)}"`);
          place("fipple",  points.fipple,  `Fipple ${points.fippleAngleDeg.toFixed(0)}°`);
        };

        let raf = null;
        const animate = () => {
          raf = requestAnimationFrame(animate);
          controls.update();
          renderer.render(scene, camera);
          updateNestLabels();
        };
        animate();

        const handleResize = () => {
          const w = mount.clientWidth || 600;
          camera.aspect = w / height;
          camera.updateProjectionMatrix();
          renderer.setSize(w, height);
        };
        window.addEventListener("resize", handleResize);

        stateRef.current = { renderer, scene, camera, controls, raf, handleResize, mount, ambientLight, key, fill, showNestLabels };
        setBuilding(false);
      } catch (err) {
        console.error("[Flute3DViewer] CSG build failed:", err);
        setBuildError(err.message || String(err));
        setBuilding(false);
      }
    }, 20);

    return () => {
      cancelled = true;
      clearTimeout(buildTimer);
      const s = stateRef.current;
      if (s.handleResize) window.removeEventListener("resize", s.handleResize);
      if (s.raf) cancelAnimationFrame(s.raf);
      if (s.controls) s.controls.dispose();
      if (s.renderer) s.renderer.dispose();
      if (s.scene) {
        s.scene.traverse(obj => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
            else obj.material.dispose();
          }
        });
      }
      if (mount) mount.innerHTML = "";
      Object.values(nestLabelRefs.current).forEach(el => { if (el) el.style.display = "none"; });
      stateRef.current = {};
    };
  }, [JSON.stringify(chambers), curve, pipeMaterial, holeShape, birdKey, birdHeight, surfaceRoughness, surfaceMetalness]);

  // showNestLabels toggles independently of the (expensive) geometry
  // rebuild above — same reasoning as the lighting-intensity effect below.
  useEffect(() => {
    if (stateRef.current) stateRef.current.showNestLabels = showNestLabels;
  }, [showNestLabels]);

  // Lighting intensities update live, independent of the (expensive) full
  // geometry rebuild above — adjusting a lighting slider shouldn't have to
  // re-run CSG on the whole flute.
  useEffect(() => {
    const s = stateRef.current;
    if (!s || !s.ambientLight) return;
    s.ambientLight.intensity = ambientIntensity;
    s.key.intensity = keyIntensity;
    s.fill.intensity = keyIntensity * (0.4 / 0.9);
  }, [ambientIntensity, keyIntensity]);

  const resetView = () => {
    const s = stateRef.current;
    if (!s.controls) return;
    s.controls.reset();
  };

  return (
    <div>
      <div style={{position:"relative"}}>
        <div ref={mountRef} style={{width:"100%",height:380,borderRadius:8,overflow:"hidden",border:"1px solid #3a2a14",touchAction:"none"}}/>
        {["ramp","sacExit","flue","tsh","fipple"].map(key => (
          <div key={key} ref={el => { nestLabelRefs.current[key] = el; }} style={{
            position:"absolute", top:0, left:0, display:"none", transform:"translate(-50%,-50%)",
            fontFamily:"ui-monospace,monospace", fontSize:10.5, fontWeight:600, color:"#7dd3fc",
            background:"rgba(15,10,2,0.88)", border:"1px solid #3a2a14", borderRadius:5,
            padding:"3px 6px", whiteSpace:"nowrap", pointerEvents:"none", zIndex:5,
          }}/>
        ))}
        {building && !buildError && (
          <div style={{
            position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",
            background:"rgba(12,6,0,0.75)",borderRadius:8,pointerEvents:"none",
          }}>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:13,color:"#e5d5b8",fontWeight:700,marginBottom:4}}>Building 3D model…</div>
              <div style={{fontSize:11,color:"#8a7255"}}>Cutting holes into the tube — a moment for complex builds</div>
            </div>
          </div>
        )}
        {buildError && (
          <div style={{
            position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",
            background:"rgba(12,6,0,0.9)",borderRadius:8,padding:16,
          }}>
            <div style={{textAlign:"center",maxWidth:400}}>
              <div style={{fontSize:13,color:"#fca5a5",fontWeight:700,marginBottom:6}}>Couldn't build the 3D preview for this configuration</div>
              <div style={{fontSize:11,color:"#8a7255",lineHeight:1.5}}>
                This can happen with extreme hole counts, sizes, or curvature. Try a different bore, hole count, or curve setting — everything else in the app (drilling template, PDF) is unaffected.
              </div>
            </div>
          </div>
        )}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8,flexWrap:"wrap",gap:6}}>
        <div style={{fontSize:11,color:"#9a8166"}}>
          🖱 Drag to rotate · Scroll to zoom · Right-click drag to pan (touch: 1 finger rotate, 2 finger pinch/pan)
        </div>
        <button onClick={resetView} style={{
          fontSize:11,padding:"5px 12px",borderRadius:6,border:"1px solid #4a3a26",
          background:"#241608",color:"#e8dcc8",cursor:"pointer",
        }}>
          ↺ Reset View
        </button>
      </div>
    </div>
  );
}


// Shared pitch-detection helper (autocorrelation-based), used by both the
// Real-Time Tuner and the Progressive Tuning Assistant so mic-listening
// behavior is identical everywhere in the app.
function autoCorrelatePitch(buf, sampleRate) {
  let SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  if (Math.sqrt(rms / SIZE) < 0.01) return -1;

  const THRES = 0.2;
  let r1 = 0, r2 = SIZE - 1;
  for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < THRES) { r1 = i; break; }
  for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < THRES) { r2 = SIZE - i; break; }
  buf = buf.slice(r1, r2);
  SIZE = buf.length;
  if (SIZE < 2) return -1;

  const c = new Array(SIZE).fill(0);
  for (let i = 0; i < SIZE; i++)
    for (let j = 0; j < SIZE - i; j++) c[i] += buf[j] * buf[j + i];

  let d = 0;
  while (d < SIZE - 1 && c[d] > c[d + 1]) d++;

  let maxval = -1, maxpos = -1;
  for (let i = d; i < SIZE; i++) if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
  if (maxpos <= 0) return -1;

  let T0 = maxpos;
  if (T0 > 0 && T0 < SIZE - 1) {
    const x1 = c[T0-1], x2 = c[T0], x3 = c[T0+1];
    const a = (x1 + x3 - 2*x2) / 2;
    const b = (x3 - x1) / 2;
    if (a) T0 -= b / (2 * a);
  }
  return T0 > 0 ? sampleRate / T0 : -1;
}

function RealTuner({ rootNote, onClose, a4, NOTES }) {
  const [isListening,   setIsListening]   = useState(false);
  const [detectedNote,  setDetectedNote]  = useState("--");
  const [detectedFreq,  setDetectedFreq]  = useState(0);
  const [detectedCents, setDetectedCents] = useState(0);
  const [volume,        setVolume]        = useState(0);
  const [targetNote,    setTargetNote]    = useState(rootNote.name);

  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef      = useRef(null);
  const streamRef   = useRef(null);

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      analyserRef.current = analyser;
      setIsListening(true);

      const tick = () => {
        if (!analyserRef.current || !audioCtxRef.current) return;
        const buf = new Float32Array(analyserRef.current.fftSize);
        analyserRef.current.getFloatTimeDomainData(buf);
        const pitch = autoCorrelatePitch(buf, audioCtxRef.current.sampleRate);

        let maxA = 0;
        for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > maxA) maxA = a; }
        setVolume(Math.min(maxA * 120, 100));

        if (pitch > 60 && pitch < 2500) {
          const ni = nearestNote(pitch, NOTES);
          setDetectedNote(ni.name);
          setDetectedFreq(Math.round(pitch));
          setDetectedCents(ni.cents);
        } else {
          setDetectedNote("--"); setDetectedFreq(0); setDetectedCents(0);
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      alert("Microphone error: " + e.message);
    }
  };

  const stopListening = () => {
    if (rafRef.current)    { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (audioCtxRef.current){ audioCtxRef.current.close(); audioCtxRef.current = null; }
    analyserRef.current = null;
    setIsListening(false); setDetectedNote("--"); setDetectedFreq(0); setDetectedCents(0); setVolume(0);
  };

  useEffect(() => () => stopListening(), []);

  const inTune  = detectedNote !== "--" && detectedNote === targetNote && Math.abs(detectedCents) < 12;
  const cc      = Math.abs(detectedCents) < 10 ? "#4ade80" : Math.abs(detectedCents) < 30 ? "#fbbf24" : "#f87171";
  const clampC  = Math.max(-50, Math.min(50, detectedCents));

  return (
    <div style={{background:"#1a1208",border:`2px solid ${inTune?"#4ade80":"#5a3a18"}`,borderRadius:12,padding:20,marginTop:14,transition:"border-color 0.3s"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:18,color:"#f59e0b",fontWeight:700}}>🎤 Real-Time Tuner</div>
        <button onClick={onClose} style={{color:"#c4a97d",background:"transparent",border:"1px solid #6b5d4a",padding:"4px 14px",borderRadius:6,cursor:"pointer",fontSize:13}}>✕ Close</button>
      </div>

      <div style={{textAlign:"center",marginBottom:14}}>
        <div style={{fontSize:10,color:"#8a7255",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Target Note</div>
        <select value={targetNote} onChange={e=>setTargetNote(e.target.value)}
          style={{fontSize:20,background:"#241608",color:"#f59e0b",padding:"6px 14px",borderRadius:8,border:"1px solid #5a3a18",cursor:"pointer"}}>
          {NOTES.map(n=><option key={n.name} value={n.name}>{n.name}</option>)}
        </select>
      </div>

      <div style={{textAlign:"center",marginBottom:10}}>
        <div style={{fontSize:80,fontWeight:900,color:inTune?"#4ade80":"#f59e0b",lineHeight:1,letterSpacing:"-3px",transition:"color 0.2s",fontFamily:"system-ui"}}>
          {detectedNote}
        </div>
        <div style={{fontSize:13,color:"#8a7255",marginTop:2}}>{detectedFreq > 0 ? detectedFreq+" Hz" : ""}</div>
        <div style={{fontSize:26,color:cc,minHeight:34,marginTop:4}}>
          {detectedCents !== 0 && detectedNote !== "--" ? (detectedCents>0?"+":"")+detectedCents+"¢" : ""}
        </div>
        {inTune && <div style={{color:"#4ade80",fontSize:13,fontWeight:700,marginTop:2,letterSpacing:"0.05em"}}>✓ IN TUNE</div>}
      </div>

      <div style={{position:"relative",height:22,background:"#33240f",borderRadius:999,marginBottom:5,overflow:"hidden"}}>
        <div style={{position:"absolute",left:"50%",top:0,width:2,height:"100%",background:"#f59e0b",zIndex:2}}/>
        {detectedNote !== "--" && (
          <div style={{
            position:"absolute",
            left:`${50 + clampC * 0.42}%`,
            top:"15%",width:"10%",height:"70%",
            background:cc,borderRadius:999,
            transform:"translateX(-50%)",transition:"left 0.1s ease",
          }}/>
        )}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#6b5d4a",marginBottom:14}}>
        <span>♭ flat</span><span>in tune</span><span>sharp ♯</span>
      </div>

      <div style={{height:8,background:"#33240f",borderRadius:999,marginBottom:14,overflow:"hidden"}}>
        <div style={{height:"100%",width:volume+"%",background:volume>70?"#f59e0b":"#d97706",transition:"width 0.06s"}}/>
      </div>

      <button onClick={isListening?stopListening:startListening}
        style={{width:"100%",padding:"14px",fontSize:16,fontWeight:700,borderRadius:8,border:"none",cursor:"pointer",
          background:isListening?"#7f1d1d":"#f59e0b",color:isListening?"#fca5a5":"#0f0801"}}>
        {isListening ? "⏹ Stop Microphone" : "▶ Start Microphone"}
      </button>
      <div style={{fontSize:10,color:"#4a3a26",textAlign:"center",marginTop:6}}>
        Requires microphone permission
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  PROGRESSIVE TUNING ASSISTANT — "GPS for tuning"
//  Walks the builder through drilling order hole-by-hole: cover everything
//  and blow (root note) → open hole 1 → open hole 2 → ... → all holes open.
//  Each step shows the expected note/frequency computed from the same
//  formulas as the rest of the app. The microphone is optional — the
//  expected numbers are always visible as a reference even with it off.
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
//  FINGER REACH ANALYZER — UI
//  Visualizes the gap analysis from analyzeFingerReach() and gives
//  actionable fixes when spacing is cramped or exceeds comfortable reach:
//  increase bore (shortens the tube for the same note, tightening spacing),
//  raise the tuning key (shorter tube overall), or shorten the tube directly
//  (switch to a higher key or trim length).
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
//  ANTLER SELECTION ASSISTANT — UI
//  Physical-measurement intake + ranked key-fit results. onApply hands
//  {bore, curvature, noteKey} back to the caller, which owns actually
//  setting pipeMaterial/antlerShape/bore/noteKey — this component never
//  touches app state directly.
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
//  ERGONOMIC HOLE ADJUSTMENT — UI
//  Lets the maker choose how much to prioritize even, comfortable spacing
//  over pure theoretical tuning, see the resulting positions/diameters and
//  pitch-drift cost side-by-side with the original, and apply the
//  adjustment back into the main hole table via onApply.
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
//  SAVE INSTRUMENT BUTTON — quick-save from Flute/Duduk pages
//  A small button that opens a name prompt and writes the current build
//  config to the library. Purely a UI wrapper around saveInstrumentToLibrary
//  — callers pass in a getConfig() function so the actual state shape stays
//  owned by each page.
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
//  CNC G-CODE EXPORT PANEL — UI
//  Full parameter control (tool, feeds/speeds, stepdown, stock, origin,
//  units) plus a method toggle between the two machining strategies.
//  Generates and downloads a .nc/.gcode file built from the exact same
//  chamber data as the rest of the app.
// ═══════════════════════════════════════════════════════════════
// Common fractional/numbered end mill and drill bit sizes (inches) — used
// to snap auto-computed tool diameters to something a person can actually
// buy/chuck, rather than a random decimal.
const COMMON_BIT_SIZES_IN = [
  0.03125, 0.046875, 0.0625, 0.078125, 0.09375, 0.109375, 0.125, 0.140625,
  0.15625, 0.171875, 0.1875, 0.203125, 0.21875, 0.25, 0.28125, 0.3125,
  0.34375, 0.375, 0.4375, 0.5,
];
function snapToCommonBit(diameterIn) {
  return COMMON_BIT_SIZES_IN.reduce((a, b) => Math.abs(b - diameterIn) < Math.abs(a - diameterIn) ? b : a);
}

// Derives a full parameter set from the flute's own real dimensions rather
// than fixed defaults — "best options for the most accurate result" for
// THIS specific build. All choices are standard, conservative machining
// practice (stepdown/feed scaled to tool diameter, peck depth scaled to
// hole diameter, tool sized to clear the smallest feature safely) rather
// than arbitrary numbers, so results stay physically sound across a tiny
// piccolo-scale flute and a large low-drone chamber alike.
function computeEasyModeParams(chambers, method) {
  const bores = chambers.map(c => c.bore);
  const minBore = Math.min(...bores), maxBore = Math.max(...bores);

  const allHoleDiams = chambers.flatMap(c => (c.playable ? c.holes.map(h => parseFloat(h.diameter)) : []));
  const allTSH = chambers.flatMap(c => [parseFloat(c.shW) || 0, parseFloat(c.shL) || 0]).filter(v => v > 0);
  const smallestFeature = Math.min(
    allHoleDiams.length ? Math.min(...allHoleDiams) : Infinity,
    allTSH.length ? Math.min(...allTSH) : Infinity,
  );

  let toolDiameter;
  if (method === "split") {
    // Channel tool: sized well under the smallest bore's radius so a
    // ball-nose (or flat) end mill can clear full depth without gouging
    // the channel walls, while still being large enough to cut efficiently.
    toolDiameter = snapToCommonBit(Math.max(0.03125, (minBore / 2) * 0.6));
  } else {
    // Drilling tool: sized well under the smallest hole/TSH diameter so
    // the SAME tool can rough every hole; final sizing/tuning is still
    // done by hand per the app's hole table, same as any other build.
    toolDiameter = snapToCommonBit(Math.max(0.03125, smallestFeature * 0.65));
  }

  // Feed/plunge scale conservatively with tool diameter — smaller tools
  // are more fragile and need lighter feeds; this is standard chip-load
  // guidance, not a fixed number regardless of tool size.
  const feedRate = Math.round(Math.max(15, Math.min(80, toolDiameter * 220)));
  const plungeRate = Math.round(feedRate * 0.3);
  const spindleSpeed = Math.round(Math.max(10000, Math.min(24000, 24000 - toolDiameter * 24000)));

  const stepdown = method === "split"
    ? Math.max(0.02, Math.round(toolDiameter * 0.4 * 1000) / 1000)
    : 0.06;
  const peckDepth = method === "tube"
    ? Math.max(0.02, Math.round(smallestFeature * 0.35 * 1000) / 1000)
    : 0.05;

  return {
    toolDiameter, feedRate, plungeRate, spindleSpeed, stepdown, peckDepth,
    safeHeight: 0.5, retractHeight: Math.max(0.05, peckDepth * 2),
    stockMarginX: 0.5, stockMarginY: Math.max(0.25, maxBore),
    channelStyle: "round", setupMode: "rotary",
  };
}


function CNCExportPanel({ chambers, curve, pill, card, lbl, muted, bone, bg2, border, gold }) {
  const [method, setMethod] = useState("split"); // "split" | "tube"
  const [easyMode, setEasyMode] = useState(true);
  const [dialect, setDialect] = useState("grbl");
  const [units, setUnits] = useState("in");
  const [toolDiameter, setToolDiameter] = useState(0.25);
  const [feedRate, setFeedRate] = useState(40);
  const [plungeRate, setPlungeRate] = useState(12);
  const [spindleSpeed, setSpindleSpeed] = useState(16000);
  const [stepdown, setStepdown] = useState(0.06);
  const [safeHeight, setSafeHeight] = useState(0.5);
  const [retractHeight, setRetractHeight] = useState(0.1);
  const [peckDepth, setPeckDepth] = useState(0.05);
  const [stockMarginX, setStockMarginX] = useState(0.5);
  const [stockMarginY, setStockMarginY] = useState(0.5);
  const [channelStyle, setChannelStyle] = useState("round"); // "round" | "flat"
  const [setupMode, setSetupMode] = useState("rotary"); // "rotary" | "fixed"
  const [warning, setWarning] = useState("");
  const [validationReport, setValidationReport] = useState(null);

  // Easy Mode: recompute every parameter from the flute's own real
  // dimensions whenever it's on and the method (or the underlying chamber
  // data) changes, so the fields always reflect "best options for THIS
  // build" rather than a stale computation from a previous configuration.
  useEffect(() => {
    if (!easyMode) return;
    const p = computeEasyModeParams(chambers, method);
    setToolDiameter(p.toolDiameter);
    setFeedRate(p.feedRate);
    setPlungeRate(p.plungeRate);
    setSpindleSpeed(p.spindleSpeed);
    setStepdown(p.stepdown);
    setPeckDepth(p.peckDepth);
    setSafeHeight(p.safeHeight);
    setRetractHeight(p.retractHeight);
    setStockMarginX(p.stockMarginX);
    setStockMarginY(p.stockMarginY);
    setChannelStyle(p.channelStyle);
    setSetupMode(p.setupMode);
  }, [easyMode, method, JSON.stringify(chambers)]);

  const inputStyle = {
    background:bg2, border:`1px solid ${border}`, color:bone, padding:"7px 10px",
    borderRadius:6, fontSize:13, width:"100%",
  };
  const fieldLabel = { fontSize:10, color:muted, marginBottom:4, textTransform:"uppercase", letterSpacing:"0.05em" };

  const download = (filename, content) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const buildGCode = () => {
    const common = { chambers, units, feedRate, plungeRate, safeHeight, dialect, spindleSpeed };
    if (method === "split") {
      return {
        gcode: generateSplitBlockGCode({ ...common, curve, toolDiameter, stepdown, stockMarginX, stockMarginY, channelStyle }),
        filename: `flute_split_block_bore_channel.${dialect==="grbl"?"gcode":"nc"}`,
      };
    }
    return {
      gcode: generateTubeDrillingGCode({ ...common, toolDiameter, peckDepth, retractHeight, setupMode }),
      filename: `flute_tube_drilling.${dialect==="grbl"?"gcode":"nc"}`,
    };
  };

  const checkToolSafety = () => {
    setWarning("");
    const maxBore = Math.max(...chambers.map(c => c.bore));
    if (toolDiameter >= maxBore) {
      setWarning(`⚠ Tool diameter (${toolDiameter}") is larger than or equal to the bore (${maxBore}") — this program would not be safely runnable. Choose a smaller tool.`);
      return false;
    }
    return true;
  };

  const generate = () => {
    if (!checkToolSafety()) return;
    const { gcode, filename } = buildGCode();
    download(filename, gcode);
  };

  // "Open in Viewer" — the G-Code Viewer now lives inside this same app as
  // its own tab, so the program is handed off through a window event that
  // the top-level App listens for (it stores the program and switches
  // tabs). No URL-length limit, no external file to locate.
  const openInViewer = () => {
    if (!checkToolSafety()) return;
    const { gcode, filename } = buildGCode();
    window.dispatchEvent(new CustomEvent("naf-open-gcode-viewer", { detail: { gcode, filename } }));
  };

  return (
    <div>
      <div style={{fontSize:12,color:muted,lineHeight:1.6,marginBottom:14}}>
        Generates a real G-code program from your exact bore, length, and hole positions above. Always simulate the program in your CAM/sender software and verify stock size, work zero, and tool length by hand before cutting.
      </div>

      <div style={{display:"flex",gap:8,marginBottom:14}}>
        <button onClick={()=>setMethod("split")} style={{...pill(method==="split"),flex:1,padding:"10px 8px",fontSize:13,textAlign:"left"}}>
          <div style={{fontWeight:800}}>🪵 Split-Block Glue-Up</div>
          <div style={{fontSize:10,fontWeight:400,marginTop:2}}>Mill a bore channel into 2 blocks, glue together</div>
        </button>
        <button onClick={()=>setMethod("tube")} style={{...pill(method==="tube"),flex:1,padding:"10px 8px",fontSize:13,textAlign:"left"}}>
          <div style={{fontWeight:800}}>🧵 Pre-Cut Tube Drilling</div>
          <div style={{fontSize:10,fontWeight:400,marginTop:2}}>Drill finger holes &amp; sound hole into stock already cut to length</div>
        </button>
      </div>

      <div style={{
        display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,
        padding:"12px 14px",borderRadius:8,marginBottom:14,
        background: easyMode ? "#14251a" : bg2,
        border:`1px solid ${easyMode ? "#3a5a3a" : border}`,
      }}>
        <div>
          <div style={{fontSize:13,fontWeight:800,color: easyMode ? "#7acc44" : bone}}>
            ✨ Easy Mode {easyMode ? "— ON" : "— off"}
          </div>
          <div style={{fontSize:11,color:muted,marginTop:2,lineHeight:1.4}}>
            {easyMode
              ? "Tool size, feeds, speeds, and every other setting below are auto-selected from your flute's own bore and hole sizes for the most accurate result."
              : "Set every parameter by hand below."}
          </div>
        </div>
        <button onClick={()=>setEasyMode(v=>!v)} style={{
          flexShrink:0,width:46,height:26,borderRadius:999,border:"none",cursor:"pointer",position:"relative",
          background: easyMode ? "#4a7a3a" : "#4a3a26",
        }}>
          <span style={{
            position:"absolute",top:3,left: easyMode ? 23 : 3,width:20,height:20,borderRadius:"50%",
            background:"#fff",transition:"left 0.15s",
          }}/>
        </button>
      </div>

      {method === "split" && (
        <div style={{marginBottom:14, opacity: easyMode ? 0.55 : 1, pointerEvents: easyMode ? "none" : "auto"}}>
          <div style={fieldLabel}>Bore Channel Style {easyMode && "(auto: Round)"}</div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>setChannelStyle("round")} style={{...pill(channelStyle==="round"),flex:1,padding:"8px 0",fontSize:12}}>Round (ball-nose)</button>
            <button onClick={()=>setChannelStyle("flat")} style={{...pill(channelStyle==="flat"),flex:1,padding:"8px 0",fontSize:12}}>Flat-bottom</button>
          </div>
        </div>
      )}
      {method === "tube" && (
        <div style={{marginBottom:14, opacity: easyMode ? 0.55 : 1, pointerEvents: easyMode ? "none" : "auto"}}>
          <div style={fieldLabel}>CNC Setup {easyMode && "(auto: 4th-Axis Rotary)"}</div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>setSetupMode("rotary")} style={{...pill(setupMode==="rotary"),flex:1,padding:"8px 0",fontSize:12}}>4th-Axis Rotary</button>
            <button onClick={()=>setSetupMode("fixed")} style={{...pill(setupMode==="fixed"),flex:1,padding:"8px 0",fontSize:12}}>3-Axis, Manual Rotate</button>
          </div>
          {setupMode === "fixed" && (
            <div style={{fontSize:11,color:"#d4a05a",marginTop:6,lineHeight:1.5}}>
              The program pauses (M0) before every hole so you can rotate the tube by hand and re-clamp — check each comment for the required angle.
            </div>
          )}
          {easyMode && (
            <div style={{fontSize:11,color:muted,marginTop:6,lineHeight:1.5}}>
              Rotary is selected because it's the more accurate, repeatable option — switch Easy Mode off if you only have a 3-axis machine.
            </div>
          )}
        </div>
      )}

      <div style={{opacity: easyMode ? 0.55 : 1, pointerEvents: easyMode ? "none" : "auto"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:10}}>
        <div>
          <div style={fieldLabel}>Dialect</div>
          <select value={dialect} onChange={e=>setDialect(e.target.value)} style={inputStyle}>
            {Object.entries(CNC_DIALECTS).map(([k,d]) => <option key={k} value={k}>{d.label}</option>)}
          </select>
        </div>
        <div>
          <div style={fieldLabel}>Units</div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>setUnits("in")} style={{...pill(units==="in"),flex:1,padding:"7px 0",fontSize:12}}>inches</button>
            <button onClick={()=>setUnits("mm")} style={{...pill(units==="mm"),flex:1,padding:"7px 0",fontSize:12}}>mm</button>
          </div>
        </div>
        <div>
          <div style={fieldLabel}>Tool Diameter (in)</div>
          <input type="number" step="0.0625" min="0.01" value={toolDiameter} onChange={e=>setToolDiameter(parseFloat(e.target.value)||0)} style={inputStyle}/>
        </div>
        <div>
          <div style={fieldLabel}>Spindle Speed (RPM)</div>
          <input type="number" step="500" min="1000" value={spindleSpeed} onChange={e=>setSpindleSpeed(parseFloat(e.target.value)||0)} style={inputStyle}/>
        </div>
        <div>
          <div style={fieldLabel}>Feed Rate (in/min)</div>
          <input type="number" step="1" min="1" value={feedRate} onChange={e=>setFeedRate(parseFloat(e.target.value)||0)} style={inputStyle}/>
        </div>
        <div>
          <div style={fieldLabel}>Plunge Rate (in/min)</div>
          <input type="number" step="1" min="1" value={plungeRate} onChange={e=>setPlungeRate(parseFloat(e.target.value)||0)} style={inputStyle}/>
        </div>
        <div>
          <div style={fieldLabel}>Safe Height (in)</div>
          <input type="number" step="0.1" min="0.1" value={safeHeight} onChange={e=>setSafeHeight(parseFloat(e.target.value)||0)} style={inputStyle}/>
        </div>
        {method === "split" ? (
          <>
            <div>
              <div style={fieldLabel}>Stepdown per Pass (in)</div>
              <input type="number" step="0.01" min="0.01" value={stepdown} onChange={e=>setStepdown(parseFloat(e.target.value)||0)} style={inputStyle}/>
            </div>
            <div>
              <div style={fieldLabel}>Stock Margin X (in)</div>
              <input type="number" step="0.1" min="0" value={stockMarginX} onChange={e=>setStockMarginX(parseFloat(e.target.value)||0)} style={inputStyle}/>
            </div>
            <div>
              <div style={fieldLabel}>Stock Margin Y (in)</div>
              <input type="number" step="0.1" min="0" value={stockMarginY} onChange={e=>setStockMarginY(parseFloat(e.target.value)||0)} style={inputStyle}/>
            </div>
          </>
        ) : (
          <>
            <div>
              <div style={fieldLabel}>Peck Depth (in)</div>
              <input type="number" step="0.01" min="0.01" value={peckDepth} onChange={e=>setPeckDepth(parseFloat(e.target.value)||0)} style={inputStyle}/>
            </div>
            <div>
              <div style={fieldLabel}>Retract Height (in)</div>
              <input type="number" step="0.01" min="0.01" value={retractHeight} onChange={e=>setRetractHeight(parseFloat(e.target.value)||0)} style={inputStyle}/>
            </div>
          </>
        )}
      </div>
      </div>

      {warning && (
        <div style={{fontSize:12,color:"#fca5a5",background:"#2a1208",border:"1px solid #7a4a30",borderRadius:6,padding:"8px 12px",marginBottom:10}}>
          {warning}
        </div>
      )}

      <button onClick={()=>setValidationReport(validateAllChambers(chambers))} style={{
        width:"100%",padding:"9px",borderRadius:8,border:`1px solid ${border}`,background:bg2,color:bone,
        fontWeight:700,fontSize:12.5,cursor:"pointer",marginBottom:10,
      }}>
        ✓ Run Geometry Validation
      </button>
      {validationReport && (
        <div style={{
          fontSize:11.5,borderRadius:6,padding:"10px 12px",marginBottom:10,
          background: validationReport.valid ? "#14251a" : "#2a1208",
          border:`1px solid ${validationReport.valid ? "#3a5a3a" : "#7a4a30"}`,
          color: validationReport.valid ? "#7acc44" : "#fca5a5",
        }}>
          {validationReport.valid
            ? "✓ All chamber geometry checks passed — hole positions, sound hole dimensions, and SAC length all agree with the shared formulas used by every output (table, 3D, drilling template, PDF, G-code)."
            : (
              <>
                <div style={{fontWeight:700,marginBottom:6}}>⚠ {validationReport.issues.length} geometry issue{validationReport.issues.length>1?"s":""} found:</div>
                {validationReport.issues.map((issue,i) => <div key={i} style={{marginBottom:3}}>• {issue}</div>)}
              </>
            )}
        </div>
      )}

      <div style={{display:"flex",gap:8}}>
        <button onClick={generate} style={{
          flex:1,padding:"12px",borderRadius:8,border:"none",background:gold,color:"#0f0801",
          fontWeight:800,fontSize:14,cursor:"pointer",
        }}>
          ⚙ Generate &amp; Download G-Code
        </button>
        <button onClick={openInViewer} style={{
          flex:1,padding:"12px",borderRadius:8,border:`1px solid ${border}`,background:bg2,color:bone,
          fontWeight:800,fontSize:14,cursor:"pointer",
        }}>
          🖥 Open in G-Code Viewer
        </button>
      </div>

      <div style={{fontSize:10.5,color:muted,marginTop:8,lineHeight:1.5}}>
        "Open in G-Code Viewer" switches to the built-in ⚙ G-Code tab with this program already loaded — no separate viewer file needed anymore.
      </div>

      <div style={{fontSize:10.5,color:muted,marginTop:8,lineHeight:1.5}}>
        Uses explicit move sequences rather than canned drilling cycles (G81/G83), so the output runs correctly on every dialect above — including GRBL, which doesn't support canned cycles at all.
      </div>
    </div>
  );
}


function SaveInstrumentButton({ kind, getConfig, pill, bg2, border, bone, muted, gold }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  const doSave = () => {
    const entry = saveInstrumentToLibrary(name, kind, getConfig());
    if (entry) {
      setSavedMsg(`Saved as "${entry.name}"`);
      setName("");
      setOpen(false);
      setTimeout(()=>setSavedMsg(""), 3500);
    } else {
      setSavedMsg("Couldn't save — browser storage may be full or unavailable.");
      setTimeout(()=>setSavedMsg(""), 4500);
    }
  };

  return (
    <div>
      {!open ? (
        <button onClick={()=>setOpen(true)} style={{
          padding:"9px 16px",borderRadius:8,border:`1px solid ${border}`,background:bg2,color:bone,
          fontWeight:700,fontSize:12.5,cursor:"pointer",display:"flex",alignItems:"center",gap:6,
        }}>
          💾 Save to Library
        </button>
      ) : (
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <input autoFocus type="text" value={name} onChange={e=>setName(e.target.value)}
            onKeyDown={e=>{ if (e.key==="Enter") doSave(); if (e.key==="Escape") setOpen(false); }}
            placeholder={`e.g. "My Favorite G Minor"`}
            style={{background:bg2,border:`1px solid ${border}`,color:bone,padding:"8px 12px",borderRadius:6,fontSize:13,minWidth:220}}/>
          <button onClick={doSave} style={{padding:"8px 14px",borderRadius:6,border:"none",background:gold,color:"#0f0801",fontWeight:700,fontSize:12.5,cursor:"pointer"}}>Save</button>
          <button onClick={()=>{setOpen(false);setName("");}} style={{padding:"8px 14px",borderRadius:6,border:`1px solid ${border}`,background:"none",color:muted,fontWeight:700,fontSize:12.5,cursor:"pointer"}}>Cancel</button>
        </div>
      )}
      {savedMsg && <div style={{fontSize:11.5,color:savedMsg.startsWith("Saved")?"#7acc44":"#fca5a5",marginTop:6}}>{savedMsg}</div>}
    </div>
  );
}


function ErgonomicHoleAdjustment({ holes, onApply, applied, onReset, pill, muted, bone, bg2, border }) {
  const [blend, setBlend] = useState(0.5);
  const adjusted = ergonomicAdjustHoles(holes, blend);
  const maxDrift = Math.max(0, ...adjusted.map(h => Math.abs(h.centsShift)));

  const driftColor = (c) => {
    const a = Math.abs(c);
    if (a === 0) return "#8a7255";
    if (a <= 15) return "#4ade80";
    if (a <= 40) return "#fbbf24";
    return "#f87171";
  };

  return (
    <div>
      <div style={{fontSize:12,color:muted,lineHeight:1.6,marginBottom:14}}>
        Theoretical hole positions come from pure scale-degree math, which doesn't always land evenly under your fingers. This blends interior holes toward even spacing — the two end holes never move — and estimates the tuning cost plus a starting diameter compensation for each shifted hole. Final tuning is still done by ear/tuner against the actual drilled hole.
      </div>

      <div style={{marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:muted,marginBottom:6}}>
          <span>Pure theoretical tuning</span>
          <span>Fully even spacing</span>
        </div>
        <input type="range" min="0" max="1" step="0.05" value={blend}
          onChange={e=>setBlend(parseFloat(e.target.value))}
          style={{width:"100%"}}/>
        <div style={{textAlign:"center",fontSize:13,fontWeight:700,color:"#f59e0b",marginTop:4}}>
          {Math.round(blend*100)}% toward even spacing
        </div>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14}}>
        <div style={{display:"flex",fontSize:10,color:muted,textTransform:"uppercase",letterSpacing:"0.05em",padding:"0 4px"}}>
          <div style={{width:50}}>Hole</div>
          <div style={{width:90}}>From TSH</div>
          <div style={{width:90}}>Diameter</div>
          <div style={{flex:1}}>Pitch drift</div>
        </div>
        {adjusted.map(h => (
          <div key={h.num} style={{display:"flex",alignItems:"center",padding:"6px 4px",background:bg2,borderRadius:6,fontSize:12}}>
            <div style={{width:50,fontWeight:700,color:bone}}>H{h.num}</div>
            <div style={{width:90,color:bone}}>
              {h.adjFromTSH}"
              {h.adjFromTSH !== h.fromTSH && <span style={{color:muted,fontSize:10}}> (was {h.fromTSH}")</span>}
            </div>
            <div style={{width:90,color:bone}}>
              {h.adjDiameter}"
              {h.adjDiameter !== h.diameter && <span style={{color:muted,fontSize:10}}> (was {h.diameter}")</span>}
            </div>
            <div style={{flex:1,color:driftColor(h.centsShift),fontWeight:600}}>
              {h.centsShift === 0 ? "no change" : `${h.centsShift>0?"+":""}${h.centsShift}¢`}
            </div>
          </div>
        ))}
      </div>

      {maxDrift > 40 && (
        <div style={{fontSize:11.5,color:"#fca5a5",marginBottom:12,lineHeight:1.6}}>
          ⚠ At this blend, the largest pitch drift is {maxDrift}¢ — that's a noticeable tuning shift. Consider a lower blend, or plan to compensate with the suggested diameters and confirm each hole by ear during drilling.
        </div>
      )}

      <div style={{display:"flex",gap:8}}>
        <button onClick={()=>onApply(adjusted)} style={{
          flex:1,padding:"10px",borderRadius:8,border:"none",background:"#f59e0b",color:"#0f0801",
          fontWeight:700,fontSize:13,cursor:"pointer",
        }}>
          Apply Adjusted Positions
        </button>
        {applied && (
          <button onClick={onReset} style={{
            padding:"10px 16px",borderRadius:8,border:`1px solid ${border}`,background:"none",color:muted,
            fontWeight:700,fontSize:13,cursor:"pointer",
          }}>
            Reset to Theoretical
          </button>
        )}
      </div>
      {applied && (
        <div style={{fontSize:11,color:"#7acc44",marginTop:8}}>
          ✓ Adjusted positions are active — the hole table, drilling template, 3D preview, and workshop PDF below all reflect this adjustment.
        </div>
      )}
    </div>
  );
}


function AntlerSelectionAssistant({ holeCount, NOTES, onApply, pill, bg2, border, bone, muted, card, lbl }) {
  const [length,     setLength]     = useState("");
  const [widestDiam, setWidestDiam] = useState("");
  const [tipDiam,    setTipDiam]    = useState("");
  const [curvature,  setCurvature]  = useState("straight");
  const [analyzed,   setAnalyzed]   = useState(null);

  const canAnalyze = length && widestDiam && tipDiam &&
    parseFloat(length) > 0 && parseFloat(widestDiam) > 0 && parseFloat(tipDiam) > 0;

  const runAnalysis = () => {
    const result = analyzeAntlerFit({ length, widestDiam, tipDiam, curvature }, NOTES, holeCount);
    setAnalyzed(result);
  };

  const inputStyle = {
    background:bg2, border:`1px solid ${border}`, color:bone, padding:"8px 10px",
    borderRadius:6, fontSize:13, width:"100%",
  };

  return (
    <div>
      <div style={{fontSize:12,color:muted,lineHeight:1.6,marginBottom:12}}>
        Already have a piece of antler in hand? Enter its real measurements and this checks which keys it can actually be built into — using the same bore/length physics as the calculator above, so results line up with everything else in the app.
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:10}}>
        <div>
          <div style={{fontSize:10,color:muted,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>Length (in)</div>
          <input type="number" step="0.25" min="0" value={length} onChange={e=>setLength(e.target.value)} style={inputStyle} placeholder="e.g. 22"/>
        </div>
        <div>
          <div style={{fontSize:10,color:muted,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>Widest Diameter (in)</div>
          <input type="number" step="0.05" min="0" value={widestDiam} onChange={e=>setWidestDiam(e.target.value)} style={inputStyle} placeholder="e.g. 1.4"/>
        </div>
        <div>
          <div style={{fontSize:10,color:muted,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>Tip Diameter (in)</div>
          <input type="number" step="0.05" min="0" value={tipDiam} onChange={e=>setTipDiam(e.target.value)} style={inputStyle} placeholder="e.g. 0.8"/>
        </div>
      </div>

      <div style={{marginBottom:14}}>
        <div style={{fontSize:10,color:muted,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>Curvature</div>
        <div style={{display:"flex",gap:6}}>
          {["straight","slight","heavy"].map(c => (
            <button key={c} onClick={()=>setCurvature(c)} style={{...pill(curvature===c),flex:1,padding:"7px 0",fontSize:12}}>{c}</button>
          ))}
        </div>
      </div>

      <button onClick={runAnalysis} disabled={!canAnalyze} style={{
        width:"100%",padding:"11px",borderRadius:8,border:"none",fontWeight:700,fontSize:14,
        cursor: canAnalyze ? "pointer" : "not-allowed",
        background: canAnalyze ? "#f59e0b" : "#4a3a26",
        color: canAnalyze ? "#0f0801" : "#8a7255",
      }}>
        🔍 Analyze This Antler
      </button>

      {analyzed && (
        <div style={{marginTop:16}}>
          {!analyzed.fits ? (
            <div style={{background:"#2a1208",border:"1px solid #7a4a30",borderRadius:8,padding:"14px"}}>
              <div style={{fontSize:13,fontWeight:700,color:"#fca5a5",marginBottom:6}}>
                ✗ This piece doesn't have enough usable length or width to build a flute
              </div>
              <div style={{fontSize:12,color:muted,lineHeight:1.6}}>
                {analyzed.reason === "tip_too_narrow"
                  ? `The tip diameter (${tipDiam}") is too narrow to hold any standard bore with safe wall thickness. You'd need at least ${fmt(BORES[0].val + ANTLER_WALL_MARGIN*2,2)}" at the tip.`
                  : `Even at the largest bore this piece supports (${analyzed.bore}"), the usable tube length works out to ${fmt(analyzed.usableTubeLen,1)}" after SAC and trim allowances — too short to reach any playable note.`}
              </div>
            </div>
          ) : (
            <>
              <div style={{background:"#14251a",border:"1px solid #3a5a3a",borderRadius:8,padding:"12px 14px",marginBottom:12}}>
                <div style={{fontSize:13,fontWeight:700,color:"#7acc44",marginBottom:4}}>
                  ✓ This antler can be built as a {analyzed.scaleName}
                </div>
                <div style={{fontSize:11.5,color:muted,lineHeight:1.5}}>
                  Recommended bore: <strong style={{color:bone}}>{analyzed.bore}"</strong> (largest size that fits your tip diameter) ·
                  {" "}Usable tube length after SAC &amp; trim: <strong style={{color:bone}}>{fmt(analyzed.usableTubeLen,1)}"</strong>
                </div>
              </div>

              <div style={{fontSize:11,color:muted,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.05em",fontWeight:700}}>
                Best-fit keys, ranked
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14}}>
                {analyzed.bestMatches.map((r, i) => (
                  <div key={r.name} style={{
                    display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,
                    padding:"9px 12px",borderRadius:8,background:i===0?"#1f2e18":bg2,
                    border:`1px solid ${i===0?"#4a7a3a":border}`,
                  }}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <span style={{fontSize:13,fontWeight:800,color: i===0 ? "#7acc44" : "#4ade80"}}>✓ {r.name}</span>
                      <span style={{fontSize:11,color:muted}}>
                        {r.fitsExact ? "Near-perfect fit" : `Fits with ${fmt(r.diff,1)}" trimmed off`}
                      </span>
                    </div>
                    <button onClick={()=>onApply({bore:analyzed.bore, curvature, noteKey:r.name})} style={{
                      padding:"5px 12px",borderRadius:6,border:"none",background:"#f59e0b",color:"#0f0801",
                      fontWeight:700,fontSize:11.5,cursor:"pointer",flexShrink:0,
                    }}>
                      Apply
                    </button>
                  </div>
                ))}
              </div>

              {analyzed.tooLongExamples.length > 0 && (
                <div style={{fontSize:11.5,color:"#d4a05a",lineHeight:1.6}}>
                  ✗ Too short for lower keys like {analyzed.tooLongExamples.map(r=>r.name).join(", ")} — those need a longer tube than this piece can provide at this bore.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}


function FingerReachAnalyzer({ holes, handSize, bore, holeCount, muted, bone }) {
  const { gaps, hasProblem, hasWarning } = analyzeFingerReach(holes);

  const statusColor = {
    comfortable: "#4ade80",
    tight:       "#fbbf24",
    stretch:     "#fbbf24",
    cramped:     "#f87171",
    exceeds:     "#f87171",
  };
  const statusLabel = {
    comfortable: "Comfortable",
    tight:       "Tight",
    stretch:     "Stretch",
    cramped:     "Cramped — fingers will collide",
    exceeds:     "Exceeds average hand reach",
  };

  const overallColor = hasProblem ? "#f87171" : hasWarning ? "#fbbf24" : "#4ade80";
  const overallText  = hasProblem
    ? "⚠ One or more gaps fall outside comfortable hand reach"
    : hasWarning
      ? "Playable, but a couple of gaps are tight or a stretch"
      : "✓ All hole spacing is within comfortable reach";

  return (
    <div>
      <div style={{
        display:"flex",alignItems:"center",gap:8,padding:"10px 14px",borderRadius:8,marginBottom:14,
        background:"#1a1208",border:`1px solid ${overallColor}`,
      }}>
        <span style={{color:overallColor,fontSize:14,fontWeight:800}}>{overallText}</span>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14}}>
        {gaps.map((g, i) => (
          <div key={i} style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:70,fontSize:11,color:muted,flexShrink:0}}>H{g.from} → H{g.to}</div>
            <div style={{flex:1,height:10,background:"#2a1c0e",borderRadius:999,overflow:"hidden",position:"relative"}}>
              <div style={{
                height:"100%",
                width:`${Math.min(100, (g.gap / 2.2) * 100)}%`,
                background:statusColor[g.status],
                borderRadius:999,
              }}/>
            </div>
            <div style={{width:56,fontSize:11,color:bone,textAlign:"right",flexShrink:0}}>{fmt(g.gap,2)}"</div>
            <div style={{width:170,fontSize:10.5,color:statusColor[g.status],flexShrink:0,fontWeight:600}}>{statusLabel[g.status]}</div>
          </div>
        ))}
      </div>

      {hasProblem && (() => {
        const isCramped = gaps.some(g => g.status === "cramped");
        const isExceeds = gaps.some(g => g.status === "exceeds");
        return (
          <div style={{background:"#2a1208",border:"1px solid #7a4a30",borderRadius:8,padding:"12px 14px"}}>
            <div style={{fontSize:12.5,fontWeight:700,color:"#fca5a5",marginBottom:8}}>Recommended fixes — try one or more:</div>
            <div style={{fontSize:12,color:muted,lineHeight:1.7}}>
              {isCramped && (<>
                <div>• <strong style={{color:bone}}>Lower the tuning key</strong> — a lower root note needs a longer tube overall, naturally spreading holes further apart.</div>
                <div>• <strong style={{color:bone}}>Decrease bore diameter</strong> — a narrower bore lengthens the tube slightly for the same note, giving a little more room (currently {bore}").</div>
                <div>• <strong style={{color:bone}}>Reduce hole count</strong> — fewer holes ({holeCount} now) means fewer gaps packed into the same tube length.</div>
              </>)}
              {isExceeds && (<>
                <div>• <strong style={{color:bone}}>Raise the tuning key</strong> — a higher root note needs a shorter tube overall, naturally pulling holes closer together.</div>
                <div>• <strong style={{color:bone}}>Increase bore diameter</strong> — a wider bore shortens the tube slightly for the same note, tightening spacing a bit (currently {bore}").</div>
                <div>• <strong style={{color:bone}}>Reduce hole count</strong> — fewer holes ({holeCount} now) means fewer gaps to fit along the same tube length.</div>
              </>)}
              <div>• <strong style={{color:bone}}>Set hand size to "large"</strong> if your reach is above average — this widens the comfort thresholds this analyzer checks against, though it won't change the physical gap itself.</div>
            </div>
          </div>
        );
      })()}
      {!hasProblem && hasWarning && (
        <div style={{fontSize:11.5,color:muted,lineHeight:1.6}}>
          Tight or stretch gaps are playable for most hands but worth testing on a full-size mockup before committing to a final drill. If it feels wrong for your hands, the same fixes above (bore, key, hole count) apply.
        </div>
      )}
    </div>
  );
}


function ProgressiveTuningAssistant({ chamber, a4, NOTES }) {
  // Build the step sequence: step 0 = all holes covered (root), then one
  // step per hole opened in ascending-pitch order. Hole "num" 1 is closest
  // to the foot but carries the LARGEST scale-degree ratio (biggest jump
  // from root); the highest-numbered hole is closest to the mouth/TSH and
  // carries the SMALLEST ratio (barely above root). So opening holes in
  // order from highest num down to 1 walks the pitch up step by step,
  // exactly matching standard NAF fingering technique (lift the mouth-most
  // finger first, then work toward the foot) and the interval labels shown
  // in the Finger Hole Positions table (Min 3rd → ... → Octave/9th).
  const orderedHoles = [...chamber.holes].sort((a, b) => b.num - a.num);
  const steps = [
    { holeNum: null, label: "Cover all holes", note: chamber.note, ratio: 1 },
    ...orderedHoles.map(h => ({
      holeNum: h.num,
      label: `Open Hole ${h.num}`,
      interval: h.interval,
    })),
  ];

  // Expected frequency at each step: root frequency × that hole's scale-degree
  // ratio (ratio 1 = root/all covered) — the same ratio already used to place
  // that hole's position in the Finger Hole Positions table, so the number
  // shown here always agrees with the rest of the app.
  const rootFreq = chamber.note ? NOTES.find(n => n.name === chamber.note.name)?.freq : null;
  const config = SCALE_CONFIGS[chamber.holeCount || chamber.holes.length] || null;
  const ratioByNum = {};
  if (config) config.holes.forEach(h => { ratioByNum[h.num] = h.ratio; });

  const expectedFreqAt = (stepIdx) => {
    if (!rootFreq) return null;
    if (stepIdx === 0) return rootFreq;
    const holeNum = steps[stepIdx].holeNum;
    const ratio = ratioByNum[holeNum] ?? 1;
    return rootFreq * ratio;
  };

  const [stepIdx, setStepIdx] = useState(0);
  const expFreq = expectedFreqAt(stepIdx);
  const expNote = expFreq ? nearestNote(expFreq, NOTES) : null;

  // --- Optional microphone comparison (shares the same autocorrelation
  // pitch detector as the Real-Time Tuner) ---
  const [isListening,   setIsListening]   = useState(false);
  const [detectedFreq,  setDetectedFreq]  = useState(0);
  const [detectedNote,  setDetectedNote]  = useState("--");
  const [volume,        setVolume]        = useState(0);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef      = useRef(null);
  const streamRef   = useRef(null);

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      analyserRef.current = analyser;
      setIsListening(true);

      const tick = () => {
        if (!analyserRef.current || !audioCtxRef.current) return;
        const buf = new Float32Array(analyserRef.current.fftSize);
        analyserRef.current.getFloatTimeDomainData(buf);
        const pitch = autoCorrelatePitch(buf, audioCtxRef.current.sampleRate);

        let maxA = 0;
        for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > maxA) maxA = a; }
        setVolume(Math.min(maxA * 120, 100));

        if (pitch > 60 && pitch < 2500) {
          setDetectedFreq(Math.round(pitch));
          setDetectedNote(nearestNote(pitch, NOTES).name);
        } else {
          setDetectedFreq(0); setDetectedNote("--");
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      alert("Microphone error: " + e.message);
    }
  };

  const stopListening = () => {
    if (rafRef.current)     { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current)  { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (audioCtxRef.current){ audioCtxRef.current.close(); audioCtxRef.current = null; }
    analyserRef.current = null;
    setIsListening(false); setDetectedFreq(0); setDetectedNote("--"); setVolume(0);
  };

  useEffect(() => () => stopListening(), []);

  const centsOff = (expFreq && detectedFreq > 0) ? Math.round(1200 * Math.log2(detectedFreq / expFreq)) : null;
  const inTune   = centsOff !== null && Math.abs(centsOff) < 12;
  const cc       = centsOff === null ? "#8a7255" : Math.abs(centsOff) < 10 ? "#4ade80" : Math.abs(centsOff) < 30 ? "#fbbf24" : "#f87171";

  const goNext = () => setStepIdx(i => Math.min(steps.length - 1, i + 1));
  const goPrev = () => setStepIdx(i => Math.max(0, i - 1));

  if (!chamber.playable || chamber.holes.length === 0) {
    return (
      <div style={{fontSize:12,color:"#8a7255"}}>
        This chamber has no finger holes to walk through — progressive tuning only applies to a playable chamber with holes.
      </div>
    );
  }

  return (
    <div>
      <div style={{fontSize:12,color:"#8a7255",lineHeight:1.6,marginBottom:14}}>
        Drill and test one step at a time, opening holes from the mouth end toward the foot (the smallest pitch jump first, largest last — matching standard NAF fingering). At each step, cover the holes shown, blow a steady breath, and compare against the expected pitch below before enlarging or moving to the next hole.
      </div>

      {/* Step progress dots */}
      <div style={{display:"flex",gap:4,marginBottom:16,flexWrap:"wrap"}}>
        {steps.map((s, i) => (
          <button key={i} onClick={()=>setStepIdx(i)} title={s.label} style={{
            width:26,height:26,borderRadius:"50%",border:`1px solid ${i===stepIdx?"#f59e0b":"#4a3a26"}`,
            background:i===stepIdx?"#f59e0b":i<stepIdx?"#5a3a18":"#241608",
            color:i===stepIdx?"#0f0801":i<stepIdx?"#e5d5b8":"#8a7255",
            fontSize:10,fontWeight:700,cursor:"pointer",flexShrink:0,
          }}>
            {i===0 ? "R" : s.holeNum}
          </button>
        ))}
      </div>

      {/* Current step card */}
      <div style={{background:"#1a1208",border:`2px solid ${inTune?"#4ade80":"#5a3a18"}`,borderRadius:12,padding:18,marginBottom:14,transition:"border-color 0.3s"}}>
        <div style={{textAlign:"center",marginBottom:6}}>
          <div style={{fontSize:11,color:"#d4a05a",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:700}}>
            Step {stepIdx+1} of {steps.length}
          </div>
          <div style={{fontSize:20,color:"#f59e0b",fontWeight:800,marginTop:2}}>{steps[stepIdx].label}</div>
          {stepIdx > 0 && <div style={{fontSize:11,color:"#8a7255",marginTop:2}}>({steps[stepIdx].interval} from root)</div>}
        </div>

        {/* Which holes are open/covered right now, visually */}
        <div style={{display:"flex",justifyContent:"center",gap:6,margin:"12px 0"}}>
          {orderedHoles.map(h => {
            const isOpen = steps[stepIdx].holeNum !== null && h.num >= steps[stepIdx].holeNum;
            return (
              <div key={h.num} style={{textAlign:"center"}}>
                <div style={{
                  width:22,height:22,borderRadius:"50%",
                  border:`2px solid ${isOpen?"#7acc44":"#c4a97d"}`,
                  background:isOpen?"transparent":"#c4a97d",
                }}/>
                <div style={{fontSize:9,color:"#6b5d4a",marginTop:2}}>H{h.num}</div>
              </div>
            );
          })}
        </div>
        <div style={{textAlign:"center",fontSize:10,color:"#6b5d4a",marginBottom:10}}>
          ⬤ filled = finger covering hole · ○ open = green = uncovered
        </div>

        <div style={{textAlign:"center",marginBottom:10}}>
          <div style={{fontSize:10,color:"#8a7255",textTransform:"uppercase",letterSpacing:"0.08em"}}>Expected</div>
          <div style={{fontSize:44,fontWeight:900,color:"#f59e0b",lineHeight:1.1}}>
            {expNote ? expNote.name : "--"}
          </div>
          <div style={{fontSize:14,color:"#c4a97d",marginTop:2}}>
            {expFreq ? `${fmt(expFreq,1)} Hz` : ""}
          </div>
        </div>

        {isListening && (
          <div style={{textAlign:"center",borderTop:"1px solid #3a2a14",paddingTop:10,marginTop:4}}>
            <div style={{fontSize:10,color:"#8a7255",textTransform:"uppercase",letterSpacing:"0.08em"}}>Hearing</div>
            <div style={{fontSize:32,fontWeight:800,color:inTune?"#4ade80":"#e5d5b8",lineHeight:1.1}}>
              {detectedNote}
            </div>
            <div style={{fontSize:13,color:"#8a7255"}}>{detectedFreq>0?`${detectedFreq} Hz`:""}</div>
            <div style={{fontSize:20,color:cc,minHeight:26,marginTop:2}}>
              {centsOff !== null ? `${centsOff>0?"+":""}${centsOff}¢` : ""}
            </div>
            {inTune && <div style={{color:"#4ade80",fontSize:12,fontWeight:700,letterSpacing:"0.05em"}}>✓ MATCHES EXPECTED PITCH</div>}
            {centsOff !== null && !inTune && (
              <div style={{fontSize:11,color:"#d4a05a",marginTop:2}}>
                {centsOff > 0 ? "Sharp — hole may be slightly large, or check for air leaks" : "Flat — enlarge this hole gradually, then re-check"}
              </div>
            )}

            <div style={{position:"relative",height:16,background:"#33240f",borderRadius:999,marginTop:10,overflow:"hidden"}}>
              <div style={{position:"absolute",left:"50%",top:0,width:2,height:"100%",background:"#f59e0b",zIndex:2}}/>
              {centsOff !== null && (
                <div style={{
                  position:"absolute",
                  left:`${50 + Math.max(-50,Math.min(50,centsOff)) * 0.42}%`,
                  top:"15%",width:"9%",height:"70%",
                  background:cc,borderRadius:999,transform:"translateX(-50%)",transition:"left 0.1s ease",
                }}/>
              )}
            </div>
            <div style={{height:6,background:"#33240f",borderRadius:999,marginTop:6,overflow:"hidden"}}>
              <div style={{height:"100%",width:volume+"%",background:volume>70?"#f59e0b":"#d97706",transition:"width 0.06s"}}/>
            </div>
          </div>
        )}

        <button onClick={isListening?stopListening:startListening}
          style={{width:"100%",padding:"12px",fontSize:14,fontWeight:700,borderRadius:8,border:"none",cursor:"pointer",marginTop:12,
            background:isListening?"#7f1d1d":"#f59e0b",color:isListening?"#fca5a5":"#0f0801"}}>
          {isListening ? "⏹ Stop Microphone" : "🎤 Compare With Microphone (optional)"}
        </button>
      </div>

      {/* Prev / Next navigation */}
      <div style={{display:"flex",gap:8}}>
        <button onClick={goPrev} disabled={stepIdx===0} style={{
          flex:1,padding:"12px",borderRadius:8,border:"1px solid #4a3a26",
          background: stepIdx===0 ? "#1a1208" : "#241608",
          color: stepIdx===0 ? "#4a3a26" : "#e5d5b8",
          fontWeight:700,fontSize:14,cursor: stepIdx===0 ? "not-allowed" : "pointer",
        }}>
          ← Previous
        </button>
        <button onClick={goNext} disabled={stepIdx===steps.length-1} style={{
          flex:1,padding:"12px",borderRadius:8,border:"none",
          background: stepIdx===steps.length-1 ? "#4a3a26" : "#f59e0b",
          color: stepIdx===steps.length-1 ? "#8a7255" : "#0f0801",
          fontWeight:700,fontSize:14,cursor: stepIdx===steps.length-1 ? "not-allowed" : "pointer",
        }}>
          {stepIdx===steps.length-1 ? "✓ All Holes Open" : "Next →"}
        </button>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
//  HARMONY BUILDER — suggests drone chamber sets for the melody flute
//  Pure UI/logic component: reads the melody's bore/root, offers preset
//  "styles" plus a custom drone-count option, and hands a ready-to-use
//  drones array back to the caller via onApply — the caller (FlutePage)
//  owns the actual setDrones() call and any overwrite confirmation.
// ═══════════════════════════════════════════════════════════════
function HarmonyBuilder({ bore, noteKey, currentDroneCount, onApply, pill, card, lbl, muted, bg2, border, bone }) {
  const [customCount, setCustomCount] = useState(2);

  // Builds a drones[] array (same shape the app already uses) from a list
  // of DRONE_INTERVALS indices — all pure-drone (no finger holes), bore
  // matched to the melody bore as a sensible starting point.
  const buildDroneSet = (intervalIdxs) => intervalIdxs.map(ix => ({
    bore, intervalIdx: ix, playable: false, holeCount: 2, noteKey,
  }));

  const applyWithConfirm = (intervalIdxs) => {
    if (currentDroneCount > 0) {
      const ok = window.confirm(
        `This will replace your current ${currentDroneCount} drone chamber${currentDroneCount>1?"s":""} with this harmony. Continue?`
      );
      if (!ok) return;
    }
    onApply(buildDroneSet(intervalIdxs));
  };

  // A sensible default spread for "custom count" — evenly spans below and
  // above root so 1/2/3 drones all sound reasonable without hand-tuning.
  const customSpread = {
    1: [0],       // 5th below
    2: [2, 0],    // octave below + 5th below
    3: [0, 3, 5], // 5th below, root, 5th above
  };

  return (
    <div>
      <div style={{fontSize:12,color:muted,lineHeight:1.6,marginBottom:12}}>
        Pick a harmony style to automatically configure your drone chambers, tuned relative to the melody root ({noteKey}). You can still hand-tune bore, interval, or make a chamber playable afterward.
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,marginBottom:14}}>
        {HARMONY_PRESETS.map(p => (
          <button key={p.id} onClick={()=>applyWithConfirm(p.intervals)} style={{
            textAlign:"left",padding:"12px 14px",borderRadius:10,cursor:"pointer",
            border:"1px solid #4a3a26",background:bg2,color:bone,
          }}>
            <div style={{fontSize:14,fontWeight:800,marginBottom:2}}>{p.icon} {p.name}</div>
            <div style={{fontSize:10,color:"#d4a05a",marginBottom:4}}>
              {p.intervals.map(ix=>DRONE_INTERVALS[ix].label).join(" · ")}
            </div>
            <div style={{fontSize:11,color:muted,lineHeight:1.4}}>{p.desc}</div>
          </button>
        ))}
      </div>

      <div style={{borderTop:`1px solid ${border}`,paddingTop:12}}>
        <div style={{fontSize:11,color:muted,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:700}}>
          Or build a custom spread
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <div style={{display:"flex",gap:6}}>
            {[1,2,3].map(n=>(
              <button key={n} onClick={()=>setCustomCount(n)} style={{...pill(customCount===n),padding:"7px 16px"}}>
                {n} Drone{n>1?"s":""}
              </button>
            ))}
          </div>
          <button onClick={()=>applyWithConfirm(customSpread[customCount])} style={{
            padding:"9px 18px",borderRadius:8,border:"none",background:"#f59e0b",color:"#0f0801",
            fontWeight:700,fontSize:13,cursor:"pointer",
          }}>
            Apply
          </button>
          <div style={{fontSize:11,color:muted}}>
            {customSpread[customCount].map(ix=>DRONE_INTERVALS[ix].label).join(" · ")}
          </div>
        </div>
      </div>
    </div>
  );
}


// mode: "cut" draws tube outline + SAC/TSH/foot cut lines only (no holes).
//       "drill" draws tube outline + finger holes only (no cut-line emphasis
//       beyond a light TSH reference line needed to anchor hole distances).
function drawScaleTemplate(doc, { chambers, mode = "drill" }) {
  const PAGE_W = 11, PAGE_H = 8.5;
  const MARGIN = 0.5;
  const USABLE_W = PAGE_W - MARGIN * 2;
  const TOP = 1.0;
  const rowGap = 1.3;
  const tubeH = 0.5;

  const grandTotal = Math.max(...chambers.map(c => c.sacLen + c.L), 1);
  const nPages = Math.max(1, Math.ceil(grandTotal / USABLE_W));

  const rowColors = [[200,120,0],[80,150,40],[100,120,220],[200,60,140]];
  const titleWord = mode === "cut" ? "Cutting" : "Drilling";

  for (let p = 0; p < nPages; p++) {
    doc.addPage([PAGE_W, PAGE_H], "landscape");

    const segStart = p * USABLE_W;
    const segEnd   = Math.min(grandTotal, segStart + USABLE_W);

    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text(`${titleWord} Template — Page ${p+1} of ${nPages} — PRINT AT 100% SCALE (no "fit to page")`, MARGIN, 0.45);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(`Segment shows ${fmt(segStart,2)}" to ${fmt(segEnd,2)}" measured from the mouthpiece end. Tape pages together at the alignment marks if multi-page.`, MARGIN, 0.65);

    doc.setDrawColor(150,150,150); doc.setLineWidth(0.01);
    for (let i = Math.ceil(segStart*4)/4; i <= segEnd; i += 0.25) {
      const x = MARGIN + (i - segStart);
      const isInch = Math.abs(i - Math.round(i)) < 0.001;
      const tickH = isInch ? 0.12 : 0.06;
      doc.line(x, TOP - tickH, x, TOP);
      if (isInch) {
        doc.setFontSize(7);
        doc.text(fmt(i,0)+'"', x, TOP - tickH - 0.04, {align:"center"});
      }
    }

    function drawChamber(yPos, chSac, chL, chHoles, chBore, chLabel, chColor) {
      const chTotal = chSac + chL;
      const visStart = Math.max(0, segStart);
      const visEnd   = Math.min(chTotal, segEnd);
      if (visEnd <= visStart) return;

      doc.setFont("helvetica","bold"); doc.setFontSize(9);
      doc.setTextColor(chColor[0],chColor[1],chColor[2]);
      doc.text(chLabel, MARGIN, yPos - 0.18);
      doc.setTextColor(0,0,0);

      doc.setDrawColor(80,50,20); doc.setLineWidth(0.02);
      const bodyX1 = MARGIN + (visStart - segStart);
      const bodyX2 = MARGIN + (visEnd - segStart);
      doc.rect(bodyX1, yPos, bodyX2 - bodyX1, tubeH);

      const sacVisStart = Math.max(visStart, 0);
      const sacVisEnd   = Math.min(visEnd, chSac);
      if (sacVisEnd > sacVisStart) {
        doc.setFillColor(230,200,150);
        const sx1 = MARGIN + (sacVisStart - segStart);
        const sx2 = MARGIN + (sacVisEnd - segStart);
        doc.rect(sx1, yPos, sx2 - sx1, tubeH, "F");
        doc.rect(bodyX1 <= sx1 ? sx1 : bodyX1, yPos, sx2-sx1, tubeH);
      }

      if (chSac >= visStart && chSac <= visEnd) {
        const tshX = MARGIN + (chSac - segStart);
        doc.setDrawColor(200,120,0); doc.setLineWidth(mode === "cut" ? 0.035 : 0.025);
        doc.line(tshX, yPos - 0.08, tshX, yPos + tubeH + 0.08);
        doc.setFontSize(7); doc.setTextColor(160,90,0);
        doc.text("TSH", tshX, yPos - 0.10, {align:"center"});
        doc.setTextColor(0,0,0);

        // Internal wall/plug — the real, solid partition separating the SAC
        // from the sound chamber (a hardwood dowel plug in real NAF
        // construction). Drawn as a bold filled bar, distinct from the thin
        // TSH line, right at the same SAC/body boundary.
        doc.setFillColor(60,36,16);
        doc.rect(tshX - 0.035, yPos - 0.03, 0.07, tubeH + 0.06, "F");
        doc.setFontSize(6); doc.setTextColor(60,36,16);
        doc.text("WALL/PLUG", tshX, yPos + tubeH + 0.16, {align:"center"});
        doc.setTextColor(0,0,0);
      }

      if (chTotal >= visStart && chTotal <= visEnd) {
        const footX = MARGIN + (chTotal - segStart);
        doc.setDrawColor(0,0,0); doc.setLineWidth(mode === "cut" ? 0.045 : 0.03);
        doc.line(footX, yPos, footX, yPos + tubeH);
        doc.setFontSize(7);
        doc.text(mode === "cut" ? "CUT HERE (foot)" : "FOOT", footX, yPos + tubeH + 0.14, {align:"center"});
      }

      // Cutting guide also marks the mouth end (start of SAC) as a cut line,
      // since that's the other end the builder needs to trim to length.
      if (mode === "cut" && 0 >= visStart && 0 <= visEnd) {
        const mouthX = MARGIN + (0 - segStart);
        doc.setDrawColor(0,0,0); doc.setLineWidth(0.045);
        doc.line(mouthX, yPos, mouthX, yPos + tubeH);
        doc.setFontSize(7);
        doc.text("CUT HERE (mouth)", mouthX, yPos - 0.24, {align:"center"});
      }

      if (mode === "drill") {
        chHoles.forEach(h => {
          const holePos = chSac + parseFloat(h.fromTSH);
          if (holePos < visStart - 0.01 || holePos > visEnd + 0.01) return;
          const hx = MARGIN + (holePos - segStart);
          const hy = yPos + tubeH/2;
          const rad = Math.max(0.035, parseFloat(h.diameter)/2);
          doc.setDrawColor(200,120,0); doc.setLineWidth(0.02);
          doc.circle(hx, hy, rad);
          doc.setLineWidth(0.008);
          doc.line(hx - rad - 0.04, hy, hx + rad + 0.04, hy);
          doc.line(hx, hy - rad - 0.04, hx, hy + rad + 0.04);
          doc.setFontSize(7); doc.setFont("helvetica","bold");
          doc.text(`H${h.num}`, hx, yPos - 0.02, {align:"center"});
          doc.setFont("helvetica","normal"); doc.setFontSize(6);
          doc.text(`Ø${h.diameter}"`, hx, yPos + tubeH + 0.13, {align:"center"});
        });
      }
    }

    chambers.forEach((c, idx) => {
      const yPos = TOP + 0.5 + idx * rowGap;
      const label = c.playable
        ? `CHAMBER ${idx+1} (PLAYABLE) — Root ${c.note.name} — ${c.holes.length}-Hole`
        : `CHAMBER ${idx+1} (DRONE) — ${c.note ? c.note.name : ""} — no finger holes`;
      drawChamber(yPos, c.sacLen, c.L, c.playable ? c.holes : [], c.bore, label, rowColors[idx % rowColors.length]);
    });

    if (nPages > 1) {
      doc.setFontSize(7); doc.setTextColor(120,120,120);
      if (p > 0) doc.text("◄ align with previous page's right edge", MARGIN, PAGE_H - MARGIN);
      if (p < nPages - 1) doc.text("align with next page's left edge ►", PAGE_W - MARGIN, PAGE_H - MARGIN, {align:"right"});
      doc.setTextColor(0,0,0);
    }

    doc.setDrawColor(0,0,0); doc.setLineWidth(0.015);
    doc.rect(PAGE_W - MARGIN - 1.0, PAGE_H - MARGIN - 0.35, 1.0, 0.25);
    doc.setFontSize(7);
    doc.text('1.00" exactly →', PAGE_W - MARGIN - 1.0 - 0.05, PAGE_H - MARGIN - 0.20, {align:"right"});
    doc.text("Measure this box with a ruler before drilling. If it's not exactly 1\", reprint without page scaling.", MARGIN, PAGE_H - MARGIN + 0.12);
  }
}

// ═══════════════════════════════════════════════════════════════
//  MULTI-PAGE WORKSHOP PDF — cover sheet, cutting guide, drill guide,
//  tuning guide, sanding checklist, finishing checklist.
//  Each draws one page (or page group) into a shared jsPDF doc.
// ═══════════════════════════════════════════════════════════════

function pageHeader(doc, title, subtitle) {
  doc.setFont("helvetica","bold"); doc.setFontSize(18);
  doc.text(title, 4.25, 0.8, {align:"center"});
  doc.setFont("helvetica","normal"); doc.setFontSize(10);
  doc.setTextColor(120,120,120);
  doc.text(subtitle, 4.25, 1.05, {align:"center"});
  doc.setTextColor(0,0,0);
  doc.setDrawColor(200,150,50); doc.setLineWidth(0.02);
  doc.line(0.8, 1.25, 7.7, 1.25);
}

function checkboxLine(doc, x, y, text, opts={}) {
  doc.setDrawColor(0,0,0); doc.setLineWidth(0.015);
  doc.rect(x, y-0.13, 0.16, 0.16);
  doc.setFont("helvetica", opts.bold ? "bold" : "normal");
  doc.setFontSize(opts.size || 11);
  doc.text(text, x+0.26, y, {maxWidth: opts.maxWidth || 6.5});
}

// ── PAGE: Cover Sheet ──────────────────────────────────────────
function drawCoverPage(doc, data) {
  const { bore, holeCount, rootNote, totalLen, sacLen, handSize, antlerShape, pipeMaterial,
          fluteStyle, drones, a4, L } = data;
  const isAntler = pipeMaterial === "antler";
  const isDrone = drones.length > 0;

  doc.setFont("helvetica","bold"); doc.setFontSize(24);
  doc.text(`${isAntler ? "Antler" : "NAF"} ${isDrone?`${drones.length}-Drone `:""}Flute`, 4.25, 1.3, {align:"center"});
  doc.setFont("helvetica","normal"); doc.setFontSize(14);
  doc.setTextColor(120,90,40);
  doc.text(`${holeCount}-Hole · Key of ${rootNote.name} · Workshop Build Packet`, 4.25, 1.65, {align:"center"});
  doc.setTextColor(0,0,0);

  doc.setDrawColor(200,150,50); doc.setLineWidth(0.03);
  doc.line(1.2, 1.95, 7.3, 1.95);

  // At-a-glance spec table
  let y = 2.5;
  const specs = [
    ["Material",        isAntler ? `Antler (${antlerShape} curve)` : "Straight pipe"],
    ["Tuning reference", `A4 = ${a4} Hz`],
    ["Bore diameter",   `${bore}"`],
    ["Root note",       rootNote.name],
    ["Hand size",       handSize],
    ["Melody tube (TSH→foot)", `${fmt(L)}"`],
    ["SAC length",      `${fmt(sacLen)}"`],
    ["Total length (melody)",  `${totalLen}"`],
  ];
  doc.setFontSize(12);
  specs.forEach(([label, val]) => {
    doc.setFont("helvetica","bold"); doc.text(label+":", 1.4, y);
    doc.setFont("helvetica","normal"); doc.text(val, 4.0, y);
    y += 0.34;
  });

  if (isDrone) {
    y += 0.15;
    doc.setFont("helvetica","bold"); doc.setFontSize(13);
    doc.text(`Secondary Chambers (${drones.length}):`, 1.4, y); y += 0.3;
    doc.setFont("helvetica","normal"); doc.setFontSize(11);
    drones.forEach((d, i) => {
      const kind = d.playable ? `Playable, ${d.holeCount}-hole` : `Drone (${d.di.label})`;
      doc.text(`Chamber ${i+2}: ${kind} — ${d.note.name} — bore ${d.bore}" — total ${d.totalLen}"`, 1.4, y, {maxWidth:6.3});
      y += 0.3;
    });
  }

  y += 0.25;
  doc.setDrawColor(200,150,50); doc.setLineWidth(0.02);
  doc.line(1.2, y, 7.3, y); y += 0.35;

  doc.setFont("helvetica","bold"); doc.setFontSize(12);
  doc.text("Packet Contents:", 1.4, y); y += 0.3;
  doc.setFont("helvetica","normal"); doc.setFontSize(11);
  const contents = [
    "1. Cover Sheet — this page",
    "2. Cutting Guide — true-scale (100%) cut lines for tube length",
    "3. Drill Guide — true-scale (100%) finger hole positions & sizes",
    "4. Tuning Guide — step-by-step expected pitch as each hole opens",
    "5. Sanding Checklist",
    "6. Finishing Checklist",
  ];
  contents.forEach(line => { doc.text(line, 1.6, y); y += 0.28; });

  y += 0.2;
  doc.setFont("helvetica","italic"); doc.setFontSize(9.5);
  doc.setTextColor(120,120,120);
  doc.text("Print the Cutting Guide and Drill Guide pages at 100% scale (no \"fit to page\").", 1.4, y, {maxWidth:6.3}); y += 0.22;
  doc.text('Each of those pages includes a 1" calibration box — verify it with a ruler before cutting or drilling.', 1.4, y, {maxWidth:6.3});
  doc.setTextColor(0,0,0);
}

// ── PAGE: Tuning Guide ─────────────────────────────────────────
function drawTuningGuidePage(doc, data) {
  const { holeCount, holes, rootNote, a4, NOTES } = data;
  doc.addPage("letter", "portrait");
  pageHeader(doc, "Tuning Guide", "Expected pitch as each hole opens, from mouth end toward foot — check with a chromatic tuner");

  const config = SCALE_CONFIGS[holeCount];
  const rootFreq = NOTES.find(n => n.name === rootNote.name)?.freq;
  const orderedHoles = config ? [...config.holes].sort((a,b) => b.num - a.num) : [];

  let y = 1.65;
  doc.setFont("helvetica","bold"); doc.setFontSize(11);
  doc.text("Step", 0.8, y); doc.text("Action", 1.5, y); doc.text("Interval", 3.6, y);
  doc.text("Expected Note", 4.9, y); doc.text("Expected Freq.", 6.3, y);
  y += 0.1; doc.setDrawColor(0,0,0); doc.setLineWidth(0.01); doc.line(0.8,y,7.7,y); y += 0.28;

  doc.setFont("helvetica","normal"); doc.setFontSize(10.5);
  const rows = [
    { step: 1, action: "Cover all holes", interval: "Root", note: rootNote.name, freq: rootFreq },
    ...orderedHoles.map((h, i) => ({
      step: i+2, action: `Open Hole ${h.num}`, interval: h.interval,
      note: rootFreq ? nearestNote(rootFreq * h.ratio, NOTES).name : "--",
      freq: rootFreq ? rootFreq * h.ratio : null,
    })),
  ];
  rows.forEach(r => {
    doc.text(String(r.step), 0.85, y);
    doc.text(r.action, 1.5, y);
    doc.text(r.interval, 3.6, y);
    doc.setFont("helvetica","bold"); doc.text(r.note, 4.9, y); doc.setFont("helvetica","normal");
    doc.text(r.freq ? `${fmt(r.freq,1)} Hz` : "--", 6.3, y);
    y += 0.34;
  });

  y += 0.15; doc.line(0.8,y,7.7,y); y += 0.3;
  doc.setFont("helvetica","italic"); doc.setFontSize(9.5);
  doc.text("Drill each hole undersized first, blow a steady breath, and compare against the expected", 0.8, y); y += 0.22;
  doc.text("frequency above before enlarging. Enlarge gradually with a round file — you can always go", 0.8, y); y += 0.22;
  doc.text("bigger, never smaller. This same walkthrough is available live (with microphone comparison)", 0.8, y); y += 0.22;
  doc.text("in the app's Progressive Tuning Assistant.", 0.8, y);
}

// ── PAGE: Sanding Checklist ─────────────────────────────────────
function drawSandingChecklistPage(doc, data) {
  const { pipeMaterial } = data;
  const isAntler = pipeMaterial === "antler";
  doc.addPage("letter", "portrait");
  pageHeader(doc, "Sanding Checklist", isAntler ? "Antler surface & bore prep" : "Straight pipe surface prep");

  let y = 1.7;
  const items = isAntler ? [
    "Rough-shape the outside with a coarse rasp or belt sander, removing saw marks from cutting the mouth and foot ends",
    "Sand the outer surface progressively: 80 → 150 → 220 grit, following the antler's natural contour rather than flattening it",
    "Round over the mouthpiece end so it sits comfortably against your lips — no sharp edges",
    "Sand the foot end edge lightly to remove burrs from cutting",
    "Deburr the inside edge of every finger hole with a round needle file or sanding drum — sharp edges here affect both feel and tone",
    "Deburr the inside edge of the TSH (sound hole) window the same way",
    "Wipe the whole antler down with a damp cloth to raise the grain, let dry, then knock back any raised fibers with 220 grit",
    "Final pass with 320–400 grit for a smooth, glove-like feel before finishing",
    "Check the bore by feel (finger or cloth-wrapped dowel) for any rough or spongy patches left from hollowing — sand or seal these before finishing",
  ] : [
    "Remove any tooling marks or flash from cutting the mouth and foot ends",
    "Sand the outer surface progressively: 120 → 220 → 320 grit if the pipe will be painted, wrapped, or left natural",
    "Round over the mouthpiece end so it sits comfortably against your lips — no sharp edges",
    "Deburr the inside edge of every finger hole — sharp edges here affect both feel and tone",
    "Deburr the inside edge of the TSH (sound hole) window the same way",
    "Lightly scuff the outer surface if you plan to paint, stain, or wrap the tube, so finish adheres evenly",
    "Wipe down with a dry or slightly damp cloth to remove all sanding dust before finishing",
  ];

  doc.setFontSize(11.5);
  items.forEach(item => { checkboxLine(doc, 0.9, y, item, {maxWidth: 6.3}); y += 0.5; });

  y += 0.1;
  doc.setFont("helvetica","italic"); doc.setFontSize(9.5); doc.setTextColor(120,120,120);
  doc.text("Tip: hold the tube up to a light after sanding the bore — any thin or translucent", 0.8, y); y += 0.2;
  doc.text("spots indicate a wall that may be too thin at that point.", 0.8, y);
  doc.setTextColor(0,0,0);
}

// ── PAGE: Finishing Checklist ───────────────────────────────────
function drawFinishingChecklistPage(doc, data) {
  const { pipeMaterial, fluteStyle, drones } = data;
  const isAntler = pipeMaterial === "antler";
  const isDrone = drones.length > 0;
  doc.addPage("letter", "portrait");
  pageHeader(doc, "Finishing Checklist", isAntler ? "Sealing & finishing an antler flute" : "Sealing & finishing a pipe flute");

  let y = 1.7;
  const items = isAntler ? [
    "Confirm final tuning on every hole is correct before finishing — a sealant coat makes further hole enlargement messier",
    "Apply a thin first coat of finish (tung oil, beeswax/mineral-oil blend, or antler-safe polyurethane) to the outside only",
    "Let the first coat cure fully per the product's instructions before handling",
    "Lightly buff with 0000 steel wool or a soft cloth between coats",
    "Apply 2–3 additional thin coats, curing and buffing between each, rather than one thick coat",
    "Seal the bore interior lightly if desired (thinned oil on a cloth-wrapped dowel) — avoid pooling finish near finger holes or the TSH window",
    "Wax or oil the mouthpiece end generously for a smooth, comfortable feel against the lips",
    "Attach a plug/block at the mouth end if not already permanently fixed, and confirm it seals the SAC chamber completely with no air leaks",
    "Do a final blow-test on every hole combination after finishing — finish thickness can shift pitch slightly",
  ] : [
    "Confirm final tuning on every hole is correct before finishing",
    "Clean the tube thoroughly (soap and water for PVC; tack cloth for wood) and let dry completely",
    "If painting or staining, apply primer/sealer appropriate to your material first",
    "Apply finish in thin, even coats — 2–3 coats generally outperform one thick coat",
    "Avoid pooling finish near finger holes, the TSH window, or the mouthpiece opening",
    "Let each coat cure fully before handling or applying the next",
    "Attach a plug/block at the mouth end if not already permanently fixed, and confirm it seals the SAC chamber completely with no air leaks",
    "Do a final blow-test on every hole combination after finishing — finish thickness can shift pitch slightly",
  ];

  doc.setFontSize(11.5);
  items.forEach(item => { checkboxLine(doc, 0.9, y, item, {maxWidth: 6.3}); y += 0.5; });

  if (isDrone) {
    y += 0.1;
    doc.setFont("helvetica","bold"); doc.setFontSize(11);
    doc.text("Multi-chamber note:", 0.9, y); y += 0.28;
    doc.setFont("helvetica","normal"); doc.setFontSize(10.5);
    doc.text("Finish and seal each chamber the same way, and double-check the shared mouthpiece", 0.9, y, {maxWidth:6.3}); y += 0.22;
    doc.text("block seals all chambers independently — an air leak between chambers will affect tone.", 0.9, y, {maxWidth:6.3});
  }
}

// ═══════════════════════════════════════════════════════════════
//  CNC G-CODE GENERATION
//  Two independent machining strategies, both driven by the exact same
//  chamber/hole data (bore, sacLen, L, holes[].fromTSH/diameter, shW/shL)
//  used everywhere else in the app, so the G-code always matches the
//  drilling template, 3D preview, and PDF.
//
//  Dialect note: canned drilling cycles (G81/G83) are NOT supported by
//  GRBL, the most common hobby/DIY controller — only by LinuxCNC, Mach3/4,
//  Fanuc, and Siemens controls. To guarantee the output actually runs on
//  every dialect offered (including GRBL), every drilling operation is
//  generated as explicit rapid/feed move sequences (peck drilling done by
//  hand as repeated G0/G1 pairs) rather than G81/G83 canned cycles. This
//  is fully valid, standard G-code everywhere — just less compact than a
//  canned cycle would be on controls that support one.
// ═══════════════════════════════════════════════════════════════

const CNC_DIALECTS = {
  grbl:     { label: "GRBL (Shapeoko, X-Carve, most hobby routers)", programEnd: "M30", supportsCannedCycles: false },
  linuxcnc: { label: "LinuxCNC / EMC2",                              programEnd: "M2",  supportsCannedCycles: true  },
  mach3:    { label: "Mach3 / Mach4",                                programEnd: "M30", supportsCannedCycles: true  },
  generic:  { label: "Generic RS-274 (most hobby/prosumer CNC)",     programEnd: "M30", supportsCannedCycles: false },
};

function gcodeHeader(dialect, units, opts = {}) {
  const d = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push(`( ${opts.title || "NAF Flute Calculator — CNC Program"} )`);
  lines.push(`( Generated ${d} — dialect: ${CNC_DIALECTS[dialect].label} )`);
  if (opts.notes) opts.notes.forEach(n => lines.push(`( ${n} )`));
  lines.push(`( ⚠ SIMULATE THIS PROGRAM AND VERIFY ALL OFFSETS BEFORE CUTTING — )`);
  lines.push(`( ⚠ confirm stock size, work zero, and tool length by hand first. )`);
  lines.push("G17 G90 G94"); // XY plane, absolute distance, feed-per-minute
  lines.push(units === "mm" ? "G21" : "G20");
  lines.push("G54"); // default work coordinate system
  return lines;
}

function gcodeFooter(dialect) {
  return ["M5 ( spindle off )", "G0 Z25 ( retract )", CNC_DIALECTS[dialect].programEnd];
}

function toUnits(inches, units) {
  return units === "mm" ? inches * 25.4 : inches;
}

// ── STRATEGY A: Split-block glue-up ─────────────────────────────────
// Mills a half-round (or flat-bottom) channel along the bore centerline
// into each of two stock blocks, stepped down in passes. Curve (straight/
// slight/heavy) follows the same physical bow used in the 3D preview, so
// the channel matches the antler curve you've configured.
function generateSplitBlockGCode(params) {
  const {
    chambers, curve, units, toolDiameter, stepdown, feedRate, plungeRate,
    safeHeight, stockMarginX, stockMarginY, channelStyle, dialect, spindleSpeed,
  } = params;

  const bowAmp = curveBowAmplitudeIn(curve);
  const lines = [];
  const maxLen = Math.max(...chambers.map(c => c.sacLen + c.L));

  lines.push(...gcodeHeader(dialect, units, {
    title: "Split-Block Bore Channel — Half 1 of 2 (mill both halves identically, then glue)",
    notes: [
      `Stock needed: at least ${fmt(toUnits(maxLen + 2*stockMarginX, units),2)} ${units} long x enough width/thickness for bore + margin.`,
      `Tool: ${fmt(toUnits(toolDiameter, units),3)} ${units} diameter ${channelStyle === "round" ? "ball-nose" : "flat"} end mill.`,
      "Mill this SAME program into a second identical block for the other half.",
      "After both halves are milled, drill finger holes and the sound hole AFTER glue-up using the tube-drilling program, or drill each half separately before gluing if your process allows.",
    ],
  }));
  lines.push(`S${Math.round(spindleSpeed)} M3 ( spindle on )`);

  chambers.forEach((c, ci) => {
    const r = c.bore / 2;
    const totalLen = c.sacLen + c.L;
    const centerAt = (t) => ({
      x: t * totalLen,
      y: bowAmp === 0 ? 0 : bowAmp * Math.sin(t * Math.PI),
    });

    // Internal wall/plug position — the SAC/sound-chamber boundary, same
    // spot as the sound hole (TSH). The channel must NOT be milled through
    // here: a real NAF needs a solid partition at this point (see the
    // build guide's "Install the internal wall/plug" step), typically a
    // separate hardwood dowel installed after milling. Leaving a solid,
    // unmachined gap in the channel at this position means the two glued
    // halves naturally leave a solid block there instead of an open
    // channel, matching the real, physically-required part — without this,
    // the milled channel would run straight through with nothing to
    // separate the two chambers, and the finished flute would not
    // physically be able to produce its two-chamber tone.
    const wallThickness = Math.max(
      FLUTE_CONST.INTERNAL_WALL_THICKNESS_MIN,
      Math.min(c.bore * FLUTE_CONST.INTERNAL_WALL_THICKNESS_RATIO, FLUTE_CONST.INTERNAL_WALL_THICKNESS_MAX)
    );
    const wallStart = c.sacLen - wallThickness / 2;
    const wallEnd = c.sacLen + wallThickness / 2;

    lines.push(`( ── Chamber ${ci+1}${c.label ? " — " + c.label : ""}: bore ${fmt(toUnits(c.bore,units),3)}${units} length ${fmt(toUnits(totalLen,units),2)}${units} ── )`);
    lines.push(`( NOTE: channel is deliberately NOT machined from ${fmt(toUnits(wallStart,units),3)}${units} to ${fmt(toUnits(wallEnd,units),3)}${units} — )`);
    lines.push(`( this gap is the internal wall/plug position (SAC/sound-chamber boundary). )`);
    lines.push(`( Install a hardwood dowel plug here after glue-up per the build guide — do not mill through it. )`);
    lines.push(`G0 Z${fmt(toUnits(safeHeight, units),3)}`);

    // Target channel depth: full bore radius for a round (ball-nose) profile,
    // or a flat-bottom pocket at the same depth for a flat-end-mill pass —
    // either way the two halves together form the full bore diameter.
    const targetDepth = r;
    const passCount = Math.max(1, Math.ceil(targetDepth / stepdown));

    // Split the channel into two separate runs — mouth-to-wall-start, and
    // wall-end-to-foot — so the toolpath physically lifts clear and skips
    // over the plug's position rather than cutting through it.
    const segments = [
      { fromT: 0, toT: Math.max(0, wallStart / totalLen), label: "mouth → wall (SAC side)" },
      { fromT: Math.min(1, wallEnd / totalLen), toT: 1, label: "wall → foot (sound chamber side)" },
    ].filter(seg => seg.toT > seg.fromT + 1e-6);

    const segs = 40;
    segments.forEach(({ fromT, toT, label }) => {
      lines.push(`( -- ${label} -- )`);
      for (let pass = 1; pass <= passCount; pass++) {
        const depth = Math.min(targetDepth, pass * stepdown);
        lines.push(`( pass ${pass}/${passCount} — depth ${fmt(toUnits(depth,units),3)} ${units} )`);
        const start = centerAt(fromT + (stockMarginX / totalLen * 0.001));
        lines.push(`G0 X${fmt(toUnits(start.x,units),3)} Y${fmt(toUnits(start.y,units),3)}`);
        lines.push(`G1 Z${fmt(-toUnits(depth,units),3)} F${fmt(toUnits(plungeRate,units),1)}`);
        const segSteps = Math.max(2, Math.round(segs * (toT - fromT)));
        for (let s = 1; s <= segSteps; s++) {
          const t = fromT + (toT - fromT) * (s / segSteps);
          const p = centerAt(t);
          lines.push(`G1 X${fmt(toUnits(p.x,units),3)} Y${fmt(toUnits(p.y,units),3)} F${fmt(toUnits(feedRate,units),1)}`);
        }
        lines.push(`G0 Z${fmt(toUnits(safeHeight,units),3)}`);
      }
    });
  });

  lines.push(...gcodeFooter(dialect));
  return lines.join("\n");
}

// ── STRATEGY B: Drill finger holes + TSH into a pre-cut tube ────────
// Two sub-modes:
//  - rotary (4th-axis A): tube is held in a rotary fixture; the program
//    rotates A to present each hole under the spindle, then plungs Z.
//  - fixed (3-axis, V-block): only X (position along tube) and Z (plunge)
//    are used; the operator manually re-clocks/rotates the tube by hand
//    between holes per the printed angle noted in the comments, since a
//    3-axis machine has no way to rotate the part itself.
function generateTubeDrillingGCode(params) {
  const {
    chambers, units, toolDiameter, feedRate, plungeRate, peckDepth,
    safeHeight, retractHeight, dialect, spindleSpeed, setupMode, // "rotary" | "fixed"
  } = params;

  const lines = [];
  lines.push(...gcodeHeader(dialect, units, {
    title: `Tube Drilling — Finger Holes & Sound Hole (${setupMode === "rotary" ? "4th-axis rotary" : "3-axis fixed, manual rotation"})`,
    notes: [
      "PREREQUISITE: the internal wall/plug (separating the SAC from the sound chamber) must already be installed in the tube before running this program — see the build guide's \"Install the internal wall/plug\" step. This program does not create that wall; it only drills the sound hole and finger holes into a tube that already has it.",
      ...(setupMode === "rotary"
        ? [
            "Tube is held in a rotary (4th-axis/A) fixture, centerline along X.",
            "A-axis rotates the tube to present each hole under a fixed vertical spindle; program work zero (X0) at the mouth end.",
            "Confirm your rotary fixture's A-axis direction matches this program (positive A = the direction noted per hole).",
          ]
        : [
            "3-axis setup: tube held in a V-block or fixture, centerline along X, NOT rotating under CNC control.",
            "Between each hole, ROTATE THE TUBE BY HAND to the angle noted in that hole's comment, then re-clamp before running that block.",
            "This program pauses (M0) before each hole so you can rotate/re-clamp safely — press cycle-start/resume when ready.",
            "All holes are assumed to be drilled straight down (12 o'clock / top of tube) once rotated into position.",
          ]),
    ],
  }));
  lines.push(`S${Math.round(spindleSpeed)} M3 ( spindle on )`);

  chambers.forEach((c, ci) => {
    if (!c.playable && !(c.shW && c.shL)) return; // nothing to drill on a pure drone chamber besides its own TSH, handled below if present
    const r = c.bore / 2;

    lines.push(`( ── Chamber ${ci+1}${c.label ? " — " + c.label : ""} ── )`);
    lines.push(`G0 Z${fmt(toUnits(safeHeight,units),3)}`);

    // Sound hole (TSH) — drilled at the SAC/body boundary, top of tube.
    if (c.shW && c.shL) {
      const tshX = c.sacLen;
      const tshDiam = Math.max(parseFloat(c.shW) || 0, parseFloat(c.shL) || 0);
      drillOneHole(lines, {
        label: "SOUND HOLE (TSH)", x: tshX, diameter: tshDiam, depth: r + 0.05,
        units, feedRate, plungeRate, peckDepth, safeHeight, retractHeight, setupMode, angleDeg: 0,
      });
    }

    // Finger holes, in physical order along the tube.
    if (c.playable) {
      const ordered = [...c.holes].sort((a,b) => parseFloat(a.fromTSH) - parseFloat(b.fromTSH));
      ordered.forEach(h => {
        const x = c.sacLen + parseFloat(h.fromTSH);
        drillOneHole(lines, {
          label: `HOLE H${h.num} (${h.interval || ""})`, x, diameter: parseFloat(h.diameter), depth: r + 0.05,
          units, feedRate, plungeRate, peckDepth, safeHeight, retractHeight, setupMode, angleDeg: 0,
        });
      });
    }
  });

  lines.push(...gcodeFooter(dialect));
  return lines.join("\n");
}

function drillOneHole(lines, p) {
  const { label, x, diameter, depth, units, feedRate, plungeRate, peckDepth, safeHeight, retractHeight, setupMode, angleDeg } = p;
  lines.push(`( -- ${label}: Ø${fmt(toUnits(diameter,units),3)}${units} at ${fmt(toUnits(x,units),2)}${units} from mouth${setupMode==="fixed" ? `, rotate to ${angleDeg}° (top/12 o'clock)` : ""} -- )`);
  if (setupMode === "rotary") {
    lines.push(`G0 A${fmt(angleDeg,2)}`);
  } else {
    lines.push(`M0 ( PAUSE — rotate tube to ${angleDeg}° and re-clamp, then resume )`);
  }
  lines.push(`G0 X${fmt(toUnits(x,units),3)} Z${fmt(toUnits(safeHeight,units),3)}`);
  lines.push(`G0 Z${fmt(toUnits(retractHeight,units),3)}`);

  // Explicit peck-drilling sequence (no G81/G83 — see module note on GRBL
  // canned-cycle support), so this runs identically on every dialect.
  const totalDepth = depth;
  const pecks = Math.max(1, Math.ceil(totalDepth / peckDepth));
  for (let i = 1; i <= pecks; i++) {
    const z = -Math.min(totalDepth, i * peckDepth);
    lines.push(`G1 Z${fmt(toUnits(z,units),3)} F${fmt(toUnits(plungeRate,units),1)}`);
    if (i < pecks) lines.push(`G0 Z${fmt(toUnits(retractHeight,units),3)} ( chip clear )`);
  }
  lines.push(`G0 Z${fmt(toUnits(safeHeight,units),3)}`);
}


function exportPDF({ bore, L, holes, holeCount, rootNote, totalLen, sacLen, handSize, antlerShape, pipeMaterial,
                     fluteStyle, droneResults, a4, NOTES }) {
  const doc = new jsPDF({ unit: "in", format: "letter" });
  const drones = (fluteStyle === "drone" && droneResults) ? droneResults.filter(d => d.L > 0 && d.note) : [];
  const isDrone = drones.length > 0;
  const isAntler = pipeMaterial === "antler";

  const data = { bore, L, holes, holeCount, rootNote, totalLen, sacLen, handSize, antlerShape,
                 pipeMaterial, fluteStyle, drones, a4, NOTES };

  // 1. Cover sheet (uses the doc's initial page)
  drawCoverPage(doc, data);

  // Build the shared chambers array used by both the cutting and drill guides.
  const chambers = [{ L, sacLen, bore, holes, playable: true, note: rootNote, label: "MELODY" }];
  drones.forEach((d, i) => {
    chambers.push({
      L: d.L, sacLen: d.sacLen, bore: d.bore, holes: d.playable ? d.holes : [],
      playable: d.playable, note: d.note, label: d.playable ? `CHAMBER ${i+2} (PLAYABLE)` : `DRONE ${i+1}`,
    });
  });

  // 2. Cutting guide — true-scale cut lines only
  drawScaleTemplate(doc, { chambers, mode: "cut" });

  // 3. Drill guide — true-scale finger holes only
  drawScaleTemplate(doc, { chambers, mode: "drill" });

  // 4. Tuning guide
  drawTuningGuidePage(doc, data);

  // 5. Sanding checklist
  drawSandingChecklistPage(doc, data);

  // 6. Finishing checklist
  drawFinishingChecklistPage(doc, data);

  const safeName = rootNote.name.replace(/[#\/]/g,"_");
  doc.save(`${isAntler ? "antler" : "naf"}_flute_${holeCount}hole_${safeName}_${bore}bore${isDrone?`_${drones.length}chamber`:""}_workshop_packet.pdf`);
}

// ═══════════════════════════════════════════════════════════════
//  ANTLER FLUTE PAGE
// ═══════════════════════════════════════════════════════════════
function FlutePage({ loadConfig, onConfigLoaded }) {
  const [bore,           setBore]           = useState(0.625);
  const [mode,           setMode]           = useState("key");
  const [noteKey,        setNoteKey]        = useState("A4");
  const [rawLen,         setRawLen]         = useState("15.0");
  const [holeCount,      setHoleCount]      = useState(6);
  const [handSize,       setHandSize]       = useState("average");
  const [antlerShape,    setAntlerShape]    = useState("straight");
  const [pipeMaterial,   setPipeMaterial]   = useState("straight"); // "straight" (default, like a normal NAF) | "antler"
  const [showAntlerGuide,setShowAntlerGuide]= useState(false);
  const [showAntlerAssistant, setShowAntlerAssistant] = useState(false);
  const [showTuner,      setShowTuner]      = useState(false);
  const [showProgTuner,  setShowProgTuner]  = useState(false);
  const [showHarmony,    setShowHarmony]    = useState(false);
  const [showReachAnalyzer, setShowReachAnalyzer] = useState(false);
  const [showErgoAdjust, setShowErgoAdjust] = useState(false);
  const [showCNCExport, setShowCNCExport] = useState(false);
  const [ergoOverride, setErgoOverride] = useState(null);
  const [holeShape, setHoleShape] = useState("round");
  const [birdKey, setBirdKey] = useState("none");
  const [birdHeight, setBirdHeight] = useState(1); // 0 = flush on the sound hole, 1 = original 1in gap
  const [ambientIntensity, setAmbientIntensity] = useState(0.55);
  const [keyIntensity, setKeyIntensity] = useState(0.9);
  const [surfaceRoughness, setSurfaceRoughness] = useState(0.75);
  const [surfaceMetalness, setSurfaceMetalness] = useState(0.05);
  // Nest (SAC exit ramp / flue channel / TSH / fipple) overrides. null on
  // the first three means "use the bore-derived Flutopedia default" — the
  // same override-or-formula pattern already used for shW/shL — so a
  // flute with no nest ever loaded builds exactly as it always has.
  // fippleAngleDeg's own rest state is 0 (a plumb wall), since that
  // feature doesn't have a pre-existing bore-derived default to fall
  // back to; 0 already reproduces the original geometry exactly.
  const [nestName, setNestName] = useState(null); // name of the currently applied saved/imported nest, or null if none
  const [nestRampAngleDeg, setNestRampAngleDeg] = useState(null);
  const [nestFlueDepthIn, setNestFlueDepthIn] = useState(null);
  const [nestTshLengthIn, setNestTshLengthIn] = useState(null);
  const [nestFippleAngleDeg, setNestFippleAngleDeg] = useState(0);
  const [showNestLabels, setShowNestLabels] = useState(true);
  const [nestLibrary, setNestLibrary] = useState(() => loadNestLibrary());
  const [nestSaveName, setNestSaveName] = useState("");
  const [nestSaveMsg, setNestSaveMsg] = useState("");
  const [selectedNestId, setSelectedNestId] = useState("");
  const [fluteStyle,     setFluteStyle]     = useState("single");
  const [drones,         setDrones]         = useState([{ bore: 0.625, intervalIdx: 0, playable: false, holeCount: 2 }]);
  const [a4,             setA4]             = useState(440);
  const [playSamples,    setPlaySamples]    = useState(true);

  const NOTES = getNotes(a4);
  const justLoadedRef = useRef(false);

  // Load a saved instrument's full config when one is handed down from the
  // Library page. Runs once per load (onConfigLoaded clears loadConfig
  // after applying so re-renders don't keep re-applying it).
  useEffect(() => {
    if (!loadConfig) return;
    const c = loadConfig;
    justLoadedRef.current = true;
    if (c.bore !== undefined) setBore(c.bore);
    if (c.mode !== undefined) setMode(c.mode);
    if (c.noteKey !== undefined) setNoteKey(c.noteKey);
    if (c.rawLen !== undefined) setRawLen(c.rawLen);
    if (c.holeCount !== undefined) setHoleCount(c.holeCount);
    if (c.handSize !== undefined) setHandSize(c.handSize);
    if (c.antlerShape !== undefined) setAntlerShape(c.antlerShape);
    if (c.pipeMaterial !== undefined) setPipeMaterial(c.pipeMaterial);
    if (c.holeShape !== undefined) setHoleShape(c.holeShape);
    if (c.fluteStyle !== undefined) setFluteStyle(c.fluteStyle);
    if (c.drones !== undefined) setDrones(c.drones);
    if (c.a4 !== undefined) setA4(c.a4);
    setErgoOverride(c.ergoOverride !== undefined ? c.ergoOverride : null);
    setNestName(c.nestName !== undefined ? c.nestName : null);
    setNestRampAngleDeg(c.nestRampAngleDeg !== undefined ? c.nestRampAngleDeg : null);
    setNestFlueDepthIn(c.nestFlueDepthIn !== undefined ? c.nestFlueDepthIn : null);
    setNestTshLengthIn(c.nestTshLengthIn !== undefined ? c.nestTshLengthIn : null);
    setNestFippleAngleDeg(c.nestFippleAngleDeg !== undefined ? c.nestFippleAngleDeg : 0);
    onConfigLoaded && onConfigLoaded();
  }, [loadConfig]);

  useEffect(() => { if (fluteStyle === "drone") setDrones(ds => ds.map((d,i) => i===0 ? {...d, bore} : d)); }, [fluteStyle]);
  useEffect(() => {
    if (justLoadedRef.current) return; // a load just deliberately set this pair together
    if (pipeMaterial !== "antler") { setAntlerShape("straight"); setShowAntlerGuide(false); }
  }, [pipeMaterial]);
  useEffect(() => {
    if (justLoadedRef.current) return; // a load just deliberately set an override (or cleared one)
    setErgoOverride(null);
  }, [bore, noteKey, rawLen, mode, holeCount, handSize, holeShape]);
  // Runs after every render; clears the "just loaded" flag one tick later so
  // both guard effects above can see it as true within the same load, but it
  // doesn't linger and suppress a genuine subsequent user edit.
  useEffect(() => { justLoadedRef.current = false; });

  useEffect(() => {
    const r2 = bore / 2;
    const valid = NOTES.filter(n => { const tl = tubeLen(n.freq, r2); return tl >= 5 && tl <= 52; });
    if (!valid.find(n => n.name === noteKey) && valid.length > 0) {
      const pref = valid.find(n => n.name === "A4") || valid.find(n => n.name === "G4") || valid[Math.floor(valid.length/2)];
      setNoteKey(pref.name);
    }
  }, [bore, a4]);

  const r = bore / 2;
  let L, rootFreq, rootNote;
  if (mode === "key") {
    rootFreq = NOTES.find(n => n.name === noteKey)?.freq ?? a4;
    L = tubeLen(rootFreq, r);
    rootNote = nearestNote(rootFreq, NOTES);
  } else {
    L = parseFloat(rawLen) || 15;
    rootFreq = SPEED / (2 * (L + 0.6 * r));
    rootNote = nearestNote(rootFreq, NOTES);
  }

  // ★ Single authoritative geometry call — see buildChamberGeometry above.
  // L is re-derived here from rootFreq via the same tubeLen() used to set
  // it in "by key" mode, and is an exact algebraic round-trip of the
  // entered length in "by length" mode (verified: tubeLen(freqFromLen(L),r) === L),
  // so this never introduces a discrepancy against the L computed just above.
  const melodyGeom = buildChamberGeometry({
    bore, freq: rootFreq, holeCount, handSize, holeShapeKey: holeShape, ergoOverride,
  });
  const holes     = melodyGeom.holes;
  const theoreticalHoles = melodyGeom.theoreticalHoles || [];
  const sacLen    = parseFloat(melodyGeom.sacLen);
  const totalLen  = melodyGeom.totalLen;
  const shW       = melodyGeom.shW;
  const shL       = melodyGeom.shL;
  const holeSt   = fmt(Math.max(0.18, bore * 0.38), 3);
  const holeMx   = fmt(bore * 0.57, 3);

  // Per-drone calculations — each drone has its own bore + interval, all relative to melody root
  const droneResults = fluteStyle === "drone" ? drones.map((d, i) => {
    let freq, di = null;
    if (d.playable) {
      // Playable secondary chamber — uses its own directly-chosen root note, not an interval offset
      freq = NOTES.find(n => n.name === d.noteKey)?.freq ?? rootFreq;
    } else {
      di   = DRONE_INTERVALS[d.intervalIdx];
      freq = rootFreq * di.ratio;
    }

    // ★ Same authoritative geometry call as the melody chamber — this is a
    // real bug fix, not just a refactor: the previous drone-specific
    // implementation was a separate, simpler calculation that never
    // applied the hole-overlap safety cap (so a playable drone chamber at
    // a large bore + low note could produce literally overlapping finger
    // holes, the same class of bug fixed for melody, but the fix had
    // never been carried over here) and ignored handSize/holeShape
    // entirely. A drone chamber is a secondary voice on the SAME physical
    // instrument, played by the same hands, so it should honor the same
    // hand-size spacing and hole-shape acoustic adjustment as the melody
    // chamber for a non-drone (playable) chamber's finger holes.
    const geom = buildChamberGeometry({
      bore: d.bore, freq, holeCount: d.playable ? (d.holeCount || 2) : 0,
      handSize, holeShapeKey: holeShape, ergoOverride: null, // ergonomic adjustment is melody-only for now (its own UI is scoped to the melody chamber)
    });

    return {
      idx: i, bore: d.bore, intervalIdx: d.intervalIdx, di, L: parseFloat(geom.L), note: geom.playable ? nearestNote(freq, NOTES) : null,
      sacLen: parseFloat(geom.sacLen), totalLen: geom.totalLen, shW: geom.shW, shL: geom.shL,
      playable: !!d.playable, holeCount: d.holeCount || 2, holes: geom.holes,
    };
  }) : [];

  const allDronesValid = droneResults.length > 0 && droneResults.every(d => d.L > 0 && d.note);
  const maxDroneDiff = allDronesValid
    ? Math.max(...droneResults.map(d => Math.abs(parseFloat(totalLen) - parseFloat(d.totalLen))))
    : 0;
  const totalBoreWidth = allDronesValid ? bore + droneResults.reduce((s,d)=>s+d.bore,0) : bore;

  const validNotes = NOTES.filter(n => { const tl = tubeLen(n.freq, r); return tl >= 5 && tl <= 52; });

  // Recommended bore diameter for the currently selected melody key — computed
  // independently of whatever bore is currently chosen, so it always reflects
  // the note itself rather than circling back on the current selection.
  const boreRec = (() => {
    const noteFreq = NOTES.find(n => n.name === noteKey)?.freq;
    if (!noteFreq) return null;
    const { best, reachesSweetSpot } = recommendedBores(noteFreq);
    return best ? { ...best, reachesSweetSpot } : null;
  })();

  const bg0="#0f0801",bg1="#1a1005",bg2="#241608";
  const border="#3a2a14",gold="#f59e0b",amber="#d97706";
  const bone="#e5d5b8",muted="#8a7255",dim="#4a3a26";

  const card  = { background:bg1, border:`1px solid ${border}`, borderRadius:8, padding:"14px 16px", marginBottom:12 };
  const lbl   = { fontSize:10, textTransform:"uppercase", letterSpacing:"0.08em", color:amber, fontWeight:700, marginBottom:8, display:"block" };
  const pill  = (active, c) => ({
    padding:"6px 13px", borderRadius:6, cursor:"pointer", fontSize:13, fontWeight:700,
    border:`1px solid ${active?(c||gold):dim}`,
    background:active?(c||gold):bg2,
    color:active?"#0f0801":bone,
    transition:"background 0.12s, border-color 0.12s",
  });

  const showResults = L > 4;

  // Effective nest values: an explicit override if one's been dialed in or
  // loaded, else the same bore-derived Flutopedia default this app has
  // always used — so "auto" always matches prior behavior exactly.
  const autoFlueDepthIn = FLUTE_CONST.flueDepth(bore);
  const autoTshLengthIn = FLUTE_CONST.soundHoleLength(bore);
  const autoRampAngleDeg = FLUTE_CONST.SAC_EXIT_RAMP_ANGLE_DEG; // Russ Wolf's ~30°, applied directly now — see buildChamberMesh
  const effRampAngleDeg = nestRampAngleDeg != null ? nestRampAngleDeg : autoRampAngleDeg;
  const effFlueDepthIn  = nestFlueDepthIn  != null ? nestFlueDepthIn  : autoFlueDepthIn;
  const effTshLengthIn  = nestTshLengthIn  != null ? nestTshLengthIn  : autoTshLengthIn;

  const applyNest = (nest) => {
    setNestName(nest.name || null);
    setNestRampAngleDeg(nest.rampAngleDeg != null ? nest.rampAngleDeg : null);
    setNestFlueDepthIn(nest.flueDepthIn != null ? nest.flueDepthIn : null);
    setNestTshLengthIn(nest.tshLengthIn != null ? nest.tshLengthIn : null);
    setNestFippleAngleDeg(nest.fippleAngleDeg != null ? nest.fippleAngleDeg : 0);
  };
  const clearNest = () => {
    setNestName(null); setNestRampAngleDeg(null); setNestFlueDepthIn(null);
    setNestTshLengthIn(null); setNestFippleAngleDeg(0);
  };
  const doSaveNest = () => {
    const entry = saveNestToLibrary(nestSaveName, {
      rampAngleDeg: effRampAngleDeg, flueDepthIn: effFlueDepthIn,
      tshLengthIn: effTshLengthIn, fippleAngleDeg: nestFippleAngleDeg,
    });
    if (entry) {
      setNestLibrary(loadNestLibrary());
      setNestName(entry.name);
      setNestSaveName("");
      setNestSaveMsg(`Saved as "${entry.name}"`);
      setTimeout(()=>setNestSaveMsg(""), 3500);
    } else {
      setNestSaveMsg("Couldn't save — browser storage may be full or unavailable.");
      setTimeout(()=>setNestSaveMsg(""), 4500);
    }
  };
  const handleApplySelectedNest = () => {
    const nest = nestLibrary.find(n => n.id === selectedNestId);
    if (nest) applyNest(nest);
  };
  const handleDeleteSelectedNest = () => {
    if (!selectedNestId) return;
    deleteNestFromLibrary(selectedNestId);
    setNestLibrary(loadNestLibrary());
    setSelectedNestId("");
  };
  const handleNestFileImport = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseNestFile(JSON.parse(reader.result));
        const entry = saveNestToLibrary(parsed.name, parsed); // also add it to the local library for quick reuse next time
        setNestLibrary(loadNestLibrary());
        applyNest(entry || parsed);
        setNestSaveMsg(`Imported "${parsed.name}"`);
        setTimeout(()=>setNestSaveMsg(""), 3500);
      } catch (err) {
        setNestSaveMsg("Couldn't read that file — expected a .json nest file exported from the Nest Designer.");
        setTimeout(()=>setNestSaveMsg(""), 5000);
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // allow re-selecting the same file later
  };

  const chambersForDiagram = [{
    L, sacLen, bore, holes, playable:true, note:rootNote, label:"MELODY",
    shW, shL: (nestTshLengthIn != null ? nestTshLengthIn : shL),
    nestRampAngleDeg, nestFlueDepthIn, nestFippleAngleDeg,
  }];
  if (fluteStyle === "drone" && allDronesValid) {
    droneResults.forEach((d, i) => {
      chambersForDiagram.push({
        L: d.L, sacLen: d.sacLen, bore: d.bore, holes: d.playable ? d.holes : [],
        playable: d.playable, note: d.note, label: d.playable ? `CHAMBER ${i+2} (PLAYABLE)` : `DRONE ${i+1}`,
        shW: d.shW, shL: (nestTshLengthIn != null ? nestTshLengthIn : d.shL),
        nestRampAngleDeg, nestFlueDepthIn, nestFippleAngleDeg,
      });
    });
  }

  // ── Publish the live design to the Flow Studio tab ─────────────────
  // A snapshot of everything the aeroacoustics simulator needs (key, bore,
  // chamber length, TSH/flue geometry, finger holes). Stored in a module-
  // level bridge + announced via a window event — the same handoff pattern
  // as the CNC → G-Code viewer, so nothing gets prop-drilled through App.
  const flowSnapshotJson = JSON.stringify({
    schema: "naf-flow-design-v1",
    keyName: (rootNote && rootNote.name) || String(noteKey || ""),
    rootFreq,
    bore,
    L: parseFloat(L),
    sacLen: parseFloat(sacLen),
    shW: parseFloat(shW),
    shL: parseFloat(nestTshLengthIn != null ? nestTshLengthIn : shL),
    flueDepthIn: parseFloat(nestFlueDepthIn != null ? nestFlueDepthIn : FLUTE_CONST.flueDepth(bore)),
    rampAngleDeg: nestRampAngleDeg != null ? nestRampAngleDeg : FLUTE_CONST.SAC_EXIT_RAMP_ANGLE_DEG,
    fippleAngleDeg: nestFippleAngleDeg != null ? nestFippleAngleDeg : 35,
    holeCount,
    holes: (holes || []).map(h => ({
      num: h.num, interval: h.interval,
      fromTSH: parseFloat(h.fromTSH), diameter: parseFloat(h.diameter),
    })),
  });
  useEffect(() => {
    try { publishFlowDesign(JSON.parse(flowSnapshotJson)); } catch (e) { /* never break the designer over the bridge */ }
  }, [flowSnapshotJson]);

  // Helpers to mutate the drones array from the UI
  const addDrone    = () => setDrones(ds => ds.length < 3 ? [...ds, { bore, intervalIdx: 0, playable: false, holeCount: 2, noteKey: noteKey }] : ds);
  const removeDrone = (i) => setDrones(ds => ds.length > 1 ? ds.filter((_,idx)=>idx!==i) : ds);
  const setDroneBoreAt     = (i, val) => setDrones(ds => ds.map((d,idx)=> idx===i ? {...d, bore: val} : d));
  const setDroneIntervalAt = (i, val) => setDrones(ds => ds.map((d,idx)=> idx===i ? {...d, intervalIdx: val} : d));
  const setDronePlayableAt = (i, val) => setDrones(ds => ds.map((d,idx)=> idx===i ? {...d, playable: val, noteKey: d.noteKey || noteKey} : d));
  const setDroneHoleCountAt= (i, val) => setDrones(ds => ds.map((d,idx)=> idx===i ? {...d, holeCount: val} : d));
  const setDroneNoteKeyAt  = (i, val) => setDrones(ds => ds.map((d,idx)=> idx===i ? {...d, noteKey: val} : d));

  const CIRC = ["①","②","③","④","⑤","⑥","⑦","⑧","⑨"];
  let _step = 0;
  const stepNum = () => CIRC[_step++];

  return (
    <div style={{maxWidth:740,margin:"0 auto"}}>

      <div style={{textAlign:"center",marginBottom:24}}>
        <div style={{fontSize:30,fontWeight:900,color:gold,letterSpacing:"-0.5px",lineHeight:1}}>
          {pipeMaterial === "antler" ? "🦌 Antler Flute Calculator" : "🪈 NAF Flute Calculator"}
        </div>
        <div style={{color:muted,fontSize:13,marginTop:6}}>Native American Style · 3–7 Hole · Single & Drone · Real Tuner · PDF Export</div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginTop:12}}>
          <span style={{fontSize:12,color:muted}}>Tuning:</span>
          <div style={{display:"flex",borderRadius:8,overflow:"hidden",border:`1px solid ${border}`}}>
            {[440,432].map(hz=>(
              <button key={hz} onClick={()=>setA4(hz)} style={{
                padding:"5px 16px",fontSize:13,fontWeight:700,cursor:"pointer",border:"none",
                background: a4===hz ? gold : bg2,
                color: a4===hz ? "#0f0801" : muted,
                transition:"background 0.15s",
              }}>
                A4 = {hz} Hz
              </button>
            ))}
          </div>
          {a4===432 && <span style={{fontSize:11,color:"#d4a05a"}}>432 Hz — all hole positions recalculated</span>}
        </div>
      </div>

      <div style={card}>
        <span style={lbl}>{stepNum()} Pipe Material</span>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setPipeMaterial("straight")} style={{...pill(pipeMaterial==="straight"),flex:1,fontSize:14,padding:"9px 0"}}>🪈 Straight Pipe</button>
          <button onClick={()=>setPipeMaterial("antler")}   style={{...pill(pipeMaterial==="antler"),  flex:1,fontSize:14,padding:"9px 0"}}>🦌 Antler</button>
        </div>
        <div style={{marginTop:8,fontSize:12,color:muted,lineHeight:1.5}}>
          {pipeMaterial === "antler"
            ? "Antler construction — irregular, often curved bore. You'll need to account for the natural shape when measuring and drilling."
            : "Straight pipe (PVC, bamboo, or a wood dowel) — the standard approach most NAF makers use. All measurements assume a straight, uniform bore."}
        </div>

        {pipeMaterial === "antler" && (
          <div style={{marginTop:10}}>
            <button onClick={()=>setShowAntlerGuide(v=>!v)} style={{
              display:"flex",alignItems:"center",gap:6,background:"none",border:"none",
              color:"#d4a05a",fontSize:12,fontWeight:700,cursor:"pointer",padding:0,
            }}>
              <span style={{display:"inline-block",transition:"transform 0.15s",transform:showAntlerGuide?"rotate(90deg)":"none"}}>▶</span>
              {showAntlerGuide ? "Hide" : "Show"} step-by-step antler build guide
            </button>

            {showAntlerGuide && (
              <div style={{marginTop:10,padding:"12px 14px",background:bg2,border:`1px solid ${border}`,borderRadius:8,fontSize:12,color:muted,lineHeight:1.65}}>

                <div style={{color:"#d4a05a",fontWeight:700,marginBottom:4}}>1. Choose a section</div>
                <div style={{marginBottom:10}}>
                  Look for a fairly straight run of antler at least 2–3" longer than the tube length shown below (extra length gets trimmed off both ends). Deer antler naturally tapers and curves, so the straightest run is usually in the main beam between the burr and the first fork — avoid sections right at a fork or tine junction, since the bore hollows out unevenly there. Elk or moose antler gives you wider, straighter runs and can support larger bores.
                </div>

                <div style={{color:"#d4a05a",fontWeight:700,marginBottom:4}}>2. Check the natural bore</div>
                <div style={{marginBottom:10}}>
                  Antler has a spongy, porous core (the cancellous tissue) running through the center — this is what you're hollowing out, not solid material. Saw a thin slice off one end first to see how wide and how centered that core is. If the core is already close to the bore diameter recommended below, you're in good shape. If it's much smaller, you'll be reaming out solid antler as well as core, which takes longer and risks a wall breakthrough — pick a wider section of antler instead of forcing a narrow one.
                </div>

                <div style={{color:"#d4a05a",fontWeight:700,marginBottom:4}}>3. Hollow out the bore</div>
                <div style={{marginBottom:10}}>
                  Drill or ream from both ends toward the middle rather than trying to push one long bit all the way through — this keeps you from wandering off-center in a curved section. Start with a pilot bit close to the width of the natural core, then step up in bit sizes (or use a drum sander/reamer on a flexible shaft) until you reach the bore diameter shown below. Work slowly and check wall thickness often by holding the antler up to a light — you want to stop well before you can see light shining through anywhere along the tube.
                </div>

                <div style={{color:"#d4a05a",fontWeight:700,marginBottom:4}}>4. Install the internal wall/plug</div>
                <div style={{marginBottom:10}}>
                  Every Native American flute needs a solid partition separating the slow air chamber (SAC) from the sound chamber — without it, your breath just flows straight through and the flute won't produce its two-chamber tone at all. Fit a hardwood dowel plug (or leave a section of solid antler core unhollowed, if your natural bore allows it) right at the SAC/sound-chamber boundary marked "WALL/PLUG" on the drilling template below — this is the same position as the sound hole (TSH). Drill a small exit hole through the plug on the SAC side so air can still reach the flue/sound hole; don't leave the plug fully solid across its whole face. Glue and seal the plug so no air leaks around its edges — a loose plug is one of the most common reasons a finished NAF won't play.
                </div>

                <div style={{color:"#d4a05a",fontWeight:700,marginBottom:4}}>5. Confirm your actual bore & length</div>
                <div style={{marginBottom:10}}>
                  Antler bores are rarely perfectly round or perfectly straight, so once you've hollowed it out, measure your <em>actual</em> average inside diameter with calipers at a few points along the tube and re-select the closest bore size above if it's different from your original plan. Measure your actual usable tube length (sound hole to open end) the same way — if it's noticeably different from the target length shown below, switch to "By {pipeMaterial === "antler" ? "Antler" : "Pipe"} Length" mode above and enter what you actually have; hole positions will recalculate to match.
                </div>

                <div style={{color:"#d4a05a",fontWeight:700,marginBottom:4}}>6. Mark and drill finger holes</div>
                <div style={{marginBottom:10}}>
                  Use the drilling template below — it gives you two numbers per hole: the distance from the sound hole (TSH) and a diameter. Wrap a strip of paper or masking tape around the antler, mark the hole center distances on it with a ruler, then wrap the tape around the tube to transfer those marks evenly around a curved surface. Start each finger hole with a small pilot bit (1/8" or so) drilled straight down through the top of the antler into the bore, then widen it gradually with step bits or a round file, checking pitch against the tuner as you go — it's much easier to enlarge a hole than to shrink one, so sneak up on the target diameter rather than drilling it full-size immediately.
                </div>

                <div style={{color:"#d4a05a",fontWeight:700,marginBottom:4}}>7. Curved sections</div>
                <div>
                  If your antler has any bend in it, hole spacing measured in a straight line won't match reality — always measure distances <em>along the outside curve of the bore</em> (following the tube's centerline), not point-to-point. For a heavy curve, some antler makers split the flute into two straighter sections joined at the bend with a wrapped or glued sleeve instead of fighting one continuously curved bore.
                </div>

              </div>
            )}
          </div>
        )}
      </div>

      {pipeMaterial === "antler" && (
        <div style={card}>
          <button onClick={()=>setShowAntlerAssistant(v=>!v)} style={{
            display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",
            background:"none",border:"none",cursor:"pointer",padding:0,
          }}>
            <span style={lbl}>🦌📏 Antler Selection Assistant <span style={{color:muted,textTransform:"none",fontWeight:400,fontSize:10}}>(check what key a real antler can become)</span></span>
            <span style={{color:"#d4a05a",fontSize:16,transform:showAntlerAssistant?"rotate(90deg)":"none",transition:"transform 0.15s"}}>▶</span>
          </button>
          {showAntlerAssistant && (
            <div style={{marginTop:14}}>
              <AntlerSelectionAssistant
                holeCount={holeCount} NOTES={NOTES}
                onApply={({bore:newBore, curvature, noteKey:newKey})=>{
                  setPipeMaterial("antler");
                  setAntlerShape(curvature);
                  setBore(newBore);
                  setMode("key");
                  setNoteKey(newKey);
                }}
                pill={pill} bg2={bg2} border={border} bone={bone} muted={muted} card={card} lbl={lbl}
              />
            </div>
          )}
        </div>
      )}

      <div style={card}>
        <span style={lbl}>{stepNum()} Flute Style</span>
        <div style={{display:"flex",gap:8,marginBottom:fluteStyle==="drone"?10:0}}>
          <button onClick={()=>setFluteStyle("single")} style={{...pill(fluteStyle==="single"),flex:1,fontSize:14,padding:"9px 0"}}>🎵 Single Flute</button>
          <button onClick={()=>setFluteStyle("drone")}  style={{...pill(fluteStyle==="drone"), flex:1,fontSize:14,padding:"9px 0"}}>🎵🎵 Drone Flute</button>
        </div>
        {fluteStyle==="drone" && (
          <div style={{fontSize:12,color:"#d4a05a",lineHeight:1.65,borderTop:"1px solid #3a2a14",paddingTop:10}}>
            A drone flute has <strong>two parallel bores</strong> — a <em>melody chamber</em> with finger holes and a <em>drone chamber</em> that plays one continuous fixed note underneath the melody. Configure both below.
          </div>
        )}
      </div>

      <div style={card}>
        <span style={lbl}>{stepNum()} Melody Bore Diameter</span>
        {boreRec && (
          <div style={{marginBottom:9,fontSize:12,color:"#7acc44",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
            <span>💡 For key <strong>{noteKey}</strong>, recommended bore:</span>
            <button onClick={()=>setBore(boreRec.val)}
              style={{...pill(bore===boreRec.val,"#7acc44"),padding:"3px 10px",fontSize:12}}>
              {boreRec.label} <span style={{fontSize:9,opacity:0.75,marginLeft:2}}>({boreRec.mm}mm)</span>
            </button>
            <span style={{color:muted,fontSize:11}}>
              {boreRec.reachesSweetSpot
                ? `→ ~${fmt(boreRec.tubeLen,1)}" tube, comfortable to hold & finger`
                : `→ ~${fmt(boreRec.tubeLen,1)}" tube — this key runs long regardless of bore; widest bore shortens it slightly`}
            </span>
          </div>
        )}
        <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
          {BORES.map(b=>(
            <button key={b.val} onClick={()=>setBore(b.val)} style={{...pill(bore===b.val),position:"relative"}}>
              {boreRec && b.val===boreRec.val && bore!==b.val && (
                <span style={{position:"absolute",top:-6,right:-4,fontSize:10}} title={`Recommended for ${noteKey}`}>⭐</span>
              )}
              {b.label}<span style={{fontSize:9,opacity:0.7,marginLeft:3}}>({b.mm}mm)</span>
            </button>
          ))}
        </div>
        {bore>1.25 && (
          <div style={{marginTop:8,fontSize:12,color:"#fbbf24"}}>
            {pipeMaterial === "antler"
              ? "⚠ Large bore requires thick antler walls and a long straight section — common in elk or moose antler."
              : "⚠ Large bore — make sure your pipe stock (PVC, bamboo, or wood dowel) has enough wall thickness at this diameter."}
          </div>
        )}
      </div>

      <div style={card}>
        <span style={lbl}>{stepNum()} Flute Type (hole count)</span>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {[3,4,5,6,7].map(n=>(
            <button key={n} onClick={()=>setHoleCount(n)} style={{...pill(holeCount===n),padding:"7px 18px"}}>{n}-Hole</button>
          ))}
        </div>
        <div style={{marginTop:7,fontSize:12,color:muted}}>{SCALE_CONFIGS[holeCount]?.name}</div>
      </div>

      <div style={card}>
        <span style={lbl}>{stepNum()} Hand Size <span style={{color:muted,textTransform:"none",fontWeight:400,fontSize:10}}>(adjusts hole spacing)</span></span>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {[["compact","−7%  · smaller reach"],["average","±0%  · standard"],["large","+7% · wider reach"]].map(([h,tip])=>(
            <button key={h} onClick={()=>setHandSize(h)} style={{...pill(handSize===h),textAlign:"left"}}>
              <div>{h}</div>
              {handSize===h && <div style={{fontSize:10,fontWeight:400,marginTop:2,color:"#5a3a00"}}>{tip}</div>}
            </button>
          ))}
        </div>
      </div>

      <div style={card}>
        <button onClick={()=>setShowReachAnalyzer(v=>!v)} style={{
          display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",
          background:"none",border:"none",cursor:"pointer",padding:0,
        }}>
          <span style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={lbl}>🖐 Finger Reach Analyzer <span style={{color:muted,textTransform:"none",fontWeight:400,fontSize:10}}>(checks hole spacing against hand reach)</span></span>
            {(() => {
              const { hasProblem, hasWarning } = analyzeFingerReach(holes);
              const dotColor = hasProblem ? "#f87171" : hasWarning ? "#fbbf24" : "#4ade80";
              return <span style={{width:8,height:8,borderRadius:"50%",background:dotColor,flexShrink:0,marginTop:-14}}/>;
            })()}
          </span>
          <span style={{color:"#d4a05a",fontSize:16,transform:showReachAnalyzer?"rotate(90deg)":"none",transition:"transform 0.15s"}}>▶</span>
        </button>
        {showReachAnalyzer && (
          <div style={{marginTop:14}}>
            <FingerReachAnalyzer holes={holes} handSize={handSize} bore={bore} holeCount={holeCount} muted={muted} bone={bone}/>
          </div>
        )}
      </div>

      <div style={card}>
        <button onClick={()=>setShowErgoAdjust(v=>!v)} style={{
          display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",
          background:"none",border:"none",cursor:"pointer",padding:0,
        }}>
          <span style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={lbl}>✋ Ergonomic Hole Adjustment <span style={{color:muted,textTransform:"none",fontWeight:400,fontSize:10}}>(optimize spacing for real hands, not just theory)</span></span>
            {ergoOverride && <span style={{width:8,height:8,borderRadius:"50%",background:"#7acc44",flexShrink:0,marginTop:-14}}/>}
          </span>
          <span style={{color:"#d4a05a",fontSize:16,transform:showErgoAdjust?"rotate(90deg)":"none",transition:"transform 0.15s"}}>▶</span>
        </button>
        {showErgoAdjust && (
          <div style={{marginTop:14}}>
            <ErgonomicHoleAdjustment
              holes={theoreticalHoles}
              applied={!!ergoOverride}
              onApply={(adjusted)=>setErgoOverride(adjusted.map(h=>({num:h.num, adjFromTSH:h.adjFromTSH, adjDiameter:h.adjDiameter})))}
              onReset={()=>setErgoOverride(null)}
              pill={pill} muted={muted} bone={bone} bg2={bg2} border={border}
            />
          </div>
        )}
      </div>

      <div style={card}>
        <span style={lbl}>Finger Hole Shape <span style={{color:muted,textTransform:"none",fontWeight:400,fontSize:10}}>(changes calculated diameter — round is the baseline)</span></span>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,marginTop:8}}>
          {Object.entries(HOLE_SHAPES).map(([key, s]) => (
            <button key={key} onClick={()=>setHoleShape(key)} style={{
              ...pill(holeShape===key), textAlign:"left", padding:"10px 12px",
            }}>
              <div style={{fontSize:14,fontWeight:800}}>{s.icon} {s.label}</div>
              {holeShape===key && <div style={{fontSize:10,fontWeight:400,marginTop:4,lineHeight:1.4,color:"#5a3a00"}}>{s.desc}</div>}
            </button>
          ))}
        </div>
        {holeShape !== "round" && (
          <div style={{marginTop:10,padding:"10px 12px",background:bg2,borderRadius:8,fontSize:11.5,color:muted,lineHeight:1.6}}>
            <strong style={{color:bone}}>How to cut this shape: </strong>{HOLE_SHAPES[holeShape].howTo}
          </div>
        )}
      </div>

      <div style={card}>
        <span style={lbl}>Bird / Totem Block <span style={{color:muted,textTransform:"none",fontWeight:400,fontSize:10}}>(decorative — shown in the 3D preview only)</span></span>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8,marginTop:8}}>
          {[
            { key: "none", label: "None" },
            { key: "dolphin", label: BIRD_BLOCKS.dolphin.label },
            { key: "kokopelli", label: BIRD_BLOCKS.kokopelli.label },
          ].map(({ key, label }) => (
            <button key={key} onClick={()=>setBirdKey(key)} style={{
              ...pill(birdKey===key), textAlign:"center", padding:"10px 12px", fontSize:14, fontWeight:800,
            }}>
              {label}
            </button>
          ))}
        </div>
        {birdKey !== "none" && (
          <div style={{marginTop:10,padding:"10px 12px",background:bg2,borderRadius:8,fontSize:11,color:muted,lineHeight:1.6}}>
            Sized proportionally to your bore diameter and shown resting above the sound hole, the way a real removable bird/block/fetish sits on a finished flute. Decorative only — it's not cut into the flute and isn't included in the drilling template, PDF, or G-code.
            <div style={{marginTop:4,fontSize:10,color:"#6a5a45"}}>{BIRD_BLOCKS[birdKey].attribution}</div>
            <div style={{marginTop:10}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:10.5,color:bone,marginBottom:4}}>
                <span>Height above sound hole</span>
                <span style={{color:muted}}>{birdHeight <= 0.02 ? "Flush" : `${birdHeight.toFixed(2)}" gap`}</span>
              </div>
              <input
                type="range" min={0} max={1} step={0.01} value={birdHeight}
                onChange={e=>setBirdHeight(parseFloat(e.target.value))}
                style={{width:"100%"}}
              />
              <div style={{display:"flex",justifyContent:"space-between",fontSize:9.5,color:"#6a5a45",marginTop:2}}>
                <span>Flush on sound hole</span>
                <span>Original (1" gap)</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {pipeMaterial === "antler" && (
        <div style={card}>
          <span style={lbl}>{stepNum()} Antler Shape</span>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {[["straight","Use calculated positions directly"],
              ["slight","Measure along bore centerline with flexible tape"],
              ["heavy","Consider joining two angled sections at the bend"]].map(([a,tip])=>(
              <button key={a} onClick={()=>setAntlerShape(a)} style={pill(antlerShape===a)}>{a}</button>
            ))}
          </div>
          {antlerShape!=="straight" && (
            <div style={{marginTop:8,fontSize:12,color:"#d4a05a"}}>
              {antlerShape==="slight"
                ? "Slight curve — use a flexible tape along the outer bore wall to measure hole positions."
                : "Heavy curve — measure bore centerline carefully or consider splitting into two straight sections joined at the bend."}
            </div>
          )}
        </div>
      )}

      <div style={card}>
        <span style={lbl}>{stepNum()} Melody Key or Length</span>
        <div style={{display:"flex",gap:8,marginBottom:10}}>
          <button onClick={()=>setMode("key")}    style={{...pill(mode==="key"),   flex:1}}>By Key</button>
          <button onClick={()=>setMode("length")} style={{...pill(mode==="length"),flex:1}}>
            {pipeMaterial === "antler" ? "By Antler Length" : "By Pipe Length"}
          </button>
        </div>
        {mode==="key" ? (<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7,flexWrap:"wrap",gap:6}}>
            <div style={{fontSize:11,color:muted}}>Root note (all holes closed) — dimmed notes are out of range for this bore</div>
            <button onClick={()=>setPlaySamples(p=>!p)}
              style={{...pill(playSamples,"#4a9cd6"),padding:"4px 10px",fontSize:11}}>
              {playSamples ? "🔊" : "🔇"} Play note on select
            </button>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
            {NOTES.map(n=>{
              const ok = !!validNotes.find(v=>v.name===n.name);
              return (
                <button key={n.name} onClick={()=>{ if(!ok) return; setNoteKey(n.name); if(playSamples) playNoteSample(n.name); }}
                  style={{...pill(noteKey===n.name),opacity:ok?1:0.28,cursor:ok?"pointer":"not-allowed",padding:"5px 10px",fontSize:12}}>
                  {n.name}
                </button>
              );
            })}
          </div>
          {boreRec && (
            <div style={{marginTop:9,fontSize:12,color:bore===boreRec.val?"#7acc44":"#d4a05a",lineHeight:1.5}}>
              {bore===boreRec.val
                ? (boreRec.reachesSweetSpot
                    ? `✓ Current bore (${boreRec.label}) is the recommended size for ${noteKey}.`
                    : `✓ Current bore (${boreRec.label}) is the best available fit for ${noteKey} — this key runs a long tube no matter the bore.`)
                : (boreRec.reachesSweetSpot
                    ? <>💡 Recommended bore for <strong>{noteKey}</strong> is <strong>{boreRec.label}</strong> ({boreRec.mm}mm) — see step ② above to change it.</>
                    : <>💡 For <strong>{noteKey}</strong>, the widest bore (<strong>{boreRec.label}</strong>) trims the tube slightly — see step ② above to change it.</>)}
            </div>
          )}
        </>) : (<>
          <div style={{fontSize:11,color:muted,marginBottom:7}}>Enter tube length — sound hole (TSH) to open foot, in inches</div>
          <input type="number" step="0.25" min="5" max="52" value={rawLen}
            onChange={e=>setRawLen(e.target.value)}
            style={{background:bg2,border:`1px solid ${border}`,color:bone,padding:"8px 14px",width:130,borderRadius:6,fontSize:14}}
            placeholder="inches"/>
        </>)}
      </div>

      {fluteStyle==="drone" && (<>
        <div style={card}>
          <span style={lbl}>{stepNum()} Drone Chambers <span style={{color:muted,textTransform:"none",fontWeight:400,fontSize:10}}>(up to 3 — total flute will have 4 chambers max)</span></span>
          <div style={{fontSize:12,color:"#d4a05a",lineHeight:1.6,marginBottom:6}}>
            Each drone chamber has its own bore and pitch, all tuned relative to the melody root ({rootNote.name}).
          </div>
        </div>

        <div style={card}>
          <button onClick={()=>setShowHarmony(v=>!v)} style={{
            display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",
            background:"none",border:"none",cursor:"pointer",padding:0,
          }}>
            <span style={lbl}>🎼 Automatic Harmony Builder <span style={{color:muted,textTransform:"none",fontWeight:400,fontSize:10}}>(auto-configure drone chambers for you)</span></span>
            <span style={{color:"#d4a05a",fontSize:16,transform:showHarmony?"rotate(90deg)":"none",transition:"transform 0.15s"}}>▶</span>
          </button>
          {showHarmony && (
            <div style={{marginTop:14}}>
              <HarmonyBuilder
                bore={bore} noteKey={noteKey} currentDroneCount={drones.length}
                onApply={(newDrones)=>setDrones(newDrones)}
                pill={pill} card={card} lbl={lbl} muted={muted} bg2={bg2} border={border} bone={bone}
              />
            </div>
          )}
        </div>

        {drones.map((d, i) => {
          const dres = droneResults[i];
          return (
            <div key={i} style={{...card, borderColor:"#5a7a3a"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <span style={{...lbl,marginBottom:0,color:"#7acc44"}}>
                  Chamber {i+2} {d.playable ? "(Playable)" : "(Drone)"}{dres&&dres.note?` — ${dres.note.name}`:""}
                </span>
                {drones.length > 1 && (
                  <button onClick={()=>removeDrone(i)}
                    style={{fontSize:11,padding:"3px 10px",borderRadius:5,border:"1px solid #7a3a3a",background:"#2a1010",color:"#f0a0a0",cursor:"pointer"}}>
                    ✕ Remove
                  </button>
                )}
              </div>

              <div style={{display:"flex",gap:8,marginBottom:14}}>
                <button onClick={()=>setDronePlayableAt(i,false)} style={{...pill(!d.playable,"#7acc44"),flex:1,fontSize:12,padding:"7px 0"}}>🎵 Drone (no holes)</button>
                <button onClick={()=>setDronePlayableAt(i,true)}  style={{...pill(d.playable),flex:1,fontSize:12,padding:"7px 0"}}>🎶 Playable (has holes)</button>
              </div>
              {d.playable && (
                <div style={{fontSize:11,color:"#d4a05a",lineHeight:1.6,marginBottom:14}}>
                  This chamber gets its own finger holes and root note, independent of the melody chamber. On real instruments these secondary chambers are sometimes built with a removable wax/wood cover cap so the player can choose to seal the holes and use it as a pure drone instead.
                </div>
              )}

              <div style={{fontSize:10,color:muted,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Bore Diameter</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:8}}>
                {BORES.map(b=>(
                  <button key={b.val} onClick={()=>setDroneBoreAt(i,b.val)} style={pill(d.bore===b.val)}>
                    {b.label}<span style={{fontSize:9,opacity:0.7,marginLeft:3}}>({b.mm}mm)</span>
                  </button>
                ))}
              </div>
              <button onClick={()=>setDroneBoreAt(i,bore)}
                style={{marginBottom:14,...pill(false),fontSize:11,padding:"4px 12px",border:`1px solid ${dim}`}}>
                ↩ Match melody bore ({bore}")
              </button>

              {d.playable ? (<>
                <div style={{fontSize:10,color:muted,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Hole Count</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>
                  {[1,2,3,4].map(n=>(
                    <button key={n} onClick={()=>setDroneHoleCountAt(i,n)} style={{...pill(d.holeCount===n),padding:"7px 16px"}}>{n}-Hole</button>
                  ))}
                </div>
                <div style={{fontSize:10,color:muted,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Root Note (this chamber, independent of melody)</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {NOTES.map(n=>{
                    const r2 = d.bore/2;
                    const tl = tubeLen(n.freq, r2);
                    const ok = tl >= 5 && tl <= 52;
                    return (
                      <button key={n.name} onClick={()=>{ if(!ok) return; setDroneNoteKeyAt(i,n.name); if(playSamples) playNoteSample(n.name); }}
                        style={{...pill((d.noteKey||noteKey)===n.name),opacity:ok?1:0.28,cursor:ok?"pointer":"not-allowed",padding:"5px 10px",fontSize:12}}>
                        {n.name}
                      </button>
                    );
                  })}
                </div>
              </>) : (<>
                <div style={{fontSize:10,color:muted,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Drone Pitch (relative to melody root)</div>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {DRONE_INTERVALS.map((di,ix)=>(
                    <button key={ix} onClick={()=>setDroneIntervalAt(i,ix)}
                      style={{...pill(d.intervalIdx===ix),textAlign:"left",padding:"9px 14px",
                        display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
                      <span style={{flexShrink:0,fontSize:13}}>{di.label}</span>
                      <span style={{fontSize:11,fontWeight:400,color:d.intervalIdx===ix?"#5a3a00":muted,textAlign:"right"}}>{di.desc}</span>
                    </button>
                  ))}
                </div>
              </>)}
            </div>
          );
        })}

        {drones.length < 3 && (
          <button onClick={addDrone}
            style={{...pill(false),width:"100%",padding:"12px",fontSize:14,marginBottom:12,border:`1px dashed ${dim}`}}>
            + Add Drone Chamber ({drones.length + 1} of 4 total chambers)
          </button>
        )}
      </>)}

      {showResults ? (<>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10,marginBottom:12}}>
          <div style={{...card,marginBottom:0,borderColor:"#6b4010"}}>
            <div style={{fontSize:10,color:muted}}>Melody Tube (TSH → foot)</div>
            <div style={{fontSize:38,fontWeight:900,color:gold,fontFamily:"monospace"}}>{fmt(L)}"</div>
            <div style={{fontSize:11,color:muted}}>{fmt(L*25.4,0)} mm</div>
          </div>
          <div style={{...card,marginBottom:0,borderColor:"#6b4010"}}>
            <div style={{fontSize:10,color:muted}}>Root Note</div>
            <div style={{fontSize:38,fontWeight:900,color:gold,fontFamily:"monospace"}}>{rootNote.name}</div>
            <div style={{fontSize:11,color:muted}}>{rootNote.cents!==0?(rootNote.cents>0?"+":"")+rootNote.cents+"¢ off":"in tune"}</div>
          </div>
          <div style={{...card,marginBottom:0}}>
            <div style={{fontSize:10,color:muted}}>SAC Length</div>
            <div style={{fontSize:28,fontWeight:800,fontFamily:"monospace"}}>{fmt(sacLen)}"</div>
            <div style={{fontSize:11,color:muted}}>Total: {totalLen}"</div>
          </div>
        </div>

        {fluteStyle==="drone" && allDronesValid && droneResults.map((dres, i) => (
          <div key={i} style={{...card,marginBottom:12,borderColor: dres.playable ? "#7a5a10" : "#4a7a2a",background: dres.playable ? "#1a1306" : "#0d1808"}}>
            <span style={{...lbl,color: dres.playable ? "#f59e0b" : "#7acc44"}}>
              Chamber {i+2} {dres.playable ? "(Playable)" : "(Drone)"} Results
            </span>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:14}}>
              <div>
                <div style={{fontSize:10,color:muted}}>Root Note</div>
                <div style={{fontSize:36,fontWeight:900,color: dres.playable ? "#f59e0b" : "#7acc44",fontFamily:"monospace"}}>{dres.note.name}</div>
                <div style={{fontSize:10,color:muted}}>{dres.playable ? `${dres.holeCount}-hole` : dres.di.label}</div>
              </div>
              <div>
                <div style={{fontSize:10,color:muted}}>Tube</div>
                <div style={{fontSize:36,fontWeight:900,color: dres.playable ? "#f59e0b" : "#7acc44",fontFamily:"monospace"}}>{fmt(dres.L)}"</div>
                <div style={{fontSize:10,color:muted}}>{fmt(dres.L*25.4,0)} mm</div>
              </div>
              <div>
                <div style={{fontSize:10,color:muted}}>SAC</div>
                <div style={{fontSize:26,fontWeight:800,fontFamily:"monospace"}}>{fmt(dres.sacLen)}"</div>
              </div>
              <div>
                <div style={{fontSize:10,color:muted}}>Total</div>
                <div style={{fontSize:26,fontWeight:800,fontFamily:"monospace"}}>{dres.totalLen}"</div>
              </div>
            </div>

            {dres.playable ? (<>
              <div style={{borderTop:"1px solid #4a3a14",paddingTop:10,marginBottom:8}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
                  <thead>
                    <tr style={{borderBottom:"1px solid #5a4015"}}>
                      <th style={{textAlign:"left",padding:"4px 6px",color:amber}}>Hole</th>
                      <th style={{textAlign:"left",padding:"4px 6px",color:amber}}>Opens</th>
                      <th style={{textAlign:"right",padding:"4px 6px",color:amber}}>From TSH</th>
                      <th style={{textAlign:"right",padding:"4px 6px",color:amber}}>Start Ø</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dres.holes.map(h=>(
                      <tr key={h.num} style={{borderBottom:"1px solid #251c08"}}>
                        <td style={{padding:"5px 6px",color:"#f59e0b",fontWeight:700,fontFamily:"monospace"}}>H{h.num}</td>
                        <td style={{padding:"5px 6px",color:muted,fontSize:11}}>{h.interval}</td>
                        <td style={{padding:"5px 6px",textAlign:"right",fontFamily:"monospace"}}>{h.fromTSH}"</td>
                        <td style={{padding:"5px 6px",textAlign:"right",color:"#c4a97d",fontFamily:"monospace"}}>{h.diameter}"</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{fontSize:11,color:muted}}>
                <strong style={{color:bone}}>Optional cover cap:</strong> carve or fit a removable wax/wood cap over this chamber's holes if you want the option to seal them off and use this chamber as a pure drone on demand.
              </div>
            </>) : (
              <div style={{borderTop:"1px solid #2a4a1a",paddingTop:10,fontSize:12,color:muted}}>
                <strong style={{color:bone}}>No finger holes.</strong> Needs only: mouthpiece → SAC ({fmt(dres.sacLen)}") → sound hole → open foot.
              </div>
            )}
          </div>
        ))}

        {fluteStyle==="drone" && allDronesValid && (
          <div style={{...card,marginBottom:12,borderColor:"#3a5a7a",background:"#0a1420"}}>
            <span style={{...lbl,color:"#6ab0e8"}}>Multi-Chamber Construction Summary</span>
            <div style={{fontSize:12,lineHeight:1.75}}>
              <div style={{color:maxDroneDiff<2?"#7acc44":"#fbbf24",marginBottom:6}}>
                {maxDroneDiff<2
                  ? "✓ All chamber lengths are compatible — a flush-end side-by-side build is achievable."
                  : `⚠ Chamber lengths differ by up to ${fmt(maxDroneDiff,1)}" — plan for offset ends or extend the shorter chambers.`}
              </div>
              <div style={{color:muted}}>
                <strong style={{color:bone}}>Total chamber count:</strong> {1 + droneResults.length} ({1 + droneResults.length === 4 ? "maximum" : "of 4 max"})
              </div>
              <div style={{color:muted,marginTop:4}}>
                <strong style={{color:bone}}>Combined bore width:</strong> {fmt(totalBoreWidth,3)}" (melody {bore}" + {droneResults.map(d=>`${d.bore}"`).join(" + ")})
              </div>
              <div style={{color:muted,marginTop:4}}>
                <strong style={{color:bone}}>Construction: </strong>
                {pipeMaterial === "antler"
                  ? (totalBoreWidth<=2.4
                      ? `All ${1+droneResults.length} bores may fit side-by-side in one wide antler section — look for a beam at least ${fmt(totalBoreWidth*1.4,2)}" across.`
                      : `Combined bore width is too large for a single antler piece — drill each chamber in a separate antler section and lash them together at a shared mouthpiece block and foot cap.`)
                  : (totalBoreWidth<=2.4
                      ? `All ${1+droneResults.length} bores may fit side-by-side in one wide piece of pipe stock — look for stock at least ${fmt(totalBoreWidth*1.4,2)}" across.`
                      : `Combined bore width is too large for a single piece of pipe stock — drill each chamber in a separate length of pipe and lash them together at a shared mouthpiece block and foot cap.`)}
              </div>
              <div style={{color:muted,marginTop:4}}>
                One "bird" block (or a wider multi-channel block) directs air across all sound hole windows simultaneously.
              </div>
            </div>
          </div>
        )}


        <div style={{...card,overflowX:"auto"}}>
          <span style={lbl}>3D Preview <span style={{color:muted,textTransform:"none",fontWeight:400,fontSize:10}}>(true to scale — bore, length &amp; hole positions match your numbers below)</span></span>
          <Flute3DViewer chambers={chambersForDiagram} curve={pipeMaterial === "antler" ? antlerShape : "straight"} pipeMaterial={pipeMaterial} holeShape={holeShape} birdKey={birdKey}
            birdHeight={birdHeight} ambientIntensity={ambientIntensity} keyIntensity={keyIntensity} surfaceRoughness={surfaceRoughness} surfaceMetalness={surfaceMetalness}
            showNestLabels={showNestLabels}/>

          <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${bg2}`}}>
            <span style={{...lbl,fontSize:12}}>Lighting &amp; Shading</span>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:"10px 18px",marginTop:8}}>
              <div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10.5,color:bone,marginBottom:4}}>
                  <span>Ambient light</span><span style={{color:muted}}>{ambientIntensity.toFixed(2)}</span>
                </div>
                <input type="range" min={0} max={2} step={0.01} value={ambientIntensity}
                  onChange={e=>setAmbientIntensity(parseFloat(e.target.value))} style={{width:"100%"}}/>
              </div>
              <div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10.5,color:bone,marginBottom:4}}>
                  <span>Key light</span><span style={{color:muted}}>{keyIntensity.toFixed(2)}</span>
                </div>
                <input type="range" min={0} max={2.5} step={0.01} value={keyIntensity}
                  onChange={e=>setKeyIntensity(parseFloat(e.target.value))} style={{width:"100%"}}/>
              </div>
              <div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10.5,color:bone,marginBottom:4}}>
                  <span>Surface roughness</span><span style={{color:muted}}>{surfaceRoughness.toFixed(2)}</span>
                </div>
                <input type="range" min={0} max={1} step={0.01} value={surfaceRoughness}
                  onChange={e=>setSurfaceRoughness(parseFloat(e.target.value))} style={{width:"100%"}}/>
              </div>
              <div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10.5,color:bone,marginBottom:4}}>
                  <span>Surface metalness</span><span style={{color:muted}}>{surfaceMetalness.toFixed(2)}</span>
                </div>
                <input type="range" min={0} max={1} step={0.01} value={surfaceMetalness}
                  onChange={e=>setSurfaceMetalness(parseFloat(e.target.value))} style={{width:"100%"}}/>
              </div>
            </div>
            <button
              onClick={()=>{ setAmbientIntensity(0.55); setKeyIntensity(0.9); setSurfaceRoughness(0.75); setSurfaceMetalness(0.05); }}
              style={{marginTop:10,background:"none",border:`1px solid ${bg2}`,borderRadius:6,color:muted,fontSize:10.5,padding:"4px 10px",cursor:"pointer"}}
            >
              Reset to defaults
            </button>
          </div>
        </div>

        <div style={card}>
          <span style={lbl}>Nest / Sound Hole Shape <span style={{color:muted,textTransform:"none",fontWeight:400,fontSize:10}}>(SAC exit ramp, flue channel, TSH, and the sound-hole splitting edge)</span></span>

          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:"10px 18px",marginTop:10}}>
            <div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:10.5,color:bone,marginBottom:4}}>
                <span>SAC exit ramp angle</span>
                <span style={{color:muted}}>{effRampAngleDeg.toFixed(0)}°{nestRampAngleDeg==null && <span style={{color:"#6a5a45"}}> (auto)</span>}</span>
              </div>
              <input type="range" min={10} max={70} step={1} value={effRampAngleDeg}
                onChange={e=>setNestRampAngleDeg(parseFloat(e.target.value))} style={{width:"100%"}}/>
              {nestRampAngleDeg!=null && (
                <button onClick={()=>setNestRampAngleDeg(null)} style={{marginTop:4,background:"none",border:"none",color:"#7dd3fc",fontSize:10,cursor:"pointer",padding:0,textDecoration:"underline"}}>Reset to auto</button>
              )}
            </div>

            <div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:10.5,color:bone,marginBottom:4}}>
                <span>Flue channel depth</span>
                <span style={{color:muted}}>{effFlueDepthIn.toFixed(3)}"{nestFlueDepthIn==null && <span style={{color:"#6a5a45"}}> (auto)</span>}</span>
              </div>
              <input type="range" min={0.015} max={0.15} step={0.001} value={effFlueDepthIn}
                onChange={e=>setNestFlueDepthIn(parseFloat(e.target.value))} style={{width:"100%"}}/>
              {nestFlueDepthIn!=null && (
                <button onClick={()=>setNestFlueDepthIn(null)} style={{marginTop:4,background:"none",border:"none",color:"#7dd3fc",fontSize:10,cursor:"pointer",padding:0,textDecoration:"underline"}}>Reset to auto</button>
              )}
            </div>

            <div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:10.5,color:bone,marginBottom:4}}>
                <span>TSH (sound hole) length</span>
                <span style={{color:muted}}>{effTshLengthIn.toFixed(3)}"{nestTshLengthIn==null && <span style={{color:"#6a5a45"}}> (auto)</span>}</span>
              </div>
              <input type="range" min={0.1} max={0.6} step={0.005} value={effTshLengthIn}
                onChange={e=>setNestTshLengthIn(parseFloat(e.target.value))} style={{width:"100%"}}/>
              {nestTshLengthIn!=null && (
                <button onClick={()=>setNestTshLengthIn(null)} style={{marginTop:4,background:"none",border:"none",color:"#7dd3fc",fontSize:10,cursor:"pointer",padding:0,textDecoration:"underline"}}>Reset to auto</button>
              )}
            </div>

            <div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:10.5,color:bone,marginBottom:4}}>
                <span>Fipple / air-cut angle</span>
                <span style={{color:muted}}>{nestFippleAngleDeg.toFixed(0)}°{nestFippleAngleDeg===0 && <span style={{color:"#6a5a45"}}> (plumb)</span>}</span>
              </div>
              <input type="range" min={0} max={55} step={1} value={nestFippleAngleDeg}
                onChange={e=>setNestFippleAngleDeg(parseFloat(e.target.value))} style={{width:"100%"}}/>
            </div>
          </div>

          <div style={{marginTop:10,fontSize:10.5,color:muted,lineHeight:1.5}}>
            The splitting-edge bevel direction here is a modeling choice (undercut from the bore side, sharp edge held fixed) rather than a measured spec — check it against your own reference before cutting.
          </div>

          <label style={{display:"flex",alignItems:"center",gap:6,marginTop:10,fontSize:11,color:bone,cursor:"pointer"}}>
            <input type="checkbox" checked={showNestLabels} onChange={e=>setShowNestLabels(e.target.checked)}/>
            Show dimension labels in the 3D preview
          </label>

          {(nestRampAngleDeg!=null || nestFlueDepthIn!=null || nestTshLengthIn!=null || nestFippleAngleDeg!==0 || nestName) && (
            <button onClick={clearNest} style={{marginTop:8,background:"none",border:`1px solid ${bg2}`,borderRadius:6,color:muted,fontSize:10.5,padding:"4px 10px",cursor:"pointer"}}>
              Reset all to auto
            </button>
          )}

          <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${bg2}`}}>
            <span style={{...lbl,fontSize:12}}>Nest Library{nestName && <span style={{color:muted,textTransform:"none",fontWeight:400}}> — currently applying "{nestName}"</span>}</span>

            <div style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap"}}>
              <select value={selectedNestId} onChange={e=>setSelectedNestId(e.target.value)}
                style={{flex:"1 1 160px",background:bg2,border:`1px solid ${border}`,color:bone,padding:"7px 8px",borderRadius:6,fontSize:12}}>
                <option value="">— saved nests —</option>
                {nestLibrary.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
              <button onClick={handleApplySelectedNest} disabled={!selectedNestId}
                style={{...pill(false),opacity:selectedNestId?1:0.5,cursor:selectedNestId?"pointer":"not-allowed"}}>Apply</button>
              <button onClick={handleDeleteSelectedNest} disabled={!selectedNestId}
                style={{...pill(false),opacity:selectedNestId?1:0.5,cursor:selectedNestId?"pointer":"not-allowed"}}>Delete</button>
            </div>

            <div style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap"}}>
              <input type="text" value={nestSaveName} onChange={e=>setNestSaveName(e.target.value)} placeholder="Name this nest…"
                style={{flex:"1 1 160px",background:bg2,border:`1px solid ${border}`,color:bone,padding:"7px 8px",borderRadius:6,fontSize:12}}/>
              <button onClick={doSaveNest} style={{...pill(false),background:gold,color:"#0f0801",border:"none",fontWeight:800}}>Save current as new nest</button>
            </div>

            <div style={{display:"flex",gap:8,marginTop:8,alignItems:"center",flexWrap:"wrap"}}>
              <label style={{...pill(false),cursor:"pointer"}}>
                Import nest file…
                <input type="file" accept=".json,application/json" onChange={handleNestFileImport} style={{display:"none"}}/>
              </label>
              <button onClick={()=>downloadNestFile(nestName || nestSaveName || "nest", {rampAngleDeg:effRampAngleDeg, flueDepthIn:effFlueDepthIn, tshLengthIn:effTshLengthIn, fippleAngleDeg:nestFippleAngleDeg})}
                style={pill(false)}>
                Download current as file
              </button>
            </div>

            {nestSaveMsg && <div style={{marginTop:8,fontSize:11.5,color:"#7dd3fc"}}>{nestSaveMsg}</div>}

            <div style={{marginTop:10,fontSize:10.5,color:muted,lineHeight:1.5}}>
              Saved nests live in this browser's storage, plus a downloadable .json file for each — that file is what reliably carries a nest from the separate Nest Designer tool into this calculator (or between browsers/devices), since two standalone HTML files aren't guaranteed to share storage.
            </div>
          </div>
        </div>

        <div style={{...card,overflowX:"auto"}}>
          <span style={lbl}>Drilling Template</span>
          <DrillingTemplate chambers={chambersForDiagram} curve={pipeMaterial === "antler" ? antlerShape : "straight"}/>
          <div style={{fontSize:11,color:muted,marginTop:8,textAlign:"center"}}>
            Scroll / zoom to inspect · Print this page at 100% for a physical layout guide
          </div>
        </div>


        <div style={card}>
          <button onClick={()=>setShowProgTuner(v=>!v)} style={{
            display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",
            background:"none",border:"none",cursor:"pointer",padding:0,
          }}>
            <span style={lbl}>🧭 Progressive Tuning Assistant <span style={{color:muted,textTransform:"none",fontWeight:400,fontSize:10}}>(step-by-step drilling guide — like GPS for tuning)</span></span>
            <span style={{color:"#d4a05a",fontSize:16,transform:showProgTuner?"rotate(90deg)":"none",transition:"transform 0.15s"}}>▶</span>
          </button>
          {showProgTuner && (
            <div style={{marginTop:14}}>
              <ProgressiveTuningAssistant chamber={chambersForDiagram[0]} a4={a4} NOTES={NOTES}/>
            </div>
          )}
        </div>

        <div style={card}>
          <span style={lbl}>Finger Hole Positions &amp; Starting Diameters</span>
          <div style={{fontSize:11,color:muted,marginBottom:10}}>
            All distances from TSH. Drill starting size, check pitch, enlarge with round file — repeat.
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:420}}>
              <thead>
                <tr style={{borderBottom:"2px solid #5a3a18"}}>
                  {["Hole","Opens","From TSH","From Foot","Start Ø"].map(h=>(
                    <th key={h} style={{textAlign:h==="Hole"||h==="Opens"?"left":"right",padding:"6px 8px",color:amber,fontWeight:700}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holes.map(h=>(
                  <tr key={h.num} style={{borderBottom:"1px solid #2a1a08"}}>
                    <td style={{padding:"8px 8px",color:gold,fontWeight:700,fontFamily:"monospace"}}>H{h.num}</td>
                    <td style={{color:muted,fontSize:12}}>{h.interval}</td>
                    <td style={{textAlign:"right",fontWeight:600,fontFamily:"monospace"}}>{h.fromTSH}"</td>
                    <td style={{textAlign:"right",color:"#c4a97d",fontFamily:"monospace"}}>{h.fromFoot}"</td>
                    <td style={{textAlign:"right",color:"#c4a97d",fontFamily:"monospace"}}>{h.diameter}"</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:12}}>
          {[
            ["Finger Holes",`Start: ${holeSt}" (${fmt(parseFloat(holeSt)*25.4,1)}mm)`,`Max: ${holeMx}" (${fmt(parseFloat(holeMx)*25.4,1)}mm)`],
            ["Sound Hole (window)",`Width: ${shW}" (across bore)`,`Length: ${shL}" (along bore)`],
            ["SAC & Mouthpiece",`SAC: ${fmt(sacLen)}"`,`Mouthpiece end: +~2" (adjust to fit)`],
          ].map(([title,l1,l2])=>(
            <div key={title} style={{...card,marginBottom:0}}>
              <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:"0.07em",color:amber,fontWeight:700,marginBottom:7}}>{title}</div>
              <div style={{fontSize:11,color:bone,marginBottom:4,fontFamily:"monospace"}}>{l1}</div>
              <div style={{fontSize:11,color:muted,fontFamily:"monospace"}}>{l2}</div>
            </div>
          ))}
        </div>

        <div style={card}>
          <button onClick={()=>setShowTuner(!showTuner)}
            style={{...pill(showTuner),width:"100%",padding:"14px",fontSize:15,border:`1px solid ${showTuner?gold:"#5a3a18"}`}}>
            {showTuner?"🎤 Hide Tuner":"🎤 Open Real-Time Microphone Tuner"}
          </button>
          {showTuner && <RealTuner rootNote={rootNote} onClose={()=>setShowTuner(false)} a4={a4} NOTES={NOTES}/>}
        </div>

        <div style={{...card,background:"#2a1f0f",borderColor:"#8a6030"}}>
          <div style={{fontSize:11,color:muted,textAlign:"center",marginBottom:8}}>
            Complete workshop packet — cover sheet, cutting guide, drill guide, tuning guide, and sanding &amp; finishing checklists
          </div>
          <button
            onClick={()=>exportPDF({bore,L,holes,holeCount,rootNote,totalLen,sacLen,handSize,antlerShape,pipeMaterial,
              fluteStyle,droneResults,a4,NOTES})}
            style={{width:"100%",padding:"16px",background:gold,color:"#0f0801",border:"none",borderRadius:8,fontSize:17,fontWeight:800,cursor:"pointer",letterSpacing:"-0.3px"}}>
            📄 Download Workshop Packet PDF
          </button>
        </div>

        <div style={card}>
          <button onClick={()=>setShowCNCExport(v=>!v)} style={{
            display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",
            background:"none",border:"none",cursor:"pointer",padding:0,
          }}>
            <span style={lbl}>⚙ CNC G-Code Export <span style={{color:muted,textTransform:"none",fontWeight:400,fontSize:10}}>(split-block glue-up or pre-cut tube drilling)</span></span>
            <span style={{color:"#d4a05a",fontSize:16,transform:showCNCExport?"rotate(90deg)":"none",transition:"transform 0.15s"}}>▶</span>
          </button>
          {showCNCExport && (
            <div style={{marginTop:14}}>
              <CNCExportPanel
                chambers={chambersForDiagram}
                curve={pipeMaterial === "antler" ? antlerShape : "straight"}
                pill={pill} card={card} lbl={lbl} muted={muted} bone={bone} bg2={bg2} border={border} gold={gold}
              />
            </div>
          )}
        </div>

        <div style={{...card,textAlign:"center"}}>
          <div style={{fontSize:11,color:muted,marginBottom:10}}>
            Save this exact build — bore, key, material, drones, and all — to reopen anytime from the Library tab.
          </div>
          <SaveInstrumentButton
            kind="flute"
            getConfig={()=>({
              bore, mode, noteKey, rawLen, holeCount, handSize, antlerShape, pipeMaterial,
              holeShape, fluteStyle, drones, a4, ergoOverride,
              nestName, nestRampAngleDeg, nestFlueDepthIn, nestTshLengthIn, nestFippleAngleDeg,
              summary: { rootNote: rootNote.name, holeCount, bore, material: pipeMaterial, isDrone: fluteStyle==="drone" },
            })}
            pill={pill} bg2={bg2} border={border} bone={bone} muted={muted} gold={gold}
          />
        </div>

      </>) : (
        <div style={{textAlign:"center",padding:"48px 20px",color:dim,fontSize:14}}>          {mode==="key"
            ? `${noteKey} is outside the achievable range for a ${bore}" bore — select a different note or bore diameter.`
            : "Enter a tube length between 5\" and 52\" to see results."}
        </div>
      )}

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  DUDUK ACOUSTICS
// ═══════════════════════════════════════════════════════════════
// A duduk is a cylindrical, double-reed instrument that behaves acoustically as a
// CLOSED-CLOSED pipe (the reed end is "closed" by the vibrating reed, the far end
// is closed by the player's fingers/breath pressure at rest, opening as a tone hole
// for the fundamental). In practice, players treat it like other folk double-reeds:
// the resonant length is tube length + an effective reed extension, and the reed
// cavity itself must be carved into the top of the tube to seat the reed.
//
// We model:
//   - Tube speaking length L via closed-pipe approximation similar to other folk
//     double reeds: L = SPEED / (2 * f) - reed_correction
//   - Reed effective length adds ~0.85-1.3" of acoustic length depending on reed style
//   - Reed seat: a stepped-down bore at the top, carved to hold the reed shaft
//   - Finger holes spaced using the same proportional-ratio method, but duduks
//     traditionally use a different (more diatonic, sometimes microtonal) hole set
//     than NAF pentatonic flutes
const DUDUK_STYLES = {
  traditional: {
    label: "Traditional Armenian",
    desc: "Wide cylindrical bore (apricot wood), large soft double reed (ghamish), warm dark tone, microtonal pitch bending via lip pressure",
    boreRange: [0.55, 0.85],
    reedLenRange: [1.3, 1.9],     // inches, reed inserted into bore
    reedExtRange: [0.95, 1.35],   // inches, acoustic end-correction contributed by reed cavity
    holeCount: 8,                 // 7 front + 1 thumb, traditional
  },
  western: {
    label: "Western / Modern Variant",
    desc: "Narrower bore, smaller stiffer reed, brighter and more stable pitch, easier for beginners, closer-spaced holes",
    boreRange: [0.4, 0.62],
    reedLenRange: [0.9, 1.3],
    reedExtRange: [0.65, 0.95],
    holeCount: 8,
  },
};

// Duduk hole layout — diatonic major-ish scale with one chromatic-leaning hole,
// expressed as ratios from the root (similar method to the flute calculator),
// holes counted from the reed end (H8 nearest reed/top) to the foot (H1).
// This approximates the traditional 7-front + 1-thumb Armenian layout.
const DUDUK_HOLES_8 = [
  { num:8, interval:"Maj 2nd", ratio:1.1225, thumb:false },
  { num:7, interval:"Maj 3rd", ratio:1.2599, thumb:false },
  { num:6, interval:"Perf 4th",ratio:1.3348, thumb:false },
  { num:5, interval:"Perf 5th",ratio:1.4983, thumb:false },
  { num:4, interval:"Maj 6th", ratio:1.6818, thumb:false },
  { num:3, interval:"Maj 7th", ratio:1.8877, thumb:false },
  { num:2, interval:"Octave",  ratio:2.0000, thumb:false },
  { num:1, interval:"Thumb (back)", ratio:1.0595, thumb:true },
];

function dudukTubeLen(freq, r, reedExt) {
  // Closed-closed pipe approximation with reed acoustic extension subtracted from
  // the physical bore length (the reed itself supplies part of the resonant column)
  return (SPEED / (2 * freq)) - reedExt - (0.3 * r);
}

function dudukHoleDiam(bore, isThumb) {
  // Thumb hole is traditionally a bit smaller and offset on the back of the tube
  const base = bore * (isThumb ? 0.38 : 0.46);
  return Math.max(0.16, Math.min(base, bore * 0.6));
}

// ═══════════════════════════════════════════════════════════════
//  DUDUK DRILLING TEMPLATE (single bore, reed cavity shown at top)
// ═══════════════════════════════════════════════════════════════
function DudukTemplate({ L, holes, bore, reedLen, reedDiam, rootNote }) {
  const W = 820, H = 230;
  const mL = 60, mR = 48;
  const drawW = W - mL - mR;
  const total = reedLen + L;
  const sc = drawW / total;

  const reedX0 = mL;
  const reedX1 = mL + reedLen * sc;
  const footX  = mL + total * sc;
  const TY = 90, TH = 36;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",maxWidth:"820px",display:"block",border:"1px solid #3a2a14",background:"#0c0600"}}>
      <defs>
        <pattern id="wood" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(20)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#3a2a14" strokeWidth="1.3"/>
        </pattern>
      </defs>

      <text x={W/2} y="26" textAnchor="middle" fill="#f59e0b" fontSize="14" fontWeight="bold" fontFamily="system-ui">
        DUDUK DRILLING TEMPLATE — Root {rootNote.name} — {fmt(L)}" body
      </text>

      {/* Reed seat / cavity */}
      <rect x={reedX0} y={TY-6} width={reedX1-reedX0} height={TH+12} rx="6" fill="url(#wood)" stroke="#c17d1a" strokeWidth="2"/>
      <rect x={reedX0} y={TY-6} width={reedX1-reedX0} height={TH+12} rx="6" fill="#5a3a18" opacity="0.4"/>
      <text x={(reedX0+reedX1)/2} y={TY-14} textAnchor="middle" fill="#f59e0b" fontSize="10" fontFamily="system-ui">REED SEAT</text>
      <text x={(reedX0+reedX1)/2} y={TY+TH+24} textAnchor="middle" fill="#c4a97d" fontSize="9" fontFamily="monospace">{fmt(reedLen)}" deep · Ø{fmt(reedDiam,3)}"</text>

      {/* Step down marker between reed seat and bore */}
      <line x1={reedX1} y1={TY-10} x2={reedX1} y2={TY+TH+10} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4,3"/>

      {/* Main bore */}
      <rect x={reedX1} y={TY} width={footX-reedX1} height={TH} rx="4" fill="#1a1208" stroke="#5a3a18" strokeWidth="6"/>

      {/* Open foot */}
      <rect x={footX-3} y={TY} width="6" height={TH} fill="#0a0500" stroke="#c4a97d" strokeWidth="1.5"/>
      <text x={footX} y={TY+TH+24} textAnchor="middle" fill="#c4a97d" fontSize="9" fontFamily="monospace">FOOT</text>

      {/* Front finger holes */}
      {holes.filter(h=>!h.thumb).map(h => {
        const hx = reedX1 + parseFloat(h.fromReed) * sc;
        const hr = Math.max(4.5, bore * 11);
        return (
          <g key={h.num}>
            <circle cx={hx} cy={TY+TH/2} r={hr} fill="#0a0500" stroke="#f59e0b" strokeWidth="3.2"/>
            <text x={hx} y={TY-10} textAnchor="middle" fill="#e5d5b8" fontSize="10" fontWeight="bold" fontFamily="monospace">H{h.num}</text>
            <text x={hx} y={TY+TH+14} textAnchor="middle" fill="#c4a97d" fontSize="8.5" fontFamily="monospace">{h.fromReed}"</text>
          </g>
        );
      })}

      {/* Thumb hole drawn offset below, labeled clearly as "back of tube" */}
      {holes.filter(h=>h.thumb).map(h => {
        const hx = reedX1 + parseFloat(h.fromReed) * sc;
        const hr = Math.max(4, bore * 9);
        const hy = TY + TH + 46;
        return (
          <g key={h.num}>
            <line x1={hx} y1={TY+TH} x2={hx} y2={hy-hr-2} stroke="#7acc44" strokeWidth="1" strokeDasharray="3,2"/>
            <circle cx={hx} cy={hy} r={hr} fill="#0a0500" stroke="#7acc44" strokeWidth="3"/>
            <text x={hx} y={hy+hr+13} textAnchor="middle" fill="#7acc44" fontSize="9" fontWeight="bold" fontFamily="monospace">Thumb (back)</text>
            <text x={hx} y={hy+hr+25} textAnchor="middle" fill="#7acc44" fontSize="8.5" fontFamily="monospace">{h.fromReed}"</text>
          </g>
        );
      })}

      <line x1={mL} y1={H-20} x2={W-mR} y2={H-20} stroke="#6b5d4a" strokeWidth="2"/>
      <text x={W/2} y={H-6} textAnchor="middle" fill="#6b5d4a" fontSize="10" fontFamily="system-ui">
        PRINT AT 100% SCALE · MEASUREMENTS IN INCHES FROM TOP OF REED SEAT
      </text>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════
//  DUDUK PDF EXPORT
// ═══════════════════════════════════════════════════════════════
function exportDudukPDF({ style, bore, L, holes, rootNote, reedLen, reedDiam, reedExt, totalLen, a4 }) {
  const doc = new jsPDF({ unit: "in", format: "letter" });

  doc.setFont("helvetica","bold"); doc.setFontSize(18);
  doc.text(`Duduk Build Sheet — ${DUDUK_STYLES[style].label}`, 4.25, 0.8, {align:"center"});

  doc.setFont("helvetica","normal"); doc.setFontSize(11);
  doc.setDrawColor(200,150,50); doc.setLineWidth(0.02);
  doc.line(0.8, 1.0, 7.7, 1.0);

  doc.text(`Tuning: A4 = ${a4} Hz    Bore: ${bore}"    Root: ${rootNote.name}`, 0.8, 1.3);
  doc.text(`Body length: ${fmt(L)}"    Reed seat depth: ${fmt(reedLen)}"    Total: ${totalLen}"`, 0.8, 1.65);
  doc.text(`Reed acoustic extension used in calculation: ${fmt(reedExt)}"`, 0.8, 1.95);

  doc.setFont("helvetica","bold"); doc.setFontSize(12);
  doc.text("Finger Holes (from top of reed seat):", 0.8, 2.4);
  doc.line(0.8, 2.5, 7.7, 2.5);
  doc.setFont("helvetica","normal"); doc.setFontSize(11);

  const colH = [0.8, 1.9, 3.6, 5.2];
  doc.setFont("helvetica","bold");
  doc.text("Hole", colH[0], 2.8); doc.text("Interval", colH[1], 2.8);
  doc.text("From Reed Seat", colH[2], 2.8); doc.text("Start Drill Ø", colH[3], 2.8);
  doc.setFont("helvetica","normal");

  let y = 3.1;
  holes.forEach(h => {
    doc.text(h.thumb ? "Thumb" : "H"+h.num, colH[0], y);
    doc.text(h.interval,        colH[1], y);
    doc.text(h.fromReed+'"',    colH[2], y);
    doc.text(h.diameter+'"',    colH[3], y);
    y += 0.32;
  });

  y += 0.15; doc.line(0.8, y, 7.7, y); y += 0.3;
  doc.setFont("helvetica","italic"); doc.setFontSize(10);
  doc.text("Reed seat is a stepped-down bore at the top of the tube sized to grip the reed shaft", 0.8, y); y += 0.25;
  doc.text("snugly. Carve/ream gradually and test-fit the reed often — too loose leaks air,", 0.8, y); y += 0.25;
  doc.text("too tight cracks the wood. The thumb hole sits on the back of the tube, opposite the", 0.8, y); y += 0.25;
  doc.text("front holes. Start finger holes small and enlarge gradually while checking pitch.", 0.8, y); y += 0.32;
  doc.text("Traditional duduks use cane (ghamish) double reeds — pitch is highly adjustable by", 0.8, y); y += 0.25;
  doc.text("lip pressure and reed position, more so than Western reed instruments.", 0.8, y);

  // True-scale template page
  const PAGE_W = 11, PAGE_H = 8.5, MARGIN = 0.5;
  doc.addPage([PAGE_W, PAGE_H], "landscape");
  doc.setFont("helvetica","bold"); doc.setFontSize(12);
  doc.text(`Drilling Template — PRINT AT 100% SCALE (no "fit to page")`, MARGIN, 0.45);
  doc.setFont("helvetica","normal"); doc.setFontSize(8);
  doc.text(`Reed seat + body shown left to right. Verify the 1" box with a ruler before drilling.`, MARGIN, 0.65);

  const usableW = PAGE_W - MARGIN*2;
  const total = reedLen + L;
  const sc = Math.min(1, usableW / total); // true scale if it fits, else note it doesn't
  const TY = 1.6, TH = 0.5;
  const reedX0 = MARGIN, reedX1 = MARGIN + reedLen*sc, footX = MARGIN + total*sc;

  doc.setDrawColor(80,50,20); doc.setLineWidth(0.02);
  doc.setFillColor(230,200,150);
  doc.rect(reedX0, TY, reedX1-reedX0, TH, "F");
  doc.rect(reedX0, TY, reedX1-reedX0, TH);
  doc.setFontSize(8); doc.setTextColor(160,90,0);
  doc.text("REED SEAT", reedX0, TY-0.08);
  doc.setTextColor(0,0,0);

  doc.rect(reedX1, TY, footX-reedX1, TH);

  holes.filter(h=>!h.thumb).forEach(h => {
    const hx = reedX1 + parseFloat(h.fromReed)*sc;
    const rad = Math.max(0.035, parseFloat(h.diameter)/2);
    doc.setDrawColor(200,120,0); doc.setLineWidth(0.02);
    doc.circle(hx, TY+TH/2, rad);
    doc.setFontSize(7); doc.setFont("helvetica","bold");
    doc.text(`H${h.num}`, hx, TY-0.05, {align:"center"});
    doc.setFont("helvetica","normal"); doc.setFontSize(6);
    doc.text(`Ø${h.diameter}"`, hx, TY+TH+0.15, {align:"center"});
  });
  const thumbHole = holes.find(h=>h.thumb);
  if (thumbHole) {
    const hx = reedX1 + parseFloat(thumbHole.fromReed)*sc;
    const rad = Math.max(0.03, parseFloat(thumbHole.diameter)/2);
    doc.setDrawColor(80,180,60);
    doc.circle(hx, TY+TH+0.35, rad);
    doc.setFontSize(7);
    doc.text("Thumb (back)", hx, TY+TH+0.35+rad+0.12, {align:"center"});
  }

  if (sc < 0.999) {
    doc.setFontSize(8); doc.setTextColor(200,40,40);
    doc.text(`NOTE: instrument is longer than one page at 100% scale (scaled to ${fmt(sc*100,0)}% to fit). Use the hole table on page 1 for exact measurements instead of this diagram.`, MARGIN, PAGE_H - MARGIN - 0.3, {maxWidth: usableW});
    doc.setTextColor(0,0,0);
  } else {
    doc.setDrawColor(0,0,0); doc.setLineWidth(0.015);
    doc.rect(PAGE_W - MARGIN - 1.0, PAGE_H - MARGIN - 0.35, 1.0, 0.25);
    doc.setFontSize(7);
    doc.text('1.00" exactly →', PAGE_W - MARGIN - 1.0 - 0.05, PAGE_H - MARGIN - 0.20, {align:"right"});
    doc.text("Measure this box with a ruler before drilling.", MARGIN, PAGE_H - MARGIN + 0.12);
  }

  const safeName = rootNote.name.replace(/[#\/]/g,"_");
  doc.save(`duduk_${style}_${safeName}_${bore}bore.pdf`);
}

// ═══════════════════════════════════════════════════════════════
//  DUDUK PAGE
// ═══════════════════════════════════════════════════════════════
function DudukPage({ loadConfig, onConfigLoaded }) {
  const [style,      setStyle]      = useState("traditional");
  const [bore,       setBore]       = useState(0.65);
  const [mode,       setMode]       = useState("key");
  const [noteKey,    setNoteKey]    = useState("A3");
  const [rawLen,     setRawLen]     = useState("11.0");
  const [reedLen,    setReedLen]    = useState(1.5);
  const [showTuner,  setShowTuner]  = useState(false);
  const [a4,         setA4]         = useState(440);
  const [playSamples,setPlaySamples]= useState(true);

  useEffect(() => {
    if (!loadConfig) return;
    const c = loadConfig;
    if (c.style !== undefined) setStyle(c.style);
    if (c.bore !== undefined) setBore(c.bore);
    if (c.mode !== undefined) setMode(c.mode);
    if (c.noteKey !== undefined) setNoteKey(c.noteKey);
    if (c.rawLen !== undefined) setRawLen(c.rawLen);
    if (c.reedLen !== undefined) setReedLen(c.reedLen);
    if (c.a4 !== undefined) setA4(c.a4);
    onConfigLoaded && onConfigLoaded();
  }, [loadConfig]);

  const NOTES = getNotes(a4);
  const cfg = DUDUK_STYLES[style];

  // Reed acoustic extension scales with reed length within the style's typical range
  const [reedExtMin, reedExtMax] = cfg.reedExtRange;
  const [reedLenMin, reedLenMax] = cfg.reedLenRange;
  const reedFrac = reedLenMax > reedLenMin ? (reedLen - reedLenMin) / (reedLenMax - reedLenMin) : 0.5;
  const reedExt = reedExtMin + Math.max(0, Math.min(1, reedFrac)) * (reedExtMax - reedExtMin);

  // Clamp bore to style's typical range when style changes
  useEffect(() => {
    const [bMin, bMax] = cfg.boreRange;
    setBore(b => Math.max(bMin, Math.min(bMax, b)));
    setReedLen(rl => Math.max(reedLenMin, Math.min(reedLenMax, rl)));
  }, [style]);

  const r = bore / 2;
  let L, rootFreq, rootNote;
  if (mode === "key") {
    rootFreq = NOTES.find(n => n.name === noteKey)?.freq ?? a4;
    L = dudukTubeLen(rootFreq, r, reedExt);
    rootNote = nearestNote(rootFreq, NOTES);
  } else {
    L = parseFloat(rawLen) || 11;
    rootFreq = SPEED / (2 * (L + reedExt + 0.3*r));
    rootNote = nearestNote(rootFreq, NOTES);
  }

  const holes = DUDUK_HOLES_8.map(h => ({
    num: h.num,
    interval: h.interval,
    thumb: h.thumb,
    fromReed: fmt(L - (L / h.ratio)),
    diameter: fmt(dudukHoleDiam(bore, h.thumb), 3),
  }));

  const reedDiam = bore * 0.62; // reed shaft slightly narrower than bore, seated snugly
  const totalLen = fmt(L + reedLen);

  const validNotes = NOTES.filter(n => {
    const tl = dudukTubeLen(n.freq, r, reedExt);
    return tl >= 4 && tl <= 22;
  });

  const showResults = L > 3;

  const bg0="#0a0805",bg1="#160f08",bg2="#201509";
  const border="#3a2a18",gold="#e8a33d",amber="#c9842a";
  const bone="#e8dcc8",muted="#9a8166",dim="#4a3a26";

  const card  = { background:bg1, border:`1px solid ${border}`, borderRadius:8, padding:"14px 16px", marginBottom:12 };
  const lbl   = { fontSize:10, textTransform:"uppercase", letterSpacing:"0.08em", color:amber, fontWeight:700, marginBottom:8, display:"block" };
  const pill  = (active) => ({
    padding:"6px 13px", borderRadius:6, cursor:"pointer", fontSize:13, fontWeight:700,
    border:`1px solid ${active?gold:dim}`,
    background:active?gold:bg2,
    color:active?"#1a0e00":bone,
    transition:"background 0.12s, border-color 0.12s",
  });

  return (
    <div style={{maxWidth:740,margin:"0 auto"}}>

      <div style={{textAlign:"center",marginBottom:24}}>
        <div style={{fontSize:30,fontWeight:900,color:gold,letterSpacing:"-0.5px",lineHeight:1}}>🎶 Duduk Calculator</div>
        <div style={{color:muted,fontSize:13,marginTop:6}}>Armenian Double-Reed · Reed Cavity · Real Tuner · PDF Export</div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginTop:12}}>
          <span style={{fontSize:12,color:muted}}>Tuning:</span>
          <div style={{display:"flex",borderRadius:8,overflow:"hidden",border:`1px solid ${border}`}}>
            {[440,432].map(hz=>(
              <button key={hz} onClick={()=>setA4(hz)} style={{
                padding:"5px 16px",fontSize:13,fontWeight:700,cursor:"pointer",border:"none",
                background: a4===hz ? gold : bg2,
                color: a4===hz ? "#1a0e00" : muted,
              }}>
                A4 = {hz} Hz
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={card}>
        <span style={lbl}>① Duduk Style</span>
        <div style={{display:"flex",gap:8,marginBottom:10}}>
          {Object.entries(DUDUK_STYLES).map(([key,s])=>(
            <button key={key} onClick={()=>setStyle(key)} style={{...pill(style===key),flex:1,fontSize:14,padding:"9px 6px"}}>{s.label}</button>
          ))}
        </div>
        <div style={{fontSize:12,color:"#c9a06a",lineHeight:1.6,borderTop:`1px solid ${border}`,paddingTop:10}}>
          {cfg.desc}
        </div>
      </div>

      <div style={card}>
        <span style={lbl}>② Bore Diameter <span style={{color:muted,textTransform:"none",fontWeight:400,fontSize:10}}>(typical range for this style: {cfg.boreRange[0]}"–{cfg.boreRange[1]}")</span></span>
        <input type="range" min={cfg.boreRange[0]} max={cfg.boreRange[1]} step="0.01" value={bore}
          onChange={e=>setBore(parseFloat(e.target.value))}
          style={{width:"100%",marginBottom:8}}/>
        <div style={{fontSize:20,fontWeight:800,color:gold,fontFamily:"monospace"}}>{fmt(bore,2)}" <span style={{fontSize:12,color:muted,fontWeight:400}}>({fmt(bore*25.4,1)}mm)</span></div>
      </div>

      <div style={card}>
        <span style={lbl}>③ Reed Seat Depth <span style={{color:muted,textTransform:"none",fontWeight:400,fontSize:10}}>(how deep the reed is inserted)</span></span>
        <input type="range" min={cfg.reedLenRange[0]} max={cfg.reedLenRange[1]} step="0.05" value={reedLen}
          onChange={e=>setReedLen(parseFloat(e.target.value))}
          style={{width:"100%",marginBottom:8}}/>
        <div style={{fontSize:20,fontWeight:800,color:gold,fontFamily:"monospace"}}>{fmt(reedLen,2)}" <span style={{fontSize:12,color:muted,fontWeight:400}}>seat depth</span></div>
        <div style={{fontSize:11,color:muted,marginTop:6}}>Acoustic reed extension used in calculation: <strong style={{color:bone}}>{fmt(reedExt,2)}"</strong> — longer/softer reeds add more effective length to the resonating column.</div>
      </div>

      <div style={card}>
        <span style={lbl}>④ Root Key or Body Length</span>
        <div style={{display:"flex",gap:8,marginBottom:10}}>
          <button onClick={()=>setMode("key")}    style={{...pill(mode==="key"),   flex:1}}>By Key</button>
          <button onClick={()=>setMode("length")} style={{...pill(mode==="length"),flex:1}}>By Body Length</button>
        </div>
        {mode==="key" ? (<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7,flexWrap:"wrap",gap:6}}>
            <div style={{fontSize:11,color:muted}}>Root note (all holes closed) — dimmed notes are out of range for this bore/reed combo</div>
            <button onClick={()=>setPlaySamples(p=>!p)}
              style={{...pill(playSamples),padding:"4px 10px",fontSize:11}}>
              {playSamples ? "🔊" : "🔇"} Play note on select
            </button>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
            {NOTES.map(n=>{
              const ok = !!validNotes.find(v=>v.name===n.name);
              return (
                <button key={n.name} onClick={()=>{ if(!ok) return; setNoteKey(n.name); if(playSamples) playNoteSample(n.name); }}
                  style={{...pill(noteKey===n.name),opacity:ok?1:0.28,cursor:ok?"pointer":"not-allowed",padding:"5px 10px",fontSize:12}}>
                  {n.name}
                </button>
              );
            })}
          </div>
        </>) : (<>
          <div style={{fontSize:11,color:muted,marginBottom:7}}>Enter body length — bottom of reed seat to open foot, in inches</div>
          <input type="number" step="0.25" min="4" max="22" value={rawLen}
            onChange={e=>setRawLen(e.target.value)}
            style={{background:bg2,border:`1px solid ${border}`,color:bone,padding:"8px 14px",width:130,borderRadius:6,fontSize:14}}
            placeholder="inches"/>
        </>)}
      </div>

      {showResults ? (<>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10,marginBottom:12}}>
          <div style={{...card,marginBottom:0,borderColor:"#7a5018"}}>
            <div style={{fontSize:10,color:muted}}>Body Length</div>
            <div style={{fontSize:38,fontWeight:900,color:gold,fontFamily:"monospace"}}>{fmt(L)}"</div>
            <div style={{fontSize:11,color:muted}}>{fmt(L*25.4,0)} mm</div>
          </div>
          <div style={{...card,marginBottom:0,borderColor:"#7a5018"}}>
            <div style={{fontSize:10,color:muted}}>Root Note</div>
            <div style={{fontSize:38,fontWeight:900,color:gold,fontFamily:"monospace"}}>{rootNote.name}</div>
            <div style={{fontSize:11,color:muted}}>{rootNote.cents!==0?(rootNote.cents>0?"+":"")+rootNote.cents+"¢ off":"in tune"}</div>
          </div>
          <div style={{...card,marginBottom:0}}>
            <div style={{fontSize:10,color:muted}}>Total Length</div>
            <div style={{fontSize:28,fontWeight:800,fontFamily:"monospace"}}>{totalLen}"</div>
            <div style={{fontSize:11,color:muted}}>Reed seat + body</div>
          </div>
        </div>

        <div style={{...card,overflowX:"auto"}}>
          <span style={lbl}>Drilling Template</span>
          <DudukTemplate L={L} holes={holes} bore={bore} reedLen={reedLen} reedDiam={reedDiam} rootNote={rootNote}/>
          <div style={{fontSize:11,color:muted,marginTop:8,textAlign:"center"}}>
            Scroll / zoom to inspect · Print this page at 100% for a physical layout guide
          </div>
        </div>

        <div style={card}>
          <span style={lbl}>Finger Hole Positions &amp; Starting Diameters</span>
          <div style={{fontSize:11,color:muted,marginBottom:10}}>
            All distances from the top of the reed seat. The thumb hole is on the back of the tube.
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:420}}>
              <thead>
                <tr style={{borderBottom:"2px solid #7a5018"}}>
                  {["Hole","Opens","From Reed Seat","Start Ø"].map(h=>(
                    <th key={h} style={{textAlign:h==="Hole"||h==="Opens"?"left":"right",padding:"6px 8px",color:amber,fontWeight:700}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holes.map(h=>(
                  <tr key={h.num} style={{borderBottom:"1px solid #2a1c0d"}}>
                    <td style={{padding:"8px 8px",color:h.thumb?"#7acc44":gold,fontWeight:700,fontFamily:"monospace"}}>{h.thumb?"Thumb":"H"+h.num}</td>
                    <td style={{color:muted,fontSize:12}}>{h.interval}{h.thumb?" (back of tube)":""}</td>
                    <td style={{textAlign:"right",fontWeight:600,fontFamily:"monospace"}}>{h.fromReed}"</td>
                    <td style={{textAlign:"right",color:"#c9a06a",fontFamily:"monospace"}}>{h.diameter}"</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
          <div style={{...card,marginBottom:0}}>
            <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:"0.07em",color:amber,fontWeight:700,marginBottom:7}}>Reed Seat</div>
            <div style={{fontSize:11,color:bone,marginBottom:4,fontFamily:"monospace"}}>Depth: {fmt(reedLen)}"</div>
            <div style={{fontSize:11,color:muted,fontFamily:"monospace"}}>Seat Ø: {fmt(reedDiam,3)}" (reed shaft fit)</div>
          </div>
          <div style={{...card,marginBottom:0}}>
            <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:"0.07em",color:amber,fontWeight:700,marginBottom:7}}>Reed Acoustic Model</div>
            <div style={{fontSize:11,color:bone,marginBottom:4,fontFamily:"monospace"}}>Extension: {fmt(reedExt,2)}"</div>
            <div style={{fontSize:11,color:muted,fontFamily:"monospace"}}>Style: {cfg.label}</div>
          </div>
        </div>

        <div style={{...card,background:"#241608",borderColor:"#7a5018"}}>
          <div style={{fontSize:12,color:"#d4a05a",lineHeight:1.7}}>
            <strong style={{color:bone}}>About the reed:</strong> traditional Armenian duduks use a wide, soft cane (ghamish) double reed that allows significant pitch bending via lip pressure and embouchure — much more than Western double reeds. The reed seat dimensions above are a starting point; reed-makers usually hand-fit each reed to its instrument, so expect to ream/sand the seat gradually while test-fitting rather than drilling to a single exact size.
          </div>
        </div>

        <div style={card}>
          <button onClick={()=>setShowTuner(!showTuner)}
            style={{...pill(showTuner),width:"100%",padding:"14px",fontSize:15,border:`1px solid ${showTuner?gold:"#7a5018"}`}}>
            {showTuner?"🎤 Hide Tuner":"🎤 Open Real-Time Microphone Tuner"}
          </button>
          {showTuner && <RealTuner rootNote={rootNote} onClose={()=>setShowTuner(false)} a4={a4} NOTES={NOTES}/>}
        </div>

        <div style={{...card,background:"#2a1f0f",borderColor:"#8a6030"}}>
          <div style={{fontSize:11,color:muted,textAlign:"center",marginBottom:8}}>
            Complete build specification — all measurements, hole positions, and reed notes
          </div>
          <button
            onClick={()=>exportDudukPDF({style,bore,L,holes,rootNote,reedLen,reedDiam,reedExt,totalLen,a4})}
            style={{width:"100%",padding:"16px",background:gold,color:"#1a0e00",border:"none",borderRadius:8,fontSize:17,fontWeight:800,cursor:"pointer",letterSpacing:"-0.3px"}}>
            📄 Download Build Sheet PDF
          </button>
        </div>

        <div style={{...card,textAlign:"center"}}>
          <div style={{fontSize:11,color:muted,marginBottom:10}}>
            Save this exact build — style, bore, key, and reed depth — to reopen anytime from the Library tab.
          </div>
          <SaveInstrumentButton
            kind="duduk"
            getConfig={()=>({
              style, bore, mode, noteKey, rawLen, reedLen, a4,
              summary: { rootNote: rootNote.name, style, bore },
            })}
            pill={pill} bg2={bg2} border={border} bone={bone} muted={muted} gold={gold}
          />
        </div>

      </>) : (
        <div style={{textAlign:"center",padding:"48px 20px",color:dim,fontSize:14}}>
          {mode==="key"
            ? `${noteKey} is outside the achievable range for this bore/reed combination — select a different note, bore, or reed depth.`
            : "Enter a body length between 4\" and 22\" to see results."}
        </div>
      )}

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  TOP-LEVEL APP — PAGE TABS
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
//  LIBRARY PAGE — browse, load, rename, delete saved instruments
// ═══════════════════════════════════════════════════════════════
function LibraryPage({ onLoad }) {
  const [items, setItems] = useState(() => loadLibrary());
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [filter, setFilter] = useState("all"); // "all" | "flute" | "duduk"

  const bg0="#0f0801",bg1="#1a1005",bg2="#241608";
  const border="#3a2a14",gold="#f59e0b";
  const bone="#e5d5b8",muted="#8a7255",dim="#4a3a26";
  const card = { background:bg1, border:`1px solid ${border}`, borderRadius:8, padding:"14px 16px", marginBottom:12 };
  const lbl = { fontSize:10, textTransform:"uppercase", letterSpacing:"0.08em", color:gold, fontWeight:700, marginBottom:8, display:"block" };
  const pill = (active) => ({
    padding:"7px 14px", borderRadius:6, cursor:"pointer", fontSize:12.5, fontWeight:700,
    border:`1px solid ${active?gold:dim}`, background:active?gold:bg2, color:active?"#0f0801":bone,
  });

  const refresh = () => setItems(loadLibrary());

  const handleDelete = (id) => {
    deleteInstrumentFromLibrary(id);
    setConfirmDeleteId(null);
    refresh();
  };

  const startRename = (item) => { setRenamingId(item.id); setRenameValue(item.name); };
  const commitRename = () => {
    if (renamingId) renameInstrumentInLibrary(renamingId, renameValue);
    setRenamingId(null);
    refresh();
  };

  const filtered = items.filter(i => filter === "all" || i.kind === filter);

  const kindLabel = { flute: "🪈 Flute", duduk: "🎶 Duduk" };

  return (
    <div style={{maxWidth:740,margin:"0 auto"}}>
      <div style={{textAlign:"center",marginBottom:24}}>
        <div style={{fontSize:30,fontWeight:900,color:gold,letterSpacing:"-0.5px"}}>📚 Instrument Library</div>
        <div style={{color:muted,fontSize:13,marginTop:6}}>Saved builds, stored in this browser — load any of them back into the calculator anytime.</div>
      </div>

      <div style={{display:"flex",gap:8,marginBottom:16,justifyContent:"center"}}>
        {["all","flute","duduk"].map(f => (
          <button key={f} onClick={()=>setFilter(f)} style={pill(filter===f)}>
            {f === "all" ? "All" : kindLabel[f]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{...card, textAlign:"center", padding:"48px 20px", color:dim}}>
          {items.length === 0
            ? <>No saved instruments yet. Build something on the Flute or Duduk page, then hit <strong style={{color:muted}}>💾 Save to Library</strong>.</>
            : "No saved instruments match this filter."}
        </div>
      ) : (
        filtered.map(item => (
          <div key={item.id} style={card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:200}}>
                {renamingId === item.id ? (
                  <div style={{display:"flex",gap:6,marginBottom:6}}>
                    <input autoFocus type="text" value={renameValue} onChange={e=>setRenameValue(e.target.value)}
                      onKeyDown={e=>{ if(e.key==="Enter") commitRename(); if(e.key==="Escape") setRenamingId(null); }}
                      style={{background:bg2,border:`1px solid ${border}`,color:bone,padding:"6px 10px",borderRadius:6,fontSize:14,flex:1}}/>
                    <button onClick={commitRename} style={{padding:"6px 12px",borderRadius:6,border:"none",background:gold,color:"#0f0801",fontWeight:700,fontSize:12,cursor:"pointer"}}>Save</button>
                  </div>
                ) : (
                  <div style={{fontSize:16,fontWeight:800,color:bone,marginBottom:4}}>{item.name}</div>
                )}
                <div style={{fontSize:11,color:muted,marginBottom:2}}>
                  {kindLabel[item.kind] || item.kind}
                  {item.config?.summary && (
                    <> · {item.config.summary.rootNote}
                      {item.kind === "flute" && item.config.summary.holeCount ? ` · ${item.config.summary.holeCount}-hole` : ""}
                      {item.kind === "flute" && item.config.summary.material === "antler" ? " · antler" : ""}
                      {item.kind === "flute" && item.config.summary.isDrone ? " · drone" : ""}
                      {item.kind === "duduk" && item.config.summary.style ? ` · ${item.config.summary.style}` : ""}
                    </>
                  )}
                </div>
                <div style={{fontSize:10,color:dim}}>
                  Saved {new Date(item.savedAt).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"})}
                </div>
              </div>

              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <button onClick={()=>onLoad(item)} style={{padding:"8px 14px",borderRadius:6,border:"none",background:gold,color:"#0f0801",fontWeight:700,fontSize:12.5,cursor:"pointer"}}>
                  Open
                </button>
                <button onClick={()=>startRename(item)} style={{padding:"8px 12px",borderRadius:6,border:`1px solid ${border}`,background:"none",color:muted,fontWeight:700,fontSize:12.5,cursor:"pointer"}}>
                  Rename
                </button>
                {confirmDeleteId === item.id ? (
                  <button onClick={()=>handleDelete(item.id)} style={{padding:"8px 12px",borderRadius:6,border:"1px solid #7a4a30",background:"#3a1808",color:"#fca5a5",fontWeight:700,fontSize:12.5,cursor:"pointer"}}>
                    Confirm?
                  </button>
                ) : (
                  <button onClick={()=>setConfirmDeleteId(item.id)} style={{padding:"8px 12px",borderRadius:6,border:`1px solid ${border}`,background:"none",color:muted,fontWeight:700,fontSize:12.5,cursor:"pointer"}}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        ))
      )}

      {items.length > 0 && (
        <div style={{fontSize:11,color:dim,textAlign:"center",marginTop:8}}>
          Saved instruments live in this browser's storage only — they won't sync to other devices, and clearing browser data will remove them.
        </div>
      )}
    </div>
  );
}




// ═══════════════════════════════════════════════════════════════
//  G-CODE VIEWER PAGE — merged from the former standalone
//  gcode_viewer.jsx/html. Full parser, 3D/2D toolpath playback,
//  stock preview, and lighting controls, now living in its own tab.
// ═══════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════
//  G-CODE PARSER
//  Tokenizes a G-code program into a flat list of motion/annotation
//  segments, plus two bounding boxes:
//    - bounds: every point the program ever visits (rapids included) —
//      useful for framing the camera / overall scene extent.
//    - cutBounds: only points visited during FEED (cutting) moves — this
//      is the one that should ever be used to infer "where the material
//      actually gets cut", since rapid retracts/approaches happen well
//      clear of the stock and have nothing to do with its real shape.
// ═══════════════════════════════════════════════════════════════════════

function stripComments(line) {
  let comment = "";
  const paren = line.match(/\(([^)]*)\)/);
  if (paren) comment = paren[1].trim();
  let code = line.replace(/\([^)]*\)/g, "");
  const semi = code.indexOf(";");
  if (semi >= 0) {
    if (!comment) comment = code.slice(semi + 1).trim();
    code = code.slice(0, semi);
  }
  return { code: code.trim(), comment };
}

function tokenizeWords(code) {
  const re = /([A-Za-z])\s*(-?\d*\.?\d+)/g;
  const out = [];
  let m;
  while ((m = re.exec(code))) out.push({ letter: m[1].toUpperCase(), value: parseFloat(m[2]) });
  return out;
}

// Interpolates an arc (G2/G3) into a polyline of points, including
// helical movement along the axis perpendicular to the arc plane.
function arcPoints(from, to, center, ccw, plane, steps = 32) {
  const axes = plane === "XY" ? ["x", "y"] : plane === "XZ" ? ["x", "z"] : ["y", "z"];
  const [a, b] = axes;
  const startAngle = Math.atan2(from[b] - center[b], from[a] - center[a]);
  let endAngle = Math.atan2(to[b] - center[b], to[a] - center[a]);
  const radius = Math.hypot(from[a] - center[a], from[b] - center[b]);
  let sweep = endAngle - startAngle;
  if (ccw) { if (sweep > 0) sweep -= 2 * Math.PI; }
  else { if (sweep < 0) sweep += 2 * Math.PI; }
  if (Math.abs(sweep) < 1e-9) sweep = ccw ? -2 * Math.PI : 2 * Math.PI;

  const thirdAxis = plane === "XY" ? "z" : plane === "XZ" ? "y" : "x";
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = startAngle + sweep * t;
    const p = { x: 0, y: 0, z: 0 };
    p[a] = center[a] + radius * Math.cos(angle);
    p[b] = center[b] + radius * Math.sin(angle);
    p[thirdAxis] = from[thirdAxis] + (to[thirdAxis] - from[thirdAxis]) * t;
    points.push(p);
  }
  return points;
}

function parseGCode(text) {
  const lines = text.split(/\r?\n/);
  const segments = [];
  const warnings = [];

  let units = "mm";
  let unitsExplicit = false;
  let distanceMode = "absolute";
  let arcPlane = "XY";
  let position = { x: 0, y: 0, z: 0 };
  let feedRate = 0;
  let spindleOn = false;

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    const { code, comment } = stripComments(raw);
    if (!code) {
      if (comment) segments.push({ type: "comment", lineIndex: li, raw, comment });
      continue;
    }
    const words = tokenizeWords(code);
    if (words.length === 0) continue;

    const gCodes = words.filter((w) => w.letter === "G").map((w) => w.value);
    const mCodes = words.filter((w) => w.letter === "M").map((w) => w.value);
    const get = (letter) => { const w = words.find((w) => w.letter === letter); return w ? w.value : undefined; };

    if (gCodes.includes(20)) { units = "in"; unitsExplicit = true; }
    if (gCodes.includes(21)) { units = "mm"; unitsExplicit = true; }
    if (gCodes.includes(90)) distanceMode = "absolute";
    if (gCodes.includes(91)) distanceMode = "incremental";
    if (gCodes.includes(17)) arcPlane = "XY";
    if (gCodes.includes(18)) arcPlane = "XZ";
    if (gCodes.includes(19)) arcPlane = "YZ";
    if (get("F") !== undefined) feedRate = get("F");
    if (mCodes.includes(3) || mCodes.includes(4)) spindleOn = true;
    if (mCodes.includes(5)) spindleOn = false;

    if (gCodes.includes(92)) {
      const X = get("X"), Y = get("Y"), Z = get("Z");
      if (X !== undefined) position.x = X;
      if (Y !== undefined) position.y = Y;
      if (Z !== undefined) position.z = Z;
      continue;
    }
    if (gCodes.includes(4)) {
      const dwell = get("P") || 0;
      segments.push({ type: "dwell", lineIndex: li, raw, comment, at: { ...position }, duration: dwell });
      continue;
    }
    if (mCodes.includes(0) || mCodes.includes(1)) {
      segments.push({ type: "pause", lineIndex: li, raw, comment, at: { ...position } });
      continue;
    }
    const isMotionWord = gCodes.some((g) => [0, 1, 2, 3].includes(g)) ||
      (gCodes.length === 0 && ["X", "Y", "Z"].some((L) => get(L) !== undefined));
    if (!isMotionWord) {
      if (mCodes.length > 0) segments.push({ type: "annotation", lineIndex: li, raw, comment });
      continue;
    }

    const target = { ...position };
    const bx = get("X"), by = get("Y"), bz = get("Z");
    if (bx !== undefined) target.x = distanceMode === "absolute" ? bx : position.x + bx;
    if (by !== undefined) target.y = distanceMode === "absolute" ? by : position.y + by;
    if (bz !== undefined) target.z = distanceMode === "absolute" ? bz : position.z + bz;
    const isRapid = gCodes.includes(0);

    if (gCodes.includes(2) || gCodes.includes(3)) {
      const ccw = gCodes.includes(3);
      let center;
      const I = get("I"), J = get("J"), K = get("K"), R = get("R");
      if (I !== undefined || J !== undefined || K !== undefined) {
        center = { x: position.x + (I || 0), y: position.y + (J || 0), z: position.z + (K || 0) };
      } else if (R !== undefined) {
        const axes = arcPlane === "XY" ? ["x", "y"] : arcPlane === "XZ" ? ["x", "z"] : ["y", "z"];
        const [a, b] = axes;
        const dx = target[a] - position[a], dy = target[b] - position[b];
        const chord = Math.hypot(dx, dy);
        const rad = Math.abs(R);
        const h = Math.sqrt(Math.max(0, rad * rad - (chord / 2) * (chord / 2)));
        const mx = (position[a] + target[a]) / 2, my = (position[b] + target[b]) / 2;
        const perp = { x: -dy / (chord || 1), y: dx / (chord || 1) };
        const sign = (R >= 0) === ccw ? -1 : 1;
        center = { x: 0, y: 0, z: position.z };
        center[a] = mx + perp.x * h * sign;
        center[b] = my + perp.y * h * sign;
      } else {
        warnings.push(`Line ${li + 1}: arc (G2/G3) with no I/J/K or R — skipped.`);
        position = target;
        continue;
      }
      const points = arcPoints(position, target, center, ccw, arcPlane);
      segments.push({
        type: "feed", isArc: true, lineIndex: li, raw, comment,
        from: { ...position }, to: { ...target }, points, feedRate, spindleOn,
      });
    } else {
      segments.push({
        type: isRapid ? "rapid" : "feed", lineIndex: li, raw, comment,
        from: { ...position }, to: { ...target }, feedRate, spindleOn,
      });
    }
    position = target;
  }

  if (!unitsExplicit) warnings.push("No G20/G21 units command found — assuming millimeters. Verify before trusting absolute dimensions.");

  const bounds = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
  const cutBounds = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
  const expand = (box, p) => {
    box.min.x = Math.min(box.min.x, p.x); box.max.x = Math.max(box.max.x, p.x);
    box.min.y = Math.min(box.min.y, p.y); box.max.y = Math.max(box.max.y, p.y);
    box.min.z = Math.min(box.min.z, p.z); box.max.z = Math.max(box.max.z, p.z);
  };
  segments.forEach((s) => {
    if (s.from) expand(bounds, s.from);
    if (s.to) expand(bounds, s.to);
    if (s.points) s.points.forEach((p) => expand(bounds, p));
    if (s.type === "feed") {
      if (s.from) expand(cutBounds, s.from);
      if (s.to) expand(cutBounds, s.to);
      if (s.points) s.points.forEach((p) => expand(cutBounds, p));
    }
  });
  if (!isFinite(bounds.min.x)) { bounds.min = { x: 0, y: 0, z: 0 }; bounds.max = { x: 0, y: 0, z: 0 }; }
  if (!isFinite(cutBounds.min.x)) { cutBounds.min = { ...bounds.min }; cutBounds.max = { ...bounds.max }; }

  return { segments, bounds, cutBounds, units, lineCount: lines.length, warnings };
}

// ═══════════════════════════════════════════════════════════════════════
//  SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════

// Rapids + feeds only — the moves that actually take the tool somewhere
// (dwells/pauses/comments/annotations don't move the tool).
function getMotionMoves(segments) {
  return segments.filter((s) => s.type === "rapid" || s.type === "feed");
}

// Where the tool tip is at a given point [0..1] through the program.
function pointAtProgress(moves, progress) {
  if (moves.length === 0) return { x: 0, y: 0, z: 0 };
  const scaled = Math.min(1, Math.max(0, progress)) * moves.length;
  const idx = Math.min(moves.length - 1, Math.max(0, Math.floor(scaled)));
  const frac = scaled - idx;
  const move = moves[idx];
  if (move.isArc && move.points) {
    const pIdx = Math.min(move.points.length - 1, Math.floor(frac * (move.points.length - 1)));
    return move.points[pIdx];
  }
  return {
    x: move.from.x + (move.to.x - move.from.x) * frac,
    y: move.from.y + (move.to.y - move.from.y) * frac,
    z: move.from.z + (move.to.z - move.from.z) * frac,
  };
}

// G-code (x, y, z) -> scene (x, z, -y): the machine's Z (vertical spindle
// travel) becomes the scene's vertical axis; gcode Y (along the tube)
// becomes scene depth, flipped so positive Y reads as "into the screen".
function toScene(p) { return new THREE.Vector3(p.x, p.z, -p.y); }

// ═══════════════════════════════════════════════════════════════════════
//  3D VIEWER — stock block, ground plane, toolpath lines, and the
//  progressive "material being cut away" simulation.
// ═══════════════════════════════════════════════════════════════════════

const STOCK_MARGIN_Z = 0.05; // clearance above the highest actual cut, inches
const GROUND_CLEARANCE = 0.01; // gap kept between the ground plane and the stock's real bottom face, inches

function buildToolSweepGeometry(fromPt, toPt, toolDiameter) {
  const a = toScene(fromPt), b = toScene(toPt);
  const dir = new THREE.Vector3().subVectors(b, a);
  const length = dir.length();
  if (length < 1e-6) return null;
  dir.normalize();
  // A capsule-ish sweep: a cylinder the tool's diameter, long enough to
  // cover the full move plus one tool-radius of overlap on each end so
  // consecutive cuts join cleanly with no seams.
  const geo = new THREE.CylinderGeometry(toolDiameter / 2, toolDiameter / 2, length + toolDiameter, 12);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  geo.applyQuaternion(quat);
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  geo.translate(mid.x, mid.y, mid.z);
  return geo;
}

// Converts the "angle" / "height" light controls (azimuth = compass
// rotation around the model, elevation = degrees above the horizon) into a
// 3D position orbiting the model's center at a fixed distance.
function keyLightPosition(center, distance, azimuthDeg, elevationDeg) {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const horizontal = distance * Math.cos(el);
  return {
    x: center.x + horizontal * Math.cos(az),
    y: center.y + distance * Math.sin(el),
    z: center.z + horizontal * Math.sin(az),
  };
}

function Viewer3D({ parsed, progress, toolDiameter, stockSize, stockOffset, showRapids, materialColor, ambientIntensity, keyIntensity, keyAzimuth, keyElevation }) {
  const mountRef = useRef(null);
  const sceneRef = useRef({});
  const bakedProgressRef = useRef(0);
  const [isBuilding, setIsBuilding] = useState(true);
  const [buildError, setBuildError] = useState(null);
  const [isCarving, setIsCarving] = useState(false);
  const [carveError, setCarveError] = useState(null);

  const motionMoves = useMemo(() => getMotionMoves(parsed.segments), [parsed]);

  // --- one-time scene / camera / renderer / lights / ground / toolpath lines ---
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const width = el.clientWidth || 600, height = el.clientHeight || 500;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#11151a");

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.innerHTML = "";
    el.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, ambientIntensity);
    scene.add(ambientLight);
    const keyLight = new THREE.DirectionalLight(0xffffff, keyIntensity);
    const modelCenterForLight = {
      x: (parsed.bounds.min.x + parsed.bounds.max.x) / 2,
      y: (parsed.bounds.min.z + parsed.bounds.max.z) / 2,
      z: -(parsed.bounds.min.y + parsed.bounds.max.y) / 2,
    };
    const lightDistance = Math.max(10, (parsed.bounds.max.x - parsed.bounds.min.x) * 1.2);
    const keyPos = keyLightPosition(modelCenterForLight, lightDistance, keyAzimuth, keyElevation);
    keyLight.position.set(keyPos.x, keyPos.y, keyPos.z);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xaabbff, 0.35);
    fillLight.position.set(-6, -3, -5);
    scene.add(fillLight);

    const groundSize = Math.max(parsed.bounds.max.x - parsed.bounds.min.x, 10) * 1.5;
    const groundGrid = new THREE.GridHelper(groundSize, 20, 0x334455, 0x222d38);
    groundGrid.position.y = stockOffset.z - GROUND_CLEARANCE; // corrected below every time the stock is (re)built too
    scene.add(groundGrid);

    const axes = new THREE.AxesHelper(Math.max(2, (parsed.bounds.max.x - parsed.bounds.min.x) * 0.15));
    scene.add(axes);

    const centerX = (parsed.bounds.min.x + parsed.bounds.max.x) / 2;
    const centerY = (parsed.bounds.min.y + parsed.bounds.max.y) / 2;
    const centerZ = (parsed.bounds.min.z + parsed.bounds.max.z) / 2;
    const spread = Math.max(1, parsed.bounds.max.x - parsed.bounds.min.x) * 1.6 + 20;
    camera.position.set(centerX + spread * 0.4, centerY + spread * 0.5, centerZ + spread * 0.6);
    camera.lookAt(centerX, centerY, centerZ);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(centerX, centerY, centerZ);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.update();

    // A small cone+shaft standing in for the tool tip, moved along the path.
    const toolGroup = new THREE.Group();
    const toolMaterial = new THREE.MeshStandardMaterial({ color: "#ffb020", emissive: "#553300", roughness: 0.4 });
    const toolTip = new THREE.Mesh(new THREE.ConeGeometry(toolDiameter / 2, toolDiameter / 2, 12), toolMaterial);
    toolTip.position.y = 4;
    toolGroup.add(toolTip);
    const toolShaft = new THREE.Mesh(new THREE.CylinderGeometry(toolDiameter / 2, toolDiameter / 2, 1, 12), toolMaterial);
    toolShaft.position.y = -0.5;
    toolGroup.add(toolShaft);
    scene.add(toolGroup);

    const feedPoints = [], rapidPoints = [];
    motionMoves.forEach((move) => {
      const path = move.isArc && move.points ? move.points : [move.from, move.to];
      const bucket = move.type === "rapid" ? rapidPoints : feedPoints;
      for (let i = 0; i < path.length - 1; i++) {
        bucket.push(toScene(path[i]), toScene(path[i + 1]));
      }
    });
    const makeLines = (points, color, opacity) => {
      if (points.length === 0) return null;
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      const lines = new THREE.LineSegments(geo, mat);
      scene.add(lines);
      return lines;
    };
    const feedLines = makeLines(feedPoints, "#4ade80", 0.55);
    const rapidLines = makeLines(rapidPoints, "#f87171", 0.35);
    if (rapidLines) rapidLines.visible = showRapids;

    let rafId = null;
    const animate = () => { rafId = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
    animate();

    const handleResize = () => {
      const w = el.clientWidth || 600, h = el.clientHeight || 500;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);
    const ro = new ResizeObserver(handleResize);
    ro.observe(el);

    sceneRef.current = {
      scene, camera, renderer, controls, toolGroup, groundGrid, feedLines, rapidLines,
      ambientLight, keyLight, fillLight,
      stockMesh: null, pristineBrushGeo: null, bakedBrushGeo: null,
    };

    return () => {
      window.removeEventListener("resize", handleResize);
      ro.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      controls.dispose();
      renderer.dispose();
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
      });
      el.innerHTML = "";
      sceneRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(parsed.bounds), toolDiameter]);

  // --- (re)build the pristine, uncut stock block whenever its real size/position changes ---
  useEffect(() => {
    const st = sceneRef.current;
    if (!st.scene) return;
    setIsBuilding(true);
    setBuildError(null);
    setCarveError(null);
    bakedProgressRef.current = 0;
    if (st.stockMesh) {
      st.scene.remove(st.stockMesh);
      st.stockMesh.geometry.dispose();
      st.stockMesh.material.dispose();
    }
    const timer = setTimeout(() => {
      try {
        const geo = new THREE.BoxGeometry(stockSize.x, stockSize.z, stockSize.y);
        const material = new THREE.MeshStandardMaterial({ color: materialColor, roughness: 0.75, metalness: 0.05 });
        const centerX = stockOffset.x + stockSize.x / 2;
        const centerY = stockOffset.z + stockSize.z / 2;
        const centerZ = -(stockOffset.y + stockSize.y / 2);
        const mesh = new THREE.Mesh(geo, material);
        mesh.position.set(centerX, centerY, centerZ);
        st.scene.add(mesh);
        st.stockMesh = mesh;

        const pristine = geo.clone();
        pristine.translate(centerX, centerY, centerZ);
        st.pristineBrushGeo = pristine;
        st.bakedBrushGeo = pristine;

        if (st.groundGrid) st.groundGrid.position.y = stockOffset.z - GROUND_CLEARANCE;
        setIsBuilding(false);
      } catch (err) {
        setBuildError(err && err.message ? err.message : String(err));
        setIsBuilding(false);
      }
    }, 10);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockSize.x, stockSize.y, stockSize.z, stockOffset.x, stockOffset.y, stockOffset.z, materialColor]);

  // --- move the tool cursor along the path ---
  useEffect(() => {
    const st = sceneRef.current;
    if (!st.toolGroup) return;
    const p = pointAtProgress(motionMoves, progress);
    const scenePt = toScene(p);
    st.toolGroup.position.set(scenePt.x, scenePt.y + 4.5, scenePt.z);
  }, [progress, motionMoves]);

  // --- show/hide rapid travel lines ---
  useEffect(() => {
    const st = sceneRef.current;
    if (st.rapidLines) st.rapidLines.visible = showRapids;
  }, [showRapids]);

  // --- live lighting adjustments (intensity + key light angle) ---
  useEffect(() => {
    const st = sceneRef.current;
    if (!st.ambientLight || !st.keyLight) return;
    st.ambientLight.intensity = ambientIntensity;
    st.keyLight.intensity = keyIntensity;
    const center = {
      x: (parsed.bounds.min.x + parsed.bounds.max.x) / 2,
      y: (parsed.bounds.min.z + parsed.bounds.max.z) / 2,
      z: -(parsed.bounds.min.y + parsed.bounds.max.y) / 2,
    };
    const distance = Math.max(10, (parsed.bounds.max.x - parsed.bounds.min.x) * 1.2);
    const pos = keyLightPosition(center, distance, keyAzimuth, keyElevation);
    st.keyLight.position.set(pos.x, pos.y, pos.z);
  }, [ambientIntensity, keyIntensity, keyAzimuth, keyElevation, parsed]);

  // --- progressively carve the stock as playback/scrubbing advances ---
  //
  // This deliberately does NOT debounce by cancelling a pending timer on
  // every progress change (an earlier version did, via the effect's own
  // cleanup function) — during continuous playback or a fast drag, progress
  // changes every animation frame (~16ms), which is faster than any
  // reasonable debounce delay, so a naive debounce-with-cancel never
  // actually gets to run: every pending carve gets cancelled by the next
  // one before it fires, and nothing ever visibly cuts until the user stops
  // moving entirely. Instead, the latest requested progress is tracked in a
  // ref, and a small loop keeps working through it — never more than one
  // carve step in flight at a time, but always guaranteed to eventually
  // catch up to wherever the user currently is, including mid-flight.
  const targetProgressRef = useRef(0);
  const carveBusyRef = useRef(false);
  const isBuildingRef = useRef(isBuilding);
  useEffect(() => { isBuildingRef.current = isBuilding; }, [isBuilding]);

  const runCarveStep = useCallback(() => {
    const st = sceneRef.current;
    if (!st.scene || !st.stockMesh || isBuildingRef.current) { carveBusyRef.current = false; return; }
    const targetProgress = targetProgressRef.current;
    if (Math.abs(targetProgress - bakedProgressRef.current) < 1e-9 && targetProgress !== 0) {
      carveBusyRef.current = false;
      setIsCarving(false);
      return;
    }
    try {
      const rewinding = targetProgress < bakedProgressRef.current;
      const fromIdx = rewinding ? 0 : Math.floor(bakedProgressRef.current * motionMoves.length);
      const toIdx = Math.floor(targetProgress * motionMoves.length);
      const baseGeometry = rewinding ? st.pristineBrushGeo : st.bakedBrushGeo;

      const cutSegments = targetProgress <= 0
        ? []
        : motionMoves.slice(fromIdx, toIdx + 1).filter((s) => s.type === "feed");

      let resultGeometry = baseGeometry;
      if (cutSegments.length > 0) {
        const sweeps = [];
        cutSegments.forEach((seg) => {
          const path = seg.isArc && seg.points ? seg.points : [seg.from, seg.to];
          for (let i = 0; i < path.length - 1; i++) {
            const sweep = buildToolSweepGeometry(path[i], path[i + 1], toolDiameter);
            if (sweep) sweeps.push(sweep);
          }
        });
        if (sweeps.length > 0) {
          const mergedTool = mergeGeometries(sweeps, false);
          const evaluator = new Evaluator();
          evaluator.useGroups = false;
          const stockBrush = new Brush(baseGeometry); stockBrush.updateMatrixWorld();
          const toolBrush = new Brush(mergedTool); toolBrush.updateMatrixWorld();
          const result = evaluator.evaluate(stockBrush, toolBrush, SUBTRACTION);
          result.geometry.computeVertexNormals();
          resultGeometry = result.geometry;
        }
      } else if (rewinding) {
        resultGeometry = st.pristineBrushGeo;
      }

      if (resultGeometry !== st.stockMesh.geometry) {
        const material = st.stockMesh.material;
        st.scene.remove(st.stockMesh);
        st.stockMesh.geometry.dispose();
        const mesh = new THREE.Mesh(resultGeometry, material);
        st.scene.add(mesh);
        st.stockMesh = mesh;
        st.bakedBrushGeo = resultGeometry;
      }
      bakedProgressRef.current = targetProgress;
      setCarveError(null);
    } catch (err) {
      console.error("[Viewer3D] Carving step failed, showing last good shape:", err);
      setCarveError(err && err.message ? err.message : String(err));
    } finally {
      // If the requested progress moved again while this step was running
      // (very likely during smooth playback), immediately continue instead
      // of stopping — this is what guarantees the carve always catches up
      // rather than silently going stale.
      if (Math.abs(targetProgressRef.current - bakedProgressRef.current) > 1e-9) {
        setTimeout(runCarveStep, 0);
      } else {
        carveBusyRef.current = false;
        setIsCarving(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionMoves, toolDiameter]);

  useEffect(() => {
    targetProgressRef.current = Math.min(1, Math.max(0, progress));
    if (carveBusyRef.current) return; // already working; it will pick up this new target when it loops
    if (!sceneRef.current.scene || !sceneRef.current.stockMesh || isBuilding) return;
    if (Math.abs(targetProgressRef.current - bakedProgressRef.current) < 1e-9 && targetProgressRef.current !== 0) return;
    carveBusyRef.current = true;
    setIsCarving(true);
    setTimeout(runCarveStep, 0);
  }, [progress, isBuilding, runCarveStep]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />
      {isBuilding && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,14,18,0.7)", pointerEvents: "none" }}>
          <div style={{ color: "#dfe8ef", fontSize: 13 }}>Building stock…</div>
        </div>
      )}
      {!isBuilding && isCarving && !carveError && (
        <div style={{ position: "absolute", left: 10, bottom: 10, color: "#9ad1a0", fontSize: 11, background: "rgba(10,14,18,0.6)", padding: "3px 8px", borderRadius: 4, pointerEvents: "none" }}>
          carving…
        </div>
      )}
      {carveError && (
        <div style={{ position: "absolute", left: 10, bottom: 10, right: 10, color: "#fca5a5", fontSize: 11, background: "rgba(30,10,10,0.85)", padding: "6px 10px", borderRadius: 4 }}>
          Couldn't cut this step, showing the shape from before it: {carveError}
        </div>
      )}
      {buildError && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,14,18,0.85)", padding: 16 }}>
          <div style={{ color: "#fca5a5", fontSize: 13, maxWidth: 380, textAlign: "center" }}>
            Couldn't render this program's material simulation: {buildError}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  2D VIEWER — flat top/front/side projections on a plain canvas.
// ═══════════════════════════════════════════════════════════════════════

function Viewer2D({ parsed, progress, view, showRapids, active }) {
  const canvasRef = useRef(null);
  const motionMoves = useMemo(() => getMotionMoves(parsed.segments), [parsed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return; // hidden tab — redraw when `active` flips true
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width, h = rect.height;

    ctx.fillStyle = "#11151a";
    ctx.fillRect(0, 0, w, h);

    const axesFor = { top: ["x", "y"], front: ["x", "z"], side: ["y", "z"] }[view];
    const [ha, va] = axesFor;
    const bounds = parsed.bounds;
    const spanH = Math.max(0.001, bounds.max[ha] - bounds.min[ha]);
    const spanV = Math.max(0.001, bounds.max[va] - bounds.min[va]);
    const margin = 30;
    const scale = Math.min((w - margin * 2) / spanH, (h - margin * 2) / spanV);
    const originX = w / 2 - ((bounds.min[ha] + bounds.max[ha]) / 2) * scale;
    const originY = h / 2 + ((bounds.min[va] + bounds.max[va]) / 2) * scale;
    const project = (p) => ({ x: originX + p[ha] * scale, y: originY - p[va] * scale });

    ctx.strokeStyle = "#1c242c";
    ctx.lineWidth = 1;
    const gridStep = Math.pow(10, Math.floor(Math.log10(Math.max(spanH, spanV) / 8)));
    for (let x = Math.floor(bounds.min[ha] / gridStep) * gridStep; x <= bounds.max[ha] + gridStep; x += gridStep) {
      const sx = originX + x * scale;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
    }
    for (let y = Math.floor(bounds.min[va] / gridStep) * gridStep; y <= bounds.max[va] + gridStep; y += gridStep) {
      const sy = originY - y * scale;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
    }

    ctx.strokeStyle = "#334455";
    ctx.lineWidth = 1.5;
    const zero = project({ x: 0, y: 0, z: 0 });
    ctx.beginPath(); ctx.moveTo(0, zero.y); ctx.lineTo(w, zero.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(zero.x, 0); ctx.lineTo(zero.x, h); ctx.stroke();

    const total = motionMoves.length;
    motionMoves.forEach((move, i) => {
      const isPast = i < progress * total;
      const path = move.isArc && move.points ? move.points : [move.from, move.to];
      if (move.type === "rapid") {
        if (!showRapids) return;
        ctx.strokeStyle = isPast ? "rgba(248,113,113,0.9)" : "rgba(248,113,113,0.25)";
        ctx.setLineDash([4, 3]);
      } else {
        ctx.strokeStyle = isPast ? "rgba(74,222,128,0.95)" : "rgba(74,222,128,0.25)";
        ctx.setLineDash([]);
      }
      ctx.lineWidth = isPast ? 2 : 1.2;
      ctx.beginPath();
      const p0 = project(path[0]);
      ctx.moveTo(p0.x, p0.y);
      for (let k = 1; k < path.length; k++) { const pk = project(path[k]); ctx.lineTo(pk.x, pk.y); }
      ctx.stroke();
    });
    ctx.setLineDash([]);

    const cursor = pointAtProgress(motionMoves, progress);
    const cp = project(cursor);
    ctx.fillStyle = "#ffb020";
    ctx.beginPath(); ctx.arc(cp.x, cp.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.stroke();

    ctx.fillStyle = "#8a97a3";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(`${view.toUpperCase()} VIEW (${ha.toUpperCase()}/${va.toUpperCase()})`, 8, 16);
  }, [parsed, progress, view, showRapids, motionMoves, active]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}

// ═══════════════════════════════════════════════════════════════════════
//  PLAYBACK CONTROLS
// ═══════════════════════════════════════════════════════════════════════

const inputStyle = { background: "#1c242c", color: "#dfe8ef", border: "1px solid #2a3540", borderRadius: 4, padding: "3px 6px" };

// A number <input> that never fights the user while they're typing. A plain
// controlled input wired straight to a numeric state (with a "|| fallback"
// on NaN) snaps back to the fallback the instant the field is briefly empty
// — e.g. selecting "4" and typing "2" passes through an empty string for a
// moment, which would otherwise force it back to the old value and eat the
// keystroke. Here the field's own displayed text is tracked separately from
// the committed number, so it always shows exactly what was typed, and only
// calls onChange once that text parses to a real number.
function NumberField({ value, onChange, step, min, width = 55, suffix }) {
  const [text, setText] = useState(String(value));
  const lastCommittedRef = useRef(value);

  useEffect(() => {
    if (value !== lastCommittedRef.current) {
      setText(String(value));
      lastCommittedRef.current = value;
    }
  }, [value]);

  const handleChange = (raw) => {
    setText(raw);
    const n = parseFloat(raw);
    if (isFinite(n)) {
      lastCommittedRef.current = n;
      onChange(n);
    }
  };

  return (
    <>
      <input type="number" step={step} min={min} value={text}
        onChange={(e) => handleChange(e.target.value)}
        style={{ ...inputStyle, width }} />
      {suffix}
    </>
  );
}

const buttonStyle = { background: "#1c242c", color: "#dfe8ef", border: "1px solid #2a3540", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontSize: 14 };

function PlaybackControls({ progress, setProgress, playing, setPlaying, speed, setSpeed, currentLine, totalMoves, currentMoveIdx }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 14px", background: "#161b21", borderTop: "1px solid #232b33" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={() => setProgress(0)} title="Rewind to start" style={buttonStyle}>⏮</button>
        <button onClick={() => setProgress((p) => Math.max(0, p - 1 / Math.max(1, totalMoves)))} title="Step back" style={buttonStyle}>⏪</button>
        <button onClick={() => setPlaying((p) => !p)} style={{ ...buttonStyle, width: 44, background: playing ? "#3a2a1a" : "#1a3a2a" }}>{playing ? "⏸" : "▶"}</button>
        <button onClick={() => setProgress((p) => Math.min(1, p + 1 / Math.max(1, totalMoves)))} title="Step forward" style={buttonStyle}>⏩</button>
        <button onClick={() => setProgress(1)} title="Jump to end" style={buttonStyle}>⏭</button>
        <input type="range" min="0" max="1" step="0.0005" value={progress}
          onChange={(e) => { setProgress(parseFloat(e.target.value)); setPlaying(false); }}
          style={{ flex: 1, margin: "0 8px" }} />
        <div style={{ fontSize: 12, color: "#8a97a3", minWidth: 90, textAlign: "right" }}>move {currentMoveIdx + 1} / {totalMoves}</div>
        <select value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))}
          style={{ background: "#1c242c", color: "#dfe8ef", border: "1px solid #2a3540", borderRadius: 6, padding: "5px 8px", fontSize: 12 }}>
          <option value="0.25">0.25×</option>
          <option value="0.5">0.5×</option>
          <option value="1">1×</option>
          <option value="2">2×</option>
          <option value="4">4×</option>
          <option value="8">8×</option>
        </select>
      </div>
      <div style={{ fontSize: 11, color: "#556170" }}>line {currentLine != null ? currentLine + 1 : "—"}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  PROGRAM LISTING
// ═══════════════════════════════════════════════════════════════════════

function ProgramList({ parsed, currentLine }) {
  const containerRef = useRef(null);
  const activeLineRef = useRef(null);

  useEffect(() => {
    if (activeLineRef.current) activeLineRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentLine]);

  const rows = useMemo(() => {
    const byLine = {};
    parsed.segments.forEach((s) => { byLine[s.lineIndex] = s; });
    return parsed.raw.split(/\r?\n/).map((text, i) => ({ i, text, seg: byLine[i] }));
  }, [parsed]);

  return (
    <div ref={containerRef} style={{ overflowY: "auto", height: "100%", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11.5, background: "#0e1216" }}>
      {rows.map(({ i, text, seg }) => {
        const isActive = i === currentLine;
        const kind = seg && seg.type;
        const color = kind === "rapid" ? "#f87171" : kind === "feed" ? "#4ade80" : kind === "dwell" ? "#facc15" : kind === "pause" ? "#c084fc" : "#556170";
        return (
          <div key={i} ref={isActive ? activeLineRef : null}
            style={{ display: "flex", gap: 8, padding: "2px 10px", background: isActive ? "#233042" : "transparent", borderLeft: isActive ? "3px solid #ffb020" : "3px solid transparent" }}>
            <span style={{ color: "#3d4854", minWidth: 34, textAlign: "right" }}>{i + 1}</span>
            <span style={{ color: kind ? color : "#4a5560", whiteSpace: "pre" }}>{text || " "}</span>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════════

function GCodeViewerPage({ initialProgram, active }) {
  const [parsed, setParsed] = useState(null);
  const [filename, setFilename] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [layout, setLayout] = useState("split"); // "3d" | "split" | "2d"
  const [view2d, setView2d] = useState("top"); // "top" | "front" | "side"
  const [showRapids, setShowRapids] = useState(true);
  const [toolDiameter, setToolDiameter] = useState(0.25);
  const [materialColor, setMaterialColor] = useState("#c9a876");
  const [realStock, setRealStock] = useState(true);
  const [stockWidthIn, setStockWidthIn] = useState(4);
  const [stockThickIn, setStockThickIn] = useState(2);
  const [ambientIntensity, setAmbientIntensity] = useState(0.6);
  const [keyIntensity, setKeyIntensity] = useState(0.9);
  const [keyAzimuth, setKeyAzimuth] = useState(40);
  const [keyElevation, setKeyElevation] = useState(55);
  const fileInputRef = useRef(null);

  const loadProgram = useCallback((text, name) => {
    try {
      const result = parseGCode(text);
      setParsed({ ...result, raw: text });
      setFilename(name || "program.gcode");
      setProgress(0);
      setPlaying(false);
    } catch (err) {
      alert("Couldn't parse this file: " + err.message);
    }
  }, []);

  const handleFile = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (e) => loadProgram(e.target.result, file.name);
    reader.readAsText(file);
  }, [loadProgram]);

  // Handoff from the calculator's CNC G-code section ("Open in G-Code
  // Viewer" button) — the program arrives as a prop now that the viewer
  // lives inside the same app, so there's no URL-length limit anymore.
  useEffect(() => {
    if (initialProgram && initialProgram.gcode) {
      loadProgram(initialProgram.gcode, initialProgram.filename || "from-flute-calculator.gcode");
    }
  }, [initialProgram, loadProgram]);

  // Handoff from the flute calculator's "Open in Viewer" button.
  useEffect(() => {
    try {
      const hash = window.location.hash;
      if (hash && hash.startsWith("#gcode=")) {
        const rest = hash.slice(7);
        const nameIdx = rest.indexOf("&name=");
        const encodedGcode = nameIdx >= 0 ? rest.slice(0, nameIdx) : rest;
        const encodedName = nameIdx >= 0 ? rest.slice(nameIdx + 6) : "";
        const gcode = decodeURIComponent(encodedGcode);
        const name = encodedName ? decodeURIComponent(encodedName) : "from-flute-calculator.gcode";
        loadProgram(gcode, name);
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    } catch (err) {
      console.warn("[G-Code Viewer] Couldn't load program from URL handoff:", err);
    }
  }, [loadProgram]);

  // Playback animation loop.
  useEffect(() => {
    if (!playing || !parsed) return;
    let raf, last = null;
    const tick = (now) => {
      if (last === null) { last = now; raf = requestAnimationFrame(tick); return; }
      const dt = Math.max(0, (now - last) / 1000);
      last = now;
      setProgress((p) => {
        const next = p + dt * speed * 0.06;
        if (next >= 1) { setPlaying(false); return 1; }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, parsed]);

  // Real stock dimensions: when "real stock size" is on, the block is
  // sized from the user's actual Width/Thickness (default 4in x 2in,
  // matching how a board is laid flat — thickness stands vertically,
  // width lies flat) instead of an incidental toolpath-shaped box. The
  // block's bottom face is what the ground plane locks onto, so the
  // block can never appear to float above or sink through the table.
  const stock = useMemo(() => {
    if (!parsed) return { size: { x: 20, y: 2, z: 2 }, offset: { x: -1, y: -1, z: -2 } };
    const K = parsed.cutBounds;
    const lengthX = Math.max(1, K.max.x - K.min.x);
    if (realStock) {
      const width = Math.max(0.25, parseFloat(stockWidthIn) || 4);
      const thickness = Math.max(0.25, parseFloat(stockThickIn) || 2);
      const centerY = (K.min.y + K.max.y) / 2;
      const topZ = Math.max(K.max.z, 0) + STOCK_MARGIN_Z;
      return {
        size: { x: lengthX + 1, y: width, z: thickness },
        offset: { x: K.min.x - 0.5, y: centerY - width / 2, z: topZ - thickness },
      };
    }
    const widthY = Math.max(0.5, K.max.y - K.min.y);
    const thickZ = Math.max(0.5, K.max.z - K.min.z);
    return {
      size: { x: lengthX + 1, y: widthY + 1, z: thickZ + 0.3 },
      offset: { x: K.min.x - 0.5, y: K.min.y - 0.5, z: K.min.z - 0.15 },
    };
  }, [parsed, realStock, stockWidthIn, stockThickIn]);

  const motionMoves = useMemo(() => (parsed ? getMotionMoves(parsed.segments) : []), [parsed]);
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const currentMoveIdx = motionMoves.length
    ? Math.min(motionMoves.length - 1, Math.max(0, Math.floor(clampedProgress * motionMoves.length)))
    : 0;
  const currentLine = motionMoves.length ? motionMoves[currentMoveIdx].lineIndex : null;

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#0e1216", color: "#dfe8ef", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 16px", background: "#161b21", borderBottom: "1px solid #232b33" }}>
        <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.2px" }}>⚙ G-Code Viewer</div>
        {parsed && (
          <div style={{ fontSize: 12, color: "#8a97a3" }}>
            {filename} · {parsed.lineCount} lines · {motionMoves.length} moves · units: {parsed.units}
          </div>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => fileInputRef.current && fileInputRef.current.click()} style={{ ...buttonStyle, padding: "7px 14px" }}>📂 Open File</button>
        <input ref={fileInputRef} type="file" accept=".gcode,.nc,.ngc,.tap,.txt" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) handleFile(f); e.target.value = ""; }} />
      </div>

      {parsed ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", background: "#12161b", borderBottom: "1px solid #1c242c", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 4 }}>
              {["3d", "split", "2d"].map((mode) => (
                <button key={mode} onClick={() => setLayout(mode)}
                  style={{ ...buttonStyle, background: layout === mode ? "#233042" : "#1c242c", padding: "5px 10px", fontSize: 11 }}>
                  {mode === "3d" ? "3D Only" : mode === "2d" ? "2D Only" : "Split View"}
                </button>
              ))}
            </div>
            {(layout === "2d" || layout === "split") && (
              <div style={{ display: "flex", gap: 4 }}>
                {["top", "front", "side"].map((v) => (
                  <button key={v} onClick={() => setView2d(v)}
                    style={{ ...buttonStyle, background: view2d === v ? "#233042" : "#1c242c", padding: "5px 10px", fontSize: 11 }}>
                    {v[0].toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#8a97a3", cursor: "pointer" }}>
              <input type="checkbox" checked={showRapids} onChange={(e) => setShowRapids(e.target.checked)} /> show rapids
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#8a97a3" }}>
              tool ⌀ <NumberField value={toolDiameter} onChange={setToolDiameter} step="0.01" min="0.001" width={55} />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#8a97a3", cursor: "pointer" }}>
              <input type="checkbox" checked={realStock} onChange={(e) => setRealStock(e.target.checked)} /> real stock size
            </label>
            {realStock && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#8a97a3" }}>
                  width <NumberField value={stockWidthIn} onChange={setStockWidthIn} step="0.125" min="0.25" width={50} suffix={'"'} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#8a97a3" }}>
                  thick <NumberField value={stockThickIn} onChange={setStockThickIn} step="0.125" min="0.25" width={50} suffix={'"'} />
                </div>
              </>
            )}
            {parsed.warnings.length > 0 && (
              <div style={{ fontSize: 11, color: "#fbbf24" }}>⚠ {parsed.warnings.length} warning{parsed.warnings.length > 1 ? "s" : ""} — see below</div>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={() => { setParsed(null); setFilename(""); }} style={{ ...buttonStyle, padding: "5px 12px", fontSize: 11 }}>✕ Close File</button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "6px 16px", background: "#12161b", borderBottom: "1px solid #1c242c", flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: "#556170", textTransform: "uppercase", letterSpacing: "0.05em" }}>Lighting</span>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#8a97a3" }}>
              ambient
              <input type="range" min="0" max="2" step="0.01" value={ambientIntensity}
                onChange={(e) => setAmbientIntensity(parseFloat(e.target.value))} style={{ width: 80 }} />
              <span style={{ color: "#556170", minWidth: 28 }}>{ambientIntensity.toFixed(2)}</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#8a97a3" }}>
              key light
              <input type="range" min="0" max="3" step="0.01" value={keyIntensity}
                onChange={(e) => setKeyIntensity(parseFloat(e.target.value))} style={{ width: 80 }} />
              <span style={{ color: "#556170", minWidth: 28 }}>{keyIntensity.toFixed(2)}</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#8a97a3" }}>
              angle
              <input type="range" min="0" max="360" step="1" value={keyAzimuth}
                onChange={(e) => setKeyAzimuth(parseFloat(e.target.value))} style={{ width: 80 }} />
              <span style={{ color: "#556170", minWidth: 28 }}>{Math.round(keyAzimuth)}°</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#8a97a3" }}>
              height
              <input type="range" min="5" max="85" step="1" value={keyElevation}
                onChange={(e) => setKeyElevation(parseFloat(e.target.value))} style={{ width: 80 }} />
              <span style={{ color: "#556170", minWidth: 28 }}>{Math.round(keyElevation)}°</span>
            </label>
          </div>

          <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
            <div style={{ flex: 1, display: "flex", minWidth: 0 }}>
              {(layout === "3d" || layout === "split") && (
                <div style={{ flex: 1, minWidth: 0, borderRight: layout === "split" ? "1px solid #1c242c" : "none" }}>
                  <Viewer3D parsed={parsed} progress={clampedProgress} toolDiameter={toolDiameter}
                    stockSize={stock.size} stockOffset={stock.offset} showRapids={showRapids} materialColor={materialColor}
                    ambientIntensity={ambientIntensity} keyIntensity={keyIntensity} keyAzimuth={keyAzimuth} keyElevation={keyElevation} />
                </div>
              )}
              {(layout === "2d" || layout === "split") && (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Viewer2D parsed={parsed} progress={clampedProgress} view={view2d} showRapids={showRapids} active={active} />
                </div>
              )}
            </div>
            <div style={{ width: 340, borderLeft: "1px solid #232b33", display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "8px 12px", fontSize: 11, color: "#8a97a3", borderBottom: "1px solid #1c242c", textTransform: "uppercase", letterSpacing: "0.05em" }}>Program</div>
              <div style={{ flex: 1, minHeight: 0 }}><ProgramList parsed={parsed} currentLine={currentLine} /></div>
              {parsed.warnings.length > 0 && (
                <div style={{ padding: "8px 12px", fontSize: 11, color: "#fbbf24", borderTop: "1px solid #1c242c", maxHeight: 100, overflowY: "auto" }}>
                  {parsed.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                </div>
              )}
            </div>
          </div>

          <PlaybackControls progress={clampedProgress} setProgress={setProgress} playing={playing} setPlaying={setPlaying}
            speed={speed} setSpeed={setSpeed} currentLine={currentLine} totalMoves={motionMoves.length} currentMoveIdx={currentMoveIdx} />
        </>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: `2px dashed ${dragOver ? "#ffb020" : "#2a3540"}`, margin: 20, borderRadius: 12, background: dragOver ? "#1a1810" : "transparent", transition: "all 0.15s" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
          <div style={{ fontSize: 15, color: "#dfe8ef", marginBottom: 6 }}>Drop a .gcode / .nc file here</div>
          <div style={{ fontSize: 12, color: "#556170" }}>or click "Open File" above</div>
        </div>
      )}
    </div>
  );
}




// ═══════════════════════════════════════════════════════════════
//  FLOW STUDIO PAGE — physics-driven wind-chamber simulator.
//  Originally merged from the standalone fluteview.html; upgraded from a
//  decorative particle demo to a real flue-instrument aeroacoustics model:
//
//    • Jet velocity from breath pressure (Bernoulli):  U = √(2·ΔP/ρ)
//    • Jet Reynolds number Re = U·h/ν  (h = flue depth) — laminar /
//      transitional / turbulent regime → clean vs breathy vs hissy tone
//    • Dimensionless jet-drive parameter θ = U/(f·l_c)  (l_c = cut-up =
//      TSH length) — the standard flue-pipe operating parameter from the
//      Verge/Fabre/Fletcher-&-Rossing literature. Fundamental regime
//      θ ≈ 5–10; below ~4 the flute won't speak; above ~12–14 it
//      overblows to the octave. Jet waves convect at ≈ 0.4·U.
//    • Cut-up ratio l_c/h — makers/literature put the sweet spot ~3.5–6.5.
//    • Chamber resonance cross-check: open-open cylinder with 0.61·a end
//      corrections → predicted fundamental vs the designed key, in cents.
//
//  On open, the tab loads the REAL dimensions of the current flute design
//  (key, bore, sound-chamber length, SAC, TSH, flue, finger holes) via a
//  module-level bridge published by FlutePage, and builds the wind chamber
//  to those dimensions. All Three.js code uses the app's bundled copy —
//  the offline-first rule holds. Reads/writes the same Nest Library
//  (naf_nest_library_v1) as the Flute Designer's Nest section.
// ═══════════════════════════════════════════════════════════════

const FLOW_PARTICLE_COUNT = 480;

// ── Flute Designer → Flow Studio design bridge ─────────────────────
// FlutePage publishes a snapshot of its live design here on every
// recompute (same in-app handoff pattern as CNC → G-Code viewer).
let FLOW_DESIGN_BRIDGE = null;
function publishFlowDesign(snap) {
  FLOW_DESIGN_BRIDGE = snap;
  try { window.dispatchEvent(new CustomEvent("naf-design-updated")); } catch (e) { /* non-browser env */ }
}
function readFlowDesign() { return FLOW_DESIGN_BRIDGE; }

// Fallback design (mid-range F#4 flute, FLUTE_CONST-consistent) so the tab
// still works if it's somehow opened before the designer ever published.
const FLOW_DEFAULT_DESIGN = {
  schema: "naf-flow-design-v1",
  keyName: "F#4", rootFreq: 369.99,
  bore: 0.75, L: 15.1, sacLen: 3.45,
  shW: 0.375, shL: 0.219, flueDepthIn: 0.047,
  rampAngleDeg: 30, fippleAngleDeg: 35,
  holeCount: 0, holes: [],
};

// ── Aeroacoustics model ────────────────────────────────────────────
const FLOW_AIR = { rho: 1.2, nu: 1.5e-5, c: 343 }; // kg/m³, m²/s, m/s (20 °C air)
const IN2M = 0.0254;

// design: inches + Hz (bridge snapshot, possibly with nest overrides applied)
// pressurePa: player breath (SAC) pressure. Typical NAF ≈ 250–600 Pa.
function computeFluteAeroacoustics(design, pressurePa) {
  const d = design || FLOW_DEFAULT_DESIGN;
  const U  = Math.sqrt(2 * Math.max(1, pressurePa) / FLOW_AIR.rho); // jet exit velocity, m/s
  const h  = Math.max(1e-5, d.flueDepthIn * IN2M);                  // flue depth, m
  const W  = Math.max(1e-4, d.shW * IN2M);                          // flue/TSH width, m
  const lc = Math.max(1e-4, d.shL * IN2M);                          // cut-up (TSH length), m
  const Q  = U * h * W;                                             // volume flow, m³/s
  const Re = U * h / FLOW_AIR.nu;                                   // jet Reynolds number
  const f0 = d.rootFreq > 0 ? d.rootFreq : 370;

  // Dimensionless jet velocity θ = U/(f·l_c) — flue-pipe drive parameter.
  const theta = U / (f0 * lc);

  // Highest note: opening finger holes shortens the effective column to
  // roughly the TSH→first-open-hole distance, so f_top ≈ f0 · L/minFromTSH.
  let fTop = f0, thetaTop = theta;
  if (d.holes && d.holes.length && d.L > 0) {
    const fromTSHs = d.holes.map(x => x.fromTSH).filter(v => isFinite(v) && v > 0.5);
    if (fromTSHs.length) {
      const minFromTSH = Math.min(...fromTSHs);
      fTop = f0 * (d.L / minFromTSH);
      thetaTop = U / (fTop * lc);
    }
  }

  const cutupRatio = d.shL / Math.max(d.flueDepthIn, 1e-6); // l_c / h

  // Open-open cylinder resonance with unflanged end corrections (0.61·a
  // per end) — a cross-check of chamber length vs the designed key. The
  // designer's own tubeLen() already targets the key, so this mostly
  // reports how the classic textbook formula sees the same geometry.
  const a  = (d.bore / 2) * IN2M;
  const Lm = Math.max(0.01, d.L * IN2M);
  const f1pred = FLOW_AIR.c / (2 * (Lm + 2 * 0.61 * a));
  const cents  = 1200 * Math.log2(f1pred / f0);

  const jetRegime =
    theta < 3  ? { label: "Won't speak — underblown",  tone: "bad"  } :
    theta < 5  ? { label: "Weak / airy",               tone: "warn" } :
    theta <= 10 ? { label: "Optimal fundamental",      tone: "good" } :
    theta <= 14 ? { label: "Edgy — overblow risk",     tone: "warn" } :
                  { label: "Overblows to octave",      tone: "bad"  };
  const flowRegime =
    Re < 500   ? { label: "Very low — weak drive",             tone: "warn" } :
    Re <= 1200 ? { label: "Laminar — clean, pure tone",        tone: "good" } :
    Re <= 3000 ? { label: "Transitional — breathy warmth",     tone: "warn" } :
                 { label: "Turbulent — hissy",                 tone: "bad"  };

  return {
    U, Q, QLpm: Q * 60000, Re, theta, thetaTop, f0, fTop,
    cutupRatio, f1pred, cents, hM: h, lcM: lc,
    jetRegime, flowRegime,
  };
}

function scoreFlowQuality(m) {
  // 100 inside [lo,hi], linear falloff to 0 at [lo0,hi0].
  const band = (x, lo0, lo, hi, hi0) =>
    (x <= lo0 || x >= hi0) ? 0 : x < lo ? 100 * (x - lo0) / (lo - lo0)
    : x > hi ? 100 * (hi0 - x) / (hi0 - hi) : 100;

  const driveRoot = band(m.theta,    2, 5, 10, 16);
  const driveTop  = band(m.thetaTop, 2, 5, 10, 16);
  const turb      = m.Re <= 1400 ? 100 : m.Re >= 3800 ? 0 : 100 * (3800 - m.Re) / (3800 - 1400);
  const strength  = m.Re >= 500 ? 100 : Math.max(0, (100 * m.Re) / 500);
  const breath    = Math.min(turb, strength);
  const cutup     = band(m.cutupRatio, 1.5, 3.5, 6.5, 10);
  const tuning    = Math.max(0, 100 - Math.abs(m.cents) * 0.8);

  const total = Math.round(
    0.30 * driveRoot + 0.15 * driveTop + 0.25 * breath + 0.20 * cutup + 0.10 * tuning
  );
  return {
    total: Math.max(0, Math.min(100, total)),
    parts: [
      { key: "Jet drive — root note", val: Math.round(driveRoot), w: 30 },
      { key: "Jet drive — top note",  val: Math.round(driveTop),  w: 15 },
      { key: "Breath / turbulence",   val: Math.round(breath),    w: 25 },
      { key: "Cut-up geometry",       val: Math.round(cutup),     w: 20 },
      { key: "Chamber tuning",        val: Math.round(tuning),    w: 10 },
    ],
  };
}

// Physics-driven nest optimizer: for this key + breath pressure, put the
// jet-drive parameter mid-optimal (θ = 7) and the flue in the clean-laminar
// Reynolds band, then nudge to keep the cut-up ratio inside 3.5–6.5.
function optimizeNestForDesign(design, pressurePa) {
  const U  = Math.sqrt(2 * Math.max(1, pressurePa) / FLOW_AIR.rho);
  const f0 = design.rootFreq > 0 ? design.rootFreq : 370;
  let shL = Math.max(0.15, Math.min((U / (7 * f0)) / IN2M, 0.5));       // θ = 7
  let flue = Math.max(0.02, Math.min((950 * FLOW_AIR.nu / U) / IN2M, 0.09)); // Re ≈ 950
  const ratio = shL / flue;
  if (ratio > 6.5) flue = shL / 6.5;
  else if (ratio < 3.5) flue = shL / 3.5;
  flue = Math.max(0.02, Math.min(flue, 0.09));
  return { rampAngleDeg: 30, fippleAngleDeg: 35, shL, flueDepthIn: flue };
}

// Inverse of the θ condition: the breath pressure that puts θ = 7 for the
// CURRENT cut-up. P = ρ/2 · (7·f·l_c)²
function bestPressureForNest(design) {
  const f0 = design.rootFreq > 0 ? design.rootFreq : 370;
  const U  = 7 * f0 * Math.max(1e-4, design.shL * IN2M);
  return Math.round(Math.max(80, Math.min((FLOW_AIR.rho / 2) * U * U, 2000)));
}

// ── 3D wind-chamber viewer ─────────────────────────────────────────
class FlowStudioViewer {
  // container: DOM element to render into
  // getState: () => { design, params:{rampAngle,flueDepthMm,tshLengthMm,fippleAngle},
  //                   physics, pressurePa, timeScale }
  // labelEls: { ramp, flue, tsh, fipple } floating dimension labels
  constructor(container, getState, labelEls) {
    this.container = container;
    this.getState = getState;
    this.labelEls = labelEls;
    this.trackingPoints = { ramp: null, flue: null, tsh: null, fipple: null };
    this.particleSystem = null;
    this.disposed = false;
    this.layout = null;
    this.clock = new THREE.Clock();
    try { window.__flowViewer = this; } catch (e) { /* debug handle only */ }
    this.initEngine();
    this.buildChamber();
    this.initParticleFlow();
    this.frame("nest");
    this.onResize = this.onResize.bind(this);
    window.addEventListener("resize", this.onResize);
    this.ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(this.onResize) : null;
    if (this.ro) this.ro.observe(container);
    this.animate();
  }

  initEngine() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#030712");

    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 4000);
    this.camera.position.set(20, 18, 90);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI * 0.55;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const spot = new THREE.SpotLight(0xffffff, 15, 600, Math.PI / 5, 0.4, 1.0);
    spot.position.set(30, 60, 70);
    spot.castShadow = true;
    spot.shadow.mapSize.set(2048, 2048);
    this.scene.add(spot);
    const fill = new THREE.DirectionalLight(0xffffff, 0.55);
    fill.position.set(-25, 15, 30);
    this.scene.add(fill);
  }

  // Cutaway profile built from the REAL design dimensions (all mm), following
  // Mike Prairie's "Many Dimensions of the NAF" cross-section:
  // x = 0 at the flue exit (TSH window start), air flows left → right.
  //   SAC (own ceiling, stopping one TSH-length before the bird = the exit
  //   opening) → UP the ramp (the sloped upstream face of the BLOCK, rising
  //   at the ramp angle to the block top, flush at the bird's leading edge) →
  //   flue (carved flue-depth down into the block top, under the fixed bird
  //   underside) → TSH window → cutting edge just below jet level → bore.
  computeLayout() {
    const { design, params } = this.getState();
    const B    = Math.max(6, design.bore * 25.4);            // bore height
    const sacL = Math.max(20, design.sacLen * 25.4);         // SAC interior length
    const Lmm  = Math.max(40, design.L * 25.4);              // sound-chamber length
    const T    = Math.max(3, Math.min(6, B * 0.20));         // wall thickness
    const h    = Math.max(0.3, params.flueDepthMm);          // flue depth
    const lc   = Math.max(2, params.tshLengthMm);            // cut-up / TSH length
    const Wd   = Math.max(4, design.shW * 25.4);             // flue/TSH width (extrusion depth)
    const flueLen = Math.max(8, design.shW * 2 * 25.4);      // flat flue length = 2 × width (Prairie)
    const rampRad = Math.max(0.1, params.rampAngle * Math.PI / 180);
    // vertical bands: y = 0 is the body's outer surface — the SAC ceiling's
    // top face, the bore wall's top face, and the bird's (fixed) underside,
    // which is the flue ROOF.
    const yFloorTop = 0, yWallBot = -T, yBoreBot = -T - B, yBotWall = -T - B - T;
    // The flue is carved DOWN into the BLOCK (the plug the ramp climbs): the
    // block's base is constrained at the bore floor, and its TOP — the flue
    // floor — drops as the flue deepens. The bird above never moves.
    const yFlueFloor = -h;                                   // block top (flue floor)
    const birdTop = Math.max(8, T + 5);                      // bird: underside 0, fixed height
    // Ramp: ascends the SAC depth to the block top at the ramp angle —
    // "the 2 x flue width measurement is the starting point of the ramp".
    const rampTopX  = -flueLen;                              // flush at the bird's leading edge
    const rampRun   = (yFlueFloor - yBoreBot) / Math.tan(rampRad);
    const rampStartX = rampTopX - rampRun;                   // ramp base (SAC side)
    const exitX0 = rampTopX - lc;                            // SAC ceiling stops one TSH-length
                                                             // before the bird (the exit opening)
    const sacX0 = rampStartX - sacL;                         // SAC interior left end
    const boreX0 = lc;                                       // bore starts at the cutting edge
    const footX = lc + Lmm;
    return { B, sacL, Lmm, T, h, lc, Wd, flueLen, rampRad, rampRun,
             rampStartX, rampTopX, exitX0, sacX0, boreX0, footX,
             yFloorTop, yFlueFloor, yWallBot, yBoreBot, yBotWall, birdTop };
  }

  buildChamber() {
    const { design, params } = this.getState();
    const L = this.computeLayout();
    this.layout = L;

    if (this.meshGroup) {
      this.scene.remove(this.meshGroup);
      this.meshGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this.meshGroup = new THREE.Group();

    const wood = new THREE.MeshStandardMaterial({ color: 0x9a3412, roughness: 0.65, metalness: 0.05, side: THREE.DoubleSide });
    const woodDim = new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide });
    const extrude = { depth: L.Wd, bevelEnabled: false };
    const addShape = (pts, mat) => {
      const s = new THREE.Shape();
      s.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
      const g = new THREE.ExtrudeGeometry(s, extrude);
      // put the solid BEHIND the particle plane (particles live at z ≈ 0..+2)
      g.translate(0, 0, -L.Wd - 0.6);
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true; m.receiveShadow = true;
      this.meshGroup.add(m);
      return m;
    };
    const box = (x0, x1, y0, y1, mat) => addShape([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], mat);

    // Bottom wall — full length hull floor.
    box(L.sacX0 - L.T, L.footX + L.T, L.yBotWall, L.yBoreBot, woodDim);
    // SAC left end kept OPEN (mouth end — this is where breath enters).

    // BLOCK with its RAMP face: base constrained at the bore floor, top at
    // the flue floor — the flue is carved down into the block, so a deeper
    // flue lowers the block's top. Air climbs the sloped upstream face
    // ("smooth transitions") into the flue.
    addShape([
      [L.rampStartX, L.yBoreBot],
      [L.rampTopX, L.yFlueFloor],
      [0, L.yFlueFloor],
      [0, L.yBoreBot],
    ], wood);
    this.trackingPoints.ramp = new THREE.Vector3(
      L.rampStartX + L.rampRun * 0.5, (L.yBoreBot + L.yFlueFloor) / 2 + 1.5, 0);
    this.trackingPoints.flue = new THREE.Vector3(-L.flueLen / 2, L.yFlueFloor + L.h / 2 + 0.3, 0);

    // SAC ceiling (top wall): stops one TSH-length before the bird — the
    // gap between ceiling end and bird leading edge is the SAC exit opening.
    box(L.sacX0 - L.T, L.exitX0, L.yWallBot, L.yFloorTop, wood);

    // Bird: sits on the body's outer surface (underside fixed at y = 0 = the
    // flue roof). Right edge constrained at the TSH opening; the body extends
    // left PAST the ramp to cover the exit opening, overlapping slightly
    // onto the SAC ceiling — air climbs the ramp underneath it into the flue.
    box(L.exitX0 - 3, 0, L.yFloorTop, L.birdTop, woodDim);

    // TSH window: open span x ∈ [0, lc]. Cutting edge: the sharp tip sits
    // just below jet level, with the fipple-angle bevel dropping from the
    // tip into the bore-side wall and a gentle ~15° outside relief above
    // (Prairie's cutting-edge detail).
    const fippleRad = Math.max(0.15, params.fippleAngle * Math.PI / 180);
    const tipY = Math.max(
      L.yFlueFloor - Math.min(1.0, Math.max(0.4, L.h * 0.7)),
      L.yWallBot + 0.5
    );
    const bevRun = Math.max(0.2, (tipY - L.yWallBot) / Math.tan(fippleRad)); // fipple bevel (slider-driven)
    const topRun = (L.yFloorTop - tipY) / Math.tan(15 * Math.PI / 180);      // fixed outer relief
    const noseEnd = L.lc + Math.max(bevRun, topRun) + 1;
    addShape([
      [L.lc, tipY],
      [L.lc + bevRun, L.yWallBot],
      [noseEnd, L.yWallBot],
      [noseEnd, L.yFloorTop],
      [L.lc + topRun, L.yFloorTop],
    ], wood);
    this.trackingPoints.tsh = new THREE.Vector3(L.lc / 2, L.yFlueFloor - 1.2, 0);
    this.trackingPoints.fipple = new THREE.Vector3(L.lc + 0.8, tipY - 1.0, 0);

    // Bore top wall from the cutting-edge nose to the foot, with REAL
    // finger-hole gaps (position fromTSH, real diameters) from the design.
    const gaps = (design.holes || [])
      .map(hh => ({ c: L.boreX0 + hh.fromTSH * 25.4, r: Math.max(1.2, (hh.diameter * 25.4) / 2) }))
      .filter(g => isFinite(g.c) && g.c > noseEnd + 3 && g.c < L.footX - 3)
      .sort((a, b) => a.c - b.c);
    let segX = noseEnd;
    for (const g of gaps) {
      if (g.c - g.r > segX + 0.5) box(segX, g.c - g.r, L.yWallBot, L.yFloorTop, wood);
      segX = g.c + g.r;
    }
    if (L.footX > segX + 0.5) box(segX, L.footX, L.yWallBot, L.yFloorTop, wood);
    this.holeGaps = gaps;

    this.scene.add(this.meshGroup);
  }

  rebuild() { this.buildChamber(); }

  // Camera framing: "nest" = close-up on ramp→flue→TSH; "flute" = whole chamber.
  frame(mode) {
    const L = this.layout || this.computeLayout();
    if (mode === "flute") {
      const cx = (L.sacX0 + L.footX) / 2;
      const span = L.footX - L.sacX0;
      this.controls.target.set(cx, -L.T - L.B / 2, 0);
      this.camera.position.set(cx + span * 0.05, span * 0.28, span * 0.75);
    } else {
      const cx = (L.rampStartX + L.lc) / 2;
      const span = Math.max(50, (L.lc - L.rampStartX) * 1.6);
      this.controls.target.set(cx, -L.T, 0);
      this.camera.position.set(cx + span * 0.15, span * 0.35, span * 1.1);
    }
    this.controls.update();
  }

  // Soft radial sprite shared by both particle styles.
  makeSpriteTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  initParticleFlow() {
    const st = this.getState();
    this.count = Math.max(50, st.particleCount || FLOW_PARTICLE_COUNT);
    this.smoke = !!st.smokeMode;
    if (!this.spriteTex) this.spriteTex = this.makeSpriteTexture();
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.count * 3);
    const colors = new Float32Array(this.count * 3);
    const data = new Float32Array(this.count * 4);
    for (let i = 0; i < this.count; i++) {
      data[i * 4] = Math.random();                       // path progress 0..1
      data[i * 4 + 1] = Math.random() * 2;               // z offset (in front of cutaway)
      data[i * 4 + 2] = Math.random() * Math.PI * 2;     // seed
      data[i * 4 + 3] = Math.random();                   // lane 0..1 (position across flue depth)
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      map: this.spriteTex, vertexColors: true, transparent: true, depthWrite: false,
    });
    this.particleSystem = new THREE.Points(geometry, material);
    this.applyParticleStyle();
    this.scene.add(this.particleSystem);
    this.particleData = data;
  }

  // Bright additive tracer points vs soft translucent smoke.
  applyParticleStyle() {
    if (!this.particleSystem) return;
    const m = this.particleSystem.material;
    if (this.smoke) {
      m.size = 2.6;
      m.opacity = 0.28;
      m.blending = THREE.NormalBlending;
    } else {
      m.size = 0.8;
      m.opacity = 0.9;
      m.blending = THREE.AdditiveBlending;
    }
    m.needsUpdate = true;
  }

  setParticleCount(n) {
    n = Math.max(50, Math.round(n || FLOW_PARTICLE_COUNT));
    if (this.particleSystem && n === this.count) return;
    if (this.particleSystem) {
      this.scene.remove(this.particleSystem);
      this.particleSystem.geometry.dispose();
      this.particleSystem.material.dispose();
      this.particleSystem = null;
    }
    this.initParticleFlow();
  }

  setSmokeMode(on) {
    this.smoke = !!on;
    this.applyParticleStyle();
  }

  // Physics-driven particle update. Real quantities → visual motion:
  //   • speed ∝ jet velocity U, slowed by the user's slow-motion factor
  //   • jet convects across the window at 0.4·U (jet-wave convection speed)
  //   • jet flaps at the ROOT NOTE frequency f0 (slowed by the same factor),
  //     with amplitude growing exponentially toward the labium (jet
  //     instability) and splitting alternately inside/outside at the edge
  //   • turbulence jitter scales with the actual Reynolds number
  updateAirflowSimulation(dt) {
    if (!this.particleSystem || !this.layout) return;
    const { physics, timeScale } = this.getState();
    const L = this.layout;
    const t = performance.now() / 1000;

    const positions = this.particleSystem.geometry.attributes.position.array;
    const colors = this.particleSystem.geometry.attributes.color.array;

    const vis = Math.max(2, (physics.U * 1000) / Math.max(1, timeScale)); // mm/s on screen
    const fVis = physics.f0 / Math.max(1, timeScale);                     // visible flap rate, Hz
    const turb = physics.Re <= 800 ? 0 : Math.min(1.4, (physics.Re - 800) / 1800);

    // Path stations (x, entering from the SAC mouth):
    const x0 = L.sacX0;             // spawn
    const x1 = L.rampStartX;        // SAC → ramp base
    const x2 = L.rampTopX;          // ramp top (flush at the block) → flue
    const x3 = 0;                   // flue exit = jet start
    const x4 = L.lc;                // cutting edge
    const boreRun = Math.min(L.Lmm, Math.max(60, L.lc * 8)); // shown bore travel
    const x5 = L.lc + boreRun;      // recycle point inside bore
    const total = (x1 - x0) + (x2 - x1) + (x3 - x2) + (x4 - x3) + (x5 - x4);

    // Per-station speed as a fraction of the flue speed (continuity: the SAC
    // is huge so flow there crawls; the flue is the choke point; the free jet
    // convects at 0.4·U; air spreads again inside the bore).
    const spd = (x) =>
      x < x1 ? 0.12 : x < x2 ? 0.5 : x < x3 ? 1.0 : x < x4 ? 0.4 : 0.25;

    const q = this.getStateQuality();

    for (let i = 0; i < this.count; i++) {
      let prog = this.particleData[i * 4];
      const zOff = this.particleData[i * 4 + 1];
      const seed = this.particleData[i * 4 + 2];
      const lane = this.particleData[i * 4 + 3];

      let x = x0 + prog * total;
      const v = vis * spd(x);
      prog += (v * dt) / total;
      if (prog >= 1) { prog = Math.random() * 0.06; x = x0 + prog * total; }
      this.particleData[i * 4] = prog;
      x = x0 + prog * total;

      let y, quality = q.base;
      const jetMid = L.yFlueFloor + L.h / 2; // jet spans flue floor → roof (y=0)

      if (x < x1) {
        // SAC interior — slow drift filling the chamber under its ceiling
        y = L.yBoreBot + 1 + lane * (L.B - 2) + Math.sin(t * 0.7 + seed) * 1.2;
        y = Math.min(y, L.yWallBot - 0.4);
        quality = Math.min(1, q.base + 0.1);
      } else if (x < x2) {
        // climbing the ramp — converge from the SAC band onto the jet band,
        // rising through the exit opening into the flue entrance
        const p = (x - x1) / Math.max(1e-3, x2 - x1);
        const rampSurfY = L.yBoreBot + (L.yFlueFloor - L.yBoreBot) * p; // the ramp face itself
        const yStart = L.yBoreBot + 1 + lane * (L.B - 2);
        const gap = Math.max(0.3, (1 - p) * 0.5 * (yStart - L.yBoreBot) + p * (0.15 + 0.7 * lane) * L.h);
        y = Math.min(rampSurfY + gap, L.yFloorTop - 0.15); // stay under the flue roof
      } else if (x < x3) {
        // flue channel — laminar core vs shear layers at the walls
        const lanePos = L.yFlueFloor + 0.15 * L.h + lane * 0.7 * L.h;
        const shear = Math.min(lane, 1 - lane) < 0.18 ? 1 : 0;
        y = lanePos + shear * Math.sin(t * 30 + seed * 9) * turb * 0.25 * L.h;
        quality = Math.max(0.15, q.base - shear * turb * 0.45);
      } else if (x < x4) {
        // free jet across the TSH — flapping at f0, instability growth
        const xi = (x - x3) / Math.max(1e-3, L.lc);
        const amp = Math.min(L.h * 2.6, 0.28 * L.h * Math.exp(2.3 * xi));
        const wave = Math.sin(2 * Math.PI * fVis * t - xi * 2.4);
        const jitter = turb * xi * (Math.sin(t * 41 + seed * 13) + Math.sin(t * 67 + seed * 7)) * 0.35;
        y = jetMid + (lane - 0.5) * 0.5 * L.h + amp * wave + jitter;
        quality = Math.max(0.15, q.base - turb * xi * 0.4);
      } else {
        // past the labium: split by flap phase — inside drives the resonator
        const past = x - x4;
        const phaseAtLabium = Math.sin(2 * Math.PI * fVis * t - 2.4 + seed * 0.15);
        if (phaseAtLabium < 0 || seed % 1 < 0.35) {
          // into the bore — settle toward mid-bore, travel toward the foot
          const settle = Math.min(1, past / (L.B * 1.2));
          y = jetMid + settle * ((L.yWallBot - L.B / 2) - jetMid) + Math.sin(t * 3 + seed) * 1.2;
        } else {
          // sheds outside — rises away above the window
          y = jetMid + past * 0.55 + Math.sin(t * 5 + seed) * 0.6 * (1 + turb);
          quality = Math.max(0.2, q.base - 0.25);
        }
      }

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = zOff;

      if (this.smoke) {
        // smoke: soft grey-white, gently tinted by local quality
        const g = 0.55 + 0.35 * quality;
        colors[i*3] = g * 0.96; colors[i*3+1] = g; colors[i*3+2] = g * 1.05;
      } else if (quality > 0.72) { colors[i*3] = 0.1;  colors[i*3+1] = 0.9;  colors[i*3+2] = 0.3;  }
      else if (quality > 0.45) { colors[i*3] = 0.95; colors[i*3+1] = 0.7;  colors[i*3+2] = 0.1;  }
      else { colors[i*3] = 0.95; colors[i*3+1] = 0.2;  colors[i*3+2] = 0.15; }
    }

    this.particleSystem.geometry.attributes.position.needsUpdate = true;
    this.particleSystem.geometry.attributes.color.needsUpdate = true;
  }

  // Base particle quality from the actual composite score (0..1).
  getStateQuality() {
    const { score } = this.getState();
    const s = score && isFinite(score.total) ? score.total : 60;
    return { base: 0.25 + 0.65 * (s / 100) };
  }

  updateScreenSpaceLabels() {
    if (!this.trackingPoints.ramp || !this.meshGroup) return;
    const { params } = this.getState();
    const widthHalf = this.container.clientWidth / 2;
    const heightHalf = this.container.clientHeight / 2;
    const labels = [
      { el: this.labelEls.ramp,   pos: this.trackingPoints.ramp,   text: `Ramp: ${params.rampAngle}\u00B0` },
      { el: this.labelEls.flue,   pos: this.trackingPoints.flue,   text: `Flue: ${params.flueDepthMm.toFixed(1)}mm` },
      { el: this.labelEls.tsh,    pos: this.trackingPoints.tsh,    text: `TSH: ${params.tshLengthMm.toFixed(1)}mm` },
      { el: this.labelEls.fipple, pos: this.trackingPoints.fipple, text: `Fipple: ${params.fippleAngle}\u00B0` },
    ];
    for (const { el, pos, text } of labels) {
      if (!el) continue;
      const p = pos.clone().project(this.camera);
      el.style.transform = `translate(${p.x * widthHalf + widthHalf}px, ${-p.y * heightHalf + heightHalf}px)`;
      el.style.display = p.z < 1 ? "block" : "none";
      el.textContent = text;
    }
  }

  onResize() {
    if (this.disposed) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  animate() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(() => this.animate());
    const dt = Math.min(0.05, this.clock.getDelta());
    this.updateAirflowSimulation(dt);
    this.updateScreenSpaceLabels();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    if (this.ro) this.ro.disconnect();
    if (this.meshGroup) this.meshGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    if (this.particleSystem) {
      this.particleSystem.geometry.dispose();
      this.particleSystem.material.dispose();
    }
    if (this.spriteTex) this.spriteTex.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement && this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

function FlowStudioPage() {
  const [design, setDesign] = useState(() => readFlowDesign() || FLOW_DEFAULT_DESIGN);
  const [params, setParams] = useState(() => {
    const d = readFlowDesign() || FLOW_DEFAULT_DESIGN;
    return {
      rampAngle: Math.round(d.rampAngleDeg),
      flueDepthMm: +(d.flueDepthIn * 25.4).toFixed(2),
      tshLengthMm: +(d.shL * 25.4).toFixed(1),
      fippleAngle: Math.round(d.fippleAngleDeg),
    };
  });
  const paramsDirtyRef = useRef(false);
  const [pressurePa, setPressurePa] = useState(350);
  const [timeScale, setTimeScale] = useState(400);
  const [particleCount, setParticleCount] = useState(FLOW_PARTICLE_COUNT);
  const [smokeMode, setSmokeMode] = useState(false);
  const [nests, setNests] = useState(() => loadNestLibrary());
  const [selectedNestId, setSelectedNestId] = useState("");
  const [saveName, setSaveName] = useState("");
  const [status, setStatus] = useState("");

  const paramsFromDesign = (d) => ({
    rampAngle: Math.round(d.rampAngleDeg),
    flueDepthMm: +(d.flueDepthIn * 25.4).toFixed(2),
    tshLengthMm: +(d.shL * 25.4).toFixed(1),
    fippleAngle: Math.round(d.fippleAngleDeg),
  });

  // Effective design = live flute design with the studio's nest overrides.
  const designEff = useMemo(() => ({
    ...design,
    shL: params.tshLengthMm / 25.4,
    flueDepthIn: params.flueDepthMm / 25.4,
    rampAngleDeg: params.rampAngle,
    fippleAngleDeg: params.fippleAngle,
  }), [design, params]);

  const physics = useMemo(() => computeFluteAeroacoustics(designEff, pressurePa), [designEff, pressurePa]);
  const score = useMemo(() => scoreFlowQuality(physics), [physics]);

  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const labelRefs = { ramp: useRef(null), flue: useRef(null), tsh: useRef(null), fipple: useRef(null) };
  const stateRef = useRef(null);
  stateRef.current = { design: designEff, params, physics, score, pressurePa, timeScale, particleCount, smokeMode };

  useEffect(() => {
    if (!containerRef.current) return;
    const viewer = new FlowStudioViewer(
      containerRef.current,
      () => stateRef.current,
      { ramp: labelRefs.ramp.current, flue: labelRefs.flue.current, tsh: labelRefs.tsh.current, fipple: labelRefs.fipple.current }
    );
    viewerRef.current = viewer;

    // Live re-sync while this tab is open: the designer republishes on any
    // change; adopt it (and refresh sliders unless the user has overridden).
    const onDesign = () => {
      const d = readFlowDesign();
      if (!d) return;
      setDesign(d);
      if (!paramsDirtyRef.current) setParams(paramsFromDesign(d));
    };
    window.addEventListener("naf-design-updated", onDesign);
    return () => {
      window.removeEventListener("naf-design-updated", onDesign);
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  // Geometry rebuild whenever real dimensions change (breath pressure and
  // slow-motion are live parameters — read per-frame, no rebuild needed).
  useEffect(() => {
    if (viewerRef.current) viewerRef.current.rebuild();
  }, [designEff]);

  useEffect(() => {
    if (viewerRef.current) viewerRef.current.setParticleCount(particleCount);
  }, [particleCount]);

  useEffect(() => {
    if (viewerRef.current) viewerRef.current.setSmokeMode(smokeMode);
  }, [smokeMode]);

  const setParam = (k, v) => { paramsDirtyRef.current = true; setParams(p => ({ ...p, [k]: v })); };

  const syncFromDesigner = () => {
    const d = readFlowDesign();
    if (!d) { setStatus("No design published yet — open the 🪈 Flute tab once."); return; }
    paramsDirtyRef.current = false;
    setDesign(d);
    setParams(paramsFromDesign(d));
    setStatus(`Synced ${d.keyName} design from the Flute Designer.`);
  };

  const optimize = () => {
    const opt = optimizeNestForDesign(design, pressurePa);
    paramsDirtyRef.current = true;
    setParams({
      rampAngle: opt.rampAngleDeg,
      fippleAngle: opt.fippleAngleDeg,
      flueDepthMm: +(opt.flueDepthIn * 25.4).toFixed(2),
      tshLengthMm: +(opt.shL * 25.4).toFixed(1),
    });
    setStatus(`Optimized for ${design.keyName || "this key"} at ${pressurePa} Pa — θ centered at 7, Re near the clean-laminar band.`);
  };

  const findPressure = () => {
    const p = bestPressureForNest(designEff);
    setPressurePa(p);
    setStatus(`Best breath pressure for this cut-up: ${p} Pa (puts θ at 7).`);
  };

  const doSaveNest = () => {
    const entry = saveNestToLibrary(saveName || `Flow Studio ${design.keyName || "Nest"}`, {
      rampAngleDeg: params.rampAngle,
      flueDepthIn: +(params.flueDepthMm / 25.4).toFixed(4),
      tshLengthIn: +(params.tshLengthMm / 25.4).toFixed(4),
      fippleAngleDeg: params.fippleAngle,
    });
    if (entry) {
      setNests(loadNestLibrary());
      setSaveName("");
      setStatus(`Saved "${entry.name}" to the Nest Library.`);
    } else {
      setStatus("Couldn't save — browser storage may be full or disabled.");
    }
  };

  const applyNest = (id) => {
    setSelectedNestId(id);
    const item = nests.find(n => n.id === id);
    if (!item) return;
    // Library entries keep the four nest numbers at the TOP level of the
    // entry (see saveNestToLibrary) — not under a nested object.
    paramsDirtyRef.current = true;
    setParams(p => ({
      rampAngle: item.rampAngleDeg != null ? Math.round(item.rampAngleDeg) : p.rampAngle,
      flueDepthMm: item.flueDepthIn != null ? +(item.flueDepthIn * 25.4).toFixed(2) : p.flueDepthMm,
      tshLengthMm: item.tshLengthIn != null ? +(item.tshLengthIn * 25.4).toFixed(1) : p.tshLengthMm,
      fippleAngle: item.fippleAngleDeg != null ? Math.round(item.fippleAngleDeg) : p.fippleAngle,
    }));
    setStatus(`Loaded "${item.name}" from the Nest Library.`);
  };

  // ── styles (slate theme, matches the original fluteview look) ──
  const S = {
    page: { display: "flex", gap: 12, height: "100%", minHeight: 480, color: "#e2e8f0", fontFamily: "system-ui, sans-serif" },
    canvasWrap: { position: "relative", flex: 1, minWidth: 0, background: "#030712", borderRadius: 12, overflow: "hidden", border: "1px solid #1e293b" },
    label: { position: "absolute", top: 0, left: 0, display: "none", pointerEvents: "none", background: "rgba(2,6,23,0.85)", border: "1px solid #334155", color: "#7dd3fc", fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 6, whiteSpace: "nowrap", transformOrigin: "0 0" },
    side: { width: 320, flexShrink: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, paddingRight: 2 },
    card: { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 12 },
    h: { fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#38bdf8", marginBottom: 8 },
    row: { display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12, padding: "2px 0", gap: 8 },
    k: { color: "#94a3b8" }, v: { fontWeight: 700, textAlign: "right" },
    chip: (tone) => ({ fontSize: 10, fontWeight: 800, padding: "1px 7px", borderRadius: 999, whiteSpace: "nowrap",
      background: tone === "good" ? "#052e1b" : tone === "warn" ? "#3b2405" : "#3d0a0a",
      color: tone === "good" ? "#34d399" : tone === "warn" ? "#fbbf24" : "#f87171",
      border: `1px solid ${tone === "good" ? "#065f46" : tone === "warn" ? "#92400e" : "#7f1d1d"}` }),
    slider: { width: "100%" },
    sLabel: { display: "flex", justifyContent: "space-between", fontSize: 12, color: "#cbd5e1", marginTop: 8, marginBottom: 2 },
    btn: (bg, fg) => ({ width: "100%", padding: "9px 10px", background: bg, color: fg, border: "none", borderRadius: 8, fontSize: 12.5, fontWeight: 800, cursor: "pointer", marginTop: 6 }),
    bar: (val) => ({ height: 6, borderRadius: 3, width: `${Math.max(2, val)}%`,
      background: val >= 70 ? "#10b981" : val >= 40 ? "#f59e0b" : "#ef4444" }),
    input: { width: "100%", padding: "7px 9px", background: "#020617", border: "1px solid #334155", borderRadius: 7, color: "#e2e8f0", fontSize: 12, boxSizing: "border-box" },
    select: { width: "100%", padding: "7px 9px", background: "#020617", border: "1px solid #334155", borderRadius: 7, color: "#e2e8f0", fontSize: 12 },
  };

  const holes = design.holes || [];
  const fmtC = (c) => `${c >= 0 ? "+" : ""}${c.toFixed(0)}\u00A2`;

  return (
    <div style={S.page}>
      <div style={S.canvasWrap}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
        <div ref={labelRefs.ramp} style={S.label} />
        <div ref={labelRefs.flue} style={S.label} />
        <div ref={labelRefs.tsh} style={S.label} />
        <div ref={labelRefs.fipple} style={S.label} />
        <div style={{ position: "absolute", top: 10, left: 10, display: "flex", gap: 6 }}>
          <button onClick={() => viewerRef.current && viewerRef.current.frame("nest")}
            style={{ ...S.btn("#1e293b", "#7dd3fc"), width: "auto", marginTop: 0, padding: "6px 10px" }}>🔍 Nest</button>
          <button onClick={() => viewerRef.current && viewerRef.current.frame("flute")}
            style={{ ...S.btn("#1e293b", "#7dd3fc"), width: "auto", marginTop: 0, padding: "6px 10px" }}>🪈 Whole flute</button>
        </div>
        <div style={{ position: "absolute", bottom: 10, left: 10, fontSize: 10.5, color: "#64748b", background: "rgba(2,6,23,0.7)", padding: "4px 8px", borderRadius: 6 }}>
          Jet flaps at {design.keyName || "?"} ({(physics.f0 || 0).toFixed(1)} Hz), slowed {timeScale}× — drag to orbit, scroll to zoom
        </div>
      </div>

      <div style={S.side}>
        {/* ── Design source ── */}
        <div style={S.card}>
          <div style={S.h}>Flute design (live from designer)</div>
          <div style={S.row}><span style={S.k}>Key</span><span style={S.v}>{design.keyName || "—"} · {(design.rootFreq || 0).toFixed(2)} Hz</span></div>
          <div style={S.row}><span style={S.k}>Bore</span><span style={S.v}>{design.bore}&Prime;</span></div>
          <div style={S.row}><span style={S.k}>Sound chamber</span><span style={S.v}>{(design.L || 0).toFixed(2)}&Prime;</span></div>
          <div style={S.row}><span style={S.k}>SAC length</span><span style={S.v}>{(design.sacLen || 0).toFixed(2)}&Prime;</span></div>
          <div style={S.row}><span style={S.k}>TSH width</span><span style={S.v}>{(design.shW || 0).toFixed(3)}&Prime;</span></div>
          <div style={S.row}><span style={S.k}>Finger holes</span><span style={S.v}>{holes.length || "none"}</span></div>
          {holes.length > 0 && (
            <div style={{ marginTop: 6, borderTop: "1px solid #1e293b", paddingTop: 6 }}>
              {holes.map(h => (
                <div key={h.num} style={{ ...S.row, fontSize: 11 }}>
                  <span style={S.k}>#{h.num} · {h.interval}</span>
                  <span style={S.v}>{h.fromTSH.toFixed(2)}&Prime; fromTSH · &empty;{h.diameter.toFixed(3)}&Prime;</span>
                </div>
              ))}
            </div>
          )}
          <button onClick={syncFromDesigner} style={S.btn("#0c4a6e", "#e0f2fe")}>🔄 Sync from Flute Designer</button>
        </div>

        {/* ── Breath & time ── */}
        <div style={S.card}>
          <div style={S.h}>Breath &amp; time</div>
          <div style={S.sLabel}><span>Breath pressure</span><b>{pressurePa} Pa</b></div>
          <input type="range" min={100} max={1200} step={10} value={pressurePa}
            onChange={e => setPressurePa(+e.target.value)} style={S.slider} />
          <div style={{ fontSize: 10, color: "#64748b" }}>Typical NAF playing range ≈ 250–600 Pa</div>
          <div style={S.sLabel}><span>Slow motion</span><b>{timeScale}×</b></div>
          <input type="range" min={50} max={2000} step={25} value={timeScale}
            onChange={e => setTimeScale(+e.target.value)} style={S.slider} />
          <button onClick={findPressure} style={S.btn("#164e63", "#a5f3fc")}>🌬 Find best breath pressure</button>
        </div>

        {/* ── Nest geometry ── */}
        <div style={S.card}>
          <div style={S.h}>Nest geometry (what-if overrides)</div>
          <div style={S.sLabel}><span>Ramp angle</span><b>{params.rampAngle}&deg;</b></div>
          <input type="range" min={15} max={60} step={1} value={params.rampAngle}
            onChange={e => setParam("rampAngle", +e.target.value)} style={S.slider} />
          <div style={S.sLabel}><span>Flue depth</span><b>{params.flueDepthMm.toFixed(2)} mm</b></div>
          <input type="range" min={0.4} max={2.5} step={0.05} value={params.flueDepthMm}
            onChange={e => setParam("flueDepthMm", +e.target.value)} style={S.slider} />
          <div style={S.sLabel}><span>TSH length (cut-up)</span><b>{params.tshLengthMm.toFixed(1)} mm</b></div>
          <input type="range" min={3} max={14} step={0.1} value={params.tshLengthMm}
            onChange={e => setParam("tshLengthMm", +e.target.value)} style={S.slider} />
          <div style={S.sLabel}><span>Fipple angle</span><b>{params.fippleAngle}&deg;</b></div>
          <input type="range" min={25} max={55} step={1} value={params.fippleAngle}
            onChange={e => setParam("fippleAngle", +e.target.value)} style={S.slider} />
          <button onClick={optimize} style={S.btn("#065f46", "#d1fae5")}>⚡ Optimize nest for this key</button>
        </div>

        {/* ── Particles ── */}
        <div style={S.card}>
          <div style={S.h}>Particles</div>
          <div style={S.sLabel}><span>Particle count</span><b>{particleCount}</b></div>
          <input type="range" min={100} max={2500} step={50} value={particleCount}
            onChange={e => setParticleCount(+e.target.value)} style={S.slider} />
          <button onClick={() => setSmokeMode(s => !s)}
            style={S.btn(smokeMode ? "#475569" : "#1e293b", smokeMode ? "#f8fafc" : "#94a3b8")}>
            {smokeMode ? "💨 Smoke particles: ON" : "✨ Smoke particles: OFF"}
          </button>
        </div>

        {/* ── Aeroacoustics ── */}
        <div style={S.card}>
          <div style={S.h}>Aeroacoustics</div>
          <div style={S.row}><span style={S.k}>Jet velocity</span><span style={S.v}>{physics.U.toFixed(1)} m/s</span></div>
          <div style={S.row}><span style={S.k}>Air use</span><span style={S.v}>{physics.QLpm.toFixed(1)} L/min</span></div>
          <div style={S.row}><span style={S.k}>Reynolds (flue)</span><span style={S.v}>{Math.round(physics.Re)}</span></div>
          <div style={{ ...S.row, justifyContent: "flex-end" }}><span style={S.chip(physics.flowRegime.tone)}>{physics.flowRegime.label}</span></div>
          <div style={S.row}><span style={S.k}>Jet drive &theta; — root</span><span style={S.v}>{physics.theta.toFixed(1)}</span></div>
          <div style={{ ...S.row, justifyContent: "flex-end" }}><span style={S.chip(physics.jetRegime.tone)}>{physics.jetRegime.label}</span></div>
          <div style={S.row}><span style={S.k}>Jet drive &theta; — top note</span><span style={S.v}>{physics.thetaTop.toFixed(1)} <span style={{ color: "#64748b", fontWeight: 400 }}>({physics.fTop.toFixed(0)} Hz)</span></span></div>
          <div style={S.row}><span style={S.k}>Cut-up ratio l&#8342;/h</span><span style={S.v}>{physics.cutupRatio.toFixed(1)} : 1 <span style={{ color: "#64748b", fontWeight: 400 }}>(ideal 3.5–6.5)</span></span></div>
          <div style={S.row}><span style={S.k}>Chamber resonance</span><span style={S.v}>{physics.f1pred.toFixed(1)} Hz · {fmtC(physics.cents)}</span></div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
            Open-open pipe with 0.61&middot;a end corrections; &theta; = U/(f&middot;l&#8342;) per flue-pipe theory (optimal 5–10, jet waves convect at 0.4&middot;U).
          </div>
        </div>

        {/* ── Quality score ── */}
        <div style={S.card}>
          <div style={S.h}>Sound quality</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 34, fontWeight: 900, color: score.total >= 70 ? "#34d399" : score.total >= 40 ? "#fbbf24" : "#f87171" }}>{score.total}</span>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>/ 100 predicted</span>
          </div>
          {score.parts.map(p => (
            <div key={p.key} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "#94a3b8" }}>
                <span>{p.key} <span style={{ color: "#475569" }}>({p.w}%)</span></span><b style={{ color: "#cbd5e1" }}>{p.val}</b>
              </div>
              <div style={{ background: "#1e293b", borderRadius: 3, marginTop: 2 }}><div style={S.bar(p.val)} /></div>
            </div>
          ))}
        </div>

        {/* ── Nest library ── */}
        <div style={S.card}>
          <div style={S.h}>Nest library</div>
          <select value={selectedNestId} onChange={e => applyNest(e.target.value)} style={S.select}>
            <option value="">Load a saved nest…</option>
            {nests.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input placeholder="Name this nest…" value={saveName} onChange={e => setSaveName(e.target.value)} style={S.input} />
            <button onClick={doSaveNest} style={{ ...S.btn("#38bdf8", "#04121f"), width: "auto", marginTop: 0, whiteSpace: "nowrap" }}>💾 Save</button>
          </div>
        </div>

        {status && (
          <div style={{ ...S.card, borderColor: "#0e7490", color: "#a5f3fc", fontSize: 12 }}>{status}</div>
        )}
      </div>
    </div>
  );
}


function App() {
  const [page, setPage] = useState("flute");
  const [pendingLoad, setPendingLoad] = useState(null); // { kind, config } from Library "Open"
  const [gcodeProgram, setGcodeProgram] = useState(null); // { gcode, filename, ts } from CNC section handoff

  const bg0 = "#0f0801", gold = "#f59e0b", bone = "#e5d5b8", muted = "#8a7255", border = "#3a2a14", bg2 = "#241608";

  const handleLoadFromLibrary = (item) => {
    setPendingLoad({ kind: item.kind, config: item.config });
    setPage(item.kind === "duduk" ? "duduk" : "flute");
  };

  // The CNC G-code section (deep inside FlutePage) hands a generated
  // program to the built-in viewer through this window event — cheaper
  // and less invasive than prop-drilling a callback through every layer.
  useEffect(() => {
    const onOpenGcode = (e) => {
      const d = (e && e.detail) || {};
      if (!d.gcode) return;
      setGcodeProgram({ gcode: d.gcode, filename: d.filename, ts: Date.now() });
      setPage("gcode");
    };
    window.addEventListener("naf-open-gcode-viewer", onOpenGcode);
    return () => window.removeEventListener("naf-open-gcode-viewer", onOpenGcode);
  }, []);

  const tab = (id, label, activeBg, activeFg) => (
    <button key={id} onClick={()=>setPage(id)} style={{
      flex:1,padding:"10px 4px",borderRadius:8,border:`1px solid ${page===id?activeBg:border}`,
      background:page===id?activeBg:bg2,color:page===id?activeFg:muted,
      fontWeight:800,fontSize:13,cursor:"pointer",whiteSpace:"nowrap",
    }}>{label}</button>
  );

  return (
    <div style={{minHeight:"100vh",background:bg0,color:bone,fontFamily:"system-ui,-apple-system,sans-serif"}}>

      {/* Suite title + page tab bar */}
      <div style={{position:"sticky",top:0,zIndex:50,background:"#0c0600",borderBottom:`1px solid ${border}`,padding:"10px 14px"}}>
        <div style={{maxWidth:900,margin:"0 auto 8px",textAlign:"center",fontSize:12,fontWeight:700,letterSpacing:"0.04em",color:muted}}>
          NAF Flute &amp; Duduk Calculator
        </div>
        <div style={{maxWidth:900,margin:"0 auto",display:"flex",gap:8,flexWrap:"wrap"}}>
          {tab("flute",   "🪈 Flute",       gold,      "#0f0801")}
          {tab("duduk",   "🎶 Duduk",       "#e8a33d", "#1a0e00")}
          {tab("library", "📚 Library",     "#7acc44", "#0f1a08")}
          {tab("gcode",   "⚙ G-Code",      "#5aa7e0", "#04121f")}
          {tab("flow",    "💨 Flow Studio", "#38bdf8", "#04121f")}
        </div>
      </div>

      {/* G-Code Viewer stays mounted (hidden) so a loaded program and its
          camera survive tab switches; its full-bleed dark layout gets the
          whole area below the header instead of the padded page wrapper. */}
      <div style={{
        display: page === "gcode" ? "block" : "none",
        height: "calc(100vh - 86px)", minHeight: 480,
      }}>
        <GCodeViewerPage initialProgram={gcodeProgram} active={page === "gcode"}/>
      </div>

      <div style={{padding:"20px 14px 56px",display: page === "gcode" ? "none" : "block"}}>
        {page === "flute" && (
          <FlutePage
            loadConfig={pendingLoad && pendingLoad.kind === "flute" ? pendingLoad.config : null}
            onConfigLoaded={()=>setPendingLoad(null)}
          />
        )}
        {page === "duduk" && (
          <DudukPage
            loadConfig={pendingLoad && pendingLoad.kind === "duduk" ? pendingLoad.config : null}
            onConfigLoaded={()=>setPendingLoad(null)}
          />
        )}
        {page === "library" && <LibraryPage onLoad={handleLoadFromLibrary}/>}
        {page === "flow" && <FlowStudioPage/>}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
