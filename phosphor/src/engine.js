/* Phosphor engine: deterministic fixed-step simulation.
   Time unit = beats, length unit = blocks. One jump lasts exactly one beat and covers four blocks,
   so level geometry is the same at every tempo and only the real-time speed changes with the song. */
(function (root) {
  'use strict';

  var SPB = 96;                       // sim steps per beat
  var DT = 1 / SPB;

  var C = {
    SPB: SPB, DT: DT,
    SPEED: 4,                         // blocks per beat at 1x
    GRAV: 17.6,                       // blocks / beat^2
    JUMP_V: 8.8,                      // 1.00 beat of air, 2.2 blocks high
    PAD_V: 11,                        // 1.25 beats of air, 3.44 blocks high
    RING_V: 8.8,
    MAX_FALL: 11.5,
    GL_UP: 9.5, GL_DOWN: 7.5, GL_VMAX: 3.4,
    BOUNDS_H: 9,                      // corridor height for glider / zigzag
    LAND_TOL: 0.3,
    HOP: 0, GLIDE: 1, ZIG: 2,
    SPEEDS: { '1': 0.75, '2': 1, '3': 1.25, '4': 1.5 },
    START_X: 0
  };

  var EMPTY = { s: [], h: [], t: [] };

  function col(L, c) {
    var e = L.cols[c + 2];
    return e || EMPTY;
  }

  /* ---------- level compiler: ASCII chunks -> collision data ---------- */
  function compile(def) {
    var L = {
      def: def, id: def.id, name: def.name, bpm: def.bpm, song: def.song,
      length: 0, endX: 0, top: 0, cols: [], grid: [], gates: [], objs: [],
      sections: [], coins: 0, margin: 0, nextId: 1
    };
    var x0 = 0, i, r, cx;
    for (i = 0; i < def.chunks.length; i++) {
      var ch = def.chunks[i];
      var rows = ch.rows || ch;
      var w = 0;
      for (r = 0; r < rows.length; r++) if (rows[r].length > w) w = rows[r].length;
      if (ch.pal !== undefined || i === 0) L.sections.push({ x: x0, pal: ch.pal || 0 });
      for (r = 0; r < rows.length; r++) {
        var y = rows.length - 1 - r, row = rows[r];
        for (cx = 0; cx < row.length; cx++) {
          var t = row.charAt(cx);
          if (t !== '.' && t !== ' ') addTile(L, x0 + cx, y, t);
        }
      }
      x0 += w;
    }
    L.length = x0;
    L.endX = x0;
    L.gates.sort(function (a, b) { return a.x - b.x; });
    L.objs.sort(function (a, b) { return a.x - b.x; });
    return L;
  }

  function reg(L, kind, o) {
    var c0 = Math.floor(o.x0), c1 = Math.ceil(o.x1) - 1, c;
    for (c = c0; c <= c1; c++) {
      var idx = c + 2;
      if (idx < 0) continue;
      if (!L.cols[idx]) L.cols[idx] = { s: [], h: [], t: [] };
      L.cols[idx][kind].push(o);
    }
  }

  function addTile(L, x, y, t) {
    if (y + 1 > L.top) L.top = y + 1;
    if (!L.grid[x]) L.grid[x] = {};
    var cx = x + 0.5, cy = y + 0.5, id = L.nextId++;
    var draw = true;
    switch (t) {
      case '#': reg(L, 's', { x0: x, y0: y, x1: x + 1, y1: y + 1 }); break;
      case '=': reg(L, 's', { x0: x, y0: y + 0.5, x1: x + 1, y1: y + 1 }); break;
      case '-': reg(L, 's', { x0: x, y0: y, x1: x + 1, y1: y + 0.5 }); break;
      case '^': reg(L, 'h', { x0: cx - 0.15, y0: y, x1: cx + 0.15, y1: y + 0.55, r: 0 }); break;
      case 'v': reg(L, 'h', { x0: cx - 0.15, y0: y + 0.45, x1: cx + 0.15, y1: y + 1, r: 0 }); break;
      case ',': reg(L, 'h', { x0: cx - 0.15, y0: y, x1: cx + 0.15, y1: y + 0.25, r: 0 }); break;
      case '`': reg(L, 'h', { x0: cx - 0.15, y0: y + 0.75, x1: cx + 0.15, y1: y + 1, r: 0 }); break;
      case '>': reg(L, 'h', { x0: x, y0: cy - 0.15, x1: x + 0.55, y1: cy + 0.15, r: 0 }); break;
      case '<': reg(L, 'h', { x0: x + 0.45, y0: cy - 0.15, x1: x + 1, y1: cy + 0.15, r: 0 }); break;
      case '*': reg(L, 'h', { x0: cx - 0.75, y0: cy - 0.75, x1: cx + 0.75, y1: cy + 0.75, r: 0.75, cx: cx, cy: cy }); break;
      case 'x': reg(L, 'h', { x0: cx - 0.28, y0: cy - 0.28, x1: cx + 0.28, y1: cy + 0.28, r: 0.28, cx: cx, cy: cy }); break;
      case 'o': reg(L, 't', { k: 'ring', id: id, x0: cx - 0.7, y0: cy - 0.7, x1: cx + 0.7, y1: cy + 0.7 }); break;
      case '_': reg(L, 't', { k: 'pad', id: id, x0: x, y0: y, x1: x + 1, y1: y + 0.3 }); break;
      case '~': reg(L, 't', { k: 'pad', id: id, x0: x, y0: y + 0.7, x1: x + 1, y1: y + 1 }); break;
      case 'c': reg(L, 't', { k: 'coin', id: id, bit: 1 << L.coins, x0: cx - 0.55, y0: cy - 0.55, x1: cx + 0.55, y1: cy + 0.55 }); L.coins++; break;
      case 'H': case 'G': case 'Z': case 'U': case 'D': case '1': case '2': case '3': case '4':
        L.gates.push({ k: t, x: cx, row: y, id: id, floor: Math.max(0, y - 4) });
        break;
      default:
        throw new Error('Unknown tile "' + t + '" at ' + x + ',' + y + ' in level ' + L.id);
    }
    L.grid[x][y] = t;
    if (draw) L.objs.push({ t: t, x: x, y: y, id: id, bit: t === 'c' ? 1 << (L.coins - 1) : 0 });
  }

  /* ---------- state ---------- */
  function newState() {
    return {
      t: 0, x: C.START_X, y: 0.5, vy: 0, mode: 0, grav: 1, speed: 1,
      grounded: true, hold: false, buf: false, last: -1, gi: 0,
      bF: 0, bC: C.BOUNDS_H, coins: 0, dead: false, done: false
    };
  }

  function copy(a, b) {
    b = b || {};
    b.t = a.t; b.x = a.x; b.y = a.y; b.vy = a.vy; b.mode = a.mode; b.grav = a.grav; b.speed = a.speed;
    b.grounded = a.grounded; b.hold = a.hold; b.buf = a.buf; b.last = a.last; b.gi = a.gi;
    b.bF = a.bF; b.bC = a.bC; b.coins = a.coins; b.dead = a.dead; b.done = a.done;
    return b;
  }

  function die(s, ev) {
    if (!s.dead) { s.dead = true; if (ev) ev.push({ type: 'die' }); }
  }

  function applyGate(s, G, ev) {
    var k = G.k;
    if (k === 'H') { s.mode = C.HOP; }
    else if (k === 'G' || k === 'Z') {
      s.mode = k === 'G' ? C.GLIDE : C.ZIG;
      s.bF = G.floor; s.bC = G.floor + C.BOUNDS_H;
      if (s.vy > C.GL_VMAX) s.vy = C.GL_VMAX; else if (s.vy < -C.GL_VMAX) s.vy = -C.GL_VMAX;
      s.grounded = false;
    }
    else if (k === 'U') { if (s.grav !== -1) { s.grav = -1; s.grounded = false; } }
    else if (k === 'D') { if (s.grav !== 1) { s.grav = 1; s.grounded = false; } }
    else { s.speed = C.SPEEDS[k]; }
    if (ev) ev.push({ type: 'gate', gate: G });
  }

  /* ---------- one fixed step ---------- */
  function step(L, s, hold, ev) {
    if (s.dead || s.done) return;
    if (hold) { if (!s.hold) s.buf = true; } else s.buf = false;
    s.hold = hold;

    var vx = C.SPEED * s.speed;
    s.x += vx * DT;
    var gates = L.gates;
    while (s.gi < gates.length && gates[s.gi].x <= s.x) { applyGate(s, gates[s.gi], ev); s.gi++; }

    var g = s.grav, was = s.grounded, m = L.margin;
    var hx, hy, ix, iy;                // outer box (landing), inner box (crash)

    if (s.mode === C.HOP) {
      if (s.grounded && hold) {
        s.vy = C.JUMP_V * g; s.grounded = false; s.buf = false;
        if (ev) ev.push({ type: 'jump' });
      }
      s.vy -= C.GRAV * g * DT;
      if (s.vy * g < -C.MAX_FALL) s.vy = -C.MAX_FALL * g;
      s.y += s.vy * DT;
      s.grounded = false;
      hx = 0.5; hy = 0.5; ix = 0.3 + m; iy = 0.2;
      // the ground line
      if (g === 1) { if (s.y - hy <= 0 && s.vy <= 0) { s.y = hy; s.vy = 0; s.grounded = true; } }
      else if (s.y - iy < 0) die(s, ev);
    } else if (s.mode === C.GLIDE) {
      s.vy += (hold ? C.GL_UP : -C.GL_DOWN) * g * DT;
      if (s.vy > C.GL_VMAX) s.vy = C.GL_VMAX; else if (s.vy < -C.GL_VMAX) s.vy = -C.GL_VMAX;
      s.y += s.vy * DT;
      s.grounded = false;
      hx = 0.5; hy = 0.38; ix = 0.3 + m; iy = 0.18;
      if (s.y - hy < s.bF) { s.y = s.bF + hy; if (s.vy < 0) s.vy = 0; }
      if (s.y + hy > s.bC) { s.y = s.bC - hy; if (s.vy > 0) s.vy = 0; }
    } else {
      s.vy = (hold ? 1 : -1) * g * vx;
      s.y += s.vy * DT;
      s.grounded = false;
      hx = 0.2; hy = 0.2; ix = 0.2 + m; iy = 0.2;
      if (s.y - hy < s.bF) { s.y = s.bF + hy; s.vy = 0; }
      if (s.y + hy > s.bC) { s.y = s.bC - hy; s.vy = 0; }
    }

    var c0 = Math.floor(s.x - 0.5 - m), c1 = Math.floor(s.x + 0.5 + m), c, i, list, R;
    var tol = C.LAND_TOL + Math.abs(s.vy) * DT;

    // pass 1: land on / slide along surfaces
    if (s.mode !== C.ZIG) {
      for (c = c0; c <= c1; c++) {
        list = col(L, c).s;
        for (i = 0; i < list.length; i++) {
          R = list[i];
          if (R.x1 <= s.x - hx || R.x0 >= s.x + hx || R.y1 <= s.y - hy || R.y0 >= s.y + hy) continue;
          var penTop = R.y1 - (s.y - hy), penBot = (s.y + hy) - R.y0;
          if (s.mode === C.HOP) {
            if (g === 1) { if (s.vy <= 0 && penTop <= tol) { s.y = R.y1 + hy; s.vy = 0; s.grounded = true; } }
            else if (s.vy >= 0 && penBot <= tol) { s.y = R.y0 - hy; s.vy = 0; s.grounded = true; }
          } else {
            if (s.vy <= 0 && penTop <= tol) { s.y = R.y1 + hy; s.vy = 0; }
            else if (s.vy >= 0 && penBot <= tol) { s.y = R.y0 - hy; s.vy = 0; }
          }
        }
      }
    }
    // pass 2: crash into solids
    for (c = c0; c <= c1; c++) {
      list = col(L, c).s;
      for (i = 0; i < list.length; i++) {
        R = list[i];
        if (R.x1 <= s.x - ix || R.x0 >= s.x + ix || R.y1 <= s.y - iy || R.y0 >= s.y + iy) continue;
        die(s, ev);
      }
    }
    // hazards
    var kx = (s.mode === C.ZIG ? 0.2 : 0.42) + m, ky = s.mode === C.HOP ? 0.42 : (s.mode === C.GLIDE ? 0.3 : 0.2);
    for (c = c0; c <= c1; c++) {
      list = col(L, c).h;
      for (i = 0; i < list.length; i++) {
        R = list[i];
        if (R.x1 <= s.x - kx || R.x0 >= s.x + kx || R.y1 <= s.y - ky || R.y0 >= s.y + ky) continue;
        if (R.r > 0) {
          var dx = Math.max(Math.abs(s.x - R.cx) - kx, 0), dy = Math.max(Math.abs(s.y - R.cy) - ky, 0);
          if (dx * dx + dy * dy >= R.r * R.r) continue;
        }
        die(s, ev);
      }
    }
    // triggers: pads, rings, cores
    for (c = c0; c <= c1; c++) {
      list = col(L, c).t;
      for (i = 0; i < list.length; i++) {
        R = list[i];
        if (R.x1 <= s.x - 0.5 || R.x0 >= s.x + 0.5 || R.y1 <= s.y - 0.5 || R.y0 >= s.y + 0.5) continue;
        if (R.k === 'coin') {
          if (!(s.coins & R.bit)) { s.coins |= R.bit; if (ev) ev.push({ type: 'coin', id: R.id, bit: R.bit }); }
        } else if (s.mode === C.HOP && s.last !== R.id) {
          if (R.k === 'pad') {
            s.vy = C.PAD_V * g; s.grounded = false; s.last = R.id;
            if (ev) ev.push({ type: 'pad', id: R.id });
          } else if (R.k === 'ring' && s.buf && hold) {
            s.vy = C.RING_V * g; s.grounded = false; s.buf = false; s.last = R.id;
            if (ev) ev.push({ type: 'ring', id: R.id });
          }
        }
      }
    }

    if (s.y > L.top + 12 || s.y < -3) die(s, ev);
    if (!s.dead && s.grounded && !was && ev) ev.push({ type: 'land' });
    if (!s.dead && s.x >= L.endX) { s.done = true; if (ev) ev.push({ type: 'done' }); }
    s.t++;
  }

  var api = { C: C, compile: compile, newState: newState, copy: copy, step: step, col: col };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PEngine = api;
})(typeof window !== 'undefined' ? window : this);
