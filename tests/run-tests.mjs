// Automated checks for the Token Launch Radar (radar-3) entry.
// Node >= 22, standard library only. Usage:
//   node tests/run-tests.mjs [snapshot.json]
// Defaults to the make.fun kit snapshot used for local validation.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = process.argv[2] ||
  join(repo, '..', 'token-radar-01-kit', 'token-radar-01-kit', 'input', 'snapshot.json');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { failures++; console.log('FAIL  ' + name + ' — ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const out1 = mkdtempSync(join(tmpdir(), 'radar-t1-'));
const out2 = mkdtempSync(join(tmpdir(), 'radar-t2-'));
for (const dir of [out1, out2]) {
  execFileSync('node', ['main.ts', '--input', snapshot], {
    cwd: repo, env: { ...process.env, MAKEFUN_OUTPUT_DIR: dir }, stdio: 'pipe',
  });
}
const board = JSON.parse(readFileSync(join(out1, 'board.json'), 'utf8'));
const dataJs = readFileSync(join(out1, 'data.js'), 'utf8');
const D = JSON.parse(dataJs.slice(dataJs.indexOf('=') + 1).replace(/;\s*$/, ''));
const snap = JSON.parse(readFileSync(snapshot, 'utf8'));

test('board shape: 100-4000 rows, ranks exactly 1..N, unique slugs', () => {
  const rows = board.rows;
  assert(rows.length >= 100 && rows.length <= 4000, 'row count ' + rows.length);
  const seen = new Set();
  rows.forEach((r, i) => {
    assert(r.rank === i + 1, 'rank gap at index ' + i);
    assert(!seen.has(r.slug), 'duplicate slug ' + r.slug);
    seen.add(r.slug);
  });
});

test('board ordering: implied positive, <= 1e14, non-increasing, not all equal', () => {
  const v = board.rows.map((r) => r.implied_value_usd);
  v.forEach((x) => assert(x > 0 && x <= 1e14, 'implied out of range: ' + x));
  for (let i = 1; i < v.length; i++) assert(v[i] <= v[i - 1], 'increases at rank ' + (i + 1));
  assert(new Set(v).size > 1, 'all implied values equal');
});

test('watchlist coverage: every snapshot watchlist slug is on the board', () => {
  const onBoard = new Set(board.rows.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !onBoard.has(s));
  assert(missing.length === 0, 'missing: ' + missing.join(', '));
  assert(D.stats.watchlist === snap.watchlist.length, 'stats.watchlist mismatch');
});

test('farm plans: 3-12 steps per row, each 20-600 chars trimmed', () => {
  for (const r of board.rows) {
    assert(r.farm_steps.length >= 3 && r.farm_steps.length <= 12,
      r.slug + ' has ' + r.farm_steps.length + ' steps');
    for (const s of r.farm_steps) {
      const n = s.trim().length;
      assert(n >= 20 && n <= 600, r.slug + ' step length ' + n);
      assert(s === s.trim(), r.slug + ' step has stray whitespace');
    }
  }
});

test('determinism: two runs produce byte-identical board, data and dossier', () => {
  for (const f of ['board.json', 'data.js', 'dossier.json']) {
    const a = readFileSync(join(out1, f));
    const b = readFileSync(join(out2, f));
    assert(a.equals(b), f + ' differs between runs');
  }
});

test('model consistency: full-precision factors recompute every implied value', () => {
  // Mirrors the dashboard's own impliedOf(): the multiple ships at full
  // precision; growth / maturity / breadth are recomputed from the raw
  // snapshot fields (their shipped copies are rounded for display).
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const byRank = new Map(board.rows.map((r) => [r.rank, r]));
  for (const r of D.rows) {
    const g = 1 + (clamp(r.change7d == null ? 0 : r.change7d, -50, 100) / 100) * 0.5;
    const mat = 0.6 + (Math.min(r.ageDays, 1095) / 1095) * 0.4;
    const br = 1 + 0.01 * Math.min(r.chains.length, 8);
    assert(Math.abs(g - r.growthMult) < 5e-4, r.slug + ' shipped growthMult is not the display rounding of the factor');
    assert(Math.abs(mat - r.maturity) < 5e-5, r.slug + ' shipped maturity is not the display rounding of the factor');
    assert(Math.abs(br - r.breadth) < 1e-9, r.slug + ' breadth mismatch');
    const v = Math.max(1, Math.round(r.tvl * r.multiple * g * mat * br));
    assert(v === r.implied, r.slug + ' recompute ' + v + ' != shipped ' + r.implied);
    assert(byRank.get(r.rank).implied_value_usd === r.implied, r.slug + ' board/data implied differ');
    assert(byRank.get(r.rank).slug === r.slug, 'rank ' + r.rank + ' slug differs board vs data');
  }
});

test('value bands: lo positive and hi >= lo on every row', () => {
  for (const r of D.rows) {
    assert(r.lo > 0, r.slug + ' lo not positive');
    assert(r.hi >= r.lo, r.slug + ' hi < lo');
  }
});

test('live set: 144 live-token protocols, ratios consistent with mcap/TVL', () => {
  assert(D.live.length === 144, 'live count ' + D.live.length);
  for (const r of D.live) {
    // The snapshot itself records mcap_usd = 0 for some live tokens
    // (e.g. ailayer-farm) and -1 as its not-priced sentinel (autofinance);
    // the model ships the figure as recorded, with ratio 0 for both.
    assert(r.tvl > 0 && r.mcap >= -1, r.slug + ' live row missing figures');
    if (r.mcap < 0) assert(r.ratio === 0, r.slug + ' sentinel mcap must ship ratio 0');
    const exact = Math.max(0, r.mcap) / r.tvl;
    assert(Math.abs(r.ratio - exact) <= 1e-3 + 1e-3 * exact, r.slug + ' ratio off');
  }
});

test('dashboard hygiene: source <= 60000 bytes total, no external URLs', () => {
  const dir = join(repo, 'dashboard');
  const files = readdirSync(dir);
  let total = 0;
  for (const f of files) {
    const body = readFileSync(join(dir, f), 'utf8');
    total += Buffer.byteLength(body);
    assert(!/https?:\/\//.test(body), f + ' references an external URL');
  }
  assert(total <= 60000, 'dashboard source ' + total + ' bytes');
});

test('screenshots: exactly 3 PNGs at 1440x900, each <= 512 KiB', () => {
  const dir = join(out1, 'screenshots');
  const files = readdirSync(dir).filter((f) => f.endsWith('.png'));
  assert(files.length === 3, 'found ' + files.length + ' pngs');
  for (const f of files) {
    const buf = readFileSync(join(dir, f));
    assert(buf.length <= 512 * 1024, f + ' is ' + buf.length + ' bytes');
    assert(buf.toString('ascii', 1, 4) === 'PNG', f + ' is not a PNG');
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    assert(w === 1440 && h === 900, f + ' is ' + w + 'x' + h);
  }
});

test('v1 parity (optional): same slugs, ranks and implied values as radar-2', () => {
  const v1path = process.env.V1_BOARD || join(repo, '..', 'token-radar-01-repo', 'out1', 'board.json');
  let v1;
  try { v1 = JSON.parse(readFileSync(v1path, 'utf8')); }
  catch { console.log('       (skipped: v1 board not found at ' + v1path + ')'); return; }
  assert(v1.rows.length === board.rows.length, 'row counts differ: v1 ' + v1.rows.length + ' vs v2 ' + board.rows.length);
  const a = new Map(v1.rows.map((r) => [r.slug, r]));
  for (const r of board.rows) {
    const o = a.get(r.slug);
    assert(o, r.slug + ' missing from v1 board');
    assert(o.rank === r.rank, r.slug + ' rank v1 ' + o.rank + ' vs v2 ' + r.rank);
    assert(o.implied_value_usd === r.implied_value_usd,
      r.slug + ' implied v1 ' + o.implied_value_usd + ' vs v2 ' + r.implied_value_usd);
  }
});

console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
