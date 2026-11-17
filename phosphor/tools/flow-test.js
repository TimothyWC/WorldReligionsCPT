#!/usr/bin/env node
/* Browser flow test: the paths the smoke test does not reach.
   Practice checkpoints, death and respawn, pause / resume / restart / mode switch / quit,
   saved progress across a reload, settings, held input across a death, next level. */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const file = 'file://' + (process.env.PHOSPHOR_DIST ? path.resolve(process.env.PHOSPHOR_DIST) : path.join(__dirname, '..', 'dist')) + '/phosphor.html';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 640 } });
  const page = await ctx.newPage();
  const errors = [];
  let checks = 0;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const ok = (cond, msg) => { checks++; if (!cond) errors.push('FAIL: ' + msg); };
  const G = fn => page.evaluate(fn);
  const until = (fn, ms, arg) => page.waitForFunction(fn, arg, { timeout: ms || 15000 }).then(() => true, () => false);

  await page.goto(file);
  await until(() => window.__phosphor && window.__phosphor.G.mode === 'menu');

  // --- practice: die before any checkpoint, respawn at the start
  await G(() => window.__phosphor.startLevel(0, true));
  ok(await until(() => window.__phosphor.G.mode === 'dead'), 'idle player should die at the first spike');
  const deathX = await G(() => window.__phosphor.G.s.x);
  ok(deathX > 14 && deathX < 19, 'first death near the first spike, got x=' + deathX);
  ok(await until(() => window.__phosphor.G.mode === 'play' && window.__phosphor.G.attempts === 2), 'respawn after death');
  ok(await G(() => window.__phosphor.G.s.x < 3), 'respawn at the start when there is no checkpoint');
  ok(await G(() => !document.getElementById('cpBar').hidden), 'checkpoint buttons visible in practice');

  // --- bot plays on, auto checkpoints appear, then the bot lets go and we respawn at one
  await G(() => { const P = window.__phosphor; P.G.auto = true; P.G.scale = 4; });
  ok(await until(() => window.__phosphor.G.cps.length >= 2, 30000), 'auto checkpoints are placed');
  const cp = await G(() => { const P = window.__phosphor; P.G.auto = false; P.G.scale = 1; const c = P.G.cps[P.G.cps.length - 1]; return { x: c.x, n: P.G.cps.length, att: P.G.attempts }; });
  ok(await until(a => window.__phosphor.G.attempts > a && window.__phosphor.G.mode === 'play', 20000, cp.att), 'dies and respawns once the bot lets go');
  const after = await G(() => ({ x: window.__phosphor.G.s.x, t: window.__phosphor.G.s.t, target: window.__phosphor.G.target }));
  ok(after.x >= cp.x - 0.01 && after.x < cp.x + 6, 'respawn at the last checkpoint (cp ' + cp.x.toFixed(1) + ', now ' + after.x.toFixed(1) + ')');
  ok(Math.abs(after.target - after.t / 96) < 0.6, 'song clock follows the checkpoint');

  // --- manual checkpoint add / remove
  await G(() => { const P = window.__phosphor; P.G.auto = true; });
  const n0 = await G(() => window.__phosphor.G.cps.length);
  await page.keyboard.press('KeyZ');
  ok(await G(() => window.__phosphor.G.cps.length) === n0 + 1, 'Z adds a checkpoint');
  await page.keyboard.press('KeyX');
  ok(await G(() => window.__phosphor.G.cps.length) === n0, 'X removes it');
  await page.click('#btnCp');
  ok(await G(() => window.__phosphor.G.cps.length) === n0 + 1, 'the Checkpoint button adds one');

  // --- pause / resume
  await page.keyboard.press('KeyP');
  ok(await G(() => window.__phosphor.G.mode) === 'pause', 'P pauses');
  const frozen = await G(() => window.__phosphor.G.s.t);
  await page.waitForTimeout(300);
  ok(await G(() => window.__phosphor.G.s.t) === frozen, 'the sim does not advance while paused');
  ok(await G(() => !document.getElementById('pause').hidden), 'pause panel is shown');
  await page.click('#btnResume');
  ok(await G(() => window.__phosphor.G.mode) === 'play', 'Resume continues');
  await page.waitForTimeout(200);
  ok(await G(() => window.__phosphor.G.s.t) > frozen, 'the sim advances again');

  // --- settings from pause go back to pause
  await page.keyboard.press('Escape');
  await page.click('#btnPauseSettings');
  ok(await G(() => !document.getElementById('settings').hidden), 'settings open from pause');
  await page.evaluate(() => { const v = document.getElementById('volMusic'); v.value = 35; v.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#optCalm');
  await page.click('#btnSetClose');
  ok(await G(() => !document.getElementById('pause').hidden && window.__phosphor.G.mode === 'pause'), 'closing settings returns to pause');

  // --- restart level clears checkpoints
  await page.click('#btnRestart');
  const rs = await G(() => { const P = window.__phosphor; return { mode: P.G.mode, x: P.G.s.x, cps: P.G.cps.length, att: P.G.attempts, practice: P.G.practice }; });
  ok(rs.mode === 'play' && rs.x < 3 && rs.cps === 0 && rs.att === 1 && rs.practice, 'Restart level: fresh run in the same mode ' + JSON.stringify(rs));

  // --- switch to normal
  await page.keyboard.press('KeyP');
  await page.click('#btnToggleMode');
  const nm = await G(() => { const P = window.__phosphor; return { mode: P.G.mode, practice: P.G.practice, bar: document.getElementById('cpBar').hidden }; });
  ok(nm.mode === 'play' && !nm.practice && nm.bar, 'Switch to normal ' + JSON.stringify(nm));

  // --- held input across a death must not jump on respawn
  await G(() => { const P = window.__phosphor; P.G.auto = false; });
  await page.keyboard.down('Space');
  ok(await until(() => window.__phosphor.G.mode === 'dead', 20000), 'holding jump forever still dies somewhere');
  ok(await until(() => window.__phosphor.G.mode === 'play'), 'respawn while still holding');
  await page.waitForTimeout(250);
  const held = await G(() => ({ y: window.__phosphor.G.s.y, block: window.__phosphor.input.block }));
  ok(held.y < 0.6 && held.block, 'no jump on respawn while the key is still held ' + JSON.stringify(held));
  await page.keyboard.up('Space');
  await page.keyboard.down('Space');
  await page.waitForTimeout(120);
  ok(await G(() => window.__phosphor.G.s.y) > 0.8, 'a fresh press jumps');
  await page.keyboard.up('Space');

  // --- best progress is saved and shown on the card
  ok(await until(() => window.__phosphor.G.mode === 'dead', 20000), 'dies again');
  const best = await G(() => window.__phosphor.save.lv.trace.n);
  ok(best > 0, 'normal-mode best is recorded (' + best + '%)');
  await until(() => window.__phosphor.G.mode === 'play');
  await page.keyboard.press('KeyP');
  await page.click('#btnQuit');
  const menu = await G(() => ({ mode: window.__phosphor.G.mode, hud: document.getElementById('hud').hidden, card: document.querySelector('.card[data-i="0"] .prog b').textContent }));
  ok(menu.mode === 'menu' && menu.hud && menu.card === best + '%', 'back to levels shows the saved best ' + JSON.stringify(menu));

  // --- reload keeps progress and settings
  await page.reload();
  await until(() => window.__phosphor && window.__phosphor.G.mode === 'menu');
  const re = await G(() => ({ n: window.__phosphor.save.lv.trace.n, music: window.__phosphor.save.music, calm: window.__phosphor.save.calm, p: window.__phosphor.save.lv.trace.p }));
  ok(re.n === best && re.music === 35 && re.calm === true && re.p > 0, 'save survives a reload ' + JSON.stringify(re));

  // --- settings and how-to from the menu, Escape closes
  await page.click('#btnSettings');
  ok(await G(() => document.getElementById('volMusic').value) === '35', 'settings show the saved volume');
  await page.keyboard.press('Escape');
  ok(await G(() => !document.getElementById('menu').hidden), 'Escape closes settings back to the menu');
  await page.click('#btnHow');
  ok(await G(() => !document.getElementById('how').hidden), 'how to play opens');
  await page.click('#btnHowClose');

  // --- finish a level, results, next level
  await G(() => { const P = window.__phosphor; P.G.auto = true; P.startLevel(0, false); P.G.scale = 6; });
  ok(await until(() => window.__phosphor.G.mode === 'done' && window.__phosphor.G.shown, 60000), 'bot finishes level 1');
  const done = await G(() => ({ rec: window.__phosphor.save.lv.trace, cores: document.getElementById('stCores').textContent, next: document.getElementById('btnNext').hidden }));
  ok(done.rec.n === 100 && done.rec.done === 1 && done.rec.cores === 7 && done.cores === '3/3' && !done.next, 'results and save after a clear ' + JSON.stringify(done));
  await page.waitForTimeout(800);
  await page.click('#btnNext');
  const nx = await G(() => ({ mode: window.__phosphor.G.mode, id: window.__phosphor.G.L.id }));
  ok(nx.mode === 'play' && nx.id === 'carrier', 'Next level starts level 2 ' + JSON.stringify(nx));

  // --- R restarts, window blur releases input, tab hide pauses
  await G(() => { const P = window.__phosphor; P.G.auto = false; P.G.scale = 1; });
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyR');
  const rr = await G(() => ({ x: window.__phosphor.G.s.x, att: window.__phosphor.G.attempts }));
  ok(rr.x < 2 && rr.att === 2, 'R restarts the attempt ' + JSON.stringify(rr));
  await page.keyboard.down('Space');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  ok(await G(() => window.__phosphor.input.hold) === false, 'losing focus releases the jump key');
  await page.keyboard.up('Space');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  ok(await G(() => window.__phosphor.G.mode) === 'pause', 'hiding the tab pauses the run');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); });
  await page.click('#btnQuit');

  // --- glyph unlocks: 3 cores from level 1 unlock the third glyph (needs 2), not the fourth (needs 4)
  await page.click('#btnSettings');
  const gl = await G(() => Array.from(document.querySelectorAll('#skins button')).map(b => b.disabled));
  ok(gl[0] === false && gl[1] === false && gl[2] === false && gl[3] === true, 'glyph locks follow cores ' + JSON.stringify(gl));
  await page.click('#skins button[data-skin="2"]');
  await page.click('#btnSetClose');
  ok(await G(() => window.__phosphor.save.skin) === 2, 'picked glyph is saved');

  await browser.close();
  if (errors.length) { console.log('flow test: ' + checks + ' checks\n  ' + errors.join('\n  ')); process.exit(1); }
  console.log('flow test passed: ' + checks + ' checks');
})();
