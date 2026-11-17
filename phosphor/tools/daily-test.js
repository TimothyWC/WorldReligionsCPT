#!/usr/bin/env node
/* Browser check for the Daily: the card shows, the in-page solver proves the level, the bot clears it. */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const out = process.argv[2] || path.join(__dirname, '..', 'shots');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const errors = [];
  for (const sz of [{ n: 'desktop', w: 1280, h: 720 }, { n: 'phone-land', w: 844, h: 390 }, { n: 'phone-port', w: 390, h: 844 }]) {
    const ctx = await b.newContext({ viewport: { width: sz.w, height: sz.h } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(sz.n + ' pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(sz.n + ': ' + m.text()); });
    await p.goto('file://' + path.join(__dirname, '..', 'dist', 'phosphor.html'));
    await p.waitForFunction(() => window.__phosphor && window.__phosphor.G.mode === 'menu');
    await p.waitForTimeout(600);
    await p.screenshot({ path: path.join(out, sz.n + '-menu-daily.png') });
    const card = await p.$('.card.daily');
    if (!card) { errors.push(sz.n + ': no daily card'); await ctx.close(); continue; }
    await p.evaluate(() => { window.__phosphor.G.auto = true; });
    await p.click('.card.daily [data-act="play"]');
    await p.waitForFunction(() => window.__phosphor.G.mode === 'play', null, { timeout: 30000 });
    const info = await p.evaluate(() => { const P = window.__phosphor; return { name: P.G.L.name, id: P.G.L.id, len: P.G.L.length, song: P.G.L.song, ready: P.daily.ready, salt: P.daily.salt }; });
    await p.waitForTimeout(1200);
    await p.screenshot({ path: path.join(out, sz.n + '-daily-play.png') });
    await p.evaluate(() => { window.__phosphor.G.scale = 6; });
    try { await p.waitForFunction(() => { const G = window.__phosphor.G; return G.mode === 'done' && G.shown; }, null, { timeout: 90000 }); }
    catch (e) { errors.push(sz.n + ': bot did not finish the daily ' + JSON.stringify(await p.evaluate(() => ({ m: window.__phosphor.G.mode, x: window.__phosphor.G.s.x, a: window.__phosphor.G.attempts })))); }
    const att = await p.evaluate(() => window.__phosphor.G.attempts);
    if (att !== 1) errors.push(sz.n + ': daily took ' + att + ' attempts');
    await p.waitForTimeout(800);
    await p.screenshot({ path: path.join(out, sz.n + '-daily-done.png') });
    await p.click('#btnDoneMenu');
    await p.waitForTimeout(300);
    const mode = await p.evaluate(() => window.__phosphor.G.mode);
    if (mode !== 'menu') errors.push(sz.n + ': did not return to menu (' + mode + ')');
    console.log(sz.n, JSON.stringify(info));
    await ctx.close();
  }
  await b.close();
  if (errors.length) { console.log('ERRORS:\n  ' + errors.join('\n  ')); process.exit(1); }
  console.log('daily test passed');
})();
