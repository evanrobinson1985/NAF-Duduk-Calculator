// Classifies differing G-code lines as "last-digit rounding" vs "real", so a
// formatting drift can never hide a toolpath change.
// Usage: node classify-gcode.mjs <js.json> <kt.json>
import fs from 'node:fs';

const [, , jsPath, ktPath] = process.argv;
if (!jsPath || !ktPath) {
  console.error('usage: node classify-gcode.mjs <js.json> <kt.json>');
  process.exit(2);
}
const js = JSON.parse(fs.readFileSync(jsPath, 'utf8'));
const kt = JSON.parse(fs.readFileSync(ktPath, 'utf8'));
const numRe = /-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g;

let totalRounding = 0;
let totalReal = 0;
let programs = 0;
let jsLines = 0;
const realSamples = [];

for (const k of Object.keys(js)) {
  if (typeof js[k] !== 'string' || !js[k].includes('\n')) continue;
  if (typeof kt[k] !== 'string') continue;
  programs++;
  const la = js[k].split('\n');
  const lb = kt[k].split('\n');
  jsLines += la.length;
  let rounding = 0;
  let real = 0;
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    const a = la[i] ?? '<missing>';
    const b = lb[i] ?? '<missing>';
    if (a === b) continue;
    const na = a.match(numRe) || [];
    const nb = b.match(numRe) || [];
    let isRounding = a.replace(numRe, '#') === b.replace(numRe, '#') && na.length === nb.length;
    if (isRounding) {
      for (let j = 0; j < na.length; j++) {
        const decimals = (na[j].split('.')[1] || '').length;
        const unit = decimals > 0 ? 10 ** -decimals : 1;
        if (Math.abs(parseFloat(na[j]) - parseFloat(nb[j])) > unit * 1.001) { isRounding = false; break; }
      }
    }
    if (isRounding) rounding++;
    else { real++; if (realSamples.length < 20) realSamples.push({ key: k, line: i + 1, js: a, kt: b }); }
  }
  totalRounding += rounding;
  totalReal += real;
  if (real > 0) console.log(`  ${k}: ${rounding} rounding, ${real} REAL`);
}

console.log(`G-code: ${programs} programs, ${jsLines} reference lines — ${totalRounding} last-digit rounding diffs, ${totalReal} real diffs`);
if (realSamples.length) {
  console.log('\n=== REAL G-CODE DIFFERENCES ===');
  realSamples.forEach((s) => {
    console.log(`[${s.key}] line ${s.line}`);
    console.log(`  JS: ${s.js.slice(0, 200)}`);
    console.log(`  KT: ${s.kt.slice(0, 200)}`);
  });
  process.exit(1);
}
