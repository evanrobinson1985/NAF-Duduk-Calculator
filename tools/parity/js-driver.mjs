import * as E from './work/engine.mjs';

const out = {};
const r6 = (x) => (typeof x === 'number' && isFinite(x) ? Number(x.toFixed(6)) : x);
const pf = (v) => (v === null || v === undefined ? null : r6(parseFloat(v)));
const put = (k, v) => { out[k] = v; };

// ── notes ────────────────────────────────────────────────────────────
put('notes.count', E.ALL_NOTES.length);
put('notes.440', E.getNotes(440).map(n => `${n.name}:${r6(n.freq)}:${n.family}:${n.advanced ? 1 : 0}`));
put('notes.432', E.getNotes(432).slice(0, 12).map(n => `${n.name}:${r6(n.freq)}`));
put('noteNameFromFreq', [220, 261.63, 370, 441.5, 1000].map(f => { const p = E.noteNameFromFreq(f); return `${p.name}:${p.cents}`; }));
put('nearestNote', [220, 300, 370, 441.5].map(f => { const p = E.nearestNote(f, E.getNotes(440)); return `${p.name}:${p.cents}`; }));

// ── basic formulas ───────────────────────────────────────────────────
put('SPEED', E.SPEED);
put('tubeLen', [[220, 0.3125], [370, 0.375], [440, 0.25], [110, 0.5]].map(([f, r]) => r6(E.tubeLen(f, r))));
put('holeDiam', [[0.625, 1, 6], [0.625, 3, 6], [0.625, 6, 6], [1.25, 2, 5], [0.375, 4, 4]].map(([b, n, c]) => r6(E.holeDiam(b, n, c))));
put('holeShapeDiameter', ['round', 'oval', 'undercut', 'countersunk'].map(k => r6(E.holeShapeDiameter(0.3, k))));
put('curveBowAmplitudeIn', ['straight', 'slight', 'heavy'].map(c => r6(E.curveBowAmplitudeIn(c))));
put('FLUTE_CONST', Object.fromEntries(Object.entries(E.FLUTE_CONST).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, r6(v)])));
put('FLUTE_CONST.fns', [0.5, 0.625, 0.75, 1.0, 1.5].flatMap(b => [
  `shW${b}:${r6(E.FLUTE_CONST.soundHoleWidth(b))}`, `shL${b}:${r6(E.FLUTE_CONST.soundHoleLength(b))}`,
  `flueD${b}:${r6(E.FLUTE_CONST.flueDepth(b))}`, `flueL${b}:${r6(E.FLUTE_CONST.flueLength(b))}`,
  `sac${b}:${r6(E.FLUTE_CONST.autoSacLen(b))}`, `bhW${b}:${r6(E.FLUTE_CONST.breathHoleWidth(b))}`,
  `bhL${b}:${r6(E.FLUTE_CONST.breathHoleLength(b))}`]));

// ── bores / scale configs ────────────────────────────────────────────
put('BORES', E.BORES.map(b => `${b.label}:${r6(b.val)}:${r6(b.mm)}`));
put('SCALE_CONFIGS', Object.keys(E.SCALE_CONFIGS).sort().map(k =>
  `${k}:${E.SCALE_CONFIGS[k].name}:` + E.SCALE_CONFIGS[k].holes.map(h => `${h.num}/${h.interval}/${r6(h.ratio)}`).join(',')));
put('DRONE_INTERVALS', E.DRONE_INTERVALS.map(d => `${d.label}:${r6(d.ratio)}`));
put('HARMONY_PRESETS', E.HARMONY_PRESETS.map(h => `${h.id}:${h.name}:${h.intervals.join('/')}`));
const recDump = (f) => { const rec = E.recommendedBores(f); return {
  best: `${rec.best.label}:${r6(rec.best.tubeLen)}:${rec.best.inHardRange ? 1 : 0}:${rec.best.inSweetSpot ? 1 : 0}`,
  reachesSweetSpot: !!rec.reachesSweetSpot, extreme: !!rec.extreme,
  extremeTooLong: !!rec.extremeTooLong, extremeTooShort: !!rec.extremeTooShort,
  options: rec.options.map(o => `${o.label}:${r6(o.tubeLen)}:${o.inHardRange ? 1 : 0}:${o.inSweetSpot ? 1 : 0}`) }; };
put('recommendedBores.370', recDump(370));
put('recommendedBores.110', recDump(110));
put('recommendedBores.1000', recDump(1000));

// ── chamber geometry (authoritative builder) ─────────────────────────
const geomCases = [
  { bore: 0.625, freq: 440, holeCount: 6, handSize: 'average' },
  { bore: 0.75, freq: 369.99, holeCount: 6, handSize: 'average' },
  { bore: 0.75, freq: 369.99, holeCount: 5, handSize: 'compact' },
  { bore: 1.0, freq: 196, holeCount: 6, handSize: 'large' },
  { bore: 0.5, freq: 587.33, holeCount: 4, handSize: 'average' },
  { bore: 0.75, freq: 369.99, holeCount: 0, handSize: 'average' },
  { bore: 1.25, freq: 146.83, holeCount: 6, handSize: 'average', sacLenIn: 5.5 },
  { bore: 0.75, freq: 369.99, holeCount: 6, handSize: 'average', holeShapeKey: 'oval' },
  { bore: 0.375, freq: 1046.5, holeCount: 3, handSize: 'average' },
  { bore: 0.75, freq: 369.99, holeCount: 6, handSize: 'average', mouthpieceMarginIn: 0 },
];
geomCases.forEach((c, i) => {
  const g = E.buildChamberGeometry(c);
  put(`geom${i}`, {
    L: pf(g.L), sacLen: pf(g.sacLen), totalLen: pf(g.totalLen), mpMargin: pf(g.mouthpieceMargin),
    shW: pf(g.shW), shL: pf(g.shL), holeCount: g.holeCount, playable: !!g.playable,
    holes: (g.holes || []).map(h => `${h.num}/${h.interval}/${pf(h.fromFoot)}/${pf(h.fromTSH)}/${pf(h.diameter)}`),
  });
});

// ── geometry validation + auto-fix ──────────────────────────────────
// Compared numerically rather than by issue text: the messages interpolate
// raw numbers, and JS prints 42 where Kotlin prints 42.0. What has to agree
// is which cases are flagged, how many corrections each needs, and — the part
// every export actually reads — the corrected numbers.
const vBase = E.buildChamberGeometry({ bore: 0.75, freq: 369.99, holeCount: 6 });
const vClone = () => JSON.parse(JSON.stringify(vBase));
const vMinGap = (() => {
  const s = [...vBase.holes].sort((a, b) => parseFloat(a.fromTSH) - parseFloat(b.fromTSH));
  let m = Infinity;
  for (let i = 0; i < s.length - 1; i++) m = Math.min(m, parseFloat(s[i + 1].fromTSH) - parseFloat(s[i].fromTSH));
  return m;
})();
const vCases = {
  sound: (c) => c,
  sacHigh: (c) => { c.sacLen = 42; return c; },
  sacLow: (c) => { c.sacLen = 0.1; return c; },
  soundHole: (c) => { c.shW = 0.9; c.shL = 0.1; return c; },
  totalLen: (c) => { c.totalLen = 1; return c; },
  holeSum: (c) => { c.holes[0].fromFoot = parseFloat(c.holes[0].fromFoot) + 1; return c; },
  overlap: (c) => { c.holes.forEach(h => { h.diameter = vMinGap * 1.5; }); return c; },
  everything: (c) => { c.sacLen = 42; c.shW = 0.9; c.totalLen = 1; c.holes.forEach(h => { h.diameter = vMinGap * 1.5; }); return c; },
};
Object.entries(vCases).forEach(([name, mutate]) => {
  const chamber = mutate(vClone());
  const rep = E.validateChamberGeometry(chamber, 'Melody');
  const { chamber: fx, fixes } = E.fixChamberGeometry(chamber, 'Melody');
  const after = E.validateChamberGeometry(fx, 'Melody');
  put(`validate.${name}`, {
    valid: !!rep.valid,
    issueCount: rep.issues.length,
    fixCount: fixes.length,
    validAfterFix: !!after.valid,
    sacLen: pf(fx.sacLen), shW: pf(fx.shW), shL: pf(fx.shL), totalLen: pf(fx.totalLen),
    holes: (fx.holes || []).map(h => `${h.num}/${pf(h.fromTSH)}/${pf(h.fromFoot)}/${pf(h.diameter)}`),
  });
});

// ── ergonomic adjust + finger reach ─────────────────────────────────
const baseHoles = E.buildChamberGeometry({ bore: 0.75, freq: 369.99, holeCount: 6 }).holes;
[0, 0.25, 0.5, 0.75, 1].forEach(b => {
  put(`ergo${b}`, E.ergonomicAdjustHoles(baseHoles, b).map(h => `${h.num}/${pf(h.adjFromTSH)}/${pf(h.adjDiameter)}/${h.centsShift}`));
});
const reachDump = (holes) => { const a = E.analyzeFingerReach(holes); return {
  hasProblem: !!a.hasProblem, hasWarning: !!a.hasWarning,
  worst: a.worst ? `${a.worst.from}-${a.worst.to}:${r6(a.worst.gap)}:${a.worst.status}` : null,
  gaps: a.gaps.map(g => `${g.from}-${g.to}:${r6(g.gap)}:${g.status}`) }; };
put('fingerReach.mid', reachDump(baseHoles));
put('fingerReach.wide', reachDump(E.buildChamberGeometry({ bore: 1.25, freq: 130.81, holeCount: 6 }).holes));
put('fingerReach.tight', reachDump(E.buildChamberGeometry({ bore: 0.375, freq: 880, holeCount: 6 }).holes));

// ── antler fit ──────────────────────────────────────────────────────
[[20, 1.4, 0.95, 'slight'], [24, 1.6, 1.1, 'straight'], [14, 1.1, 0.85, 'heavy'],
 [9, 0.8, 0.8, 'straight'], [14, 1.1, 0.55, 'straight'], [0, 1, 1, 'straight']]
  .forEach(([length, widestDiam, tipDiam, curvature], i) => {
    const a = E.analyzeAntlerFit({ length, widestDiam, tipDiam, curvature }, E.getNotes(440), 6);
    put(`antler${i}`, a === null ? null : {
      fits: !!a.fits, reason: a.reason ?? null, maxUsableBore: r6(a.maxUsableBore), bore: r6(a.bore),
      usableTubeLen: r6(a.usableTubeLen), sacLen: r6(a.sacLen), scaleName: a.scaleName ?? '',
      bestMatches: (a.bestMatches || []).map(f => `${f.name}/${r6(f.freq)}/${r6(f.idealLen)}/${r6(f.diff)}/${f.fitsExact ? 1 : 0}/${f.fitsWithTrim ? 1 : 0}/${f.tooLong ? 1 : 0}`),
      tooLongExamples: (a.tooLongExamples || []).map(f => `${f.name}/${r6(f.diff)}`),
    });
  });

// ── duduk ───────────────────────────────────────────────────────────
put('dudukTubeLen', [[220, 0.3, 1.5], [293.66, 0.35, 2.0], [174.61, 0.45, 2.5]].map(([f, r, e]) => r6(E.dudukTubeLen(f, r, e))));
put('dudukHoleDiam', [[0.6, false], [0.6, true], [0.9, false], [0.35, true]].map(([b, t]) => r6(E.dudukHoleDiam(b, t))));
put('recommendedDudukBore', [[220, [0.4, 0.9], 1.5], [146.83, [0.4, 1.1], 2.2], [293.66, [0.55, 0.85], 1.15]].map(([f, range, e]) => {
  const d = E.recommendedDudukBore(f, range, e);
  return `${r6(d.bore)}:${r6(d.tubeLen)}:${d.reachesSweetSpot ? 1 : 0}:${d.extreme ? 1 : 0}:${d.extremeTooLong ? 1 : 0}:${d.extremeTooShort ? 1 : 0}`;
}));
put('DUDUK_STYLES', Object.keys(E.DUDUK_STYLES).sort().map(k => { const s = E.DUDUK_STYLES[k];
  return `${k}:${s.label}:${s.boreRange.join('-')}:${s.reedLenRange.join('-')}:${s.reedExtRange.join('-')}:${s.holeCount}`; }));
put('DUDUK_HOLES_8', E.DUDUK_HOLES_8.map(h => `${h.num}/${h.interval}/${r6(h.ratio)}/${h.thumb ? 1 : 0}`));

// ── flow studio ─────────────────────────────────────────────────────
const fd = E.FLOW_DEFAULT_DESIGN;
put('FLOW_DEFAULT_DESIGN', Object.fromEntries(Object.entries(fd).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, r6(v)])));
put('FLOW_AIR', E.FLOW_AIR);
[200, 400, 700, 1200].forEach(P => {
  const m = E.computeFluteAeroacoustics(fd, P);
  put(`aero${P}`, Object.fromEntries(Object.entries(m).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, r6(v)])));
  put(`aero${P}.regimes`, `${m.jetRegime.label}|${m.jetRegime.tone}|${m.flowRegime.label}|${m.flowRegime.tone}`);
  const s = E.scoreFlowQuality(m);
  put(`score${P}`, `${s.total}:` + s.parts.map(p => `${p.key}/${p.val}/${p.w}`).join(','));
});
put('optimizeNestForDesign', [300, 700].map(P => { const n = E.optimizeNestForDesign(fd, P);
  return `rampAngleDeg=${r6(n.rampAngleDeg)},fippleAngleDeg=${r6(n.fippleAngleDeg)},shL=${r6(n.shL)},flueDepthIn=${r6(n.flueDepthIn)}`; }));
put('bestPressureForNest', r6(E.bestPressureForNest(fd)));
put('optimizeEverything', (() => { const o = E.optimizeEverything(fd);
  return `sc=${o.sc},P=${r6(o.P)},flueDepthIn=${r6(o.flueDepthIn)},shL=${r6(o.shL)},flueLengthIn=${r6(o.flueLengthIn)},` +
    `tipHeightIn=${r6(o.tipHeightIn)},rampAngleDeg=${r6(o.rampAngleDeg)},rampCurve=${r6(o.rampCurve)},` +
    `chimneyIn=${r6(o.chimneyIn)},backsetIn=${r6(o.backsetIn)},fippleAngleDeg=${r6(o.fippleAngleDeg)}`; })());

// ── gcode plumbing ──────────────────────────────────────────────────
put('snapToCommonBit', [0.03, 0.1, 0.2, 0.26, 0.4, 0.51].map(d => r6(E.snapToCommonBit(d))));
put('COMMON_BIT_SIZES_IN', E.COMMON_BIT_SIZES_IN.map(r6));
put('toUnits', [[1, 'in'], [1, 'mm'], [2.5, 'mm']].map(([v, u]) => r6(E.toUnits(v, u))));
put('fmt', [[1.23456, 2], [1.23456, 4], [10, 0], [-0.5, 3], [0.0005, 3], [2.675, 2]].map(([v, d]) => E.fmt(v, d)));
put('CNC_DIALECTS', Object.keys(E.CNC_DIALECTS).sort().map(k => `${k}:${E.CNC_DIALECTS[k].programEnd}:${E.CNC_DIALECTS[k].supportsCannedCycles ? 1 : 0}`));
put('SPLIT_FIT', Object.fromEntries(Object.entries(E.SPLIT_FIT).map(([k, v]) => [k, Array.isArray(v) ? v.map(r6) : r6(v)])));
put('gcodeHeader', E.gcodeHeader('grbl', 'in', { title: 'T', notes: ['n1', 'n2'] }));
put('gcodeFooter', ['grbl', 'linuxcnc', 'mach3', 'generic'].map(d => E.gcodeFooter(d).join('|')));

// Fixed chamber specs so G-code diffs isolate G-code logic from geometry.
const mk = (bore, sacLen, L, playable, label, shW, shL, holes) => ({
  bore, sacLen, L, playable, label, shW, shL,
  holes: holes.map(([num, interval, fromTSH, diameter]) => ({ num, interval, fromTSH, diameter, fromFoot: L - fromTSH })),
});
const holes6 = [[1, 'root', 6.2, 0.31], [2, 'M2', 7.4, 0.31], [3, 'm3', 8.35, 0.28], [4, 'P4', 9.55, 0.28], [5, 'P5', 10.6, 0.28], [6, 'm7', 11.8, 0.26]];
const single = [mk(0.75, 3.45, 15.1, true, 'MELODY', 0.375, 0.219, holes6)];
const drone = [
  mk(0.75, 3.45, 15.1, true, 'MELODY', 0.375, 0.219, holes6),
  mk(0.625, 3.45, 11.3, false, 'DRONE 1', 0.3125, 0.2, []),
  mk(0.875, 3.45, 18.9, true, 'CHAMBER 3 (PLAYABLE)', 0.4375, 0.24, [[1, 'root', 7.1, 0.36], [2, 'M3', 9.2, 0.33]]),
];
const emp = (chambers, method) => Object.fromEntries(Object.entries(E.computeEasyModeParams(chambers, method)).map(([k, v]) => [k, typeof v === 'number' ? r6(v) : v]));
put('computeEasyModeParams.tube.single', emp(single, 'tube'));
put('computeEasyModeParams.split.single', emp(single, 'split'));
put('computeEasyModeParams.split.drone', emp(drone, 'split'));
put('computeEasyModeParams.tube.drone', emp(drone, 'tube'));
put('chamberYOffsets.single', E.chamberYOffsets(single).map(r6));
put('chamberYOffsets.drone', E.chamberYOffsets(drone).map(r6));

const tubeBase = { units: 'in', toolDiameter: 0.125, feedRate: 27, plungeRate: 8, peckDepth: 0.06,
  safeHeight: 0.5, retractHeight: 0.12, dialect: 'grbl', spindleSpeed: 21000, setupMode: 'fixed' };
put('GCODE.tube.single', E.generateTubeDrillingGCode({ ...tubeBase, chambers: single }));
put('GCODE.tube.drone.solid', E.generateTubeDrillingGCode({ ...tubeBase, chambers: drone, droneBody: 'solid' }));
put('GCODE.tube.drone.separate', E.generateTubeDrillingGCode({ ...tubeBase, chambers: drone, droneBody: 'separate' }));
put('GCODE.tube.rotary', E.generateTubeDrillingGCode({ ...tubeBase, chambers: single, setupMode: 'rotary' }));
put('GCODE.tube.mm', E.generateTubeDrillingGCode({ ...tubeBase, chambers: single, units: 'mm' }));

const splitBase = { units: 'in', toolDiameter: 0.25, stepdown: 0.1, feedRate: 55, plungeRate: 17,
  safeHeight: 0.5, stockMarginX: 0.5, stockMarginY: 0.75, channelStyle: 'round',
  dialect: 'grbl', spindleSpeed: 18000, alignPins: true, curve: 'straight' };
for (const style of ['nest-insert', 'symmetric']) {
  for (const only of ['halves', 'nest', 'all']) {
    put(`GCODE.split.${style}.${only}`, E.generateSplitBlockGCode({ ...splitBase, chambers: single, splitStyle: style, only }));
  }
  put(`GCODE.split.${style}.cutout`, E.generateSplitBlockGCode({ ...splitBase, chambers: single, splitStyle: style, only: 'all', outlinePass: 'cutout' }));
  put(`GCODE.split.${style}.scribe`, E.generateSplitBlockGCode({ ...splitBase, chambers: single, splitStyle: style, only: 'all', outlinePass: 'scribe' }));
  put(`GCODE.split.${style}.flat`, E.generateSplitBlockGCode({ ...splitBase, chambers: single, splitStyle: style, only: 'all', channelStyle: 'flat' }));
  put(`GCODE.split.${style}.curve`, E.generateSplitBlockGCode({ ...splitBase, chambers: single, splitStyle: style, only: 'all', curve: 'slight' }));
  put(`GCODE.split.${style}.drone.solid`, E.generateSplitBlockGCode({ ...splitBase, chambers: drone, splitStyle: style, only: 'all', droneBody: 'solid' }));
  put(`GCODE.split.${style}.nopins`, E.generateSplitBlockGCode({ ...splitBase, chambers: single, splitStyle: style, only: 'all', alignPins: false }));
  put(`GCODE.split.${style}.mm`, E.generateSplitBlockGCode({ ...splitBase, chambers: single, splitStyle: style, only: 'all', units: 'mm' }));
}

// ── pitch detection ─────────────────────────────────────────────────
const mkBuf = (freq, sr, n, amp) => { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = amp * Math.sin(2 * Math.PI * freq * i / sr); return b; };
put('autoCorrelatePitch', [
  r6(E.autoCorrelatePitch(mkBuf(440, 44100, 2048, 0.5), 44100)),
  r6(E.autoCorrelatePitch(mkBuf(220, 44100, 2048, 0.5), 44100)),
  r6(E.autoCorrelatePitch(mkBuf(370, 48000, 4096, 0.3), 48000)),
  r6(E.autoCorrelatePitch(mkBuf(440, 44100, 2048, 0.001), 44100)),
  r6(E.autoCorrelatePitch(mkBuf(880, 44100, 4096, 0.4), 44100)),
]);

console.log(JSON.stringify(out, null, 1));
