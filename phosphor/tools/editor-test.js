#!/usr/bin/env node
/* Level editor test: drives the real page at desktop, landscape-phone and portrait-phone sizes.
   Paints with the mouse (and touch on the phone sizes), undo / redo, song + colour, bot verify,
   save + reload + saved list, share codes (export, import, bad codes), test-play and back,
   and a run with storage blocked. Any console error, page error or failed check fails the run.
   usage: node tools/editor-test.js [outDir]        (run `node build.js` first) */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const out = process.argv[2] || path.join(__dirname, '..', 'shots');
const file = 'file://' + path.join(__dirname, '..', 'dist', 'phosphor.html');
const problems = [];
let checks = 0;

const SIZES = [
  { name: 'desktop', width: 1280, height: 720, touch: false },
  { name: 'phone-land', width: 844, height: 390, touch: true },
  { name: 'phone-port', width: 390, height: 844, touch: true }
];

async function run(browser, sz, opts) {
  opts = opts || {};
  const tag = sz.name + (opts.blocked ? ' (storage blocked)' : '');
  const ok = (cond, what) => { checks++; if (!cond) problems.push(tag + ': ' + what); return !!cond; };
  const ctx = await browser.newContext({ viewport: { width: sz.width, height: sz.height }, hasTouch: sz.touch, permissions: opts.clipboard ? ['clipboard-read', 'clipboard-write'] : [] });
  if (opts.blocked) {
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('storage is blocked'); } });
    });
  }
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') problems.push(tag + ' console: ' + m.text()); });
  page.on('pageerror', e => problems.push(tag + ' pageerror: ' + e.message));
  page.on('dialog', d => { problems.push(tag + ': a native dialog opened (' + d.type() + ')'); d.dismiss().catch(() => {}); });

  const shot = n => page.screenshot({ path: path.join(out, 'ed-' + sz.name + (opts.blocked ? '-blocked' : '') + '-' + n + '.png') });
  const state = () => page.evaluate(() => window.PEditor.state());
  const cell = (x, y) => page.evaluate(([x, y]) => window.PEditor.cell(x, y), [x, y]);
  const mode = () => page.evaluate(() => window.__phosphor.G.mode);
  const status = () => page.evaluate(() => document.getElementById('edStatus').textContent);
  const visible = sel => page.evaluate(s => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel);
  /* centre of a grid cell in page pixels; throws when a bar covers it, which would be a bug in this test */
  const at = async (x, y) => {
    const p = await page.evaluate(([x, y]) => {
      const s = window.PRender.toScreen(x + 0.5, y + 0.5), r = document.getElementById('scope').getBoundingClientRect();
      const px = s.x + r.left, py = s.y + r.top, hit = document.elementFromPoint(px, py);
      return { x: px, y: py, hit: hit ? hit.id : '' };
    }, [x, y]);
    if (p.hit !== 'scope') throw new Error(tag + ': cell ' + x + ',' + y + ' is not reachable on the canvas (hit "' + p.hit + '")');
    return p;
  };
  const clickCell = async (x, y, o) => { const p = await at(x, y); await page.mouse.click(p.x, p.y, o); };
  const dragCells = async (x0, y0, x1, y1) => {
    const a = await at(x0, y0), b = await at(x1, y1);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
  };
  const tool = id => page.click('#edTool-' + id);
  /* secondary controls live in the top bar on wide screens and in the More panel otherwise */
  const reveal = async sel => { if (!(await visible(sel))) { await page.click('#edMoreBtn'); await page.waitForSelector(sel, { state: 'visible' }); } };
  const closePanels = async () => { if ((await state()).panel) await page.keyboard.press('Escape'); };
  const openEditor = async () => {
    await page.goto(file);
    await page.waitForFunction(() => window.__phosphor && window.__phosphor.G.mode === 'menu' && window.PEditor);
    ok(await visible('#btnEditor'), 'the Level editor button is not visible in the menu');
    await page.click('#btnEditor');
    await page.waitForFunction(() => window.__phosphor.G.mode === 'editor' && window.PEditor.state().active);
    await page.waitForTimeout(250);
  };
  const frameSettle = () => page.waitForTimeout(80);

  /* ---- open ---- */
  await openEditor();
  let st = await state();
  ok(st.name === 'Untitled level', 'a new level is not called "Untitled level"');
  ok((await cell(10, 0)) === '^' && (await cell(16, 0)) === '#' && (await cell(31, 0)) === '_' && (await cell(42, 2)) === 'o', 'the example layout is missing');
  ok(st.warn === '', 'the example layout triggers the run-up warning');
  ok(await visible('#editor'), '#editor is not shown');
  ok(!(await page.evaluate(() => document.getElementById('ui').classList.contains('scrim'))), 'the menu scrim is still on');
  await shot('1-open');
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), 'horizontal page overflow');
  const small = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('#editor button').forEach(b => { const r = b.getBoundingClientRect(); if (r.width && (r.width < 42 || r.height < 42)) bad.push(b.id + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); });
    return bad;
  });
  ok(small.length === 0, 'touch targets under 42px: ' + small.join(', '));
  const clipped = await page.evaluate(() => {
    const bad = [], vw = window.innerWidth, vh = window.innerHeight;
    document.querySelectorAll('#edBar, #edBottom').forEach(b => { const r = b.getBoundingClientRect(); if (r.left < 15.5 || r.right > vw - 15.5 || r.top < 0 || r.bottom > vh) bad.push(b.id); });
    document.querySelectorAll('#edBar button, #edBar input, #edBar select, #edStatus, #edPos').forEach(e => { if (e.getClientRects().length && e.scrollWidth > e.clientWidth + 1) bad.push((e.id || e.tagName) + ' text clipped'); });
    return bad;
  });
  ok(clipped.length === 0, 'layout: ' + clipped.join(', '));

  /* ---- paint, undo, redo, erase ---- */
  await tool('block');
  await clickCell(3, 3);
  ok((await cell(3, 3)) === '#', 'a click did not paint a block');
  await dragCells(4, 3, 8, 3);
  ok((await Promise.all([4, 5, 6, 7, 8].map(x => cell(x, 3)))).join('') === '#####', 'a drag did not paint a row of blocks');
  st = await state();
  ok(st.undo === 2, 'a click and a drag should be 2 undo steps, got ' + st.undo);
  ok(st.dirty, 'painting did not mark the level as changed');
  await shot('2-painted');
  await page.click('#edUndo');
  ok((await cell(4, 3)) === '.' && (await cell(8, 3)) === '.' && (await cell(3, 3)) === '#', 'undo did not remove the whole drag stroke');
  await page.click('#edUndo');
  ok((await cell(3, 3)) === '.', 'the second undo did not remove the click');
  ok((await page.getAttribute('#edUndo', 'aria-disabled')) === 'true', 'Undo is not marked unavailable with nothing left to undo');
  await page.click('#edRedo'); await page.click('#edRedo');
  ok((await cell(3, 3)) === '#' && (await cell(8, 3)) === '#', 'redo did not bring the tiles back');
  await page.evaluate(() => { const a = document.activeElement; if (a) a.blur(); });
  await page.keyboard.press('Control+z');
  ok((await cell(8, 3)) === '.', 'Ctrl+Z did not undo');
  await page.keyboard.press('Control+y');
  ok((await cell(8, 3)) === '#', 'Ctrl+Y did not redo');
  await clickCell(3, 3, { button: 'right' });
  ok((await cell(3, 3)) === '.', 'right-click did not erase');
  await tool('erase');
  await dragCells(4, 3, 8, 3);
  ok((await Promise.all([4, 5, 6, 7, 8].map(x => cell(x, 3)))).join('') === '.....', 'the Erase tool did not erase along a drag');
  if (sz.touch) {
    await tool('slabTop');
    const p = await at(5, 2);
    await page.touchscreen.tap(p.x, p.y);
    ok((await cell(5, 2)) === '=', 'a touch tap did not paint');
    await page.click('#edUndo');
  }

  /* ---- rules: gate hint, 3 cores, run-up warning ---- */
  await tool('gateG');
  const hint = await status();
  ok(/whole column/.test(hint) && /corridor/.test(hint) && /row - 4/.test(hint), 'the FLY gate hint does not explain the column and corridor rule: ' + hint);
  await clickCell(6, 4);
  ok((await cell(6, 4)) === 'G', 'the gate was not placed');
  await page.click('#edUndo');
  await tool('gateU');
  ok(/whole column/.test(await status()), 'the gravity gate hint does not say it acts on the whole column');
  await tool('core');
  await clickCell(2, 4); await clickCell(3, 4);
  ok((await state()).cores === 3, 'expected 3 cores after placing two more');
  await clickCell(7, 4);
  ok((await cell(7, 4)) === '.' && (await state()).cores === 3, 'a 4th core was accepted');
  ok(/3 cores/.test(await status()), 'no message about the 3 core limit: ' + (await status()));
  await page.click('#edUndo'); await page.click('#edUndo');
  ok((await state()).cores === 1, 'undo did not restore the core count');
  await tool('spike');
  await clickCell(3, 0);
  ok(/first 8 columns/.test((await state()).warn), 'no warning for a hazard in the first 8 columns');
  ok((await cell(3, 0)) === '^', 'the warning blocked the tile, it should only warn');
  await page.click('#edUndo');
  ok((await state()).warn === '', 'the run-up warning did not clear');

  /* ---- camera: wheel, keys, scrubber, upper rows ---- */
  const cam0 = (await state()).camX;
  const mid = await at(6, 2);
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.wheel(0, 240); await frameSettle();
  ok((await state()).camX > cam0 + 1, 'the wheel did not scroll the level');
  await page.keyboard.press('Home'); await frameSettle();
  ok(Math.abs((await state()).camX - cam0) < 0.01, 'Home did not return to the start');
  await page.keyboard.press('ArrowRight'); await frameSettle();
  ok(Math.abs((await state()).camX - cam0 - 2) < 0.01, 'ArrowRight did not move the view 2 columns');
  await page.focus('#edScrub');
  await page.keyboard.press('End'); await frameSettle();
  st = await state();
  const endVisible = await page.evaluate(() => window.PRender.toScreen(window.PEditor.state().width, 0).x < window.innerWidth);
  ok(st.camX > 60 && endVisible, 'the scrubber did not reach the end of the level');
  await shot('3-end');
  await page.keyboard.press('Home'); await frameSettle();
  ok(Math.abs((await state()).camX - cam0) < 0.01, 'the scrubber did not return to the start');
  await page.evaluate(() => document.activeElement.blur());
  // Pan tool: dragging 4 columns to the left moves the view 4 columns on, and paints nothing
  await tool('pan');
  let before = await state();
  let pa = await at(8, 2), pb = await at(4, 2);
  await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.mouse.move(pb.x, pb.y, { steps: 5 }); await page.mouse.up();
  await frameSettle();
  st = await state();
  ok(Math.abs(st.camX - before.camX - 4) < 0.05 && st.undo === before.undo, 'the Pan tool did not drag the view by 4 columns');
  await page.keyboard.press('Home'); await frameSettle();
  if (sz.touch) {
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type: type, touchPoints: pts });
    await tool('block');
    before = await state();
    // one finger drags a stroke
    pa = await at(4, 2); pb = await at(7, 2);
    await touch('touchStart', [{ x: pa.x, y: pa.y, id: 1 }]);
    for (let i = 1; i <= 4; i++) await touch('touchMove', [{ x: pa.x + (pb.x - pa.x) * i / 4, y: pa.y, id: 1 }]);
    await touch('touchEnd', []);
    ok((await Promise.all([4, 5, 6, 7].map(x => cell(x, 2)))).join('') === '####' && (await state()).undo === before.undo + 1, 'a one-finger drag did not paint one stroke');
    await page.click('#edUndo');
    // two fingers pan and leave no tiles behind
    before = await state();
    pa = await at(8, 2); pb = await at(9, 3);
    await touch('touchStart', [{ x: pa.x, y: pa.y, id: 1 }]);
    await touch('touchStart', [{ x: pa.x, y: pa.y, id: 1 }, { x: pb.x, y: pb.y, id: 2 }]);
    for (let i = 1; i <= 5; i++) await touch('touchMove', [{ x: pa.x - 30 * i, y: pa.y, id: 1 }, { x: pb.x - 30 * i, y: pb.y, id: 2 }]);
    await touch('touchEnd', []);
    await frameSettle();
    st = await state();
    ok(st.camX > before.camX + 3.5, 'a two-finger drag did not pan the view (' + before.camX.toFixed(2) + ' -> ' + st.camX.toFixed(2) + ')');
    ok(st.undo === before.undo && (await cell(8, 2)) === '.', 'a two-finger drag left a tile or an undo step behind');
    await page.keyboard.press('Home'); await frameSettle();
  }
  const rowsVisible = () => page.evaluate(() => {
    const top = document.getElementById('edBar').getBoundingClientRect().bottom, bot = document.getElementById('edBottom').getBoundingClientRect().top;
    const y0 = window.PRender.toScreen(1, 0.5).y, y9 = window.PRender.toScreen(1, 9.5).y;
    return { row0: y0 < bot && y0 > top, row9: y9 > top && y9 < bot };
  });
  st = await state();
  let rv = await rowsVisible();
  ok(rv.row0, 'row 0 is not visible when the editor opens');
  if (st.panY) {
    ok(await visible('#edView'), 'rows do not all fit but the upper / lower rows button is hidden');
    await page.click('#edView'); await frameSettle();
    rv = await rowsVisible();
    ok(rv.row9, 'row 9 is not reachable after showing the upper rows');
    await tool('block');
    await clickCell(4, 9);
    ok((await cell(4, 9)) === '#', 'could not paint in row 9');
    await shot('4-upper-rows');
    await page.click('#edUndo');
    await page.click('#edView'); await frameSettle();
    ok((await rowsVisible()).row0, 'row 0 is not back after showing the lower rows');
  } else ok(rv.row9, 'row 9 is not visible although the view cannot pan vertically');

  /* ---- name, song, colour ---- */
  const myName = 'Probe ' + sz.name;
  await page.fill('#edName', myName);
  await page.keyboard.press('Enter');
  ok((await state()).name === myName, 'the level name did not update');
  await reveal('#edSong');
  await shot('5-controls');
  await page.selectOption('#edSong', 'carrier');
  ok((await page.evaluate(() => window.PEditor.def().bpm)) === 140, 'choosing Carrier Wave did not set 140 BPM');
  await page.selectOption('#edPal', '2');
  ok((await state()).pal === 2, 'the colour did not change');
  ok((await page.evaluate(() => window.PEditor.def().chunks[0].pal)) === 2, 'the colour is not written into the chunk');
  await closePanels();
  await page.waitForTimeout(350);

  /* ---- verify with the bot ---- */
  await page.click('#edVerify');
  await page.waitForFunction(() => /Beatable|stuck|unproven|could not/.test(document.getElementById('edStatus').textContent), null, { timeout: 30000 });
  let verdict = await status();
  ok(/^Beatable\. Timing slack: (comfortable|tight)\.$/.test(verdict), 'verify on the example layout said: ' + verdict);
  ok(((await state()).verify || {}).ok === true, 'verify result not recorded as beatable');
  await shot('6-verified');
  // eight spikes in a row cannot be jumped: the bot must get stuck there and the camera must go to it
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
  await frameSettle();
  await tool('spike');
  await dragCells(19, 0, 26, 0);
  await page.keyboard.press('Home');
  await page.click('#edVerify');
  await page.waitForFunction(() => /Beatable|stuck|unproven|could not/.test(document.getElementById('edStatus').textContent), null, { timeout: 30000 });
  verdict = await status();
  const stuckAt = +((/^The bot gets stuck at (\d+)%\.$/.exec(verdict) || [])[1] || -1);   // the spikes span columns 19-26 of 96
  ok(stuckAt >= 17 && stuckAt <= 28, 'verify on an impossible level said: ' + verdict);
  await frameSettle();
  const markOnScreen = await page.evaluate(() => { const v = window.PEditor.state().verify, x = window.PRender.toScreen(v.x, 0).x; return x > 0 && x < window.innerWidth; });
  ok(markOnScreen, 'the camera did not move to where the bot got stuck');
  await shot('7-stuck');
  await page.click('#edUndo');
  ok((await cell(22, 0)) === '.', 'undo did not remove the spike row');
  await page.keyboard.press('Home');

  /* ---- save ---- */
  await page.click('#edSave');
  const saved = await state();
  if (opts.blocked) {
    ok(/blocking storage/.test(await status()), 'no clear message when storage is blocked: ' + (await status()));
    ok(saved.store === false, 'storage should be detected as blocked');
  } else {
    ok(/^Saved /.test(await status()), 'Save did not confirm: ' + (await status()));
    ok(!saved.dirty, 'the level is still marked unsaved after Save');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('phosphor.custom.v1')));
    ok(Array.isArray(stored) && stored.length === 1 && stored[0].id === saved.id && stored[0].name === myName && stored[0].song === 'carrier' && stored[0].pal === 2 &&
      stored[0].width === 96 && stored[0].rows.length === 10 && stored[0].rows[9].charAt(10) === '^' && typeof stored[0].updated === 'number', 'the stored record has the wrong shape: ' + JSON.stringify(stored).slice(0, 200));
  }

  /* ---- share codes ---- */
  const code = await page.evaluate(() => window.PEditor.code());
  ok(/^PH1\.[A-Za-z0-9_-]+$/.test(code) && code.length < 600, 'unexpected share code: ' + code.slice(0, 80));
  await reveal('#edCopy');
  await page.click('#edCopy');
  await page.waitForFunction(() => /copied/.test(document.getElementById('edStatus').textContent) || window.PEditor.state().panel === 'code', null, { timeout: 5000 });
  if ((await state()).panel === 'code') {
    ok((await page.inputValue('#edCodeText')) === code, 'the fallback code box does not hold the code');
    ok(await page.evaluate(() => document.getElementById('edCodeText').readOnly && document.getElementById('edImport').hidden), 'the copy fallback should be read-only without Import');
    await shot('8-code-fallback');
    await page.click('#edCodeClose');
    console.log(tag + ': clipboard blocked, fallback code box shown');
  } else {
    if (opts.clipboard) ok((await page.evaluate(() => navigator.clipboard.readText())) === code, 'the clipboard does not hold the code');
    console.log(tag + ': clipboard write succeeded');
  }
  // change the level, then import the code: the change must be gone and the code must round-trip
  await tool('block');
  await clickCell(3, 4);
  await reveal('#edPaste');
  await page.click('#edPaste');
  await page.waitForSelector('#edCodeText', { state: 'visible' });
  const tryCode = async c => { await page.fill('#edCodeText', c); await page.click('#edImport'); return page.evaluate(() => document.getElementById('edCodeMsg').textContent); };
  const forge = o => page.evaluate(o => 'PH1.' + btoa(JSON.stringify(o)), o);
  const dots = n => '(' + n + ').';
  ok(/Paste a level code first/.test(await tryCode('')), 'an empty code was not rejected clearly');
  ok(/not a Phosphor level code/.test(await tryCode('hello world')), 'a non-code was not rejected clearly');
  ok(/damaged|cut short/.test(await tryCode(code.slice(0, code.length - 9))), 'a cut-off code was not rejected clearly');
  ok(/columns long/.test(await tryCode(await forge({ v: 1, n: 'x', s: 'trace', p: 0, w: 999999, g: '.' }))), 'an oversized level was not rejected');
  ok(/does not match/.test(await tryCode(await forge({ v: 1, n: 'x', s: 'trace', p: 0, w: 32, g: '(999999).' }))), 'a run-length bomb was not rejected');
  ok(/tile this version does not know/.test(await tryCode(await forge({ v: 1, n: 'x', s: 'trace', p: 0, w: 32, g: dots(319) + 'Q' }))), 'an unknown tile was not rejected');
  ok(/4 cores/.test(await tryCode(await forge({ v: 1, n: 'x', s: 'trace', p: 0, w: 32, g: dots(316) + 'cccc' }))), 'a level with 4 cores was not rejected');
  ok(/song/.test(await tryCode(await forge({ v: 1, n: 'x', s: 'nope', p: 0, w: 32, g: dots(320) }))), 'an unknown song was not rejected');
  ok(/colour/.test(await tryCode(await forge({ v: 1, n: 'x', s: 'trace', p: 9, w: 32, g: dots(320) }))), 'an unknown colour was not rejected');
  ok(/version/.test(await tryCode(await forge({ v: 7 }))), 'a code from another version was not rejected');
  ok((await state()).panel === 'code' && (await cell(3, 4)) === '#', 'a rejected code changed the level or closed the panel');
  await shot('9-bad-code');
  await page.fill('#edCodeText', '  ' + code.slice(0, 40) + '\n' + code.slice(40) + '  ');   // pasted with stray whitespace
  await page.click('#edImport');
  ok((await page.textContent('#edImport')) === 'Confirm' && /unsaved changes/.test(await page.textContent('#edCodeMsg')), 'importing over unsaved changes should ask first');
  await page.click('#edImport');
  await page.waitForFunction(() => window.PEditor.state().panel === null);
  st = await state();
  ok((await cell(3, 4)) === '.' && st.name === myName && st.song === 'carrier' && st.pal === 2 && st.width === 96, 'the imported level differs from the exported one');
  ok((await page.evaluate(() => window.PEditor.code())) === code, 'export -> import -> export does not round-trip');
  ok(st.id !== saved.id && /^custom-[a-z0-9]+$/.test(st.id), 'an imported level should get its own custom- id, got ' + st.id);

  /* ---- reload: the saved level is in the list ---- */
  if (!opts.blocked) {
    await openEditor();
    ok((await state()).name === 'Untitled level', 'after a reload the editor should open a new level');
    await reveal('#edLevels');
    await page.click('#edLevels');
    await page.waitForSelector('#edLevelsPanel', { state: 'visible' });
    const names = () => page.evaluate(() => Array.from(document.querySelectorAll('#edList .ed-item b')).map(b => b.textContent));
    ok((await names()).join('|') === myName, 'the saved level is not in the list after a reload: ' + (await names()).join('|'));
    await page.click('#edDup-' + saved.id);
    ok((await names()).join('|') === myName + ' copy|' + myName, 'Duplicate did not add a copy: ' + (await names()).join('|'));
    await shot('10-levels');
    const copyId = await page.evaluate(() => document.querySelector('#edList button[data-act=del]').getAttribute('data-id'));
    await page.click('#edDel-' + copyId);
    ok((await names()).length === 2 && (await page.textContent('#edDel-' + copyId)) === 'Confirm' && /for good/.test(await page.textContent('#edLevelsInfo')), 'Delete should ask for a second press');
    await page.click('#edDel-' + copyId);
    ok((await names()).join('|') === myName, 'Delete did not remove the copy');
    await page.click('#edLoad-' + saved.id);
    await page.waitForFunction(() => window.PEditor.state().panel === null);
    st = await state();
    ok(st.id === saved.id && st.name === myName && st.song === 'carrier' && st.pal === 2 && !st.dirty, 'Load did not restore the saved level');
    ok((await page.inputValue('#edName')) === myName && (await page.inputValue('#edSong')) === 'carrier', 'the form does not show the loaded level');
    ok((await cell(10, 0)) === '^', 'the loaded level lost its tiles');
    // New asks before dropping unsaved work
    await tool('block'); await clickCell(3, 3);
    await reveal('#edLevels'); await page.click('#edLevels');
    await page.click('#edNew');
    ok((await page.textContent('#edNew')) === 'Confirm' && /unsaved changes/.test(await page.textContent('#edLevelsInfo')), 'New should ask before dropping unsaved changes');
    await page.click('#edNew');
    await page.waitForFunction(() => window.PEditor.state().panel === null);
    st = await state();
    ok(st.name === 'Untitled level' && st.id !== saved.id && st.song === 'trace', 'New did not start a fresh level');
  } else {
    await reveal('#edLevels');
    await page.click('#edLevels');
    ok(/blocking storage/.test(await page.textContent('#edLevelsInfo')), 'the Levels panel does not explain that storage is blocked');
    await shot('10-levels');
    await page.click('#edLevelsClose');
  }

  /* ---- test play and back ---- */
  const idBefore = (await state()).id;
  await page.click('#edTest');
  await page.waitForFunction(() => window.__phosphor.G.mode === 'play');
  ok(!(await visible('#editor')), 'the editor is still shown during a test run');
  ok(await page.evaluate(() => !!window.__phosphor.G.custom && !window.__phosphor.G.practice), 'Test should start a normal custom run');
  await page.waitForTimeout(700);
  await shot('11-test-play');
  const y0 = await page.evaluate(() => window.__phosphor.G.s.y);
  await page.mouse.move(sz.width * 0.6, sz.height * 0.5); await page.mouse.down(); await page.waitForTimeout(140);
  const y1 = await page.evaluate(() => window.__phosphor.G.s.y);
  await page.mouse.up();
  ok(y1 > y0 + 0.3 && (await state()).undo === (await state()).undo && (await page.evaluate(() => !window.PEditor.state().active)), 'a tap during the test run should jump and not reach the editor');
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__phosphor.G.mode === 'pause');
  ok((await page.textContent('#btnQuit')) === 'Back to editor', 'the pause menu does not offer Back to editor');
  await page.click('#btnQuit');
  await page.waitForFunction(() => window.__phosphor.G.mode === 'editor' && window.PEditor.state().active);
  await frameSettle();
  st = await state();
  ok(await visible('#editor') && !(await visible('#pause')) && !(await visible('#hud')), 'the editor UI is not restored after the test run');
  ok(st.id === idBefore && (await cell(10, 0)) === '^', 'the level changed across the test run');
  await clickCell(3, 3, { button: 'right' });       // the canvas paints again
  await tool('block'); await clickCell(4, 4);
  ok((await cell(4, 4)) === '#', 'painting does not work after coming back from a test run');
  await page.click('#edUndo');
  await shot('12-back');

  // practice test
  await reveal('#edPractice');
  await page.click('#edPractice');
  await page.waitForFunction(() => window.__phosphor.G.mode === 'play');
  ok(await page.evaluate(() => window.__phosphor.G.practice === true), 'Practice did not start a practice run');
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__phosphor.G.mode === 'pause');
  await page.click('#btnQuit');
  await page.waitForFunction(() => window.__phosphor.G.mode === 'editor' && window.PEditor.state().active);

  // finishing a run: an empty level runs straight to the end, the complete screen leads back to the editor
  if (sz.name === 'desktop') {
    await reveal('#edClear');
    await page.click('#edClear');
    ok((await cell(10, 0)) === '.', 'Clear tiles did not clear');
    await page.click('#edTest');
    await page.waitForFunction(() => window.__phosphor.G.mode === 'play');
    await page.evaluate(() => { window.__phosphor.G.scale = 6; });
    await page.waitForFunction(() => window.__phosphor.G.mode === 'done' && window.__phosphor.G.shown, null, { timeout: 30000 });
    await page.evaluate(() => { window.__phosphor.G.scale = 1; });
    ok((await page.textContent('#btnDoneMenu')) === 'Back to editor' && !(await visible('#btnNext')), 'the complete screen should offer Back to editor and no Next level');
    await page.click('#btnDoneMenu');
    await page.waitForFunction(() => window.__phosphor.G.mode === 'editor' && window.PEditor.state().active);
    await page.click('#edUndo');
    ok((await cell(10, 0)) === '^', 'undo did not bring the cleared tiles back');
    // grow and trim
    await reveal('#edGrow'); await page.click('#edGrow');
    ok((await state()).width === 128, '+32 columns did not grow the level to 128');
    await reveal('#edTrim'); await page.click('#edTrim');
    ok((await state()).width === 88, 'Trim empty tail should leave 88 columns, got ' + (await state()).width);
    await page.click('#edUndo'); await page.click('#edUndo');
    ok((await state()).width === 96, 'undo did not restore the level width');
  }

  /* ---- exit and come back ---- */
  await page.click('#edExit');
  await page.waitForFunction(() => window.__phosphor.G.mode === 'menu');
  ok(await visible('#menu') && !(await visible('#editor')), 'Exit did not return to the menu');
  ok(await page.evaluate(() => !window.PEditor.state().active), 'the editor is still active in the menu');
  await page.click('#btnEditor');
  await page.waitForFunction(() => window.__phosphor.G.mode === 'editor' && window.PEditor.state().active);
  ok((await state()).id === idBefore, 'the open level was lost by leaving and re-entering the editor');
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), 'horizontal page overflow at the end');
  await ctx.close();
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  for (const sz of SIZES) {
    try { await run(browser, sz, { clipboard: sz.name === 'desktop' }); }
    catch (e) { problems.push(sz.name + ': test aborted: ' + e.message.split('\n')[0]); }
    console.log(sz.name + ': done');
  }
  try { await run(browser, SIZES[1], { blocked: true }); }
  catch (e) { problems.push('storage blocked: test aborted: ' + e.message.split('\n')[0]); }
  console.log('storage blocked: done');
  await browser.close();
  if (problems.length) { console.log('FAILED (' + problems.length + ' of ' + checks + ' checks):\n  ' + problems.join('\n  ')); process.exit(1); }
  console.log('editor test passed: ' + checks + ' checks, screenshots in ' + out);
})();
