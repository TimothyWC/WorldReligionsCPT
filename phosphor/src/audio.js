/* Phosphor audio: procedural music + sound effects on the Web Audio API.
   Classic script, no dependencies, exposes one global: window.PAudio.
   Every note below is original pattern data written for this game. No samples, no network. */
(function () {
  'use strict';

  var AC = window.AudioContext || window.webkitAudioContext;
  var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  var LOOKAHEAD = 0.18, TICK_MS = 25, LEAD_IN = 0.05, PULSE_TC = 0.06;
  var TRIM = 0.85;    // post-compressor gain (the compressor adds makeup gain of its own)
  var ctx = null, rig = null, cur = null, timer = 0, musicVol = 0.8, sfxVol = 0.8, warnings = [];

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function fit(pc, lo) { return lo + (((pc - lo) % 12) + 12) % 12; }   // pitch class -> midi note in [lo, lo+12)
  function clamp01(v) { v = +v; return v > 1 ? 1 : v > 0 ? v : 0; }

  // ---------------------------------------------------------------- master chain
  // music bus + sfx bus -> compressor -> trim -> soft clipper (hard ceiling 0.94) -> destination
  function buildRig(c, mv, sv) {
    var r = { c: c, music: c.createGain(), sfx: c.createGain(), comp: c.createDynamicsCompressor(), trim: c.createGain(), clip: c.createWaveShaper() };
    var n = c.sampleRate * 2, buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0), s = 22222, i;
    for (i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823.5 - 1; }   // one shared white-noise buffer
    r.noise = buf;
    var N = 1025, cv = new Float32Array(N), A = 0.72, M = 0.94, c1 = (1 - A) / (M - A), x, ax, u;
    for (i = 0; i < N; i++) {   // linear up to A, then a cubic knee that lands flat on M at full scale
      x = i / (N - 1) * 2 - 1; ax = Math.abs(x); u = (ax - A) / (1 - A);
      cv[i] = (x < 0 ? -1 : 1) * (ax <= A ? ax : A + (M - A) * (c1 * u + (3 - 2 * c1) * u * u + (c1 - 2) * u * u * u));
    }
    r.clip.curve = cv;
    r.comp.threshold.value = -10; r.comp.knee.value = 8; r.comp.ratio.value = 3; r.comp.attack.value = 0.005; r.comp.release.value = 0.15;
    r.music.gain.value = mv; r.sfx.gain.value = sv; r.trim.gain.value = TRIM;
    r.music.connect(r.comp); r.sfx.connect(r.comp); r.comp.connect(r.trim); r.trim.connect(r.clip); r.clip.connect(c.destination);
    return r;
  }

  // ---------------------------------------------------------------- node helpers
  // S is a "play session" (or a tiny stand-in for sfx): { c: context, rig, live: [[source, endTime]...] }
  function osc(S, type, f, t0, t1, det) {
    var o = S.c.createOscillator();
    o.type = type; o.frequency.value = f; if (det) o.detune.value = det;
    o.start(t0); o.stop(t1); if (S.live) S.live.push([o, t1]);
    return o;
  }
  function free(src, node) { src.onended = function () { try { node.disconnect(); } catch (e) {} }; }
  function decay(c, t, d, v, atk) {   // percussive envelope: optional short attack, exponential fall to silence at t+d
    var g = c.createGain(), p = g.gain;
    if (atk) { p.setValueAtTime(0, t); p.linearRampToValueAtTime(v, t + atk); } else p.setValueAtTime(v, t);
    p.exponentialRampToValueAtTime(v * 0.004, t + d); p.linearRampToValueAtTime(0, t + d + 0.01);
    return g;
  }
  function adsr(c, t, d, v, a, r, s) {   // held envelope: attack a, settle to s*v, hold to t+d, release r
    var g = c.createGain(), p = g.gain;
    if (d < a + 0.02) d = a + 0.02;
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(v, t + a);
    if (s < 1) p.linearRampToValueAtTime(v * s, t + a + Math.min(0.1, (d - a) * 0.8));
    p.setValueAtTime(v * s, t + d); p.linearRampToValueAtTime(0, t + d + r);
    return g;
  }
  function link(S, g, bus, pan) {   // connect g to a bus, optionally through a panner; returns the node to disconnect later
    if (pan && S.c.createStereoPanner) { var p = S.c.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(bus); return p; }
    g.connect(bus); return g;
  }
  function tone(S, dest, t, d, v, type, f0, f1, pd, atk) {   // oscillator blip with optional pitch glide f0 -> f1 over pd
    var o = osc(S, type, f0, t, t + d + 0.02), g = decay(S.c, t, d, v, atk);
    if (f1) { o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + pd); }
    o.connect(g); g.connect(dest); free(o, g);
    return o;
  }
  function nz(S, dest, t, d, v, type, f, q, atk) {   // filtered noise burst; returns the filter for sweeps
    var c = S.c, n = c.createBufferSource(), fl = c.createBiquadFilter(), g = decay(c, t, d, v, atk);
    n.buffer = S.rig.noise; n.loop = true; fl.type = type; fl.frequency.value = f; fl.Q.value = q || 0.7;
    n.connect(fl); fl.connect(g); g.connect(dest);
    S.nz = ((S.nz || 0) + 0.173) % 1.7; n.start(t, S.nz); n.stop(t + d + 0.02);
    if (S.live) S.live.push([n, t + d + 0.02]);
    free(n, g);
    return fl;
  }

  // ---------------------------------------------------------------- voices: fn(S, t, dur, a, b, c [, progress])
  function vKick(S, t, d, v) {
    tone(S, S.drum, t, 0.25, v * 0.85, 'sine', 165, 48, 0.085);    // body
    tone(S, S.drum, t, 0.05, v * 0.32, 'triangle', 330, 120, 0.03);   // knock, so it still reads on small speakers
    nz(S, S.drum, t, 0.012, v * 0.26, 'highpass', 2000);              // click
    S.kicks.push(t);
    S.duck.gain.setTargetAtTime(1 - 0.5 * v, t, 0.005);   // sidechain-style dip on bass + pad
    S.duck.gain.setTargetAtTime(1, t + 0.05, 0.075);
  }
  function vSnare(S, t, d, v) {
    nz(S, S.drum, t, 0.17, v * 0.54, 'bandpass', 2700, 0.5);
    tone(S, S.drum, t, 0.1, v * 0.36, 'triangle', 235, 170, 0.06);
  }
  function vClap(S, t, d, v) {
    nz(S, S.drum, t, 0.02, v * 0.44, 'bandpass', 1500, 1.2);
    nz(S, S.drum, t + 0.011, 0.02, v * 0.44, 'bandpass', 1500, 1.2);
    nz(S, S.drum, t + 0.022, 0.19, v * 0.52, 'bandpass', 1500, 1.2);
  }
  function vHat(S, t, d, v, hp, side) { nz(S, side > 0 ? S.right : side < 0 ? S.left : S.drum, t, d, v * 0.36, 'highpass', hp); }
  function vTom(S, t, d, v) { var f = 70 + 140 * v; tone(S, S.drum, t, d, 0.5, 'sine', f * 1.7, f, 0.07); }

  var BASS_LV = [0.185, 0.078, 0.14, 0.1];   // 0 clean saw, 1 gritty square+saw, 2 reese (two detuned saws), 3 rubbery square
  function vBass(S, t, d, m, v, br) {
    var c = S.c, k = S.def.bass, f = mtof(m), e = t + d + 0.05, fl = c.createBiquadFilter();
    var g = adsr(c, t, d, v * BASS_LV[k], 0.005, 0.035, 0.8), lo = 160 + 1000 * br, o;
    o = osc(S, k % 2 ? 'square' : 'sawtooth', f, t, e, k === 2 ? -14 : 0); o.connect(fl);
    if (k === 1 || k === 2) osc(S, 'sawtooth', f, t, e, k === 2 ? 14 : 6).connect(fl);
    if (k === 3) { o.frequency.setValueAtTime(f * 1.3, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06); }   // snaps down onto the note
    fl.type = 'lowpass'; fl.Q.value = k === 3 ? 8 : k === 1 ? 5 : 2.5;
    fl.frequency.setValueAtTime(lo * (k === 2 ? 2 : 4.5), t); fl.frequency.exponentialRampToValueAtTime(lo, t + (k === 2 ? 0.3 : 0.13));
    fl.connect(g); g.connect(S.duck); free(o, g);
  }
  function vPluck(S, t, d, m, v, pan, br) {   // br (0..1, default 1) closes the filter for "filtered" passages
    var c = S.c, f = mtof(m), fl = c.createBiquadFilter(), g = decay(c, t, d, v * 0.42, 0.003);
    var o = osc(S, S.def.pluck || 'sawtooth', f, t, t + d + 0.02);
    if (br == null) br = 1;
    fl.type = 'lowpass'; fl.Q.value = 1.5;
    fl.frequency.setValueAtTime(Math.min(11000, f * 10) * (0.15 + 0.85 * br), t);
    fl.frequency.exponentialRampToValueAtTime(Math.max(700, f * 2.5) * (0.3 + 0.7 * br), t + 0.16);
    o.connect(fl); fl.connect(g); free(o, link(S, g, S.mel, pan));
  }
  // lead kinds: [wave1, wave2, detune cents, cutoff, Q, attack, release, level]
  var LEADS = [['sawtooth', 'square', 9, 3600, 1, 0.01, 0.1, 0.095], ['square', 'sawtooth', -11, 2300, 4, 0.006, 0.07, 0.085],
               ['sawtooth', 'sawtooth', 15, 3000, 2, 0.005, 0.07, 0.12], ['triangle', 'sawtooth', 8, 1400, 0.7, 0.08, 0.4, 0.12],
               ['square', 'sawtooth', 1207, 3200, 6, 0.004, 0.06, 0.09],    // 4: thin and wiry, second voice an octave up
               ['sawtooth', 'sawtooth', 7, 4500, 3, 0.003, 0.045, 0.1]];     // 5: bright tight saw for fast runs
  function vLead(S, t, d, m, v, k) {
    var c = S.c, K = LEADS[k], f = mtof(m), e = t + d + K[6] + 0.02, fl = c.createBiquadFilter();
    var g = adsr(c, t, d, v * K[7], K[5], K[6], 0.75), cut = Math.max(K[3], f * 2.5), o = osc(S, K[0], f, t, e);
    o.connect(fl); osc(S, K[1], f, t, e, K[2]).connect(fl);
    fl.type = 'lowpass'; fl.Q.value = K[4];
    fl.frequency.setValueAtTime(cut * 1.8, t); fl.frequency.exponentialRampToValueAtTime(cut, t + 0.15);
    fl.connect(g); g.connect(S.mel); free(o, g);
  }
  function vPad(S, t, d, notes, v, br) {   // one saw per chord tone; the session's ensemble chorus supplies the width
    var c = S.c, e = t + d + 0.42, fl = c.createBiquadFilter(), g = adsr(c, t, d, v * 0.08, Math.min(0.4, d * 0.3), 0.4, 1), o, i;
    for (i = 0; i < notes.length; i++) { o = osc(S, 'sawtooth', mtof(notes[i]), t, e, i % 2 ? 5 : -5); o.connect(fl); }
    fl.type = 'lowpass'; fl.frequency.value = 400 + 2200 * br; fl.Q.value = 0.6;
    fl.connect(g); g.connect(S.pad); free(o, g);
  }
  function vStab(S, t, d, notes, v) {
    var c = S.c, fl = c.createBiquadFilter(), g = decay(c, t, 0.22, v * 0.2, 0.003), o, i;
    for (i = 0; i < notes.length; i++) { o = osc(S, i % 2 ? 'square' : 'sawtooth', mtof(notes[i]), t, t + 0.25, i * 7 - 7); o.connect(fl); }
    fl.type = 'lowpass'; fl.Q.value = 3;
    fl.frequency.setValueAtTime(5200, t); fl.frequency.exponentialRampToValueAtTime(700, t + 0.16);
    fl.connect(g); g.connect(S.mel); free(o, g);
  }
  function vRise(S, t, d, v, a, b, p0) {   // noise sweep + rising tone; p0 = fraction already elapsed when joined late
    p0 = p0 || 0;
    var c = S.c, e = t + d, n = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain(), og = c.createGain();
    var o = osc(S, 'sawtooth', 110, t, e + 0.05);
    n.buffer = S.rig.noise; n.loop = true; n.start(t); n.stop(e + 0.05); S.live.push([n, e + 0.05]);
    fl.type = 'bandpass'; fl.Q.value = 1.1;
    fl.frequency.setValueAtTime(350 * Math.pow(26, p0), t); fl.frequency.exponentialRampToValueAtTime(9100, e);
    o.frequency.setValueAtTime(110 * Math.pow(4, p0), t); o.frequency.exponentialRampToValueAtTime(440, e);
    og.gain.value = 0.1;
    g.gain.setValueAtTime(v * 0.3 * p0, t); g.gain.linearRampToValueAtTime(v * 0.3, e); g.gain.linearRampToValueAtTime(0, e + 0.04);
    n.connect(fl); fl.connect(g); o.connect(og); og.connect(g); g.connect(S.out); free(n, g);
  }

  // ---------------------------------------------------------------- sound effects: fn(X, t), X = { c, rig }
  var FX = {
    jump: function (X, t) { tone(X, X.rig.sfx, t, 0.07, 0.24, 'triangle', 430, 800, 0.06); },
    land: function (X, t) { tone(X, X.rig.sfx, t, 0.09, 0.16, 'sine', 140, 55, 0.07); },
    pad: function (X, t) {   // springy upward sweep
      var o = tone(X, X.rig.sfx, t, 0.24, 0.24, 'triangle', 240, 0, 0, 0.004), cv = new Float32Array(32), i, p;
      for (i = 0; i < 32; i++) { p = i / 31; cv[i] = 240 * Math.pow(4, p) * (1 + 0.1 * Math.sin(p * 25) * (1 - p)); }
      o.frequency.setValueCurveAtTime(cv, t, 0.22);
    },
    ring: function (X, t) {
      tone(X, X.rig.sfx, t, 0.32, 0.16, 'sine', 1568, 0, 0, 0.002);
      tone(X, X.rig.sfx, t, 0.2, 0.09, 'sine', 2352, 0, 0, 0.002);
    },
    gate: function (X, t) {
      var fl = nz(X, X.rig.sfx, t, 0.26, 0.3, 'bandpass', 500, 2.5, 0.05);
      fl.frequency.setValueAtTime(500, t); fl.frequency.exponentialRampToValueAtTime(4200, t + 0.22);
      tone(X, X.rig.sfx, t, 0.22, 0.13, 'sine', 330, 660, 0.2, 0.01);
    },
    die: function (X, t) {
      var fl = nz(X, X.rig.sfx, t, 0.36, 0.42, 'lowpass', 7000, 0.8);
      fl.frequency.setValueAtTime(7000, t); fl.frequency.exponentialRampToValueAtTime(250, t + 0.33);
      tone(X, X.rig.sfx, t, 0.36, 0.26, 'sawtooth', 520, 42, 0.34);
    },
    coin: function (X, t) {
      tone(X, X.rig.sfx, t, 0.09, 0.16, 'triangle', 1319);
      tone(X, X.rig.sfx, t + 0.07, 0.3, 0.16, 'triangle', 1976);
    },
    win: function (X, t) {
      [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach(function (f, i) {
        tone(X, X.rig.sfx, t + i * 0.085, i === 5 ? 0.75 : 0.28, 0.15, 'triangle', f, 0, 0, 0.004);
      });
      tone(X, X.rig.sfx, t + 0.43, 0.8, 0.06, 'sine', 523.25, 0, 0, 0.03);
      tone(X, X.rig.sfx, t + 0.43, 0.8, 0.05, 'sine', 783.99, 0, 0, 0.03);
    },
    click: function (X, t) { tone(X, X.rig.sfx, t, 0.03, 0.1, 'square', 1500, 1000, 0.03); },
    checkpoint: function (X, t) {
      tone(X, X.rig.sfx, t, 0.2, 0.15, 'sine', 784, 0, 0, 0.01);
      tone(X, X.rig.sfx, t + 0.11, 0.34, 0.15, 'sine', 1175, 0, 0, 0.01);
    }
  };

  // ---------------------------------------------------------------- song data
  // Drum strings (k s c h o sh cy tm): 16 chars per bar. x hit, X accent, o soft, g ghost, . rest.
  // bass: r root, R root+octave, f fifth, t third, _ hold.   arp: digit = chord-tone index (3+ wraps up an octave), _ hold.
  // lead / mel: "note/len" tokens (len in 16ths, default 1, r = rest).   ch: one chord per bar, looped across the section.
  var Z = '................', K4 = 'x...x...x...x...', BK = '....x.......x...', OFF = '..x...x...x...x.', OFS = '..o...o...o...o.';
  var H8 = 'o.o.o.o.o.o.o.o.', H16 = 'ogxgogxgogxgogxg', DRONE = 'r_______________', P8 = 'r.r.r.r.r.r.r.r.', K1 = 'x...............';
  function x(s, n) { return s.repeat(n); }

  // First Trace: rising-sequence hook
  var TA = 'a4/3 c5/3 f5/2 e5/2 c5/2 d5/4 ', TB = 'b4/3 d5/3 g5/2 f5/2 d5/2 e5/4 ', TC = 'c5/3 e5/3 a5/2 g5/2 e5/2 g5/4 ';
  var TBASS = 'r_.r_.r_..r_R.r.', TDRIVE = 'r.r.R.r.r.r.R.rr', TARP = '0.2.3.2.4.2.3.2.', TINTRO = '0..2..3.1..2..3.';
  // Carrier Wave: staccato call and response; long floating line for the half-time section
  var CA = 'b4/2 e5/2 r/1 e5/1 g5/2 f#5/2 e5/2 r/1 d5/1 e5/2 ', CB = 'g5/3 e5/3 c5/2 e5/2 g5/2 f#5/2 e5/2 ';
  var CHOOK = CA + CB + 'b4/2 d5/2 r/1 d5/1 g5/2 f#5/2 d5/2 r/1 b4/1 d5/2 a5/3 f#5/3 d5/2 f#5/2 a5/2 b5/4 ' + CA + CB +
              'c#5/2 e5/2 r/1 e5/1 a5/2 g5/2 e5/2 r/1 c#5/1 e5/2 f#5/3 d#5/3 b4/2 d#5/2 f#5/2 b5/4';
  var CAIR = 'g5/6 e5/2 b5/8 a5/6 f#5/2 d5/8 e5/4 g5/4 b5/6 a5/2 g5/10 r/2 d5/2 f#5/2 ' +
             'g5/6 e5/2 c6/8 b5/6 a5/2 f#5/8 g5/4 b5/4 e6/6 d6/2 d#6/8 b5/4 f#5/4';
  var CBASS = 'r_.r_.r_.r.rR.r.', CDRIVE = 'rrRrrrRrrrRrrrRr', CKICK = x(K4, 7) + 'x...x...x...x.xx', CTOM = x(Z, 7) + '........x.x.o.oo';
  // Overdrive: phrygian neighbour-note hook over a breakbeat
  var OA = 'd5/2 r/1 d5/1 eb5/2 d5/2 a5/3 g5/3 f5/2 ', OB = 'd5/2 r/1 d5/1 f5/2 d5/2 bb5/3 a5/3 f5/2 ';
  var OHOOK = OA + OB + 'g5/2 r/1 g5/1 a5/2 g5/2 d6/3 c6/3 bb5/2 g5/3 eb5/3 g5/2 bb5/2 a5/2 g5/2 eb5/2 ' + OA + OB +
              'eb5/2 r/1 eb5/1 g5/2 eb5/2 bb5/3 g5/3 eb5/2 e5/3 c#5/3 e5/2 a5/2 g5/2 e5/2 c#5/2';
  var OK1 = 'x.....x...x.....', OK = OK1 + 'x..x......x..x..', OS1 = BK, OS = OS1 + '....x..g....x..g', OH = 'xgogxgogxgogxgog';
  var OBASS = 'r____.r__.r___R.' + 'r_.r_____.r_.f_.', OSTAB = '..x..x....o.....' + '..x..x....o..x.x';
  var OCH = 'Dm Bb Gm Eb Dm Bb Eb A', OVAMP = 'Dm Dm Eb Cm', OTEASE = 'd5/2 r/1 d5/1 eb5/2 d5/2 r/8 r/16 eb5/2 r/1 eb5/1 g5/2 eb5/2 r/8 r/16';
  var OARP = '0.2.3.2.0.2.3.5.', A16 = '0232023202320232', OTICK = 'x...x...x...x...', OTOCK = 'x.o.x.o.x.o.x.o.';
  // Sidebands: pedal-note pluck sequence over a 3-3-2 kick, off-beat hook
  var SRIFF = 'g4 r d5 g4 r bb4 r c5 d5 r g4 r f5/2 d5 r  g4 r d5 g4 r bb4 r c5 d5 r f5 r g5/2 d5 bb4 ' +
              'g4 r e5 g4 r c5 r d5 e5 r g4 r g5/2 e5 r  g4 r e5 g4 r c5 r d5 e5 r c5 r bb4/2 a4 r';
  var SBREAK = 'g4 r d5 g4 r/12 r/8 bb4 r c5 d5 r/4 g4 r e5 g4 r/12 r/8 c5 r d5 e5 r/4';
  var SA = 'r/2 d5 g5 r f5 d5/2 bb4 d5 r c5/3 r/2 ', SB = 'r/2 e5 g5 r e5 c5/2 g4 c5 r d5/3 r/2 ';
  var SHOOK = SA + SB + 'r/2 e5 a5 r g5 e5/2 c5 e5 r d5/3 r/2 r/2 f5 a5 r f5 d5/2 a4 d5 f5 a5 g5/2 f5/2 ' + SA + SB +
              'r/2 d5 f5 r d5 bb4/2 f5 bb5 r a5/3 r/2 r/2 c5 f5 r a5 f5/2 g5/2 a5/2 c6/2 d6/2';
  var SAIR = 'bb5/8 a5/4 f5/4 g5/8 e5/4 c5/4 a5/6 g5/2 e5/4 c5/4 d5/4 f#5/4 a5/4 d6/4';
  var SK = 'x..o..o.x..o..o.', SKF = x(SK, 3) + 'x..o..o.x..o.xox', SHAT = '.gx.gx.g.gx.gx.g', SCH = 'Gm Gm C C';
  var SBASS = 'r_.R.r_.r.R.rf.R', SPOLY = '..3..4..2..3..4.', OH2 = Z + '..............x.';
  // Sawtooth: zigzag arpeggio runs in C harmonic minor over a straight four-on-the-floor
  var W1 = 'c5 eb5 g5 c6 eb6 c6 g5 eb5 c5/2 g5/2 eb5/2 d5/2 ', W2 = 'c5 eb5 ab5 c6 eb6 c6 ab5 eb5 c5/2 ab5/2 eb5/2 c5/2 ';
  var W3 = 'c5 f5 ab5 c6 eb6 c6 ab5 f5 c5/2 ab5/2 f5/2 d5/2 ', W4 = 'b4 d5 f5 ab5 b5 ab5 f5 d5 b4 d5 g5 b5 d6 b5 g5 d5 ', WHA = W1 + W2 + W3 + W4;
  var WHB = 'eb6 c6 g5 eb5 c5 eb5 g5 c6 eb6/2 d6/2 c6/2 g5/2 eb6 c6 ab5 eb5 c5 eb5 ab5 c6 eb6/2 c6/2 ab5/2 eb5/2 ' +
            'c6 ab5 f5 c5 f5 ab5 c6 ab5 f5/2 ab5/2 c6/2 d6/2 b5 d6 b5 g5 d5 g5 b5 d6 ab5 f5 d5 b4 d5 f5 ab5 b5';
  var WSLOW = 'g5/8 eb5/4 d5/4 c5/8 eb5/4 ab5/4 ab5/8 g5/4 f5/4 d5/6 f5/2 ab5/4 b5/4';
  var WZ = '0213243542312010', WARP = WZ + '02132435.4.3.2.1', WROLL = '.rrr.rrr.rrr.rrr', WDRIVE = '.rRr.rRr.rRr.rRr', WCH = 'Cm Ab Fm G';
  var CY2 = K1 + Z, WK = K4 + 'x...x...x...x.x.', WS = BK + '....x.......x.xx', SH16 = 'xoxoxoxoxoxoxoxo';

  var DEFS = {
    trace: { name: 'First Trace', bpm: 128, len: 128, bass: 0, lead: 0, bassLo: 36, sec: [
      { b: [0, 16], ch: 'Am F C G', pad: 0.85, arp: TINTRO, ao: 12, h: Z + Z + OFS + OFS, lv: { arp: 0.85 } },
      { b: [16, 32], ch: 'Am F C G', cr: 0.6, pad: 0.8, k: x(K4, 3) + 'x...x...x...x.x.', c: BK, h: OFF, bass: TBASS, arp: TARP, ao: 12 },
      { b: [32, 48], ch: 'Am F C Em', pad: 0.8, k: x(K4, 3) + 'x...x...x..x..x.', c: x(BK, 3) + '....x.......x.xx', h: 'og.gog.gog.gog.g', o: OFF,
        bass: TBASS, arp: TARP + '0.2.3.2.5.4.3.2.', ao: 12 },
      { b: [48, 64], ch: 'F G Am G', pad: 0.8, k: K1 + K1 + Z + Z, s: Z + Z + 'o...o...o...o...' + 'g.g.o.o.o.x.xxXX', h: OFS + OFS + H8 + H8,
        bass: DRONE + DRONE + P8 + P8, arp: TARP + TARP + '3.4.5.4.6.4.5.4.' + '34563456345634..', rise: [4, 12], lv: { bass: 0.7, arp: 0.8 } },
      { b: [64, 96], ch: 'F G Am C F G C G', cr: 1, pad: 0.7, k: x(K4, 7) + 'x...x...x...x.xx', s: BK, c: BK, h: H16, o: OFF,
        bass: TDRIVE, arp: TARP, lv: { arp: 0.6, o: 0.6 },
        lead: TA + TB + TC + 'g5/3 e5/3 c5/2 d5/2 e5/2 c5/2 r/2 ' + TA + TB + 'e5/3 g5/3 c6/2 b5/2 g5/2 a5/4 b5/3 a5/3 g5/2 d5/2 e5/2 g5/2 b5/2' },
      { b: [96, 112], ch: 'F G Am C', cr: 1, pad: 0.7, k: K4, s: x(BK, 3) + '....x.....x.x.xx', c: BK, h: H16, o: OFF, bass: TDRIVE,
        arp: A16, ao: 12, lv: { arp: 0.5 }, lead: TA + TB + TC + 'g5/3 e5/3 c5/2 g4/2 e4/2 d4/2 c4/2', lo: 12 },
      { b: [112, 128], ch: 'F C G G', cr: 0.7, pad: 0.9, arp: TINTRO, ao: 12, h: OFS + OFS + Z + Z, bass: DRONE + DRONE + Z + Z,
        lead: 'a5/8 g5/8 e5/16 r/16 r/16', lv: { lead: 0.6, bass: 0.7, arp: 0.85 } }
    ] },
    carrier: { name: 'Carrier Wave', bpm: 140, len: 160, bass: 1, lead: 1, bassLo: 40, sec: [
      { b: [0, 16], ch: 'Em', pad: 0.5, pb: 0.3, bass: P8, bq: [0.08, 0.9], h: Z + OFS + H8 + H16, s: x(Z, 3) + '............o.xx' },
      { b: [16, 32], ch: 'Em Em C D', cr: 0.8, pad: 0.6, k: x(K4, 3) + 'x...x...x...x.x.', c: BK, h: H16, bass: CBASS, arp: '3..2..3.4..3..2.', lv: { bass: 0.85, arp: 1.2 } },
      { b: [32, 48], ch: 'Em Em G A', pad: 0.6, k: x(K4, 3) + 'x...x...x..x..x.', c: BK, s: x(Z, 3) + '............x.xx', h: H16, o: OFF,
        bass: CBASS, arp: '3.23.2.34.34.3.2', lv: { bass: 0.85, arp: 1.2 } },
      { b: [48, 80], ch: 'C D Em G C D Em B', cr: 0.6, pad: 0.8, pb: 0.7, k: K1, s: x('........x.......', 7) + '........x...o.xX', h: OFS,
        bass: DRONE, bq: 0.25, arp: '0...2...3...2...', ao: 12, lead: CAIR, lk: 3, rise: [24, 8], lv: { arp: 0.5, bass: 0.6, lead: 0.8 } },
      { b: [80, 112], ch: 'Em C G D Em C A B', cr: 1, pad: 0.5, k: CKICK, s: BK, c: BK, h: H16, o: OFF, bass: CDRIVE, lead: CHOOK, tm: CTOM, lv: { o: 0.7 } },
      { b: [112, 144], ch: 'Em C G D Em C A B', cr: 1, pad: 0.5, k: CKICK, s: BK, c: BK, h: H16, o: OFF, bass: CDRIVE + 'rrRrrrRrrrRrRrRR',
        arp: A16, ao: 12, lead: CHOOK, lo: 12, tm: CTOM, lv: { arp: 0.45, lead: 0.85 } },
      { b: [144, 160], ch: 'Em', cr: 0.8, pad: 0.6, pb: 0.3, k: K1 + K1 + Z + Z, bass: P8, bq: [0.9, 0.08], h: H16 + H8 + OFS + Z }
    ] },
    overdrive: { name: 'Overdrive', bpm: 150, len: 192, bass: 2, lead: 2, bassLo: 36, sec: [
      { b: [0, 16], ch: 'Dm Dm Eb Dm', pad: 0.8, pb: 0.25, h: OTICK + OTICK + OTOCK + OTOCK, bass: DRONE, bq: [0.2, 0.6], tm: x(Z, 3) + '..........o.x.xX', lv: { bass: 0.4 } },
      { b: [16, 32], ch: OVAMP, cr: 0.8, pad: 0.5, pb: 0.35, k: OK, s: OS, h: OH, bass: OBASS, stab: OSTAB },
      { b: [32, 48], ch: OVAMP, pad: 0.5, pb: 0.35, k: OK, s: OS, h: OH, o: Z + '..............x.', bass: OBASS, stab: OSTAB, arp: OARP, ao: 12, lv: { arp: 0.7 } },
      { b: [48, 64], ch: OVAMP, pad: 0.5, pb: 0.35, k: OK + OK1 + 'x..x..x...x.x.xx', s: OS + OS1 + '....x..g....xxXX', h: OH, o: Z + '..............x.',
        bass: OBASS, stab: OSTAB, arp: OARP, ao: 12, mel: OTEASE, lv: { arp: 0.7 } },
      { b: [64, 80], ch: 'Dm Bb Gm A', cr: 0.7, pad: 0.8, pb: 0.5, bass: DRONE, bq: 0.3, arp: x(TARP, 2) + x('0232423202324232', 2), ao: 12,
        s: x(Z, 3) + '........g.o.x.XX', rise: [8, 8], lv: { bass: 0.5, arp: 0.7 } },
      { b: [80, 112], ch: OCH, cr: 1, pad: 0.5, k: OK, s: OS, c: BK, h: OH, o: Z + '..............x.', bass: OBASS, lead: OHOOK },
      { b: [112, 144], ch: OCH, cr: 0.8, pad: 0.5, k: OK, s: OS, c: BK, h: OH, o: OFF, bass: OBASS, lead: OHOOK, arp: A16, ao: 12,
        tm: x(Z, 7) + '..........x.x.oo', lv: { arp: 0.5, o: 0.7 } },
      { b: [144, 176], ch: OCH, tr: 2, cr: 1, pad: 0.6, k: OK, s: OS, c: BK, h: OH, o: OFF, sh: 'xoxoxoxoxoxoxoxo', bass: OBASS, lead: OHOOK, arp: OARP, ao: 12,
        stab: OSTAB, tm: x(Z, 3) + '..........x.x.oo', lv: { arp: 0.7, stab: 0.8, o: 0.7, sh: 0.6 } },
      { b: [176, 192], ch: 'Dm Dm Eb Dm', cr: 0.8, pad: 0.8, pb: 0.25, h: OTOCK + OTOCK + OTICK + OTICK, bass: DRONE, bq: [0.6, 0.2],
        mel: 'd5/2 r/1 d5/1 eb5/2 d5/2 r/8 r/16 r/16 r/16', lv: { bass: 0.4 } }
    ] },
    sidebands: { name: 'Sidebands', bpm: 136, len: 144, bass: 3, lead: 4, bassLo: 41, pluck: 'square', sec: [
      { b: [0, 16], ch: SCH, pad: 0.4, pb: 0.4, mel: SRIFF, md: 0.1, h: Z + OFS + SHAT + SHAT, tm: x(Z, 3) + '..........x.o.xX', lv: { mel: 0.45 } },
      { b: [16, 32], ch: SCH, cr: 0.7, pad: 0.5, k: SK, c: BK, h: SHAT, bass: SBASS, mel: SRIFF, md: 0.1, lv: { mel: 0.42, h: 1.4 } },
      { b: [32, 48], ch: SCH, pad: 0.6, k: SKF, c: x(BK, 3) + '....x.......x.xx', h: SHAT, o: OH2, bass: SBASS, mel: SRIFF, md: 0.1, arp: SPOLY,
        lv: { mel: 0.42, arp: 0.7, h: 1.4 } },
      { b: [48, 64], ch: SCH, cr: 0.6, pad: 0.7, pb: 0.45, k: K1, s: x('........x.......', 3) + '........x...o.xX', h: OFS, bass: 'r_______........', bq: 0.35,
        mel: SBREAK, md: 0.25, rise: [8, 8], lv: { bass: 0.7, mel: 0.5 } },
      { b: [64, 96], ch: 'Gm C Am Dm Gm C Bb F', cr: 1, pad: 0.5, k: SKF, c: BK, h: SHAT, o: OH2, bass: SBASS, lead: SHOOK, arp: SPOLY, tm: CTOM, lv: { arp: 0.6, h: 1.4 } },
      { b: [96, 112], ch: 'Bb C Am D', cr: 0.7, pad: 0.85, pb: 0.75, k: 'x.......x.......', c: '............o...', s: x(Z, 3) + '........o.o.x.xX', h: SHAT,
        bass: 'r_______r_____R.', bq: 0.4, lead: SAIR, lk: 3, arp: '0...2...3...2...', ao: 12, rise: [8, 8], lv: { h: 0.6, arp: 0.5, bass: 0.7, lead: 0.85 } },
      { b: [112, 128], ch: 'Gm C Am Dm', cr: 1, pad: 0.5, k: x(K4, 3) + 'x...x...x...x.xx', s: BK, c: BK, h: H16, o: OFF, sh: '...x..x....x..x.',
        bass: 'rrR.rrR.rrR.rRrR', lead: SHOOK, lo: 12, arp: A16, ao: 12, lv: { arp: 0.45, lead: 0.9, o: 0.7 } },
      { b: [128, 144], ch: SCH, cr: 0.8, pad: 0.5, pb: 0.4, k: K1 + x(Z, 3), mel: SRIFF, md: 0.1, h: SHAT + SHAT + OFS + Z, bass: 'r_______........' + x(Z, 3),
        lv: { mel: 0.45 } }
    ] },
    sawtooth: { name: 'Sawtooth', bpm: 144, len: 160, bass: 0, lead: 5, bassLo: 41, gate: 0.55, sec: [
      { b: [0, 8], ch: 'Cm', arp: WARP, aq: [0.1, 0.6], h: H8 + H16, rise: [4, 4], lv: { arp: 0.8 } },
      { b: [8, 32], ch: 'Cm Cm Ab Ab Fm G', cr: 0.8, pad: 0.5, k: x(K4, 5) + 'x...x...x...x.xx', c: BK, h: H16, o: OFF, bass: WROLL, bq: 0.8, arp: WARP,
        lv: { o: 0.7 } },
      { b: [32, 48], ch: WCH, cr: 0.6, pad: 0.6, pb: 0.3, k: K1, s: x('........o.......', 3) + '........o...o.xX', h: 'xoooxoooxoooxooo', bass: DRONE, bq: 0.3,
        lead: WSLOW, lv: { lead: 0.5, bass: 0.8, h: 0.8 } },
      { b: [48, 80], ch: WCH, pad: 0.5, cy: CY2, k: WK, s: WS, c: BK, h: H16, o: OFF, bass: WDRIVE, bq: 0.8, lead: WHA + WHB, tm: x(Z, 3) + '..........x.o.oo',
        lv: { o: 0.8 } },
      { b: [80, 96], ch: 'Ab Ab Fm G', cr: 0.7, pad: 1, pb: 0.5, k: K1 + K1 + Z + Z, h: OFS, s: x(Z, 3) + 'g.g.o.o.o.x.xxXX', arp: '0.2.1.3.2.4.3.5.', ao: 12,
        bass: DRONE + DRONE + Z + Z, bq: 0.3, rise: [12, 4], lv: { k: 0.7, arp: 0.8, bass: 0.6 } },
      { b: [96, 112], ch: WCH, pad: 0.5, cy: CY2, k: WK, s: WS, c: BK, h: H16, o: OFF, sh: SH16, bass: WDRIVE, bq: 0.9, lead: WHA, lo: 12, arp: WZ,
        lv: { sh: 0.6, arp: 0.5 } },
      { b: [112, 128], ch: WCH, pad: 0.6, cy: CY2, k: WK, s: WS, c: BK, h: H16, o: OFF, sh: SH16, bass: WDRIVE, bq: 0.9, lead: WHB, lo: 12, arp: WZ, ao: 12,
        stab: '......x.......x.', tm: x(Z, 3) + '........x.x.o.oo', lv: { sh: 0.6, arp: 0.45, stab: 0.7 } },
      // climax: one bar each, every bar a different drum pattern and register
      { b: [128, 132], ch: 'Cm', cr: 1, pad: 0.5, k: K4, s: '....x.......xxxx', c: BK, h: H16, o: OFF, sh: SH16, bass: WDRIVE, bq: 0.9, lead: W1, lo: 12, lv: { sh: 0.6 } },
      { b: [132, 136], ch: 'Ab', cr: 1, pad: 0.5, k: 'x.x.x.x.x.x.x...', h: 'xoxoxoxoxoxoxo..', bass: '.r.r.r.r.r.r.r..', bq: 0.9,
        lead: 'c5 eb5 ab5 c6 eb6 c6 ab5 eb5 c5/2 ab5/2 eb5/2 r/2' },
      { b: [136, 140], ch: 'Fm', cr: 1, pad: 0.7, k: 'x.........x.....', s: '........x...xxXX', tm: 'x..x..x.x..o....', o: OFF, bass: 'r_____r___r_____', bq: 0.7,
        lead: 'f5/6 ab5/6 c6/4', arp: WZ, ao: 12, lv: { arp: 0.6 } },
      { b: [140, 144], ch: 'G', cr: 1, pad: 0.5, k: K4, s: 'x.x.x.x.xxxxXXXX', h: H16, o: OFF, sh: SH16, bass: WDRIVE, bq: 0.9, lead: W4, lo: 12, rise: [0, 4],
        lv: { sh: 0.6, s: 0.8 } },
      { b: [144, 160], ch: WCH, cr: 0.9, pad: 0.7, pb: 0.35, k: K1 + x(Z, 3), arp: WARP, aq: [0.7, 0.1], h: H16 + H16 + H8 + OFS, bass: DRONE + DRONE + Z + Z, bq: 0.3,
        lv: { bass: 0.6 } }
    ] },
    menu: { name: 'Standby', bpm: 100, len: 32, bass: 0, lead: 3, bassLo: 33, pluck: 'triangle', vol: 0.5, sec: [
      { b: [0, 32], ch: 'FM7 FM7 Am7 Am7 CM7 CM7 G G', pad: 1, pb: 0.6, k: 'o.......o.......', bass: DRONE, bq: 0.2, lv: { k: 0.6, bass: 0.6 },
        mel: 'e5/6 c5/6 a4/4 r/4 g4/4 a4/8 e5/6 d5/6 c5/4 r/4 g4/4 e4/8 g5/6 e5/6 d5/4 r/4 b4/4 c5/8 d5/6 b4/6 g4/4 r/4 a4/4 b4/4 d5/4' }
    ] }
  };

  // ---------------------------------------------------------------- compile song data into per-step event lists
  var PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  var QUAL = { '': [0, 4, 7], m: [0, 3, 7], m7: [0, 3, 7, 10], M7: [0, 4, 7, 11], '7': [0, 4, 7, 10] };
  var VEL = { x: 0.8, X: 1, o: 0.5, g: 0.28 };
  var DRUMS = { k: [vKick, 0, 0], s: [vSnare, 0, 0], c: [vClap, 0, 0], h: [vHat, 0.045, 8500, 1], o: [vHat, 0.2, 7000, -1], sh: [vHat, 0.03, 5200, -1], cy: [vHat, 1.4, 4500, 0], tm: [vTom, 0.2, 0] };
  function acc(s) { return s === '#' ? 1 : s === 'b' ? -1 : 0; }
  function chord(tok, tr, D) {
    var m = /^([A-G])([#b]?)(.*)$/.exec(tok), pc = (PC[m[1].toLowerCase()] + acc(m[2]) + tr + 24) % 12, iv = QUAL[m[3]] || QUAL[''];
    return { key: tok, root: fit(pc, D.bassLo), third: iv[1], tones: iv.map(function (i) { return fit(pc + i, 57); }).sort(function (a, b) { return a - b; }) };
  }
  function melody(str, id) {   // -> { notes: [[offset, len, midi]], len }
    var out = [], pos = 0;
    str.trim().split(/\s+/).forEach(function (tk) {
      var m = /^([a-g])([#b]?)(\d)(?:\/(\d+))?$|^r(?:\/(\d+))?$/.exec(tk), l;
      if (!m) { warnings.push(id + ': bad token ' + tk); return; }
      l = +(m[4] || m[5] || 1);
      if (m[1]) out.push([pos, l, PC[m[1]] + acc(m[2]) + 12 * (+m[3] + 1)]);
      pos += l;
    });
    if (pos % 16) warnings.push(id + ': melody length ' + pos + ' is not whole bars');
    return { notes: out, len: pos };
  }
  function compile(id) {
    var D = DEFS[id];
    if (D.steps) return D;
    var sd = 15 / D.bpm, n = D.len * 4, steps = [], longs = [], i;
    for (i = 0; i < n; i++) steps.push([]);
    D.sec.forEach(function (sc) {
      var s0 = sc.b[0] * 4, ns = sc.b[1] * 4 - s0, lv = sc.lv || {}, tr = sc.tr || 0, ao = sc.ao || 0, bq = sc.bq == null ? 0.6 : sc.bq;
      var chs = sc.ch.split(' ').map(function (c) { return chord(c, tr, D); }), p, c, k, l, j, ch, tn, m, span;
      function L(key) { return lv[key] == null ? 1 : lv[key]; }
      function P(key) {
        var s = sc[key] && sc[key].replace(/[ |]/g, '');
        if (s && s.length % 16) warnings.push(id + ' @' + sc.b[0] + ' ' + key + ': pattern length ' + s.length);
        return s;
      }
      function at(i) { return chs[(i >> 4) % chs.length]; }
      function add(i, f, key, d, a, b, c2, len, extra) {
        var ev = [f, key, d, a, b, c2, extra]; steps[s0 + i].push(ev);
        if (len) longs.push({ s: s0 + i, len: len, e: ev });
      }
      function run(p, i) { var l = 1; while (i + l < ns && p[(i + l) % p.length] === '_') l++; return l; }

      for (k in DRUMS) if ((p = P(k))) for (i = 0; i < ns; i++) if ((c = VEL[p[i % p.length]])) add(i, DRUMS[k][0], k, DRUMS[k][1], c * L(k), DRUMS[k][2], DRUMS[k][3]);
      if (sc.cr) add(0, vHat, 'cr', 1.4, sc.cr * 0.8, 4500);
      if ((p = P('bass'))) for (i = 0; i < ns; i++) {
        c = p[i % p.length]; ch = at(i);
        m = c === 'r' ? 0 : c === 'R' ? 12 : c === 'f' ? 7 : c === 't' ? ch.third : -1;
        if (m >= 0) add(i, vBass, 'bass', (D.gate ? run(p, i) - 1 + D.gate : run(p, i) * 0.9) * sd, ch.root + m, L('bass'), bq.length ? bq[0] + (bq[1] - bq[0]) * i / ns : bq);
      }
      if ((p = P('arp'))) for (i = 0; i < ns; i++) {
        c = p.charCodeAt(i % p.length) - 48; tn = at(i).tones;
        if (c >= 0 && c <= 9) add(i, vPluck, 'arp', run(p, i) * sd + 0.15, tn[c % tn.length] + 12 * Math.floor(c / tn.length) + ao, 0.8 * L('arp'), (i >> 1) % 2 ? 0.4 : -0.4,
          0, sc.aq ? sc.aq[0] + (sc.aq[1] - sc.aq[0]) * i / ns : 1);
      }
      if ((p = P('stab'))) for (i = 0; i < ns; i++) {
        c = p[i % p.length];
        if (VEL[c]) add(i, vStab, 'stab', 0, at(i).tones.map(function (t) { return t + (c === 'o' ? 0 : 12); }), (c === 'X' ? 1 : 0.8) * L('stab'));
      }
      ['lead', 'mel'].forEach(function (key) {
        if (!sc[key]) return;
        var M = melody(sc[key], id + ' @' + sc.b[0] + ' ' + key), r, q;
        for (r = 0; r < ns && M.len; r += M.len) for (j = 0; j < M.notes.length; j++) {
          q = M.notes[j]; i = r + q[0];
          if (i >= ns) continue;
          if (key === 'lead') add(i, vLead, key, q[1] * sd * 0.92, q[2] + tr + (sc.lo || 0), L(key), sc.lk == null ? D.lead : sc.lk);
          else add(i, vPluck, key, q[1] * sd + (sc.md == null ? 0.3 : sc.md), q[2] + tr, L(key), j % 2 ? 0.3 : -0.3);
        }
      });
      if (sc.pad) for (i = 0; i < ns; i += span * 16) {   // one pad per chord; a repeated chord is held for two bars
        ch = at(i); span = i + 16 < ns && at(i + 16).key === ch.key ? 2 : 1;
        add(i, vPad, 'pad', span * 16 * sd, ch.tones, sc.pad * L('pad'), sc.pb == null ? 0.5 : sc.pb, span * 16);
      }
      if (sc.rise) add(sc.rise[0] * 4, vRise, 'rise', sc.rise[1] * 4 * sd, L('rise'), 0, 0, sc.rise[1] * 4);
    });
    D.steps = steps; D.longs = longs; D.sd = sd; D.n = n;
    return D;
  }

  // ---------------------------------------------------------------- sessions + scheduler
  // Each playSong() gets its own output gain, so a restart can fade and drop everything already scheduled.
  function makeSession(r, id, b0, anchor) {
    var c = r.c, D = compile(id), S = { c: c, rig: r, def: D, id: id, b0: b0, anchor: anchor, spb: 60 / D.bpm, vol: D.vol || 1,
      next: Math.ceil(b0 * 4 - 1e-6), fresh: true, gap: -Infinity, live: [], kicks: [], nz: 0, mute: null };
    var send = c.createGain(), da = c.createDelay(1), db = c.createDelay(1), lp = c.createBiquadFilter(), ab = c.createGain(), ba = c.createGain();
    var cho = c.createDelay(0.1), lfo = c.createOscillator(), dep = c.createGain();
    S.out = c.createGain(); S.out.gain.value = S.vol; S.out.connect(r.music);
    S.drum = S.out;
    S.left = c.createGain(); S.right = c.createGain();    // slightly off-centre buses (hats, delay taps)
    link(S, S.left, S.out, -0.45); link(S, S.right, S.out, 0.45);
    S.duck = c.createGain(); S.duck.connect(S.out);        // bass + pad, dipped on every kick
    S.pad = c.createGain();                                // pad bus: dry on one side, slowly modulated copy on the other
    cho.delayTime.value = 0.012; lfo.frequency.value = 0.7; dep.gain.value = 0.0015;
    lfo.connect(dep); dep.connect(cho.delayTime); lfo.start(); S.live.push([lfo, Infinity]);
    link(S, S.pad, S.duck, -0.5); S.pad.connect(cho); link(S, cho, S.duck, 0.5);
    S.mel = c.createGain(); S.mel.connect(S.out);          // plucks, leads, stabs: dry + delay send
    // light ping-pong feedback delay, a dotted eighth per hop
    send.gain.value = 0.3; da.delayTime.value = db.delayTime.value = S.spb * 0.75; lp.type = 'lowpass'; lp.frequency.value = 3000; ab.gain.value = ba.gain.value = 0.6;
    S.mel.connect(send); send.connect(da); da.connect(lp); lp.connect(S.left); lp.connect(ab); ab.connect(db); db.connect(S.right); db.connect(ba); ba.connect(da);
    S.fx = [ba, ab, lp, S.mel, S.duck, S.left, S.right, S.pad, cho, dep];
    return S;
  }
  function stepTime(S, step) { return S.anchor + (step / 4 - S.b0) * S.spb; }
  function schedStep(S, step, t) {
    if (step < 0) return;   // negative start beat = silent count-in
    var D = S.def, i = step % D.n, evs = D.steps[i], e, k, L;
    if (S.fresh) {   // joined mid-song (or skipped ahead): pick up pads / risers that began before this step
      S.fresh = false;
      for (k = 0; k < D.longs.length; k++) {
        L = D.longs[k]; e = L.e;
        if (L.s < i && i < L.s + L.len && step - (i - L.s) >= S.gap && !(S.mute && S.mute.test(e[1])))
          e[0](S, t, (L.s + L.len - i) * D.sd, e[3], e[4], e[5], (i - L.s) / L.len);
      }
    }
    for (k = 0; k < evs.length; k++) { e = evs[k]; if (!(S.mute && S.mute.test(e[1]))) e[0](S, t, e[2], e[3], e[4], e[5], e[6]); }
  }
  function tick() {
    var S = cur;
    if (!S || !ctx) return;
    try {
      var now = ctx.currentTime, horizon = now + LOOKAHEAD, first = Math.ceil(((now - S.anchor) / S.spb + S.b0) * 4 - 1e-6), t;
      if (S.next < first) { S.gap = S.next; S.next = first; S.fresh = true; }   // throttled tab: skip late steps, never catch up
      for (;;) { t = stepTime(S, S.next); if (t > horizon) break; schedStep(S, S.next++, t); }
      if (S.live.length > 120) S.live = S.live.filter(function (x) { return x[1] > now; });
      if (S.kicks.length > 12) S.kicks.splice(0, S.kicks.length - 6);
    } catch (e) {}
  }
  function kill(S, fade) {
    var c = S.c, now = c.currentTime, end = now + Math.max(0.005, fade), i;
    try {
      S.out.gain.cancelScheduledValues(now); S.out.gain.setValueAtTime(S.vol, now); S.out.gain.linearRampToValueAtTime(0, end);
      for (i = 0; i < S.live.length; i++) if (S.live[i][1] > end) { try { S.live[i][0].stop(end + 0.01); } catch (e) {} }
    } catch (e2) {}
    S.live = [];
    setTimeout(function () {
      try { S.out.disconnect(); for (i = 0; i < S.fx.length; i++) S.fx[i].disconnect(); } catch (e) {}
    }, (Math.max(0, fade) + 0.2) * 1000);
  }

  // ---------------------------------------------------------------- public API (nothing here throws)
  function init() {
    if (ctx || !AC) return;
    try { ctx = new AC(); rig = buildRig(ctx, musicVol, sfxVol); } catch (e) { ctx = null; rig = null; }
  }
  function resume() {
    try {
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed' && ctx.resume) { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); }
    } catch (e) {}
  }
  function ready() { return !!ctx && ctx.state === 'running'; }
  function setVol(bus, v) {
    try { if (rig) rig[bus].gain.setTargetAtTime(v, ctx.currentTime, 0.02); } catch (e) {}
  }
  function playSong(id, startBeat) {
    try {
      if (!DEFS[id]) return;
      init(); if (!ctx) return;
      resume();
      if (cur) kill(cur, 0.03);
      cur = makeSession(rig, id, +startBeat || 0, ctx.currentTime + LEAD_IN);
      if (!timer) timer = setInterval(tick, TICK_MS);
      tick();
    } catch (e) {}
  }
  function stopSong(fadeSec) {
    try {
      if (timer) { clearInterval(timer); timer = 0; }
      if (cur) { var S = cur; cur = null; kill(S, fadeSec == null ? 0.08 : +fadeSec || 0); }
    } catch (e) {}
  }
  function songBeat() {
    if (!cur || !ctx) return null;
    return cur.b0 + (ctx.currentTime - cur.anchor) / cur.spb;
  }
  function latency() {   // seconds between scheduling and hearing, for the game's audio offset
    try { return ctx ? (+ctx.outputLatency || 0) + (+ctx.baseLatency || 0) : 0; } catch (e) { return 0; }
  }
  function pulse() {
    if (!cur || !ctx) return 0;
    var now = ctx.currentTime, k = cur.kicks, i = k.length, dt;
    while (i--) { dt = now - k[i]; if (dt >= 0) return Math.exp(-dt / PULSE_TC); }
    return 0;
  }
  function sfx(name) {
    try {
      init(); if (!ctx) return;
      resume();
      if (ctx.state !== 'running' || !FX.hasOwnProperty(name)) return;   // never queue effects on a suspended context
      FX[name]({ c: ctx, rig: rig }, ctx.currentTime + 0.004);
    } catch (e) {}
  }

  // Offline render for tests. id = song id or 'sfx:<name>'. Both buses at full volume (worst case).
  // Resolves { peak, rms, perSecondRms, hot } (hot = fraction of samples inside the soft-clip knee).
  // `mute` is an optional regex source matched against track keys (k, s, c, h, o, bass, arp, lead, pad ...).
  // Same graph and step scheduler as live play. Where the offline context can suspend, steps are fed in one second
  // ahead of the render position (keeps the node count small, so long renders stay fast); otherwise all up front.
  function renderOffline(id, seconds, startBeat, mute) {
    return new Promise(function (resolve, reject) {
      try {
        var sr = 44100, oc = new OAC(2, Math.ceil(seconds * sr), sr), r = buildRig(oc, 1, 1), m = /^sfx:(.+)$/.exec(id), S, at;
        var feed = function (until) {
          for (var t; (t = stepTime(S, S.next)) < until && t < seconds; S.next++) schedStep(S, S.next, t);
        };
        var pause = function (at) {
          oc.suspend(at).then(function () { try { feed(at + 1.1); } catch (e) { reject(e); } oc.resume(); }, reject);
        };
        if (m) FX[m[1]]({ c: oc, rig: r }, 0.05);
        else {
          S = makeSession(r, id, +startBeat || 0, LEAD_IN);
          if (mute) S.mute = new RegExp(mute);
          if (oc.suspend && oc.resume) { feed(1.1); for (at = 1; at < seconds - 0.05; at++) pause(at); }
          else feed(seconds);
        }
        oc.startRendering().then(function (buf) {
          var a = buf.getChannelData(0), b = buf.getChannelData(1), n = buf.length, peak = 0, sum = 0, per = [], accu = 0, cnt = 0, hot = 0, i, v;
          for (i = 0; i < n; i++) {
            v = Math.max(Math.abs(a[i]), Math.abs(b[i])); if (v > peak) peak = v;
            if (v > 0.72) hot++;   // samples inside the soft-clip knee
            accu += a[i] * a[i] + b[i] * b[i]; cnt++;
            if (cnt === sr || i === n - 1) { per.push(Math.sqrt(accu / (2 * cnt))); sum += accu; accu = 0; cnt = 0; }
          }
          resolve({ peak: peak, rms: Math.sqrt(sum / (2 * n)), perSecondRms: per, hot: hot / n });
        }, reject);
      } catch (e) { reject(e); }
    });
  }

  var songs = {};
  Object.keys(DEFS).forEach(function (id) { songs[id] = { name: DEFS[id].name, bpm: DEFS[id].bpm, lengthBeats: DEFS[id].len }; });

  window.PAudio = {
    init: init, resume: resume, ready: ready, songs: songs,
    setMusicVolume: function (v) { musicVol = clamp01(v); setVol('music', musicVol); },
    setSfxVolume: function (v) { sfxVol = clamp01(v); setVol('sfx', sfxVol); },
    playSong: playSong, stopSong: stopSong, songBeat: songBeat, pulse: pulse, latency: latency, sfx: sfx,
    _renderOffline: renderOffline,
    _stats: function () {   // debug / tests only
      return { state: ctx ? ctx.state : 'none', song: cur ? cur.id : null, nextStep: cur ? cur.next : null, live: cur ? cur.live.length : 0,
        timer: !!timer, warnings: warnings.slice() };
    }
  };
})();
