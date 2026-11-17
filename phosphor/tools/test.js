#!/usr/bin/env node
/* Engine invariants. Run after touching src/engine.js or the constants in it. */
'use strict';
const assert = require('assert');
const E = require('../src/engine.js');
const LV = require('../src/levels.js');
const { verifyToggles } = require('../src/solver.js');
const C = E.C;
let n = 0;
function test(name, fn) { fn(); n++; console.log('ok  ' + name); }
function flat(rows) { return E.compile({ id: 't', name: 't', bpm: 120, song: 'x', chunks: [rows] }); }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, msg + ': got ' + a + ', want ' + b + ' +/- ' + tol);

test('a jump lasts one beat, covers four blocks, peaks near 2.2', () => {
  const L = flat(['.'.repeat(64)]), s = E.newState();
  for (let i = 0; i < 10; i++) E.step(L, s, false);
  const x0 = s.x, t0 = s.t; let apex = 0;
  E.step(L, s, true);
  while (!s.grounded) { E.step(L, s, false); apex = Math.max(apex, s.y - 0.5); }
  near((s.t - t0) / C.SPB, 1, 0.03, 'air time in beats');
  near(s.x - x0, 4, 0.12, 'jump length');
  near(apex, 2.2, 0.06, 'apex');
});

test('a pad throws you 1.25 beats / 5 blocks', () => {
  const L = flat(['........_' + '.'.repeat(40)]), s = E.newState();
  while (s.grounded && s.x < 12) E.step(L, s, false);
  const x0 = s.x, t0 = s.t;
  while (!s.grounded) E.step(L, s, false);
  near((s.t - t0) / C.SPB, 1.25, 0.04, 'pad air time');
  near(s.x - x0, 5, 0.2, 'pad length');
});

test('running into a wall or a spike ends the run; a spike can be jumped', () => {
  let L = flat(['......#' + '.'.repeat(20)]), s = E.newState();
  while (!s.dead && s.x < 12) E.step(L, s, false);
  assert.ok(s.dead && s.x < 6.5, 'wall');
  L = flat(['......^' + '.'.repeat(20)]); s = E.newState();
  while (!s.dead && s.x < 12) E.step(L, s, false);
  assert.ok(s.dead, 'spike');
  s = E.newState();
  while (!s.dead && s.x < 12) E.step(L, s, s.x > 4.4 && s.x < 4.8);
  assert.ok(!s.dead, 'jumped the spike');
});

test('rings need a fresh press; holding through one does nothing', () => {
  const rows = ['......o' + '.'.repeat(20), '.'.repeat(27), '.'.repeat(27)];
  let L = flat(rows), s = E.newState(), used = false, ev = [];
  while (s.x < 10) { E.step(L, s, s.x > 4, ev); }
  assert.ok(!ev.some(e => e.type === 'ring'), 'held press should not trigger');
  s = E.newState(); ev = [];
  while (s.x < 10) { E.step(L, s, (s.x > 4 && s.x < 4.3) || (s.x > 6.2 && s.x < 6.6), ev); }
  assert.ok(ev.some(e => e.type === 'ring'), 'fresh press should trigger');
});

test('gravity gates flip the fall direction and speed gates change pace', () => {
  const L = flat(['##########################', '..........................', '..........................', '....U.......3.............', '..........................']);
  const s = E.newState();
  while (s.x < 10) E.step(L, s, false);
  assert.strictEqual(s.grav, -1); assert.ok(s.grounded && s.y > 3, 'standing on the ceiling');
  while (s.x < 14) E.step(L, s, false);
  assert.strictEqual(s.speed, 1.25);
});

test('every built-in level has a stored bot run that still wins with all cores', () => {
  const D = require('../src/demos.js');
  LV.levels.forEach(def => {
    const L = E.compile(def), tg = D[def.id];
    assert.ok(tg, 'no demo for ' + def.id + ' (run tools/solve.js all --coins --write)');
    const end = verifyToggles(L, tg);
    assert.ok(end.done, def.id + ': stored run dies at x=' + end.x.toFixed(1) + ' (regenerate demos)');
    assert.strictEqual(end.coins, (1 << L.coins) - 1, def.id + ': stored run misses a core');
    assert.ok(L.coins <= 3, def.id + ': more than 3 cores');
  });
});

console.log(n + ' tests passed');
