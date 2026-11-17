#!/usr/bin/env node
/* Proves levels are beatable by searching the input space with the real engine.
   usage: node tools/solve.js [levelId|all] [--margin=0.15] [--coins] [--write] [--map]
   --margin  inflates hazards and shrinks ledges, so a pass means a human has timing slack
   --coins   also proves each core can be collected on a winning run
   --write   saves a bot run per level to src/demos.js (used by "watch the bot") */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
const LV = require('../src/levels.js');
const C = E.C;

function key(s) {
  const yq = Math.round((s.y + 4) * 32);               // < 2048
  const vq = Math.round((s.vy + 12) * 8);              // < 256
  let k = yq;
  k = k * 256 + vq;
  k = k * 4 + s.mode;
  k = k * 2 + (s.grav === 1 ? 1 : 0);
  k = k * 2 + (s.grounded ? 1 : 0);
  k = k * 2 + (s.hold ? 1 : 0);
  k = k * 2 + (s.buf ? 1 : 0);
  k = k * 8 + (s.coins & 7);
  k = k * 8 + ((s.last + 1) & 7);
  return k;
}

function solve(L, opts) {
  opts = opts || {};
  const DEC = opts.dec || 4;
  const needCoins = opts.needCoins || 0;
  L.margin = opts.margin || 0;
  const visited = [];
  // a needed core that is already behind the player can never be collected: prune those branches early
  const need = L.objs.filter(o => o.t === 'c' && (o.bit & needCoins)).map(o => ({ bit: o.bit, x: o.x + 2.2 }));
  const stack = [{ s: E.newState(), a: 0, first: false, act: false }];
  let best = 0, bestState = null, nodes = 0;
  const limit = opts.limit || 4e7;
  while (stack.length) {
    const f = stack[stack.length - 1];
    if (f.a >= 2) { stack.pop(); continue; }
    const hold = f.a === 0 ? f.first : !f.first;
    f.a++;
    const s = E.copy(f.s);
    for (let i = 0; i < DEC && !s.dead && !s.done; i++) E.step(L, s, hold, null);
    nodes++;
    if (s.x > best) { best = s.x; bestState = E.copy(s); }
    if (s.done) {
      if ((s.coins & needCoins) !== needCoins) continue;
      const acts = [];
      for (let i = 1; i < stack.length; i++) acts.push(stack[i].act);
      acts.push(hold);
      L.margin = 0;
      return { ok: true, acts: acts, dec: DEC, nodes: nodes, steps: s.t };
    }
    if (s.dead) continue;
    let missed = false;
    for (let i = 0; i < need.length; i++) if (!(s.coins & need[i].bit) && s.x > need[i].x) { missed = true; break; }
    if (missed) continue;
    const d = Math.round(s.t / DEC);
    let set = visited[d];
    if (!set) set = visited[d] = new Set();
    const k = key(s);
    if (set.has(k)) continue;
    set.add(k);
    if (nodes > limit) break;
    // prefer not pressing as a hopper, prefer keeping the current input when flying
    const first = s.mode === C.HOP ? false : hold;
    stack.push({ s: s, a: 0, first: first, act: hold });
  }
  L.margin = 0;
  return { ok: false, best: best, bestState: bestState, nodes: nodes };
}

/* Replays a decision list and returns toggles as step indices (compact demo format). */
function toToggles(res) {
  const out = [];
  let prev = false;
  for (let i = 0; i < res.acts.length; i++) {
    if (res.acts[i] !== prev) { out.push(i * res.dec); prev = res.acts[i]; }
  }
  return out;
}

function verifyToggles(L, toggles) {
  const s = E.newState();
  let hold = false, ti = 0;
  while (!s.dead && !s.done && s.t < 1e6) {
    while (ti < toggles.length && toggles[ti] <= s.t) { hold = !hold; ti++; }
    E.step(L, s, hold, null);
  }
  return s;
}

function mapAround(L, x, w) {
  const x0 = Math.max(0, Math.floor(x) - w), x1 = Math.min(L.length - 1, Math.floor(x) + w);
  const lines = [];
  for (let y = Math.min(L.top, 13); y >= 0; y--) {
    let line = '';
    for (let c = x0; c <= x1; c++) line += (L.grid[c] && L.grid[c][y]) || '.';
    lines.push(String(y).padStart(2) + ' ' + line);
  }
  let ruler = '   ';
  for (let c = x0; c <= x1; c++) ruler += c === Math.floor(x) ? '!' : (c % 4 === 0 ? '|' : ' ');
  lines.push(ruler + '   x=' + x0 + '..' + x1 + '  (! = furthest, | = beat at 1x)');
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const flags = {};
  const names = [];
  args.forEach(a => {
    if (a.startsWith('--')) { const p = a.slice(2).split('='); flags[p[0]] = p[1] === undefined ? true : p[1]; }
    else names.push(a);
  });
  const which = names[0] || 'all';
  const margins = flags.margin !== undefined ? [parseFloat(flags.margin)] : [0, 0.1, 0.2, 0.3, 0.4];
  const demos = {};
  let allOk = true;
  LV.levels.forEach(def => {
    if (which !== 'all' && def.id !== which) return;
    const L = E.compile(def);
    const beats = L.length / 4;
    console.log('\n== ' + def.id + ' "' + def.name + '"  ' + def.bpm + ' BPM  length ' + L.length + ' blocks (~' +
      (beats * 60 / def.bpm).toFixed(0) + 's at 1x)  cores ' + L.coins + '  gates ' + L.gates.length);
    let passMargin = -1, base = null;
    for (const m of margins) {
      const t0 = Date.now();
      const r = solve(L, { margin: m });
      const ms = Date.now() - t0;
      if (r.ok) {
        passMargin = m;
        if (!base || m <= (flags.demoMargin ? parseFloat(flags.demoMargin) : 0.2)) base = r;
        console.log('  margin ' + m.toFixed(2) + ': OK    nodes ' + r.nodes + '  ' + ms + 'ms  presses ' + (toToggles(r).length / 2 | 0));
      } else {
        console.log('  margin ' + m.toFixed(2) + ': FAIL  furthest x=' + r.best.toFixed(1) + ' (beat ' + (r.bestState.t / C.SPB).toFixed(1) +
          ')  nodes ' + r.nodes + '  ' + ms + 'ms');
        if (m === 0 || flags.map) console.log(mapAround(L, r.best, 14));
        if (m === 0) allOk = false;
        break;
      }
    }
    if (base) {
      const tg = toToggles(base);
      const end = verifyToggles(L, tg);
      if (!end.done) { console.log('  !! demo replay failed at x=' + end.x.toFixed(1)); allOk = false; }
      demos[def.id] = tg;
    }
    if (flags.coins && passMargin >= 0) {
      for (let i = 0; i < L.coins; i++) {
        const r = solve(L, { margin: 0.1, needCoins: 1 << i });
        console.log('  core ' + (i + 1) + ': ' + (r.ok ? 'reachable' : 'NOT reachable (nodes ' + r.nodes + ')'));
        if (!r.ok) allOk = false;
      }
      const all = solve(L, { margin: 0.1, needCoins: (1 << L.coins) - 1 });
      console.log('  all cores in one run: ' + (all.ok ? 'yes' : 'NO'));
      if (all.ok && flags.write) demos[def.id] = toToggles(all);
      if (!all.ok) allOk = false;
    }
  });
  if (flags.write) {
    const file = path.join(__dirname, '..', 'src', 'demos.js');
    let prev = {};
    try { prev = require(file); } catch (e) { prev = {}; }
    Object.keys(demos).forEach(k => { prev[k] = demos[k]; });
    fs.writeFileSync(file,
      '/* generated by tools/solve.js --write : bot runs as hold-toggle step indices */\n' +
      '(function (root) {\n  var D = ' + JSON.stringify(prev) + ';\n' +
      '  if (typeof module !== "undefined" && module.exports) module.exports = D; else root.PDemos = D;\n' +
      '})(typeof window !== "undefined" ? window : this);\n');
    console.log('\nwrote ' + file);
  }
  process.exit(allOk ? 0 : 1);
}

if (require.main === module) main();
module.exports = { solve, toToggles, verifyToggles, mapAround };
