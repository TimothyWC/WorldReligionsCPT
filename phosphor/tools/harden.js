#!/usr/bin/env node
/* Makes levels harder without making them unfair, using the solver as the referee.
   It takes the bot's line through the hand-drawn level and proposes extra hazards around it:
     - mines beside the top of jump arcs (they cut the early or late side of a jump's timing window)
     - mines over jump arcs (pressure only)
     - one more spike on short spike rows (two wide at normal speed, three when the level runs fast)
     - mines above and below the line in flying and zigzag sections
   A proposal is kept only if the level is still beatable with the level's safety margin, and at the
   end every core must still be collectible in one run. Results go to src/extras.js.
   usage: node tools/harden.js [levelId|all] */
'use strict';
process.env.PHOSPHOR_NO_EXTRAS = '1';
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
const LV = require('../src/levels.js');
const { solve } = require('../src/solver.js');
const C = E.C;

/* margin: timing slack the level must keep (bigger = easier). every: use every Nth jump for side mines. */
const PLAN = {
  trace:     { margin: 0.26, every: 2, over: 3, fly: 9, grid: 22 },
  carrier:   { margin: 0.20, every: 2, over: 3, fly: 7, grid: 18 },
  sidebands: { margin: 0.15, every: 1, over: 3, fly: 6, grid: 14 },
  overdrive: { margin: 0.12, every: 1, over: 2, fly: 5, grid: 14 },
  sawtooth:  { margin: 0.08, every: 1, over: 2, fly: 5, grid: 12 }
};
/* grid: the level must stay beatable when inputs can only change every `grid` sim steps, at every phase.
   That is the timing window a player gets, in steps of 1/96 beat (see tools/windows.js). */
function timing(L, G) {
  // a coarser grid can pass by luck where a finer one fails, so check every grid up to the target
  for (let g = 6; g <= G; g += 2) {
    let worst = null;
    for (let p = 0; p < g; p += (g > 8 ? 2 : 1)) {
      const r = solve(L, { margin: 0, dec: g, phase: p, limit: 3e6 });
      if (!r.ok && (worst === null || r.best < worst)) worst = r.best;
    }
    if (worst !== null) return worst;   // the x where the tightest spot stops the bot
  }
  return null;                          // passes
}

function clone(def) { return Object.assign({}, def, { chunks: def.chunks.map(ch => ch.rows ? { pal: ch.pal, rows: ch.rows.slice() } : ch.slice()) }); }
function build(def, adds) { const d = clone(def); LV.lay(d.chunks, adds); return E.compile(d); }

function line(L, res) {
  const s = E.newState(), out = [];
  for (let d = 0; d < res.acts.length && !s.dead && !s.done; d++)
    for (let i = 0; i < res.dec && !s.dead && !s.done; i++) { E.step(L, s, res.acts[d], null); out.push({ x: s.x, y: s.y, mode: s.mode, grav: s.grav, gr: s.grounded, speed: s.speed }); }
  return out;
}
function tile(L, c, r) { const g = L.grid[c]; return g ? g[r] : undefined; }
function free(L, c, r, rad) {
  if (r < 0 || r > 11 || c < 10 || c > L.length - 8) return false;
  for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) if (tile(L, c + dx, r + dy)) return false;
  for (const g of L.gates) if (Math.abs(g.x - (c + 0.5)) < 2.6) return false;
  return true;
}
function speedAt(L, x) { let sp = 1; for (const g of L.gates) { if (g.x > x) break; if (C.SPEEDS[g.k]) sp = C.SPEEDS[g.k]; } return sp; }
function flying(L) {
  const z = []; let mode = 0, a = 0;
  for (const g of L.gates) { if ((g.k === 'G' || g.k === 'Z') && !mode) { mode = 1; a = g.x; } else if (g.k === 'H' && mode) { mode = 0; z.push([a - 1, g.x + 1]); } }
  if (mode) z.push([a - 1, L.endX]);
  return x => z.some(q => x >= q[0] && x <= q[1]);
}

function propose(L, pts, plan) {
  const mines = [], spikes = [];
  // jump arcs
  let j = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].mode !== C.HOP || pts[i].gr || !pts[i - 1].gr) continue;
    let k = i, top = i;
    while (k < pts.length && !pts[k].gr && pts[k].mode === C.HOP) { if (pts[k].y * pts[k].grav > pts[top].y * pts[top].grav) top = k; k++; }
    const a = pts[top], g = a.grav; j++;
    if (j % plan.every === 0) {
      const side = (j / plan.every) % 2 ? 1 : -1, d = 1.7 * a.speed;
      mines.push({ x: a.x + side * d, y: a.y, why: 'side' });
    }
    if (j % plan.over === 1) mines.push({ x: a.x, y: a.y + 2.0 * g, why: 'over' });
    i = k;
  }
  // flying line
  let last = -99, flip = 1;
  for (const p of pts) {
    if (p.mode === C.HOP || p.x - last < plan.fly) continue;
    last = p.x; flip = -flip;
    mines.push({ x: p.x, y: p.y + flip * (p.mode === C.ZIG ? 1.5 : 1.7), why: 'fly' });
  }
  // short spike rows
  const inFly = flying(L);
  for (let c = 8; c < L.length - 6; c++) {
    const g = L.grid[c]; if (!g || inFly(c)) continue;
    for (const key in g) {
      const t = g[key], y = +key;
      if ((t !== '^' && t !== 'v') || tile(L, c - 1, y) === t) continue;
      let n = 1; while (tile(L, c + n, y) === t) n++;
      const max = speedAt(L, c) >= 1.25 ? 3 : 2;
      if (n >= max) continue;
      const ok = cc => !tile(L, cc, y) && (t === '^' ? (y === 0 || tile(L, cc, y - 1) === '#') : tile(L, cc, y + 1) === '#') &&
        !tile(L, cc, y + (t === '^' ? 1 : -1)) && !L.gates.some(q => Math.abs(q.x - cc - 0.5) < 2);
      const opts = [];
      if (ok(c + n)) opts.push([c + n, y, t]);
      if (ok(c - 1)) opts.push([c - 1, y, t]);
      if (opts.length) spikes.push(opts);
    }
  }
  return { mines, spikes };
}

function harden(def) {
  const plan = PLAN[def.id];
  if (!plan) return null;
  const t0 = Date.now();
  const base = build(def, []);
  const ok = L => solve(L, { margin: plan.margin, limit: 2500000 }).ok;
  if (!ok(base)) { console.log(def.id + ': base level does not pass margin ' + plan.margin + ', lowering the bar'); plan.margin = Math.max(0.05, plan.margin - 0.06); if (!ok(base)) { console.log('  still failing, skipped'); return []; } }
  const ref = solve(base, { margin: plan.margin, limit: 2500000 });
  const pts = line(base, ref);
  const { mines, spikes } = propose(base, pts, plan);
  const adds = [], count = { side: 0, over: 0, fly: 0, spike: 0 }, tried = { side: 0, over: 0, fly: 0, spike: 0 };
  const taken = new Set();
  // spikes first (they shape the level), one row at a time, right side then left
  for (const opts of spikes) {
    tried.spike++;
    for (const o of opts) { if (ok(build(def, adds.concat([o])))) { adds.push(o); count.spike++; break; } }
  }
  // mines in small batches; a failed batch is retried one by one
  const cur = () => build(def, adds);
  const cand = [];
  let Lc = cur();
  for (const m of mines) {
    const c = Math.round(m.x - 0.5), r = Math.round(m.y - 0.5), key = c + ',' + r;
    tried[m.why]++;
    if (taken.has(key) || !free(Lc, c, r, 1)) continue;
    let near = false;
    for (const k of taken) { const q = k.split(','); if (Math.abs(q[0] - c) < 3 && Math.abs(q[1] - r) < 3) { near = true; break; } }
    if (near) continue;
    taken.add(key); cand.push({ add: [c, r, 'x'], why: m.why });
  }
  cand.sort((a, b) => a.add[0] - b.add[0]);
  for (let i = 0; i < cand.length; i += 5) {
    const batch = cand.slice(i, i + 5);
    if (ok(build(def, adds.concat(batch.map(b => b.add))))) { batch.forEach(b => { adds.push(b.add); count[b.why]++; }); continue; }
    for (const b of batch) if (ok(build(def, adds.concat([b.add])))) { adds.push(b.add); count[b.why]++; }
  }
  // every core must still be collectible on one winning run
  let L = build(def, adds);
  const all = (1 << L.coins) - 1;
  const cores = LL => !all || solve(LL, { margin: 0.1, needCoins: all, limit: 3e7 }).ok;
  if (!cores(L)) {
    const coinX = L.objs.filter(o => o.t === 'c').map(o => o.x);
    for (const radius of [8, 14, 22, 40, 1e9]) {
      const kept = adds.filter(a => !coinX.some(x => Math.abs(a[0] - x) <= radius));
      if (cores(build(def, kept))) { console.log('  cores: dropped ' + (adds.length - kept.length) + ' extras within ' + radius + ' columns of a core'); adds.length = 0; kept.forEach(k => adds.push(k)); break; }
    }
  }
  // repair: wherever the timing window fell below the target, take the extras around that spot back out
  let pulled = 0;
  for (let round = 0; round < 60; round++) {
    const x = timing(build(def, adds), plan.grid);
    if (x === null) break;
    let cut = 0;
    for (const span of [[6, 12], [10, 20], [16, 34]]) {
      const keep = adds.filter(a => a[0] < x - span[0] || a[0] > x + span[1]);
      cut = adds.length - keep.length;
      if (cut) { adds.length = 0; keep.forEach(k => adds.push(k)); break; }
    }
    if (!cut) { console.log('  timing: the hand-drawn level itself is below the target near x=' + x.toFixed(0)); break; }
    pulled += cut;
  }
  const ms = plan.grid * 60000 / def.bpm / C.SPB;
  if (pulled) console.log('  timing: pulled ' + pulled + ' extras back out to keep a ' + ms.toFixed(0) + ' ms window');
  L = build(def, adds);
  console.log(def.id.padEnd(10) + ' margin ' + plan.margin.toFixed(2) + '  kept ' + adds.length + ' extras  (spikes ' + count.spike + '/' + tried.spike +
    ', side mines ' + count.side + '/' + tried.side + ', over ' + count.over + '/' + tried.over + ', flying ' + count.fly + '/' + tried.fly + ')  ' +
    'beatable ' + ok(L) + '  cores ' + cores(L) + '  ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
  return adds.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

const which = process.argv.slice(2).find(a => !a.startsWith('--')) || 'all';
const file = path.join(__dirname, '..', 'src', 'extras.js');
let out = {};
try { out = require(file); } catch (e) { out = {}; }
LV.levels.forEach(def => { if (which === 'all' || def.id === which) { const r = harden(def); if (r) out[def.id] = r; } });
fs.writeFileSync(file,
  '/* generated by tools/harden.js : extra hazards per level as [x, y, tile]; applied in levels.js */\n' +
  '(function (root) {\n  var X = ' + JSON.stringify(out) + ';\n' +
  '  if (typeof module !== "undefined" && module.exports) module.exports = X; else root.PExtras = X;\n' +
  '})(typeof window !== "undefined" ? window : this);\n');
console.log('wrote ' + path.relative(process.cwd(), file));
