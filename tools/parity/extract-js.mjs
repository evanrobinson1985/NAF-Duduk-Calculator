// Turns the original React source (`antler_duduk_calculator (50) (4).jsx` in
// the repo root) into a headless ES module whose pure functions can be called
// from Node, so the Kotlin port can be compared against the code it was
// ported from.
//
// Two transformations:
//   1. drop the ReactDOM.createRoot(...) bootstrap (there is no DOM here), and
//   2. append an `export { ... }` listing the pure symbols the drivers use —
//      the source declares them at module scope but exports nothing.
// React / three.js / jsPDF / three-bvh-csg are aliased to a permissive Proxy
// stub (js-import-stub.js); none of the exported functions touch them.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const work = path.join(here, 'work');
fs.mkdirSync(work, { recursive: true });

const jsxName = process.env.PARITY_JSX ??
  fs.readdirSync(repoRoot).find((f) => f.endsWith('.jsx'));
if (!jsxName) {
  console.error('No .jsx source found in the repo root. Set PARITY_JSX to its path.');
  process.exit(1);
}
const jsxPath = path.isAbsolute(jsxName) ? jsxName : path.join(repoRoot, jsxName);

// Pure, module-scope symbols the parity drivers exercise. Anything React-
// flavoured stays out; anything listed here must exist in the source or
// esbuild fails loudly rather than silently skipping a comparison.
const EXPORTS = [
  // notes + basic formulas
  'SPEED', 'ALL_NOTES', 'getNotes', 'noteNameFromFreq', 'nearestNote', 'fmt',
  'tubeLen', 'holeDiam', 'holeShapeDiameter', 'curveBowAmplitudeIn',
  'FLUTE_CONST', 'HOLE_SHAPES', 'SCALE_CONFIGS', 'BORES', 'DRONE_INTERVALS', 'HARMONY_PRESETS',
  'recommendedBores',
  // geometry + assistants
  'buildChamberGeometry', 'ergonomicAdjustHoles', 'analyzeFingerReach', 'analyzeAntlerFit',
  'validateChamberGeometry', 'validateAllChambers', 'fixChamberGeometry', 'fixAllChambers',
  'DIAM_CENTS_PER_PCT',
  // duduk
  'dudukTubeLen', 'recommendedDudukBore', 'dudukHoleDiam', 'DUDUK_STYLES', 'DUDUK_HOLES_8',
  // flow studio
  'FLOW_DEFAULT_DESIGN', 'FLOW_AIR', 'IN2M', 'CRAFTING_DIMS', 'computeFluteAeroacoustics',
  'scoreFlowQuality', 'optimizeNestForDesign', 'optimizeEverything', 'bestPressureForNest',
  // CAM
  'toUnits', 'gcodeHeader', 'gcodeFooter', 'CNC_DIALECTS', 'COMMON_BIT_SIZES_IN',
  'snapToCommonBit', 'computeEasyModeParams', 'chamberYOffsets', 'SPLIT_FIT',
  'drillRoundHole', 'drillOneHole', 'generateSplitBlockGCode', 'generateTubeDrillingGCode',
  // tuner
  'autoCorrelatePitch',
  // G-code reader (drives the toolpath viewer and the milled-blank export)
  'parseGCode', 'stripComments', 'tokenizeWords', 'arcPoints',
];

let src = fs.readFileSync(jsxPath, 'utf8');
const bootstrap = 'ReactDOM.createRoot(document.getElementById("root")).render(<App/>);';
if (src.includes(bootstrap)) src = src.replace(bootstrap, '// bootstrap removed by extract-js.mjs');
src += `\n\nexport { ${EXPORTS.join(', ')} };\n`;

const patched = path.join(work, 'source.jsx');
fs.writeFileSync(patched, src);

const stub = path.join(here, 'js-import-stub.js');
const aliases = [
  'react', 'react-dom/client', 'jspdf', 'three', 'three-bvh-csg',
  'three/examples/jsm/controls/OrbitControls.js',
  'three/examples/jsm/utils/BufferGeometryUtils.js',
  'three/examples/jsm/loaders/STLLoader.js',
  'three/examples/jsm/exporters/STLExporter.js',
  'three/examples/jsm/exporters/OBJExporter.js',
  'three/examples/jsm/exporters/PLYExporter.js',
  'three/examples/jsm/exporters/GLTFExporter.js',
].map((m) => `--alias:${m}=${stub}`);

const out = path.join(work, 'engine.mjs');
execFileSync('npx', ['--yes', 'esbuild', patched, '--bundle', '--format=esm', `--outfile=${out}`,
  '--log-level=error', ...aliases], { stdio: 'inherit', cwd: here });

console.log(`extract-js: ${path.basename(jsxPath)} -> ${path.relative(repoRoot, out)} (${EXPORTS.length} exports)`);
