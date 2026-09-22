// Per-group SHA-256 of the JS reference output. Tiny compared with the ~3 MB
// of raw JSON, and enough to detect the JSX source changing under the port.
// Usage: node golden.mjs write|check <js.json> <golden.sha256>
import crypto from 'node:crypto';
import fs from 'node:fs';

const [, , mode, jsonPath, goldenPath] = process.argv;
if (!['write', 'check'].includes(mode) || !jsonPath || !goldenPath) {
  console.error('usage: node golden.mjs write|check <js.json> <golden.sha256>');
  process.exit(2);
}
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const lines = Object.keys(data).sort().map((k) => {
  const h = crypto.createHash('sha256').update(JSON.stringify(data[k])).digest('hex').slice(0, 32);
  return `${h}  ${k}`;
});

if (mode === 'write') {
  fs.writeFileSync(goldenPath, lines.join('\n') + '\n');
  console.log(`golden: wrote ${lines.length} group hashes`);
  process.exit(0);
}

if (!fs.existsSync(goldenPath)) {
  console.log('golden: no manifest yet (run with --update to create one)');
  process.exit(0);
}
const want = fs.readFileSync(goldenPath, 'utf8').trim().split('\n');
const wantMap = new Map(want.map((l) => { const [h, ...rest] = l.split(/\s+/); return [rest.join(' '), h]; }));
const gotMap = new Map(lines.map((l) => { const [h, ...rest] = l.split(/\s+/); return [rest.join(' '), h]; }));
let bad = 0;
for (const [k, h] of gotMap) {
  if (!wantMap.has(k)) { console.error(`  golden: new group not in manifest: ${k}`); bad++; continue; }
  if (wantMap.get(k) !== h) { console.error(`  golden: JS reference changed for ${k}`); bad++; }
}
for (const k of wantMap.keys()) if (!gotMap.has(k)) { console.error(`  golden: group disappeared: ${k}`); bad++; }
if (bad) {
  console.error(`golden: ${bad} group(s) drifted — the JSX source or the driver changed. Re-run with --update if intended.`);
  process.exit(1);
}
console.log(`golden: JS reference matches the manifest (${lines.length} groups)`);
