#!/usr/bin/env node
/* Phosphor audio test. Runs src/audio.js in headless Chromium (Playwright).
   - offline-renders every song in full, plus mid-song windows and every sfx
   - checks peak, silence, section loudness, the menu / level balance and the oscillator budget
   - smoke-tests the live API: no AudioContext, blocked (suspended) context, running context, restart spam, stalled timer
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
const min = (a) => Math.min.apply(null, a);
const max = (a) => Math.max.apply(null, a);

// which section does the 1-second window starting at `sec` sit fully inside? (beat 0 sounds at 0.05s)
function sectionOf(song, sec, startBeat) {
  const bps = song.bpm / 60, b0 = startBeat + (sec - 0.05) * bps, b1 = b0 + bps;
  for (const s of song.sec) if (b0 >= s[0] && b1 <= s[1]) return s[2];
  return null;
}

// Installed before audio.js loads: counts contexts and nodes, records every source's start/stop time,
// and taps whatever feeds the real destination so the live checks can look at actual output.
function instrument() {
  window.__made = 0; window.__nodes = 0; window.__iv = [];
  const O = window.AudioContext;
  window.AudioContext = class extends O { constructor(...a) { super(...a); window.__made++; window.__ctx = this; } };
  const conn = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode && !(this.context instanceof OfflineAudioContext)) {
      window.__an = this.context.createAnalyser(); window.__an.fftSize = 2048; conn.call(this, window.__an);
    }
    return conn.call(this, dest, ...rest);
  };
  for (const [C, tag] of [[OscillatorNode, 'osc'], [AudioBufferSourceNode, 'noise']]) {
    const st = C.prototype.start, sp = C.prototype.stop;
    C.prototype.start = function (t) { this.__r = { tag, a: t || 0, b: Infinity }; window.__iv.push(this.__r); return st.apply(this, arguments); };
    C.prototype.stop = function (t) { if (this.__r) this.__r.b = t || 0; return sp.apply(this, arguments); };
  }
  for (const n of ['createGain', 'createBiquadFilter', 'createOscillator', 'createBufferSource', 'createStereoPanner', 'createDelay']) {
    const f = BaseAudioContext.prototype[n];
    BaseAudioContext.prototype[n] = function () { window.__nodes++; return f.apply(this, arguments); };
  }
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

  // ------------------------------------------------------------ 2. API surface
  console.log('\n[2] API surface');
  page = await newPage(instrument);
  r = await page.evaluate((API) => ({
    missing: API.filter((n) => typeof PAudio[n] !== 'function'), songs: PAudio.songs, made: window.__made,
    pre: { beat: PAudio.songBeat(), pulse: PAudio.pulse(), ready: PAudio.ready() }
  }), API);
  check(r.missing.length === 0, 'all API functions present' + (r.missing.length ? ' (missing ' + r.missing + ')' : ''));
  check(r.made === 0, 'no AudioContext created on load');
  check(r.pre.beat === null && r.pre.pulse === 0 && r.pre.ready === false, 'before init: songBeat null, pulse 0, ready false');
  for (const id of Object.keys(SONGS)) {
    const s = r.songs[id];
    check(!!s && s.bpm === SONGS[id].bpm && s.lengthBeats === SONGS[id].len && typeof s.name === 'string', `songs.${id} = ${JSON.stringify(s)}`);
  }

  // ------------------------------------------------------------ 3. offline renders
  console.log('\n[3] offline renders (both buses at full volume)');
  const render = (id, seconds, startBeat, mute) => page.evaluate(([id, seconds, startBeat, mute]) => {
    const t0 = performance.now(), n0 = window.__nodes; window.__iv.length = 0;
    return PAudio._renderOffline(id, seconds, startBeat, mute).then((x) => Object.assign(x, { ms: Math.round(performance.now() - t0), nodes: window.__nodes - n0 }));
  }, [id, seconds, startBeat || 0, mute || null]);
  // average / max number of sources sounding at once between two beats of the render that just finished
  const sounding = (bpm, b0, b1) => page.evaluate(([bpm, b0, b1]) => {
    const t0 = 0.05 + b0 * 60 / bpm, t1 = 0.05 + b1 * 60 / bpm; let so = 0, mo = 0, sn = 0, cnt = 0;
    for (let t = t0; t < t1; t += 0.01) {
      let o = 0, nz = 0;
      for (const iv of window.__iv) if (iv.a <= t && t < iv.b) { if (iv.tag === 'osc') o++; else nz++; }
      so += o; sn += nz; if (o > mo) mo = o; cnt++;
    }
    return { osc: so / cnt, oscMax: mo, noise: sn / cnt };
  }, [bpm, b0, b1]);

  const full = {};
  for (const id of Object.keys(SONGS)) {
    const song = SONGS[id], secs = Math.ceil(song.len * 60 / song.bpm + 2);   // whole song plus the first moments of the loop
    const res = await render(id, secs, 0);
    full[id] = res;
    const bySec = {};
    res.perSecondRms.forEach((v, i) => { const s = sectionOf(song, i, 0); if (s) (bySec[s] = bySec[s] || []).push(v); });
    res.bySec = bySec;
    console.log(`\n  ${id}: ${secs}s rendered in ${res.ms}ms   peak ${f3(res.peak)}   rms ${f3(res.rms)}   in soft-clip knee ${(res.hot * 100).toFixed(2)}% of samples`);
    console.log('    per-second rms x1000: ' + res.perSecondRms.map((v) => Math.round(v * 1000)).join(' '));
    console.log('    section mean rms:     ' + song.sec.map((s) => `${s[2]} ${f3(mean(bySec[s[2]] || [0]))}`).join('   '));
    const busy = [];
    for (const s of song.sec) busy.push(Object.assign(await sounding(song.bpm, s[0], s[1]), { name: s[2] }));
    console.log('    oscillators at once:  ' + busy.map((b) => `${b.name} ${b.osc.toFixed(1)} (max ${b.oscMax})`).join('   ') + `   | ${Math.round(res.nodes / secs)} nodes created per second`);
    check(res.peak < 0.95, `${id} peak ${f3(res.peak)} < 0.95`);
    check(res.hot < 0.002, `${id} barely touches the soft clipper (${(res.hot * 100).toFixed(2)}% of samples)`);
    check(res.rms > 0.05, `${id} is not near-silent overall`);
    for (const name of song.loud) check(min(bySec[name]) > 0.03, `${id} no silent second in ${name} (min ${f3(min(bySec[name]))})`);
    if (bySec.intro) check(mean(bySec.intro) < 0.8 * mean(bySec[song.top]), `${id} intro (${f3(mean(bySec.intro))}) quieter than ${song.top} (${f3(mean(bySec[song.top]))})`);
    check(res.perSecondRms[res.perSecondRms.length - 1] > 0.005, `${id} keeps playing across the loop point`);
    check(max(busy.map((b) => b.osc)) <= 14, `${id} oscillator budget: busiest section averages ${max(busy.map((b) => b.osc)).toFixed(1)} at once`);
  }
  const levelRms = ['trace', 'carrier', 'overdrive'].map((id) => full[id].rms);
  check(full.menu.rms < 0.65 * min(levelRms), `menu rms ${f3(full.menu.rms)} clearly below level songs (${levelRms.map(f3).join(', ')})`);
  check(mean(full.trace.bySec.build) < mean(full.trace.bySec.main), 'trace build quieter than the main section');
  check(mean(full.carrier.bySec.air) < mean(full.carrier.bySec.drop), 'carrier half-time section quieter than the drop');
  check(mean(full.overdrive.bySec.breakdown) < 0.8 * mean(full.overdrive.bySec.drop), 'overdrive breakdown clearly quieter than the drop');
  check(mean(full.overdrive.bySec.climax) >= 0.95 * mean(full.overdrive.bySec.drop), 'overdrive climax at least as loud as the drop');

  console.log('\n  mid-song starts');
  for (const [id, secs, sb] of [['overdrive', 27, 80], ['trace', 3, 37.5], ['trace', 6, 124], ['carrier', 4, 76.25], ['trace', 3, 54.3], ['trace', 3, -2]]) {
    const res = await render(id, secs, sb);
    console.log(`    ${id} from beat ${sb}, ${secs}s (${res.ms}ms): peak ${f3(res.peak)} rms ${f3(res.rms)}  [${res.perSecondRms.map((v) => Math.round(v * 1000)).join(' ')}]`);
    check(res.peak < 0.95 && res.rms > 0.02, `${id}@${sb} renders, peak ${f3(res.peak)}`);
    if (id === 'overdrive') {   // beats 80-144 = 25.6s of drop
      const drop = res.perSecondRms.slice(0, 25), ref = mean(full.overdrive.bySec.drop);
      check(min(drop) > 0.03, `overdrive drop window has no silent second (min ${f3(min(drop))})`);
      check(Math.abs(mean(drop) - ref) < 0.25 * ref, `overdrive drop window matches the full render (${f3(mean(drop))} vs ${f3(ref)})`);
    }
  }
  const padOnly = await render('trace', 1, 18, '^(?!pad$)');   // joining mid-bar must pick up the pad that began at beat 16
  check(padOnly.rms > 0.005, `a start in the middle of a bar still gets its pad (pad-only rms ${f3(padOnly.rms)})`);
  const riseOnly = await render('trace', 1, 58, '^(?!rise$)');
  check(riseOnly.rms > 0.005, `a start in the middle of the build still gets its riser (riser-only rms ${f3(riseOnly.rms)})`);

  console.log('\n  sfx (rendered alone)');
  const fx = {};
  for (const n of SFX) fx[n] = await render('sfx:' + n, 1.6, 0);
  console.log('    peaks: ' + SFX.map((n) => `${n} ${f3(fx[n].peak)}`).join('  '));
  check(SFX.every((n) => fx[n].peak > 0.01 && fx[n].peak < 0.95), 'every sfx is audible and below the ceiling');
  check(SFX.every((n) => n === 'die' || fx.die.peak > fx[n].peak), 'die is the loudest sfx');
  check(fx.land.peak < fx.jump.peak, 'land is softer than jump');
  check(SFX.every((n) => n === 'die' || fx[n].peak < 0.6 * full.trace.peak), 'sfx sit below the music peak');

  if (MIX) {
    console.log('\n  solo-track rms/peak (track alone through the master chain)');
    for (const [id, sb] of [['trace', 0], ['trace', 16], ['trace', 64], ['carrier', 80], ['carrier', 48], ['overdrive', 16], ['overdrive', 80], ['overdrive', 144], ['menu', 0]]) {
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
  await page.evaluate(() => { window.__iv.length = 0; });
  const sleep = (ms) => page.waitForTimeout(ms);
  const tapMax = async (ms) => {   // loudest sample seen at the output over `ms`
    let p = 0; const end = Date.now() + ms;
    while (Date.now() < end) {
      p = Math.max(p, await page.evaluate(() => {
        const b = new Float32Array(window.__an.fftSize); window.__an.getFloatTimeDomainData(b);
        let q = 0; for (let i = 0; i < b.length; i++) q = Math.max(q, Math.abs(b[i])); return q;
      }));
      await sleep(12);
    }
    return p;
  };
  // Headless Chromium lets a context run without a gesture, so autoplay blocking is simulated:
  // suspend the context and make resume() fail until the "gesture" arrives.
  const block = () => page.evaluate(async () => {
    await window.__ctx.suspend();
    window.__resume = window.__resume || window.__ctx.resume.bind(window.__ctx);
    window.__ctx.resume = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
  });
  const gesture = () => page.evaluate(() => { window.__ctx.resume = window.__resume; PAudio.init(); PAudio.resume(); });

  r = await page.evaluate((SFX) => {
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
  console.log(`    context state straight after init(): ${r.state}`);
  check(r.threw === null, 'init / every sfx / playSong(trace,0) / playSong(trace,37.5) / stopSong do not throw' + (r.threw ? ' (' + r.threw + ')' : ''));
  check(r.made === 1, 'init() twice creates exactly one context');
  check(Math.abs(r.beat0 + 0.05 * 128 / 60) < 0.05 && Math.abs(r.beat1 - (37.5 - 0.05 * 128 / 60)) < 0.05,
    `songBeat right after playSong is 50ms short of the start beat: ${f3(r.beat0)} then ${f3(r.beat1)}`);
  check(r.beat2 === null && r.pulse === 0 && r.timer === false, 'after stopSong: songBeat null, pulse 0, timer cleared');
  await sleep(1600);

  await block();
  r = await page.evaluate((SFX) => {
    const out = { threw: null, ready: PAudio.ready() };
    try { SFX.forEach((n) => PAudio.sfx(n)); PAudio.setMusicVolume(0.9); PAudio.setMusicVolume(1); } catch (e) { out.threw = String(e); }
    return out;
  }, SFX);
  check(r.ready === false && r.threw === null, 'blocked context: ready() false, sfx calls do not throw');
  await gesture();
  await sleep(150);
  check(await page.evaluate(() => PAudio.ready()), 'resume() from a gesture starts the context');
  check((await tapMax(300)) < 0.005, 'sfx requested while blocked were dropped, not replayed on resume');

  await block();
  r = await page.evaluate(async () => {
    PAudio.playSong('menu', 0);
    const b0 = PAudio.songBeat(); await new Promise((res) => setTimeout(res, 300));
    return { b0, b1: PAudio.songBeat(), stats: PAudio._stats() };
  });
  check(r.b0 !== null && r.b0 === r.b1 && r.b0 < 0, `song requested while blocked waits at its start (songBeat frozen at ${f3(r.b0)})`);
  await gesture();
  await sleep(700);
  r = await page.evaluate(() => PAudio.songBeat());
  check(r > 0.6 && r < 1.4, `after the gesture it plays from the start (beat ${f3(r)} about 0.7s later)`);
  check((await tapMax(400)) > 0.01, 'menu music reaches the output');
  await page.evaluate(() => PAudio.stopSong());
  await sleep(300);

  await page.evaluate(() => PAudio.sfx('die'));
  check((await tapMax(200)) > 0.05, 'sfx produces output on the running context');
  await sleep(500);

  await page.evaluate(() => PAudio.playSong('trace', 16));
  await sleep(450);
  r = await page.evaluate(() => ({ beat: PAudio.songBeat(), stats: PAudio._stats() }));
  check(r.beat > 16.5 && r.beat < 17.6, `songBeat advances in real time (${f3(r.beat)} about 0.45s after playSong(trace,16))`);
  check(r.stats.nextStep > r.beat * 4 && r.stats.nextStep < r.beat * 4 + 4, `scheduler stays just ahead of the playhead (next step ${r.stats.nextStep}, playhead step ${(r.beat * 4).toFixed(1)})`);
  const pulses = await page.evaluate(() => new Promise((res) => {
    const v = []; const iv = setInterval(() => { v.push(PAudio.pulse()); if (v.length >= 60) { clearInterval(iv); res(v); } }, 16);
  }));
  check(pulses.every((p) => p >= 0 && p <= 1) && max(pulses) > 0.6 && min(pulses) < 0.2, `pulse() swings with the kick (min ${f3(min(pulses))}, max ${f3(max(pulses))})`);
  check((await tapMax(400)) > 0.1, 'music produces output on the running context');

  await page.evaluate(() => PAudio.playSong('trace', 37.5));
  await sleep(300);
  r = await page.evaluate(() => PAudio.songBeat());
  check(r > 37.9 && r < 38.6, `restart at beat 37.5 lands where expected (${f3(r)} after 0.3s)`);

  r = await page.evaluate(() => {   // main thread stalls for 1.2s (stands in for a throttled background tab)
    const before = { nodes: window.__nodes, step: PAudio._stats().nextStep }, end = performance.now() + 1200;
    while (performance.now() < end) { /* busy */ }
    return new Promise((res) => setTimeout(() => res({ nodes: window.__nodes - before.nodes, steps: PAudio._stats().nextStep - before.step, beat: PAudio.songBeat(), next: PAudio._stats().nextStep }), 60));
  });
  check(r.steps > 9 && r.nodes < 90, `after a 1.2s stall the scheduler skips ahead (${r.steps} steps on) without replaying late notes (${r.nodes} nodes made)`);
  check(r.next > r.beat * 4, 'and is back ahead of the playhead');

  r = await page.evaluate(() => new Promise((res) => {   // death spam: 60 restarts, 20ms apart
    let n = 0, threw = null, worst = 0;
    const iv = setInterval(() => {
      const t0 = performance.now();
      try { PAudio.playSong(n % 2 ? 'overdrive' : 'carrier', n % 3 ? 80 : 0); PAudio.sfx('die'); } catch (e) { threw = String(e); }
      worst = Math.max(worst, performance.now() - t0);
      if (++n >= 60) { clearInterval(iv); res({ threw, worst }); }
    }, 20);
  }));
  check(r.threw === null, `60 rapid restarts do not throw (slowest playSong + sfx call ${r.worst.toFixed(1)}ms)`);
  check(r.worst < 25, 'a restart is cheap (< 25ms worst case)');
  const loud = await tapMax(500);
  check(loud < 0.95, `output stays under the ceiling after restart spam (tap peak ${f3(loud)})`);

  await page.evaluate(() => PAudio.setMusicVolume(0));
  await sleep(700);
  check((await tapMax(200)) < 0.01, 'setMusicVolume(0) silences the music');
  await page.evaluate(() => PAudio.setMusicVolume(1));
  await sleep(200);
  check((await tapMax(300)) > 0.1, 'setMusicVolume(1) brings it back');

  await page.evaluate(() => PAudio.stopSong());
  r = await page.evaluate(() => ({ beat: PAudio.songBeat(), pulse: PAudio.pulse(), timer: PAudio._stats().timer }));
  check(r.beat === null && r.pulse === 0 && r.timer === false, 'stopSong: songBeat null, pulse 0, timer cleared');
  await sleep(1500);
  check((await tapMax(250)) < 0.003, 'output is silent after stopSong (no stuck notes, no delay tail)');
  r = await page.evaluate(() => { const now = window.__ctx.currentTime; return window.__iv.filter((iv) => iv.a < 1e6 && iv.b > now + 0.5).length; });
  check(r === 0, `no source is left running after stopSong (${r} still scheduled)`);

  await browser.close();
  console.log('');
  if (errors.length) { console.log('page errors:\n  ' + errors.join('\n  ')); failures += errors.length; }
  console.log(failures ? `FAILED: ${failures} problem(s)` : 'ALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
