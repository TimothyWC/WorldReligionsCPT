#!/usr/bin/env node
/* Bot playtest: how forgiving is the timing?
   The solver is only allowed to change its input on a coarse time grid. If the level is still
   beatable on a grid of G ms at EVERY phase of that grid, then every required input has a window
   of at least about G ms (and no tap has to be shorter than G). Prints the widest passing grid
   per level and where the first failure is, which is the tightest spot in the level.
   usage: node tools/windows.js [levelId|all] */
'use strict';
const E = require('../src/engine.js');
const LV = require('../src/levels.js');
const { solve } = require('../src/solver.js');
const C = E.C;
const GRIDS = [4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32];

function analyse(def) {
  const L = E.compile(def);
  const msPerStep = 60000 / def.bpm / C.SPB;
  let pass = 0, fail = null;
  for (const G of GRIDS) {
    let worst = null;
    for (let p = 0; p < G; p += (G > 8 ? 2 : 1)) {
      const r = solve(L, { margin: 0, dec: G, phase: p, limit: 3e6 });
      if (!r.ok && (!worst || r.best < worst.x)) worst = { x: r.best, phase: p };
    }
    if (worst) { fail = { G, x: worst.x }; break; }
    pass = G;
  }
  console.log(def.id.padEnd(10) + ' ' + def.bpm + ' BPM  timing window >= ' + (pass * msPerStep).toFixed(0).padStart(3) + ' ms' +
    (fail ? '   first failure on a ' + (fail.G * msPerStep).toFixed(0) + ' ms grid at x=' + fail.x.toFixed(0) +
      ' (' + (100 * fail.x / L.endX).toFixed(0) + '%, beat ' + beatAt(L, fail.x).toFixed(1) + ')' : '   (never failed up to ' + (GRIDS[GRIDS.length - 1] * msPerStep).toFixed(0) + ' ms)'));
  return pass * msPerStep;
}

function beatAt(L, x) {
  const s = E.newState();
  while (s.x < x && !s.done) { s.dead = false; s.y = 50; s.mode = 1; s.bF = 40; s.bC = 60; E.step(L, s, true, null); if (s.t > 1e6) break; }
  return s.t / C.SPB;
}

const which = process.argv.slice(2).find(a => !a.startsWith('--')) || 'all';
LV.levels.forEach(def => { if (which === 'all' || def.id === which) analyse(def); });
