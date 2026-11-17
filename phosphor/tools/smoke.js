#!/usr/bin/env node
/* Browser smoke test: loads the standalone build, checks for errors, screenshots the menu and
   gameplay at desktop + phone sizes, then lets the bot clear a level at high speed in the real page.
   usage: node tools/smoke.js [outDir] [--full]   (--full autoplays every level to the end) */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(__dirname, '..', 'shots');
const full = process.argv.includes('--full');
const file = 'file://' + path.join(__dirname, '..', 'dist', 'phosphor.html');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  let failed = false;
  const sizes = [
    { name: 'desktop', width: 1280, height: 720, scale: 1 },
    { name: 'phone-land', width: 844, height: 390, scale: 1 },
    { name: 'phone-port', width: 390, height: 844, scale: 1 }
  ];
  for (const sz of sizes) {
    const ctx = await browser.newContext({ viewport: { width: sz.width, height: sz.height }, deviceScaleFactor: sz.scale, hasTouch: sz.name !== 'desktop' });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(sz.name + ': ' + m.text()); });
    page.on('pageerror', e => errors.push(sz.name + ' pageerror: ' + e.message));
    await page.goto(file);
    await page.waitForFunction(() => window.__phosphor && window.__phosphor.G.mode === 'menu');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, sz.name + '-menu.png') });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) { errors.push(sz.name + ': horizontal overflow'); }

    // play: start level 0 with the bot driving, look at it mid-run
    const n = await page.evaluate(() => window.__phosphor.levels.length);
    const list = full ? [...Array(n).keys()] : [0];
    for (const li of list) {
      await page.evaluate(i => { const P = window.__phosphor; P.G.auto = true; P.startLevel(i, false); }, li);
      await page.waitForTimeout(2600);
      await page.screenshot({ path: path.join(out, sz.name + '-play' + li + '-a.png') });
      await page.evaluate(() => { window.__phosphor.G.scale = 6; });
      const shotsAt = [0.25, 0.5, 0.75];
      for (const frac of shotsAt) {
        try {
          await page.waitForFunction(f => { const G = window.__phosphor.G; return G.mode !== 'play' || G.s.x / G.L.endX >= f; }, frac, { timeout: 60000 });
        } catch (e) { errors.push(sz.name + ' level ' + li + ': timed out before ' + frac); }
        await page.evaluate(() => { window.__phosphor.G.scale = 0.0001; });
        await page.waitForTimeout(120);
        await page.screenshot({ path: path.join(out, sz.name + '-play' + li + '-' + Math.round(frac * 100) + '.png') });
        await page.evaluate(() => { window.__phosphor.G.scale = 6; });
      }
      try {
        await page.waitForFunction(() => { const G = window.__phosphor.G; return G.mode === 'done' && G.shown; }, null, { timeout: 90000 });
      } catch (e) {
        const st = await page.evaluate(() => { const G = window.__phosphor.G; return { mode: G.mode, x: G.s.x, att: G.attempts }; });
        errors.push(sz.name + ' level ' + li + ': bot did not finish ' + JSON.stringify(st));
      }
      const st = await page.evaluate(() => { const G = window.__phosphor.G; return { mode: G.mode, attempts: G.attempts, jumps: G.jumps, coins: G.coins }; });
      console.log(sz.name + ' level ' + li + ':', JSON.stringify(st));
      if (st.attempts !== 1) errors.push(sz.name + ' level ' + li + ': bot needed ' + st.attempts + ' attempts');
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, sz.name + '-done' + li + '.png') });
      await page.evaluate(() => { const P = window.__phosphor; P.G.auto = false; P.G.scale = 1; P.toMenu(); });
      await page.waitForTimeout(200);
    }
    // real input path: tap to jump in normal play
    await page.evaluate(() => { window.__phosphor.startLevel(0, true); });
    await page.waitForTimeout(600);
    const y0 = await page.evaluate(() => window.__phosphor.G.s.y);
    await page.mouse.move(sz.width * 0.7, sz.height * 0.6);
    await page.mouse.down();
    await page.waitForTimeout(140);
    const y1 = await page.evaluate(() => window.__phosphor.G.s.y);
    await page.mouse.up();
    if (!(y1 > y0 + 0.3)) errors.push(sz.name + ': pointer press did not jump (y ' + y0 + ' -> ' + y1 + ')');
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(out, sz.name + '-pause.png') });
    const paused = await page.evaluate(() => window.__phosphor.G.mode);
    if (paused !== 'pause') errors.push(sz.name + ': P did not pause (' + paused + ')');
    await page.click('#btnPauseSettings');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(out, sz.name + '-settings.png') });
    await ctx.close();
  }
  await browser.close();
  if (errors.length) { failed = true; console.log('ERRORS:\n  ' + errors.join('\n  ')); }
  else console.log('smoke test passed, screenshots in ' + out);
  process.exit(failed ? 1 : 0);
})();
