// Compares the JS reference output against the Kotlin port's output.
// Usage: node compare.mjs <js.json> <kt.json>
//
// Exits non-zero if anything drifts that is not on the known-benign list.
// Known benign (documented in tools/parity/README.md):
//   * signed zero — JS toFixed keeps the sign ("-0.000"), BigDecimal does not
//     ("0.000"); numerically identical, machine-identical.
//   * fields the JS early-returns omit but a Kotlin data class always carries
//     as null (analyzeAntlerFit's bore/usableTubeLen/sacLen when it bails).
import fs from 'node:fs';

const [, , jsPath, ktPath] = process.argv;
if (!jsPath || !ktPath) {
  console.error('usage: node compare.mjs <js.json> <kt.json>');
  process.exit(2);
}
const js = JSON.parse(fs.readFileSync(jsPath, 'utf8'));
const kt = JSON.parse(fs.readFileSync(ktPath, 'utf8'));

const TOL = 2e-6;
const numRe = /-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi;
const findings = [];
let okCount = 0;
let cmpCount = 0;

// "-0.000" vs "0.000" only.
const signedZeroOnly = (a, b) =>
  typeof a === 'string' && typeof b === 'string' &&
  a.replace(/-(0(?:\.0+)?)\b/g, '$1') === b.replace(/-(0(?:\.0+)?)\b/g, '$1');

const closeEnough = (a, b) =>
  typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= TOL + Math.abs(b) * 1e-9;

function stringNumEq(a, b) {
  if (a === b) return true;
  if (a.replace(numRe, '#') !== b.replace(numRe, '#')) return false;
  const na = a.match(numRe) || [];
  const nb = b.match(numRe) || [];
  if (na.length !== nb.length) return false;
  return na.every((v, i) => Math.abs(parseFloat(v) - parseFloat(nb[i])) <= 1e-6 + Math.abs(parseFloat(nb[i])) * 1e-9);
}

function walk(path, a, b) {
  cmpCount++;
  if (a === null || b === null || a === undefined || b === undefined) {
    if (a === b) okCount++;
    else findings.push({ path, kind: 'null-mismatch', js: a, kt: b, benign: false });
    return;
  }
  if (typeof a === 'number' || typeof b === 'number') {
    if (closeEnough(a, b)) okCount++;
    else findings.push({ path, kind: 'number', js: a, kt: b, benign: false });
    return;
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    if (a === b) okCount++;
    else findings.push({ path, kind: 'bool', js: a, kt: b, benign: false });
    return;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    if (a === b) { okCount++; return; }
    if (a.includes('\n') || b.includes('\n')) {
      const la = a.split('\n');
      const lb = b.split('\n');
      const diffs = [];
      for (let i = 0; i < Math.max(la.length, lb.length); i++) {
        if (la[i] !== lb[i]) diffs.push({ line: i + 1, js: la[i] ?? '<missing>', kt: lb[i] ?? '<missing>' });
      }
      const benign = diffs.every((d) => signedZeroOnly(d.js, d.kt));
      findings.push({ path, kind: 'gcode', jsLines: la.length, ktLines: lb.length,
        diffCount: diffs.length, benign, sample: diffs.filter((d) => !signedZeroOnly(d.js, d.kt)).slice(0, 12) });
      return;
    }
    if (signedZeroOnly(a, b)) { findings.push({ path, kind: 'signed-zero', js: a, kt: b, benign: true }); return; }
    if (stringNumEq(a, b)) { findings.push({ path, kind: 'numeric-drift', js: a, kt: b, benign: false }); return; }
    findings.push({ path, kind: 'string', js: a, kt: b, benign: false });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { findings.push({ path, kind: 'array-length', js: a.length, kt: b.length, benign: false }); return; }
    a.forEach((v, i) => walk(`${path}[${i}]`, v, b[i]));
    return;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a) || !(k in b)) {
        // A Kotlin data class always carries its fields; JS omits them on an
        // early return. Only benign when the extra side is null.
        const extraIsNull = (!(k in a) && b[k] === null) || (!(k in b) && a[k] === null);
        findings.push({ path: `${path}.${k}`, kind: 'missing-key', js: k in a, kt: k in b, benign: extraIsNull });
        continue;
      }
      walk(`${path}.${k}`, a[k], b[k]);
    }
    return;
  }
  findings.push({ path, kind: 'type', js: typeof a, kt: typeof b, benign: false });
}

const allKeys = [...new Set([...Object.keys(js), ...Object.keys(kt)])].sort();
for (const k of allKeys) {
  if (!(k in js)) { findings.push({ path: k, kind: 'js-missing', benign: false }); continue; }
  if (!(k in kt)) { findings.push({ path: k, kind: 'kt-missing', benign: false }); continue; }
  walk(k, js[k], kt[k]);
}

const real = findings.filter((f) => !f.benign);
const benign = findings.filter((f) => f.benign);

console.log(`compared ${cmpCount} values across ${allKeys.length} groups; ${okCount} identical`);
console.log(`findings: ${real.length} real, ${benign.length} known-benign`);

for (const f of real) {
  if (f.kind === 'gcode') {
    console.log(`\n### ${f.path}  (js ${f.jsLines} lines / kt ${f.ktLines} lines, ${f.diffCount} differing)`);
    f.sample.forEach((d) => {
      console.log(`   L${d.line} JS: ${String(d.js).slice(0, 160)}`);
      console.log(`   L${d.line} KT: ${String(d.kt).slice(0, 160)}`);
    });
  } else {
    console.log(`[${f.kind}] ${f.path}\n    JS: ${JSON.stringify(f.js)}\n    KT: ${JSON.stringify(f.kt)}`);
  }
}
if (benign.length) {
  const byKind = {};
  benign.forEach((f) => { byKind[f.kind] = (byKind[f.kind] || 0) + 1; });
  console.log(`benign breakdown: ${JSON.stringify(byKind)}`);
}

if (real.length) {
  console.error(`\nPARITY FAILED: ${real.length} real difference(s) vs the original JS.`);
  process.exit(1);
}
console.log('\nPARITY OK: Kotlin port matches the original JS.');
