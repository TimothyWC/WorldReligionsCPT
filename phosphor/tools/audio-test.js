#!/usr/bin/env node
/* Phosphor audio test. Runs src/audio.js in headless Chromium (Playwright).
   - offline-renders every song in full, plus mid-song windows and every sfx
   - checks peak, silence, section loudness and the menu / level balance
   - smoke-tests the live API (no context, suspended context, running context, restarts)
   Usage: node tools/audio-test.js [--mix]      (--mix also prints a per-track solo table) */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const SRC = path.join(__dirname, '..', 'src', 'audio.js');
const MIX = process.argv.includes('--mix');
const SFX = ['jump', 'land', 'pad', 'ring', 'gate', 'die', 'coin', 'win', 'click', 'checkpoint'];
const API = ['init', 'resume', 'setMusicVolume', 'setSfxVolume', 'playSong', 'stopSong', 'songBeat', 'pulse', 'sfx', 'ready', '_renderOffline'];
const SONGS = {
  trace: { bpm: 128, len: 128, sec: [[0, 16, 'intro'], [16, 48, 'groove'], [48, 64, 'build'], [64, 112, 'main'], [112, 128, 'outro']], loud: ['groove', 'main'], top: 'main' },
  carrier: { bpm: 140, len: 160, sec: [[0, 16, 'intro'], [16, 48, 'groove'], [48, 80, 'air'], [80, 144, 'drop'], [144, 160, 'outro']], loud: ['groove', 'drop'], top: 'drop' },
  overdrive: { bpm: 150, len: 192, sec: [[0, 16, 'intro'], [16, 64, 'A'], [64, 80, 'breakdown'], [80, 144, 'drop'], [144, 176, 'climax'], [176, 192, 'outro']], loud: ['A', 'drop', 'climax'], top: 'drop' },
  menu: { bpm: 100, len: 32, sec: [[0, 32, 'loop']], loud: ['loop'], top: 'loop' }
};
const TRACKS = ['k', 's', 'c', 'h', 'o', 'cr', 'sh', 'tm', 'bass', 'arp', 'mel', 'lead', 'pad', 'stab', 'rise'];

let failures = 0;
function check(ok, msg) { console.log((ok ? '  ok    ' : '  FAIL  ') + msg); if (!ok) failures++; }
const f3 = (v) => v.toFixed(3);
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

// which section does the 1-second window starting at `sec` sit fully inside? (beat 0 sounds at 0.05s)
function sectionOf(song, sec, startBeat) {
  const bps = song.bpm / 60, b0 = startBeat + (sec - 0.05) * bps, b1 = b0 + bps;
  for (const s of song.sec) if (b0 >= s[0] && b1 <= s[1]) return s[2];
  return null;
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async (pre) => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto('about:blank');
    if (pre) await page.evaluate(pre);
    await page.addScriptTag({ path: SRC });
    return page;
  };

  // ------------------------------------------------------------ 1. no AudioContext at all
  console.log('\n[1] no AudioContext available');
  let page = await newPage(() => { window.AudioContext = undefined; window.webkitAudioContext = undefined; });
  let r = await page.evaluate((SFX) => {
    const out = { threw: null };
    try {
      PAudio.init(); PAudio.resume(); PAudio.setMusicVolume(0.5); PAudio.setSfxVolume(0.5);
      SFX.forEach((n) => PAudio.sfx(n)); PAudio.sfx('nope');
      PAudio.playSong('trace', 0); PAudio.playSong('nope', 3); PAudio.stopSong(); PAudio.stopSong(0);
      out.beat = PAudio.songBeat(); out.pulse = PAudio.pulse(); out.ready = PAudio.ready();
    } catch (e) { out.threw = String(e); }
    return out;
  }, SFX);
  check(r.threw === null, 'every method is a silent no-op' + (r.threw ? ' (' + r.threw + ')' : ''));
  check(r.beat === null && r.pulse === 0 && r.ready === false, 'songBeat null, pulse 0, ready false');
  await page.close();

  // ------------------------------------------------------------ 2. API surface + offline renders
  console.log('\n[2] API surface');
  page = await newPage(() => {
    window.__made = 0;
    const O = window.AudioContext;
    window.AudioContext = class extends O { constructor(...a) { super(...a); window.__made++; } };
    // tap whatever feeds the real destination so the live test can see actual output
    const conn = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dest, ...rest) {
      if (dest instanceof AudioDestinationNode && !(this.context instanceof OfflineAudioContext)) {
        window.__an = this.context.createAnalyser(); window.__an.fftSize = 2048; conn.call(this, window.__an);
      }
      return conn.call(this, dest, ...rest);
    };
  });
  r = await page.evaluate((API) => ({
    globals: Object.keys(window).filter((k) => /audio/i.test(k) && k !== 'PAudio' && !/^(webkit)?(Offline)?Audio|^on/.test(k)),
    missing: API.filter((n) => typeof PAudio[n] !== 'function'), songs: PAudio.songs, made: window.__made,
    pre: { beat: PAudio.songBeat(), pulse: PAudio.pulse(), ready: PAudio.ready() }, warnings: PAudio._stats().warnings
  }), API);
  check(r.missing.length === 0, 'all API functions present' + (r.missing.length ? ' (missing ' + r.missing + ')' : ''));
  check(r.made === 0, 'no AudioContext created on load');
  check(r.pre.beat === null && r.pre.pulse === 0 && r.pre.ready === false, 'before init: songBeat null, pulse 0, ready false');
  for (const id of Object.keys(SONGS)) {
    const s = r.songs[id];
    check(!!s && s.bpm === SONGS[id].bpm && s.lengthBeats === SONGS[id].len && typeof s.name === 'string',
      `songs.${id} = ${JSON.stringify(s)}`);
  }

  console.log('\n[3] offline renders (both buses at full volume)');
  const render = (id, seconds, startBeat, mute) => page.evaluate(([id, seconds, startBeat, mute]) => {
    const t0 = performance.now();
    return PAudio._renderOffline(id, seconds, startBeat, mute).then((x) => Object.assign(x, { ms: Math.round(performance.now() - t0) }));
  }, [id, seconds, startBeat || 0, mute || null]);

  const full = {};
  for (const id of Object.keys(SONGS)) {
    const song = SONGS[id], secs = Math.ceil(song.len * 60 / song.bpm + 2);   // whole song plus the first moments of the loop
    const res = await render(id, secs, 0);
    full[id] = res;
    const bySec = {};
    res.perSecondRms.forEach((v, i) => { const s = sectionOf(song, i, 0); if (s) (bySec[s] = bySec[s] || []).push(v); });
    console.log(`\n  ${id}: ${secs}s rendered in ${res.ms}ms   peak ${f3(res.peak)}   rms ${f3(res.rms)}   in soft-clip knee ${(res.hot * 100).toFixed(2)}% of samples`);
    console.log('    per-second rms x1000: ' + res.perSecondRms.map((v) => Math.round(v * 1000)).join(' '));
    console.log('    section mean rms:     ' + song.sec.map((s) => `${s[2]} ${f3(mean(bySec[s[2]] || [0]))}`).join('   '));
    res.bySec = bySec;
    check(res.peak < 0.95, `${id} peak ${f3(res.peak)} < 0.95`);
    check(res.peak > 0.2 || id === 'menu', `${id} is not near-silent overall`);
    for (const name of song.loud) {
      const lo = Math.min.apply(null, bySec[name]);
      check(lo > 0.03, `${id} no silent second in ${name} (min ${f3(lo)})`);
    }
    if (bySec.intro) check(mean(bySec.intro) < 0.8 * mean(bySec[song.top]), `${id} intro (${f3(mean(bySec.intro))}) quieter than ${song.top} (${f3(mean(bySec[song.top]))})`);
    const tail = res.perSecondRms[res.perSecondRms.length - 1];
    check(tail > 0.005, `${id} keeps playing across the loop point (last second rms ${f3(tail)})`);
  }
  const levelRms = ['trace', 'carrier', 'overdrive'].map((id) => full[id].rms);
  check(full.menu.rms < 0.65 * Math.min.apply(null, levelRms), `menu rms ${f3(full.menu.rms)} clearly below level songs (${levelRms.map(f3).join(', ')})`);
  check(mean(full.overdrive.bySec.climax) >= 0.95 * mean(full.overdrive.bySec.drop), 'overdrive climax at least as loud as the drop');
  check(mean(full.carrier.bySec.air) < mean(full.carrier.bySec.drop), 'carrier half-time section quieter than the drop');

  console.log('\n  mid-song starts');
  const windows = [['overdrive', 27, 80], ['trace', 3, 37.5], ['trace', 6, 124], ['carrier', 4, 76.25], ['trace', 3, 54.3], ['trace', 3, -2]];
  for (const [id, secs, sb] of windows) {
    const res = await render(id, secs, sb);
    console.log(`    ${id} from beat ${sb}, ${secs}s (${res.ms}ms): peak ${f3(res.peak)} rms ${f3(res.rms)}  [${res.perSecondRms.map((v) => Math.round(v * 1000)).join(' ')}]`);
    check(res.peak < 0.95 && res.rms > 0.02, `${id}@${sb} renders, peak ${f3(res.peak)}`);
    if (id === 'overdrive') {   // beats 80-144 = 25.6s of drop
      const drop = res.perSecondRms.slice(0, 25);
      check(Math.min.apply(null, drop) > 0.03, `overdrive drop window has no silent second (min ${f3(Math.min.apply(null, drop))})`);
      const ref = mean(full.overdrive.bySec.drop);
      check(Math.abs(mean(drop) - ref) < 0.25 * ref, `overdrive drop window matches the full render (${f3(mean(drop))} vs ${f3(ref)})`);
    }
  }

  console.log('\n  sfx (rendered alone)');
  const fx = {};
  for (const n of SFX) fx[n] = await render('sfx:' + n, 1.6, 0);
  console.log('    ' + SFX.map((n) => `${n} ${f3(fx[n].peak)}`).join('  '));
  const fxPeaks = SFX.map((n) => fx[n].peak);
  check(fxPeaks.every((p) => p > 0.01 && p < 0.95), 'every sfx is audible and below the ceiling');
  check(SFX.every((n) => n === 'die' || fx.die.peak > fx[n].peak), 'die is the loudest sfx');
  check(fx.land.peak < fx.jump.peak, 'land is softer than jump');
  check(SFX.every((n) => n === 'die' || fx[n].peak < 0.6 * full.trace.peak), 'sfx sit below the music peak');

  if (MIX) {
    console.log('\n  solo-track rms (track alone through the master chain)');
    for (const [id, sb] of [['trace', 64], ['carrier', 80], ['carrier', 48], ['overdrive', 80], ['overdrive', 144], ['menu', 0]]) {
      const row = [];
      for (const tk of TRACKS) {
        const res = await render(id, 8, sb, '^(?!' + tk + '$)');
        if (res.peak > 0.0005) row.push(`${tk} ${f3(res.rms)}/${f3(res.peak)}`);
      }
      console.log(`    ${id}@${sb}: ` + row.join('  '));
    }
  }

  r = await page.evaluate(() => PAudio._stats().warnings);
  check(r.length === 0, 'song data compiles without warnings' + (r.length ? ': ' + r.join('; ') : ''));

  // ------------------------------------------------------------ 4. live context
  console.log('\n[4] live AudioContext');
  const sleep = (ms) => page.waitForTimeout(ms);
  const tapPeak = () => page.evaluate(() => {
    if (!window.__an) return -1;
    const b = new Float32Array(window.__an.fftSize); window.__an.getFloatTimeDomainData(b);
    let p = 0; for (let i = 0; i < b.length; i++) p = Math.max(p, Math.abs(b[i])); return p;
  });
  const tapMax = async (ms) => { let p = 0; const end = Date.now() + ms; while (Date.now() < end) { p = Math.max(p, await tapPeak()); await sleep(15); } return p; };

  r = await page.evaluate((SFX) => {   // no user gesture yet: context is probably suspended
    const out = { threw: null };
    try {
      PAudio.init(); PAudio.init(); out.made = window.__made; out.state = PAudio._stats().state;
      SFX.forEach((n) => PAudio.sfx(n));
      PAudio.playSong('trace', 0); out.beat0 = PAudio.songBeat();
      PAudio.playSong('trace', 37.5); out.beat1 = PAudio.songBeat();
      PAudio.stopSong(); out.beat2 = PAudio.songBeat(); out.pulse = PAudio.pulse(); out.timer = PAudio._stats().timer;
    } catch (e) { out.threw = String(e); }
    return out;
  }, SFX);
  console.log(`    state without a gesture: ${r.state}`);
  check(r.threw === null, 'init / sfx / playSong / stopSong do not throw before a gesture' + (r.threw ? ' (' + r.threw + ')' : ''));
  check(r.made === 1, 'init() twice creates exactly one context');
  check(Math.abs(r.beat0 - (0 - 0.05 * 128 / 60)) < 0.05 && Math.abs(r.beat1 - (37.5 - 0.05 * 128 / 60)) < 0.05,
    `songBeat right after playSong: ${f3(r.beat0)} then ${f3(r.beat1)}`);
  check(r.beat2 === null && r.pulse === 0 && r.timer === false, 'after stopSong: songBeat null, pulse 0, timer cleared');

  await page.evaluate(() => document.addEventListener('pointerdown', () => { PAudio.init(); PAudio.resume(); PAudio.sfx('click'); }, { once: true }));
  await page.mouse.click(20, 20);
  await sleep(200);
  const running = await page.evaluate(() => PAudio.ready());
  console.log(`    state after a click gesture: ${running ? 'running' : 'still suspended'}`);
  if (!running) {
    console.log('  note  context never started here, so the timed checks below were skipped');
  } else {
    check((await tapMax(120)) < 0.02, 'stale sfx / notes queued while suspended did not fire on resume');
    await page.evaluate(() => PAudio.sfx('die'));
    check((await tapMax(200)) > 0.02, 'sfx produces output on the live context');
    await sleep(500);

    await page.evaluate(() => PAudio.playSong('trace', 16));
    await sleep(450);
    r = await page.evaluate(() => ({ beat: PAudio.songBeat(), stats: PAudio._stats() }));
    check(r.beat > 16.5 && r.beat < 17.6, `songBeat advances in real time (${f3(r.beat)} about 0.45s after playSong(trace,16))`);
    check(r.stats.nextStep > 16 * 4 + 2, `scheduler is ahead of the playhead (next step ${r.stats.nextStep})`);
    const pulses = await page.evaluate(() => new Promise((res) => {
      const v = []; const iv = setInterval(() => { v.push(PAudio.pulse()); if (v.length >= 60) { clearInterval(iv); res(v); } }, 16);
    }));
    check(pulses.every((p) => p >= 0 && p <= 1) && Math.max.apply(null, pulses) > 0.6 && Math.min.apply(null, pulses) < 0.2,
      `pulse() swings with the kick (min ${f3(Math.min.apply(null, pulses))}, max ${f3(Math.max.apply(null, pulses))})`);
    check((await tapMax(400)) > 0.1, 'music produces output on the live context');

    await page.evaluate(() => PAudio.playSong('trace', 37.5));
    await sleep(300);
    r = await page.evaluate(() => PAudio.songBeat());
    check(r > 37.9 && r < 38.6, `restart at beat 37.5 lands where expected (${f3(r)} after 0.3s)`);

    r = await page.evaluate(() => new Promise((res) => {   // death spam: 60 restarts, 20ms apart
      let n = 0, threw = null, worst = 0;
      const iv = setInterval(() => {
        const t0 = performance.now();
        try { PAudio.playSong(n % 2 ? 'overdrive' : 'carrier', n % 3 ? 80 : 0); PAudio.sfx('die'); } catch (e) { threw = String(e); }
        worst = Math.max(worst, performance.now() - t0);
        if (++n >= 60) { clearInterval(iv); res({ threw, worst, stats: PAudio._stats() }); }
      }, 20);
    }));
    check(r.threw === null, `60 rapid restarts do not throw (slowest playSong+sfx call ${r.worst.toFixed(1)}ms)`);
    check(r.worst < 25, 'restart is cheap (< 25ms worst case)');
    const loud = await tapMax(500);
    check(loud < 0.95, `output stays under the ceiling after restart spam (tap peak ${f3(loud)})`);

    await page.evaluate(() => { PAudio.setMusicVolume(0); });
    await sleep(700);
    check((await tapMax(200)) < 0.01, 'setMusicVolume(0) silences the music');
    await page.evaluate(() => { PAudio.setMusicVolume(1); });
    await sleep(200);
    check((await tapMax(300)) > 0.1, 'setMusicVolume(1) brings it back');

    await page.evaluate(() => PAudio.stopSong());
    r = await page.evaluate(() => ({ beat: PAudio.songBeat(), pulse: PAudio.pulse(), timer: PAudio._stats().timer }));
    check(r.beat === null && r.pulse === 0 && r.timer === false, 'stopSong: songBeat null, pulse 0, timer cleared');
    await sleep(1500);
    check((await tapMax(200)) < 0.003, 'output is silent after stopSong (no stuck notes or delay tail)');

    await page.evaluate(() => PAudio.playSong('menu', 0));
    await sleep(1200);
    r = await page.evaluate(() => ({ beat: PAudio.songBeat(), song: PAudio._stats().song }));
    check(r.song === 'menu' && r.beat > 1.5, `menu plays after a stop (beat ${f3(r.beat)})`);
    await page.evaluate(() => PAudio.stopSong(0));
  }

  await browser.close();
  console.log('');
  if (errors.length) { console.log('page errors:\n  ' + errors.join('\n  ')); failures += errors.length; }
  console.log(failures ? `FAILED: ${failures} problem(s)` : 'ALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
