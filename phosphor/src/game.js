/* Phosphor game shell: loop, input, audio sync, menus, practice mode, saved progress. */
(function (root) {
  'use strict';
  var E = root.PEngine, C = E.C, R = root.PRender;
  var A = root.PAudio || null;
  function au(fn, a, b) {
    if (!A || typeof A[fn] !== 'function') return null;
    try { return A[fn](a, b); } catch (e) { return null; }
  }
  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var LV = root.PLevels.levels.map(E.compile);
  var DEMOS = root.PDemos || {};

  /* ---------- saved progress (per browser) ---------- */
  var SAVE_KEY = 'phosphor.save.v1';
  var save = { lv: {}, music: 80, sfx: 80, calm: false, auto: true, skin: 0, tint: 0, offset: 0, streak: 0, streakDay: '' };
  function loadSave() {
    try {
      var j = JSON.parse(root.localStorage.getItem(SAVE_KEY) || 'null');
      if (j && typeof j === 'object') { for (var k in save) if (j[k] !== undefined && typeof j[k] === typeof save[k]) save[k] = j[k]; }
    } catch (e) { /* storage blocked: play without saving */ }
    if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) save.calm = true;
    var keep = 'daily-' + today();
    for (var id in save.lv) if (id.indexOf('daily-') === 0 && id !== keep) delete save.lv[id];
  }
  function persist() { try { root.localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }
  var scratch = {};                 // progress for editor test runs: kept for the session only, never saved
  function rec(id) {
    var box = id.indexOf('custom-') === 0 ? scratch : save.lv;
    return box[id] || (box[id] = { n: 0, p: 0, cores: 0, att: 0, done: 0 });
  }

  /* ---------- state ---------- */
  var G = {
    mode: 'menu', sel: 0, L: LV[0], s: E.newState(), px: 0, py: 0.5, target: 0, alpha: 0,
    practice: false, attempts: 0, jumps: 0, coins: 0, used: {}, cps: [], lastCp: 0,
    trail: [], parts: [], rot: 0, shake: 0, flash: 0, flashCol: 0, deadT: 0, doneT: 0, shown: false,
    wait: 0, ti: 0, dh: false, custom: null, squash: 0, secI: 0, snap: true, dust: 0, hints: {}, exit: 0, bestAtStart: 0, screen: 'menu', back: 'menu'
  };
  var input = { hold: false, latch: false, block: false, ptrs: {}, nptr: 0, key: false };
  var EV = [];
  var sc = { trail: G.trail, parts: G.parts };
  var ui = {};

  function progress() { return Math.max(0, Math.min(100, Math.floor(100 * G.s.x / G.L.endX))); }

  /* ---------- particles ---------- */
  function spark(x, y, n, col, speed, o) {
    o = o || {};
    for (var i = 0; i < n && G.parts.length < 240; i++) {
      var a = o.dir !== undefined ? o.dir + (Math.random() - 0.5) * (o.spread || 1) : Math.random() * 6.2832;
      var v = speed * (0.35 + Math.random() * 0.65), l = (o.life || 0.45) * (0.6 + Math.random() * 0.6);
      G.parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: l, max: l, size: o.size || 0.13, col: col, g: o.g || 0, line: !!o.line, ring: false });
    }
  }
  function ringFx(x, y, col, size) {
    G.parts.push({ x: x, y: y, vx: 0, vy: 0, life: 0.4, max: 0.4, size: size || 1.2, col: col, g: 0, line: false, ring: true });
  }
  function flash(v, col) { G.flash = Math.max(G.flash, save.calm ? v * 0.3 : v); G.flashCol = col; }

  /* ---------- level flow ---------- */
  function resetRun(cp) {
    G.s = cp ? E.copy(cp.s) : E.newState();
    G.coins = cp ? cp.coins : 0;
    G.used = {};
    if (cp) for (var k in cp.used) G.used[k] = 1;
    G.rot = cp ? cp.rot : 0;
    G.px = G.s.x; G.py = G.s.y; G.target = G.s.t * C.DT; G.alpha = 0;
    G.trail.length = 0; G.snap = true; G.exit = 0; G.secI = 0; G.dust = 0;
    G.lastCp = G.s.t;
    G.ti = 0; G.dh = false;          // demo / autoplay cursor
    EV.length = 0;
  }

  function startLevel(i, practice) { G.custom = null; G.sel = i; startL(LV[i], practice); }

  /* def = a level definition in the levels.js format; opts.onExit runs when the player leaves it */
  function playCustom(def, opts) {
    var L;
    try { L = E.compile(def); } catch (e) { toast('That level has a problem: ' + e.message); return false; }
    G.custom = { onExit: opts && opts.onExit };
    delete scratch[L.id];
    startL(L, opts && opts.practice);
    return true;
  }

  var wake = null;
  function keepAwake(on) {
    try {
      var fp = document.featurePolicy || document.permissionsPolicy;
      if (on && fp && fp.allowsFeature && !fp.allowsFeature('screen-wake-lock')) return;
      if (on && !wake && root.navigator.wakeLock) {
        root.navigator.wakeLock.request('screen').then(function (w) { wake = w; w.addEventListener('release', function () { wake = null; }); }, function () { /* refused */ });
      } else if (!on && wake) { wake.release(); wake = null; }
    } catch (e) { /* unsupported */ }
  }

  function startL(L, practice) {
    G.L = L; G.practice = !!practice; G.attempts = 0; G.jumps = 0; G.cps = []; G.hints = {};
    G.bestAtStart = rec(G.L.id)[practice ? 'p' : 'n'];
    G.parts.length = 0;
    setTrace(G.L);
    show(null);
    ui.hud.hidden = false;
    ui.cpBar.hidden = !G.practice;
    au('init'); au('resume'); au('stopSong', 0.05);
    keepAwake(true);
    spawn();
    banner((G.custom ? (G.custom.daily ? 'DAILY ' : '') : 'CH' + (G.sel + 1) + ' ') + G.L.name.toUpperCase(), G.practice ? 'Practice: checkpoints on' : (rec(G.L.id).att <= 1 ? 'Tap or press Space to jump' : ''), 2200);
  }

  function spawn() {
    var cp = G.practice && G.cps.length ? G.cps[G.cps.length - 1] : null;
    resetRun(cp);
    G.attempts++; rec(G.L.id).att++;
    G.mode = 'play';
    input.latch = false; input.block = input.hold;
    au('playSong', G.L.song, G.target);
    ui.att.textContent = 'ATT ' + G.attempts;
    var best = rec(G.L.id)[G.practice ? 'p' : 'n'];
    ui.best.hidden = !(best > 0 && best < 100);
    ui.best.style.left = best + '%';
  }

  function onDeath() {
    G.mode = 'dead'; G.deadT = 0.62;
    au('stopSong', 0.07); au('sfx', 'die');
    var s = G.s;
    spark(s.x, s.y, 26, 1, 13, { line: true, life: 0.55, size: 0.07 });
    spark(s.x, s.y, 10, 3, 8, { life: 0.5, size: 0.16 });
    ringFx(s.x, s.y, 1, 2.4);
    G.shake = save.calm ? 0 : 1; flash(0.38, 1);
    var r = rec(G.L.id), key = G.practice ? 'p' : 'n', pct = progress();
    var isBest = pct > r[key];
    if (isBest) r[key] = pct;
    toast(isBest && !G.practice && G.attempts > 1 ? 'New best ' + pct + '%' : pct + '%');
    if (G.practice && G.cps.length) {
      var top = G.cps[G.cps.length - 1];
      if (s.t - top.s.t < C.SPB * 1.5) {
        top.fails++;
        if (top.fails >= 3) { G.cps.pop(); toast('Checkpoint removed: no way out from there'); }
      } else top.fails = 0;
    }
    persist();
  }

  function onDone() {
    G.mode = 'done'; G.doneT = 0; G.shown = false;
    au('stopSong', 1.4); au('sfx', 'win');
    var s = G.s, r = rec(G.L.id);
    for (var i = 0; i < 3; i++) ringFx(s.x + i * 0.4, s.y + i * 0.6, i === 1 ? 3 : 2, 2 + i);
    spark(s.x, s.y, 40, 2, 12, { life: 0.9, g: 9 }); spark(s.x, s.y, 24, 3, 9, { life: 0.8, line: true, size: 0.06 });
    flash(0.3, 0);
    var before = G.custom ? 0 : unlockedSkins(totalCores());
    if (!G.practice && G.custom && G.custom.daily && save.streakDay !== DAILY.date) {
      save.streak = streakNow() + 1; save.streakDay = DAILY.date;
    }
    if (G.practice) r.p = 100;
    else { r.n = 100; r.done = 1; r.cores |= G.coins; }
    G.newGlyph = !G.custom && unlockedSkins(totalCores()) > before;
    persist();
  }

  function showComplete() {
    G.shown = true; G.shownAt = root.performance.now();
    var L = G.L, r = rec(L.id), n = bits(G.coins), last = !!G.custom || G.sel >= LV.length - 1;
    ui.doneMenu.textContent = G.custom ? (G.custom.label || 'Back to editor') : 'Back to levels';
    ui.doneTitle.textContent = G.practice ? 'Practice run complete' : 'Signal locked';
    ui.doneInfo.textContent = G.practice
      ? L.name + ' finished with checkpoints. Next step: one clean run in normal mode.'
      : L.name + ' cleared' + (bits(r.cores) >= L.coins ? (L.coins ? ' with every core recovered.' : '.') : '. ' + (L.coins - bits(r.cores)) + ' core' + (L.coins - bits(r.cores) === 1 ? '' : 's') + ' still out there.');
    if (G.newGlyph) ui.doneInfo.textContent += ' New glyph unlocked: pick it in Settings.';
    if (!G.practice && G.custom && G.custom.daily) ui.doneInfo.textContent = 'Daily cleared. Streak: ' + streakNow() + ' day' + (streakNow() === 1 ? '' : 's') + '. A new one arrives at midnight.';
    ui.stAtt.textContent = G.attempts; ui.stJumps.textContent = G.jumps; ui.stCores.textContent = n + '/' + L.coins;
    ui.stCores.parentNode.hidden = !L.coins;
    ui.next.hidden = last;
    ui.next.className = last ? '' : 'primary';
    ui.again.className = last ? 'primary' : '';
    ui.hud.hidden = true;
    show('complete');
  }

  function bits(m) { var n = 0; while (m) { n += m & 1; m >>= 1; } return n; }

  /* glyphs unlock with cores collected in the built-in levels */
  var SKIN_COST = [0, 0, 2, 4, 6, 9];
  function totalCores() { var n = 0; LV.forEach(function (L) { n += bits(rec(L.id).cores); }); return n; }
  function unlockedSkins(n) { var k = 0; for (var i = 0; i < SKIN_COST.length; i++) if (n >= SKIN_COST[i]) k++; return k; }

  function pause() {
    if (G.mode !== 'play') return;
    G.mode = 'pause';
    au('stopSong', 0.05);
    ui.pauseInfo.textContent = G.L.name + ' / ' + (G.practice ? 'practice' : 'normal') + ' / ' + progress() + '%';
    ui.toggleMode.textContent = G.practice ? 'Switch to normal' : 'Switch to practice';
    ui.quit.textContent = G.custom ? (G.custom.label || 'Back to editor') : 'Back to levels';
    show('pause');
  }
  function resume() {
    if (G.mode !== 'pause') return;
    show(null);
    G.mode = 'play'; input.block = input.hold; input.latch = false;
    au('resume'); au('playSong', G.L.song, G.target);
  }

  function toMenu() {
    au('stopSong', 0.08);
    keepAwake(false);
    ui.hud.hidden = true;
    G.practice = false; G.cps = [];
    if (G.custom) {
      var cb = G.custom.onExit; G.custom = null;
      if (typeof cb === 'function') { G.mode = 'menu'; cb(); return; }
    }
    buildMenu();
    startDemo(G.sel);
    show('menu');
    au('playSong', 'menu', 0);
  }

  function startDemo(i) {
    G.mode = 'menu'; G.sel = i; G.L = LV[i]; G.practice = false; G.cps = [];
    resetRun(null);
    G.wait = 0; G.parts.length = 0;
    setTrace(G.L);
  }
  function demoHold() {
    var tg = DEMOS[G.L.id];
    if (!tg) return false;
    while (G.ti < tg.length && tg[G.ti] <= G.s.t) { G.dh = !G.dh; G.ti++; }
    return G.dh;
  }

  /* ---------- the Daily: a generated level, the same for everyone on a given date, proven beatable ---------- */
  var DAILY = { def: null, L: null, date: '', ready: false };
  var NAME_A = ['Quiet', 'Split', 'Hollow', 'Bright', 'Cold', 'Loose', 'Narrow', 'Late', 'Double', 'Stray', 'Sharp', 'Slow', 'Thin', 'Hard', 'Open', 'Blind'];
  var NAME_B = ['Lattice', 'Echo', 'Carrier', 'Ripple', 'Sweep', 'Harmonic', 'Drift', 'Pulse', 'Gate', 'Envelope', 'Filter', 'Phase', 'Burst', 'Fold', 'Static', 'Decay'];
  var DAILY_SONGS = [['trace', 128], ['carrier', 140], ['sidebands', 136], ['overdrive', 150], ['sawtooth', 144]];

  function rng32(a) {
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function today() {
    var d = new Date(), m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function dayBefore(date) {
    var p = date.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2] - 1), m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  /* days in a row with a cleared Daily (normal mode); 0 once a day is missed */
  function streakNow() {
    var t = today();
    return save.streakDay === t || save.streakDay === dayBefore(t) ? save.streak : 0;
  }
  function noCores(ch) {
    var rows = (ch.rows || ch).map(function (r) { return r.replace(/c/g, '.'); });
    return rows;
  }
  function makeDaily(date, salt) {
    var seed = +date.replace(/-/g, '') * 16 + salt, rnd = rng32(seed), P = root.PLevels.pool;
    function take(list) { return list.splice(Math.floor(rnd() * list.length), 1)[0]; }
    var hop = P.hop.slice(), sets = P.sets.slice(), chunks = [], song = DAILY_SONGS[Math.floor(rnd() * DAILY_SONGS.length)];
    var pals = [0, 1, 2, 3, 4, 5].sort(function () { return rnd() - 0.5; }), pi = 0;
    function add(ch, newPal) { chunks.push(newPal ? { pal: pals[pi++ % pals.length], rows: noCores(ch) } : noCores(ch)); }
    add(['................'], true);
    for (var part = 0; part < 3; part++) {
      var n = 3 + Math.floor(rnd() * 2), i;
      for (i = 0; i < n; i++) add(take(hop), i === 0 && part > 0);
      if (part < 2) { var set = take(sets); for (i = 0; i < set.length; i++) add(set[i], i === 0); add(['........'], false); }
    }
    add(['................'], false);
    return {
      id: 'daily-' + date, name: NAME_A[Math.floor(rnd() * NAME_A.length)] + ' ' + NAME_B[Math.floor(rnd() * NAME_B.length)],
      song: song[0], bpm: song[1], diff: 'Daily', color: pals[0], chunks: chunks
    };
  }
  /* cheap part: build today's candidate so the card can show its name */
  function peekDaily() {
    var date = today(), salt = 0;
    if (DAILY.date === date && DAILY.def) return DAILY;
    try { var c = JSON.parse(root.localStorage.getItem('phosphor.daily.v1') || 'null'); if (c && c.date === date && c.ok) { salt = c.salt | 0; DAILY.ready = true; } } catch (e) { /* no cache */ }
    DAILY.date = date; DAILY.salt = salt;
    if (!DAILY.ready) DAILY.ready = false;
    DAILY.def = makeDaily(date, salt);
    try { DAILY.L = E.compile(DAILY.def); } catch (e2) { DAILY.L = null; }
    return DAILY;
  }
  /* expensive part, once per day per browser: ask the solver, and reroll until it says yes */
  function proveDaily() {
    var S = root.PSolver, salt, def, L, r;
    if (DAILY.ready && DAILY.L) return true;
    if (!S) { DAILY.ready = !!DAILY.L; return DAILY.ready; }
    for (salt = DAILY.salt || 0; salt < 12; salt++) {
      try {
        def = makeDaily(DAILY.date, salt); L = E.compile(def);
        r = S.solve(L, { margin: 0.1, limit: 2500000 });
      } catch (e) { r = null; }
      if (r && r.ok) {
        DAILY.def = def; DAILY.L = L; DAILY.salt = salt; DAILY.ready = true;
        DEMOS[def.id] = S.toToggles(r);
        try { root.localStorage.setItem('phosphor.daily.v1', JSON.stringify({ date: DAILY.date, salt: salt, ok: 1 })); } catch (e3) { /* fine */ }
        return true;
      }
    }
    return false;
  }
  function playDaily(practice) {
    var card = ui.levels.querySelector('.card.daily'), b = card && card.querySelector('[data-act="' + (practice ? 'practice' : 'play') + '"]'), label = b ? b.textContent : '';
    function go() {
      if (b) b.textContent = label;
      if (!proveDaily()) { toast('Could not build a fair level today. Try again tomorrow.'); return; }
      G.custom = { daily: true, label: 'Back to levels' };
      startL(DAILY.L, practice);
    }
    if (DAILY.ready && DAILY.L) go();
    else { if (b) b.textContent = 'Tuning'; root.setTimeout(go, 60); }
  }

  /* ---------- practice checkpoints ---------- */
  var HAZ = '^v,`<>*x';
  function safeSpot() {
    var s = G.s, L = G.L;
    if (s.mode === C.HOP && (!s.grounded || s.hold)) return false;
    if (s.x > L.endX - 14) return false;
    var c0 = Math.floor(s.x), y0 = Math.floor(s.y - 2.2), y1 = Math.floor(s.y + 2.2), c, y, g, t, i;
    for (c = c0 - 1; c <= c0 + 6; c++) {
      g = L.grid[c]; if (!g) continue;
      for (y = y0; y <= y1; y++) {
        t = g[y]; if (!t) continue;
        if (HAZ.indexOf(t) >= 0 || t === 'o' || t === '_' || t === '~') return false;
        if (t === '#' && c > c0 && Math.abs(y + 0.5 - s.y) < 0.9) return false;
      }
    }
    for (i = s.gi; i < L.gates.length && L.gates[i].x < s.x + 5; i++) return false;
    return true;
  }
  function addCp(auto) {
    if (G.mode !== 'play' || !G.practice || G.s.dead || G.s.done) return;
    var used = {}; for (var k in G.used) used[k] = 1;
    G.cps.push({ s: E.copy(G.s), coins: G.coins, used: used, rot: G.rot, x: G.s.x, y: G.s.y, fails: 0 });
    if (G.cps.length > 60) G.cps.shift();
    G.lastCp = G.s.t;
    ringFx(G.s.x, G.s.y, 2, 1.4);
    if (!auto) { au('sfx', 'checkpoint'); toast('Checkpoint placed'); }
  }
  function delCp() {
    if (!G.practice || !G.cps.length) return;
    G.cps.pop(); toast(G.cps.length ? 'Checkpoint removed' : 'Back to the start');
    G.lastCp = G.s.t;
  }

  /* ---------- sim ---------- */
  var HINT = { G: ['FLY', 'Hold to climb, release to sink'], Z: ['ZIG', 'Hold to rise, release to dive'], U: ['GRAVITY UP', 'You now fall towards the ceiling'], '1': ['SLOW', ''], '3': ['FAST', ''], '4': ['FASTER', ''] };

  function flushEvents(play) {
    var s = G.s, i, e, fy = s.y - 0.5 * s.grav;
    for (i = 0; i < EV.length; i++) {
      e = EV[i];
      switch (e.type) {
        case 'jump':
          G.squash = -0.2;
          if (play) { G.jumps++; au('sfx', 'jump'); }
          spark(s.x - 0.2, fy, 5, 0, 4, { dir: s.grav > 0 ? 3.6 : 2.7, spread: 1.2, life: 0.3 });
          break;
        case 'land':
          G.squash = 0.26;
          if (play) au('sfx', 'land');
          spark(s.x, fy, 4, 0, 3.5, { dir: 3.14, spread: 2.4, life: 0.25, size: 0.1 });
          break;
        case 'pad':
          G.used[e.id] = 1; if (play) au('sfx', 'pad');
          ringFx(s.x, fy, 2, 1.3); spark(s.x, fy, 10, 2, 8, { dir: s.grav > 0 ? 1.57 : -1.57, spread: 1.6, life: 0.4 });
          break;
        case 'ring':
          G.used[e.id] = 1; if (play) { G.jumps++; au('sfx', 'ring'); }
          ringFx(s.x, s.y, 2, 1.6); spark(s.x, s.y, 8, 2, 7, { life: 0.35 });
          break;
        case 'coin':
          G.coins |= e.bit; if (play) au('sfx', 'coin');
          ringFx(s.x, s.y, 3, 1.8); spark(s.x, s.y, 14, 3, 8, { life: 0.6, line: true, size: 0.06 });
          break;
        case 'gate':
          if (play) {
            au('sfx', 'gate');
            var h = HINT[e.gate.k], n = G.hints[e.gate.k] || 0;
            if (h && n < 2) { G.hints[e.gate.k] = n + 1; banner(h[0], h[1], 1500); }
          }
          flash(0.16, 2); ringFx(s.x, s.y, 2, 2.2);
          break;
        case 'die': if (play) onDeath(); else { G.wait = 0.9; ringFx(s.x, s.y, 1, 2); } break;
        case 'done': if (play) onDone(); else G.wait = 1.6; break;
      }
    }
    EV.length = 0;
  }

  function advance(dt) {
    var L = G.L, s = G.s, play = G.mode === 'play';
    G.target += dt * L.bpm / 60;
    if (play && (G.scale || 1) === 1 && au('ready')) {
      var sb = au('songBeat');
      if (typeof sb === 'number' && isFinite(sb)) {
        // what you hear lags the audio clock by the output latency (plus the player's own offset, for Bluetooth)
        var lat = au('latency');
        sb -= ((typeof lat === 'number' && lat > 0 && lat < 0.5 ? lat : 0) + save.offset / 1000) * L.bpm / 60;
        var err = sb - G.target;
        if (Math.abs(err) > 0.6) au('playSong', L.song, Math.max(0, G.target));    // big hiccup: move the music, not the player
        else G.target += err * 0.08;
      }
    }
    var n = 0, hold;
    while ((s.t + 1) * C.DT <= G.target && n < 72) {
      G.px = s.x; G.py = s.y;
      if (play && !G.auto) { hold = (input.hold && !input.block) || input.latch; input.latch = false; }
      else hold = demoHold();
      E.step(L, s, hold, EV);
      n++;
      if (EV.length) flushEvents(play);
      if (s.dead || s.done || G.mode !== (play ? 'play' : 'menu')) break;
      if (play && G.practice && save.auto && s.t % 12 === 0 && s.t - G.lastCp > C.SPB * 8 && safeSpot()) addCp(true);
    }
    if (n >= 72) G.target = s.t * C.DT;
    G.alpha = Math.max(0, Math.min(1, (G.target - s.t * C.DT) / C.DT));
  }

  function fx(dt) {
    var s = G.s, i, p, live = G.mode === 'play' || (G.mode === 'menu' && G.wait <= 0);
    var bdt = dt * G.L.bpm / 60;
    if (live && !s.dead) {
      if (s.mode === C.HOP) {
        if (!s.grounded) G.rot += Math.PI * bdt * s.grav;
        else {
          var q = Math.PI / 2, tgt = Math.round(G.rot / q) * q;
          G.rot += (tgt - G.rot) * (1 - Math.exp(-dt * 28));
          G.dust += dt;
          if (G.dust > 0.06) { G.dust = 0; spark(s.x - 0.45, s.y - 0.48 * s.grav, 1, 0, 2.2, { dir: 3.0, spread: 0.8, life: 0.28, size: 0.09 }); }
        }
      } else {
        var want = -Math.atan2(s.vy, C.SPEED * s.speed) * (s.mode === C.GLIDE ? 0.9 : 1);
        G.rot += (want - G.rot) * (1 - Math.exp(-dt * (s.mode === C.GLIDE ? 16 : 40)));
        if (s.mode === C.GLIDE) spark(s.x - 0.45, s.y, 1, 2, 5, { dir: 3.14, spread: 0.5, life: 0.22, size: 0.05, line: true });
      }
      var rx = G.px + (s.x - G.px) * G.alpha, ry = G.py + (s.y - G.py) * G.alpha;
      G.trail.push(rx, ry);
      var maxT = s.mode === C.ZIG ? 150 : 44;
      if (G.trail.length > maxT) G.trail.splice(0, G.trail.length - maxT);
    }
    for (i = G.parts.length - 1; i >= 0; i--) {
      p = G.parts[i];
      p.life -= dt;
      if (p.life <= 0) { G.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= p.g * dt;
    }
    if (G.squash) { G.squash *= Math.exp(-dt * 16); if (Math.abs(G.squash) < 0.004) G.squash = 0; }
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 3.2);
    if (G.flash > 0) G.flash = Math.max(0, G.flash - dt * 1.6);
    if (G.mode === 'done') {
      G.exit += dt;
      G.rot += dt * 9;
      G.trail.push(s.x + G.exit * 11 * (1 + G.exit * 1.5), s.y + G.exit * G.exit * 3 * s.grav);
      if (G.trail.length > 60) G.trail.splice(0, G.trail.length - 60);
    }
  }

  var lastPct = -1;
  function render(dt) {
    var s = G.s, L = G.L;
    while (G.secI + 1 < L.sections.length && L.sections[G.secI + 1].x <= s.x) G.secI++;
    var live = !(s.dead || s.done);
    sc.L = L; sc.s = s; sc.dt = dt; sc.beat = G.target;
    sc.x = live ? G.px + (s.x - G.px) * G.alpha : s.x;
    sc.y = live ? G.py + (s.y - G.py) * G.alpha : s.y;
    if (s.done) { sc.camX = s.x; sc.x = s.x + G.exit * 11 * (1 + G.exit * 1.5); sc.y = s.y + G.exit * G.exit * 3 * s.grav; }
    else sc.camX = undefined;
    var pu = G.mode === 'play' ? au('pulse') : null;
    sc.pulse = typeof pu === 'number' ? pu : Math.exp(-(((G.target % 1) + 1) % 1) * 5) * (G.mode === 'menu' ? 0.6 : 1);
    sc.rot = G.rot; sc.squash = s.mode === C.HOP ? (G.squash || 0) : 0; sc.used = G.used; sc.coins = G.coins; sc.owned = rec(L.id).cores;
    sc.cps = G.practice ? G.cps : null;
    sc.shake = G.shake; sc.flash = G.flash; sc.flashCol = G.flashCol;
    sc.skin = save.skin; sc.tint = save.tint;
    sc.hidePlayer = s.dead;
    sc.pal = L.sections[G.secI].pal; sc.snap = G.snap; G.snap = false;
    R.draw(sc);
    if (!ui.hud.hidden) {
      var pct = s.done ? 100 : Math.min(99, progress());
      ui.bar.style.transform = 'scaleX(' + Math.min(1, s.x / L.endX).toFixed(4) + ')';
      if (pct !== lastPct) { lastPct = pct; ui.pct.textContent = pct + '%'; ui.meter.setAttribute('aria-valuenow', pct); }
    }
  }

  var last = 0;
  function frame(now) {
    root.requestAnimationFrame(frame);
    var dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!(dt > 0)) return;
    if (G.mode === 'editor') { if (root.PEditor && root.PEditor.frame) root.PEditor.frame(dt); return; }
    if (G.mode === 'play') advance(dt * (G.scale || 1));
    else if (G.mode === 'menu') {
      if (G.wait > 0) { G.wait -= dt; if (G.wait <= 0) startDemo(G.sel); }
      else advance(dt * 1);
    }
    else if (G.mode === 'dead') { G.deadT -= dt; if (G.deadT <= 0) spawn(); }
    else if (G.mode === 'done') { G.doneT += dt; if (!G.shown && G.doneT > 1.1) showComplete(); }
    fx(dt);
    render(dt);
  }

  /* ---------- UI ---------- */
  var SCREENS = ['menu', 'pause', 'complete', 'settings', 'how'];
  function show(name) {
    SCREENS.forEach(function (n) { $(n).hidden = n !== name; });
    G.screen = name;
    ui.root.classList.toggle('scrim', !!name);
    if (name) { var b = $(name).querySelector('button.primary'); if (b && name !== 'menu') b.focus({ preventScroll: true }); }
    else ui.canvas.focus({ preventScroll: true });
  }

  var bannerT = 0, toastT = 0;
  function banner(title, subline, ms) {
    ui.msg.innerHTML = esc(title) + (subline ? '<small>' + esc(subline) + '</small>' : '');
    ui.msg.classList.add('on');
    clearTimeout(bannerT); bannerT = setTimeout(function () { ui.msg.classList.remove('on'); }, ms || 1600);
  }
  function toast(t) {
    ui.toast.textContent = t; ui.toast.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { ui.toast.classList.remove('on'); }, 1800);
  }

  function toastMenu(t) { var k = ui.root.querySelector('.foot .keys'); if (k) k.textContent = t; }

  function css(a) { return 'rgb(' + a[0] + ',' + a[1] + ',' + a[2] + ')'; }
  function setTrace(L) {
    var p = R.palette(L.def.color !== undefined ? L.def.color : L.sections[0].pal);
    document.documentElement.style.setProperty('--trace', css(p.trace));
  }

  function buildMenu() {
    var box = ui.levels, html = '';
    LV.forEach(function (L, i) {
      var r = rec(L.id), col = css(R.palette(L.def.color !== undefined ? L.def.color : L.sections[0].pal).trace), cores = '';
      for (var k = 0; k < L.coins; k++) cores += '<span class="' + (r.cores & (1 << k) ? '' : 'off') + '">&#9670;</span>';
      html += '<article class="card' + (i === G.sel ? ' sel' : '') + '" tabindex="0" data-i="' + i + '" style="--c:' + col + '" aria-label="' + esc(L.name) + '">' +
        '<div class="card-head"><span class="ch">CH' + (i + 1) + '</span><span>' + L.bpm + ' BPM</span></div>' +
        '<h2>' + esc(L.name) + '</h2>' +
        '<div class="card-meta"><span>' + esc(L.def.diff) + (r.done ? ' / cleared' : '') + '</span><span class="cores" title="Cores found">' + cores + '</span></div>' +
        '<div class="prog"><span>Normal</span><div class="meter"><i style="transform:scaleX(' + r.n / 100 + ')"></i></div><b>' + r.n + '%</b></div>' +
        '<div class="prog practice"><span>Practice</span><div class="meter"><i style="transform:scaleX(' + r.p / 100 + ')"></i></div><b>' + r.p + '%</b></div>' +
        '<div class="rowb"><button class="primary" data-act="play">Play</button><button data-act="practice">Practice</button></div>' +
        '</article>';
    });
    var D = peekDaily();
    if (D.L) {
      var dr = rec(D.def.id), dcol = css(R.palette(D.def.color).trace);
      html += '<article class="card daily" tabindex="0" data-i="daily" style="--c:' + dcol + '" aria-label="Daily level">' +
        '<div class="card-head"><span class="ch">DAILY</span><span>' + D.date + '</span></div>' +
        '<h2>' + esc(D.def.name) + '</h2>' +
        '<div class="card-meta"><span>' + D.def.bpm + ' BPM' + (dr.done ? ' / cleared' : '') + '</span><span>' + (streakNow() ? 'streak ' + streakNow() : 'bot-verified') + '</span></div>' +
        '<div class="prog"><span>Normal</span><div class="meter"><i style="transform:scaleX(' + dr.n / 100 + ')"></i></div><b>' + dr.n + '%</b></div>' +
        '<div class="prog practice"><span>Practice</span><div class="meter"><i style="transform:scaleX(' + dr.p / 100 + ')"></i></div><b>' + dr.p + '%</b></div>' +
        '<div class="rowb"><button class="primary" data-act="play">Play</button><button data-act="practice">Practice</button></div>' +
        '</article>';
    }
    box.innerHTML = html;
  }

  function selectCard(i) {
    if (i === G.sel && G.mode === 'menu') return;
    var cards = ui.levels.querySelectorAll('.card');
    for (var k = 0; k < cards.length; k++) cards[k].classList.toggle('sel', cards[k].getAttribute('data-i') === String(i));
    startDemo(i);
  }

  function buildPicks() {
    var s = '', t = '', i;
    var have = totalCores();
    for (i = 0; i < R.SKINS; i++) {
      var need = SKIN_COST[i] || 0, locked = have < need;
      s += '<button data-skin="' + i + '" aria-label="Glyph ' + (i + 1) + (locked ? ', needs ' + need + ' cores' : '') + '" aria-pressed="' + (save.skin === i) + '"' + (locked ? ' disabled' : '') + '>' +
        '<canvas width="68" height="68"></canvas>' + (locked ? '<em>' + need + '</em>' : '') + '</button>';
    }
    ui.skinNote.textContent = have + ' core' + (have === 1 ? '' : 's') + ' collected. Locked glyphs show how many they need.';
    for (i = 0; i < R.TINTS.length; i++) t += '<button data-tint="' + i + '" aria-label="Colour ' + (i + 1) + '" aria-pressed="' + (save.tint === i) + '"><i style="background:' + css(R.TINTS[i]) + '"></i></button>';
    ui.skins.innerHTML = s; ui.tints.innerHTML = t;
    var cs = ui.skins.querySelectorAll('canvas');
    for (i = 0; i < cs.length; i++) R.drawSkin(cs[i], i, save.tint);
  }

  function openSettings(from) {
    G.back = from;
    ui.volMusic.value = save.music; ui.volSfx.value = save.sfx; ui.calm.checked = save.calm; ui.auto.checked = save.auto;
    ui.offset.value = save.offset; ui.offsetOut.textContent = save.offset + ' ms';
    buildPicks();
    show('settings');
  }

  function unlockAudio() {
    au('init'); au('resume');
    au('setMusicVolume', save.music / 100); au('setSfxVolume', save.sfx / 100);
    if (G.mode === 'menu' && au('songBeat') === null) au('playSong', 'menu', 0);
  }

  function setHold() {
    var h = input.nptr > 0 || input.key;
    if (h && !input.hold) input.latch = true;
    if (!h) input.block = false;
    input.hold = h;
  }

  function wire() {
    var cv = ui.canvas;
    cv.addEventListener('pointerdown', function (e) {
      unlockAudio();
      if (G.mode !== 'play') return;
      e.preventDefault();
      if (!input.ptrs[e.pointerId]) { input.ptrs[e.pointerId] = 1; input.nptr++; }
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      setHold();
    });
    function up(e) {
      if (input.ptrs[e.pointerId]) { delete input.ptrs[e.pointerId]; input.nptr = Math.max(0, input.nptr - 1); setHold(); }
    }
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('lostpointercapture', up);
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // jump keys; several can be held at once, so track them by code
    var JUMP = { Space: 1, ArrowUp: 1, KeyW: 1, KeyL: 1 }, held = {};
    function anyHeld() { for (var c in held) return true; return false; }
    root.addEventListener('keydown', function (e) {
      var k = e.code;
      if (JUMP[k]) {
        if (G.mode === 'play' || G.mode === 'dead') { e.preventDefault(); if (!e.repeat) { unlockAudio(); held[k] = 1; input.key = true; setHold(); } }
        return;
      }
      if (e.repeat) return;
      if (k === 'KeyP' || k === 'Escape') {
        if (G.screen === 'settings') ui.setClose.click();
        else if (G.screen === 'how') ui.howClose.click();
        else if (G.mode === 'play') pause();
        else if (G.mode === 'pause') resume();
      } else if (k === 'KeyR') {
        if (G.mode === 'play') { au('stopSong', 0.04); spawn(); }
      } else if (k === 'KeyZ') addCp(false);
      else if (k === 'KeyX') delCp();
    });
    root.addEventListener('keyup', function (e) {
      if (JUMP[e.code]) { delete held[e.code]; input.key = anyHeld(); setHold(); }
    });
    root.addEventListener('blur', function () { held = {}; input.key = false; input.ptrs = {}; input.nptr = 0; setHold(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) { if (G.mode === 'play') pause(); else if (G.mode === 'menu') au('stopSong', 0.1); } });
    root.addEventListener('resize', R.resize);
    root.addEventListener('orientationchange', function () { setTimeout(R.resize, 250); });

    ui.root.addEventListener('pointerdown', unlockAudio);
    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchend', unlockAudio, { passive: true });
    ui.root.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('button')) au('sfx', 'click'); });

    ui.levels.addEventListener('click', function (e) {
      var card = e.target.closest('.card'); if (!card) return;
      var b = e.target.closest('button');
      if (card.getAttribute('data-i') === 'daily') { if (b) playDaily(b.getAttribute('data-act') === 'practice'); return; }
      var i = +card.getAttribute('data-i');
      if (b) startLevel(i, b.getAttribute('data-act') === 'practice');
      else selectCard(i);
    });
    ui.levels.addEventListener('pointerover', function (e) {
      if (e.pointerType !== 'mouse') return;
      var card = e.target.closest('.card'); if (card && card.getAttribute('data-i') !== 'daily') selectCard(+card.getAttribute('data-i'));
    });
    ui.levels.addEventListener('focusin', function (e) { var card = e.target.closest('.card'); if (card && card.getAttribute('data-i') !== 'daily') selectCard(+card.getAttribute('data-i')); });
    ui.levels.addEventListener('keydown', function (e) {
      if (e.code !== 'Enter' || !e.target.classList.contains('card')) return;
      if (e.target.getAttribute('data-i') === 'daily') playDaily(false); else startLevel(+e.target.getAttribute('data-i'), false);
    });

    $('btnPause').addEventListener('click', pause);
    $('btnResume').addEventListener('click', resume);
    $('btnRestart').addEventListener('click', function () { G.cps = []; show(null); G.attempts = 0; G.jumps = 0; spawn(); });
    ui.toggleMode.addEventListener('click', function () { startL(G.L, !G.practice); });
    ui.quit.addEventListener('click', toMenu);
    $('btnPauseSettings').addEventListener('click', function () { openSettings('pause'); });
    $('btnSettings').addEventListener('click', function () { openSettings('menu'); });
    $('btnHow').addEventListener('click', function () { show('how'); });
    ui.howClose.addEventListener('click', function () { show('menu'); });
    ui.setClose.addEventListener('click', function () { persist(); show(G.back); });
    function settled() { return root.performance.now() - (G.shownAt || 0) > 650; }
    ui.next.addEventListener('click', function () { if (settled()) startLevel(Math.min(LV.length - 1, G.sel + 1), false); });
    ui.again.addEventListener('click', function () { if (settled()) startL(G.L, G.practice); });
    ui.doneMenu.addEventListener('click', toMenu);
    // fullscreen is optional: phones and some embedded views do not offer it
    var full = $('btnFull'), de = document.documentElement;
    if (document.fullscreenEnabled && de.requestFullscreen && !(root.matchMedia && root.matchMedia('(pointer: coarse)').matches)) {
      full.hidden = false;
      full.addEventListener('click', function () {
        try {
          var p = document.fullscreenElement ? document.exitFullscreen() : de.requestFullscreen();
          if (p && p.catch) p.catch(function () { toastMenu('Fullscreen is not available here'); });
        } catch (e) { /* refused */ }
      });
      document.addEventListener('fullscreenchange', function () { full.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'; R.resize(); });
    }
    $('btnCp').addEventListener('click', function () { addCp(false); });
    $('btnCpDel').addEventListener('click', delCp);

    ui.volMusic.addEventListener('input', function () { save.music = +ui.volMusic.value; au('setMusicVolume', save.music / 100); });
    ui.volSfx.addEventListener('input', function () { save.sfx = +ui.volSfx.value; au('setSfxVolume', save.sfx / 100); });
    ui.volSfx.addEventListener('change', function () { au('sfx', 'coin'); });
    ui.offset.addEventListener('input', function () { save.offset = +ui.offset.value; ui.offsetOut.textContent = save.offset + ' ms'; });
    ui.calm.addEventListener('change', function () { save.calm = ui.calm.checked; });
    ui.auto.addEventListener('change', function () { save.auto = ui.auto.checked; });
    ui.skins.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b && !b.disabled) { save.skin = +b.getAttribute('data-skin'); buildPicks(); } });
    ui.tints.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { save.tint = +b.getAttribute('data-tint'); buildPicks(); } });
    var armed = 0;
    $('btnReset').addEventListener('click', function () {
      var b = $('btnReset');
      if (!armed) {
        armed = setTimeout(function () { armed = 0; b.textContent = 'Erase progress'; }, 3000);
        b.textContent = 'Tap again to erase';
      } else {
        clearTimeout(armed); armed = 0; save.lv = {}; persist(); b.textContent = 'Progress erased';
        setTimeout(function () { b.textContent = 'Erase progress'; }, 1500);
        if (G.back === 'menu') buildMenu();
      }
    });
  }

  function start() {
    loadSave();
    ui = {
      root: $('ui'), canvas: $('scope'), hud: $('hud'), att: $('hudAtt'), pct: $('hudPct'), bar: $('hudBar'), best: $('hudBest'), meter: $('hudMeter'),
      msg: $('hudMsg'), toast: $('toast'), cpBar: $('cpBar'), levels: $('levels'),
      pauseInfo: $('pauseInfo'), toggleMode: $('btnToggleMode'), doneTitle: $('doneTitle'), doneInfo: $('doneInfo'),
      stAtt: $('stAtt'), stJumps: $('stJumps'), stCores: $('stCores'), next: $('btnNext'), again: $('btnAgain'),
      volMusic: $('volMusic'), volSfx: $('volSfx'), offset: $('audioOffset'), offsetOut: $('audioOffsetOut'), calm: $('optCalm'), auto: $('optAuto'), skins: $('skins'), tints: $('tints'), skinNote: $('skinNote'),
      setClose: $('btnSetClose'), howClose: $('btnHowClose'), quit: $('btnQuit'), doneMenu: $('btnDoneMenu')
    };
    if ($('editor')) SCREENS.push('editor');
    R.init(ui.canvas);
    wire();
    buildMenu();
    startDemo(0);
    show('menu');
    last = root.performance.now();
    root.requestAnimationFrame(frame);
    // hooks for automated tests
    root.__phosphor = {
      G: G, input: input, levels: LV, save: save, startLevel: startLevel, toMenu: toMenu, pause: pause, resume: resume,
      press: function () { input.key = true; setHold(); }, release: function () { input.key = false; setHold(); },
      daily: DAILY, playDaily: playDaily, makeDaily: makeDaily
    };
    /* API for the level editor */
    root.PGame = {
      playCustom: playCustom, toMenu: toMenu, show: show, toast: toast, audio: au, render: R,
      enterEditor: function () { au('stopSong', 0.1); ui.hud.hidden = true; G.custom = null; G.mode = 'editor'; show('editor'); ui.root.classList.remove('scrim'); },
      exitEditor: function () { G.mode = 'menu'; toMenu(); }
    };
    if (root.PEditor && typeof root.PEditor.init === 'function') root.PEditor.init();
  }

  var hot = root.claude && root.claude.hot;
  if (hot && typeof hot.ready === 'function') hot.ready(start); else start();
})(window);
