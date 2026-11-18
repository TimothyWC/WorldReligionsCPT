/* Phosphor renderer: vector-CRT look on a 2D canvas. All glow is done with layered strokes
   (wide + faint under thin + bright), batched per material, so it stays cheap on phones. */
(function (root) {
  'use strict';
  var E = root.PEngine, C = E.C;
  var cv, ctx, W = 0, H = 0, DPR = 1, B = 40, baseB = 40, zoomNow = 1, baseY = 0, px0 = 0, portrait = false;
  var cam = { x: 0, y: 0, yT: 0, lastMode: 0 };
  var boundsA = 0;

  /* phosphor palettes: glass (background), trace (solids), hot (hazards), acc (pads, rings, gates) */
  var PALS = [
    { bg0: [3, 16, 11], bg1: [7, 30, 22], trace: [93, 255, 160], hot: [255, 92, 80], acc: [255, 232, 110] },    // P1 green
    { bg0: [20, 12, 3], bg1: [34, 21, 5], trace: [255, 184, 77], hot: [255, 72, 118], acc: [125, 245, 255] },   // amber
    { bg0: [2, 10, 24], bg1: [5, 26, 46], trace: [112, 212, 255], hot: [255, 94, 150], acc: [255, 240, 122] },  // ice
    { bg0: [16, 4, 26], bg1: [32, 9, 46], trace: [222, 140, 255], hot: [255, 170, 60], acc: [125, 255, 205] },  // violet
    { bg0: [10, 10, 14], bg1: [20, 20, 28], trace: [238, 240, 255], hot: [255, 70, 70], acc: [110, 255, 184] }, // white-hot
    { bg0: [22, 4, 6], bg1: [40, 8, 10], trace: [255, 128, 104], hot: [255, 226, 80], acc: [140, 220, 255] }    // red alert
  ];
  var pal = { key: '', from: 0, to: 0, t: 1, bg0: '', bg1: '', c: {} };
  var cur = { trace: [0, 0, 0], hot: [0, 0, 0], acc: [0, 0, 0], bg0: [0, 0, 0], bg1: [0, 0, 0] };

  function rgba(a, al) { return 'rgba(' + (a[0] | 0) + ',' + (a[1] | 0) + ',' + (a[2] | 0) + ',' + al + ')'; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  function setPalette(idx, dt, snap) {
    idx = idx % PALS.length;
    if (snap) { pal.from = pal.to = idx; pal.t = 1; }
    else if (idx !== pal.to) {
      // start a blend from whatever is on screen now
      PALS.tmp = { bg0: cur.bg0, bg1: cur.bg1, trace: cur.trace, hot: cur.hot, acc: cur.acc };
      pal.from = -1; pal.to = idx; pal.t = 0;
    }
    if (pal.t < 1) pal.t = Math.min(1, pal.t + dt * 2.2);
    var key = pal.from + ':' + pal.to + ':' + pal.t.toFixed(3);
    if (key === pal.key) return;
    pal.key = key;
    var A = pal.from < 0 ? PALS.tmp : PALS[pal.from], Bp = PALS[pal.to], t = pal.t;
    ['trace', 'hot', 'acc', 'bg0', 'bg1'].forEach(function (k) { cur[k] = pal.t >= 1 ? Bp[k] : mix(A[k], Bp[k], t); });
    var c = pal.c;
    c.bg0 = rgba(cur.bg0, 1); c.bg1 = rgba(cur.bg1, 1);
    c.tr = rgba(cur.trace, 1); c.trGlow = rgba(cur.trace, 0.17); c.trFill = rgba(cur.trace, 0.12);
    c.trDim = rgba(cur.trace, 0.34); c.trFaint = rgba(cur.trace, 0.09); c.trGrid = rgba(cur.trace, 0.06);
    c.trDeco = rgba(cur.trace, 0.2); c.trBack = rgba(cur.trace, 0.13); c.trInset = rgba(cur.trace, 0.3);
    c.hot = rgba(cur.hot, 1); c.hotGlow = rgba(cur.hot, 0.2); c.hotFill = rgba(cur.hot, 0.28);
    c.acc = rgba(cur.acc, 1); c.accGlow = rgba(cur.acc, 0.2); c.accFill = rgba(cur.acc, 0.22);
  }

  function init(canvas) { cv = canvas; ctx = cv.getContext('2d', { alpha: false }); resize(); }

  function resize() {
    var w = cv.clientWidth || root.innerWidth, h = cv.clientHeight || root.innerHeight;
    DPR = Math.min(root.devicePixelRatio || 1, 2);
    while (w * h * DPR * DPR > 2600000 && DPR > 1) DPR -= 0.25;
    W = w; H = h;
    cv.width = Math.round(w * DPR); cv.height = Math.round(h * DPR);
    portrait = h > w * 1.05;
    if (portrait) { B = w / 12.5; baseY = h * 0.66; px0 = w * 0.24; }
    else { B = Math.min(h / 10.6, w / 16); baseY = h - Math.max(B * 2.1, h - B * 8.6); px0 = w * 0.28; }
    baseB = B; B = baseB * zoomNow;
    api.view.W = W; api.view.H = H; api.view.B = B; api.view.portrait = portrait;
  }

  function sx(wx) { return px0 + (wx - cam.x) * B; }
  function sy(wy) { return baseY - (wy - cam.y) * B; }

  function updateCam(sc) {
    var s = sc.s, dt = sc.dt;
    cam.x = sc.camX !== undefined ? sc.camX : sc.x;
    if (sc.editor) { cam.y = cam.yT = sc.camY || 0; boundsA = 0; cam.lastMode = 0; return; }
    var tgt;
    if (s.mode !== C.HOP) {
      tgt = s.bF + C.BOUNDS_H / 2 - (baseY - H * (portrait ? 0.42 : 0.5)) / B;
      cam.yT = tgt;
    } else {
      if (cam.lastMode !== C.HOP) cam.yT = cam.y;
      var top = baseY / B - 3.3, lo = 1.7, rel = sc.y - cam.yT;
      if (rel > top) cam.yT = sc.y - top;
      else if (rel < lo) cam.yT = Math.max(0, sc.y - lo);
      if (cam.yT > 0 && s.grounded && sc.y < 1.2) cam.yT = 0;
      tgt = cam.yT;
    }
    cam.lastMode = s.mode;
    if (sc.snap) cam.y = tgt; else cam.y += (tgt - cam.y) * (1 - Math.exp(-dt * 7));
    var wantB = s.mode !== C.HOP ? 1 : 0;
    boundsA += (wantB - boundsA) * (1 - Math.exp(-dt * 9));
  }

  /* layered stroke of the current path */
  function glow(colGlow, col, wide, thin) {
    ctx.lineWidth = wide; ctx.strokeStyle = colGlow; ctx.stroke();
    ctx.lineWidth = thin; ctx.strokeStyle = col; ctx.stroke();
  }

  function drawBackground(sc) {
    var c = pal.c, g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, c.bg0); g.addColorStop(1, c.bg1);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // graticule, drifting slowly behind the level
    var div = B * 2, ox = -((cam.x * B * 0.2) % div), oy = ((cam.y * B * 0.2) % div), x, y;
    ctx.beginPath();
    for (x = ox; x < W; x += div) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (y = (baseY % div) + oy - div; y < H; y += div) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.lineWidth = 1; ctx.strokeStyle = c.trGrid; ctx.stroke();
    // minor ticks on the centre line, like a scope face
    var midY = baseY - B * 4.2 + oy * 0.5, tick = div / 5;
    ctx.beginPath();
    for (x = ox - div; x < W; x += tick) { ctx.moveTo(x, midY - 3); ctx.lineTo(x, midY + 3); }
    ctx.strokeStyle = c.trFaint; ctx.stroke();
    // two live waveforms that breathe with the kick
    var amp = B * (0.5 + sc.pulse * 0.9), ph = sc.beat * 1.2, k = 1 / (B * 2.6), sc2 = cam.x * B * 0.35;
    for (var n = 0; n < 2; n++) {
      ctx.beginPath();
      for (x = -8; x <= W + 8; x += 8) {
        var th = (x + sc2 * (n ? 0.6 : 1)) * k * (n ? 0.55 : 1);
        var v = Math.sin(th + ph) * 0.6 + Math.sin(th * 2.3 - ph * 1.7) * 0.28 + Math.sin(th * 5.1 + ph * 3) * 0.12 * (0.3 + sc.pulse);
        var yy = midY - B * (n ? 1.9 : -0.2) + v * amp * (n ? 0.7 : 1);
        if (x === -8) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.lineWidth = 6; ctx.strokeStyle = c.trGrid; ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = n ? c.trFaint : c.trGlow; ctx.stroke();
    }
  }

  /* ---------- decoration: never collides, always dimmer than anything that matters ---------- */
  function h1(n) {
    n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3) | 0; n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15);
    return (n >>> 0) / 4294967296;
  }
  var streakA = 0;

  /* large slow shapes far behind the level; one family per colour theme */
  function drawBackdrop(sc) {
    var c = pal.c, theme = pal.to, par = 0.3, cellW = 6.5, beat = sc.beat, pulse = sc.pulse, i, k, a;
    // horizon glow that breathes with the kick
    var hg = ctx.createRadialGradient(W * 0.5, baseY, 0, W * 0.5, baseY, Math.max(W, H) * 0.6);
    hg.addColorStop(0, rgba(cur.trace, 0.05 + pulse * 0.07)); hg.addColorStop(1, rgba(cur.trace, 0));
    ctx.fillStyle = hg; ctx.fillRect(0, 0, W, H);
    var x0 = cam.x * par, i0 = Math.floor((x0 - px0 / B) / cellW) - 1, i1 = Math.ceil((x0 + (W - px0) / B) / cellW) + 1;
    var p = new Path2D();
    for (i = i0; i <= i1; i++) {
      var hx = h1(i * 31 + theme * 101 + 7), hy = h1(i * 17 + theme * 53 + 5), hs = h1(i * 23 + theme * 11 + 3);
      var X = px0 + ((i + 0.15 + 0.7 * hx) * cellW - x0) * B, Y = baseY - (2.6 + 4.2 * hy - cam.y * par) * B, S = (1.1 + 1.5 * hs) * B;
      if (theme === 0) {                       // scope faces with a slow lissajous
        p.moveTo(X + S, Y); p.arc(X, Y, S, 0, 6.2832);
        p.moveTo(X - S * 1.15, Y); p.lineTo(X - S * 0.85, Y); p.moveTo(X + S * 0.85, Y); p.lineTo(X + S * 1.15, Y);
        p.moveTo(X, Y - S * 1.15); p.lineTo(X, Y - S * 0.85); p.moveTo(X, Y + S * 0.85); p.lineTo(X, Y + S * 1.15);
        for (k = 0; k <= 28; k++) {
          a = k / 28 * 6.2832;
          var lx = X + Math.sin(a * 2 + beat * 0.25 + i) * S * 0.62, ly = Y + Math.sin(a * 3) * S * 0.62;
          if (k === 0) p.moveTo(lx, ly); else p.lineTo(lx, ly);
        }
      } else if (theme === 1) {                // level meters rising from the horizon
        var gy = baseY + cam.y * par * B;
        for (k = 0; k < 4; k++) {
          var bh = Math.floor((2 + 9 * h1(i * 7 + k * 13 + 1)) * (0.7 + 0.3 * pulse * h1(i + k * 5))), bx = X + k * B * 0.62, seg;
          for (seg = 0; seg < bh; seg++) p.rect(bx, gy - (seg + 1) * B * 0.42, B * 0.44, B * 0.28);
        }
      } else if (theme === 2) {                // tall crystals
        p.moveTo(X, Y - S * 1.5); p.lineTo(X + S * 0.55, Y); p.lineTo(X, Y + S * 1.5); p.lineTo(X - S * 0.55, Y); p.closePath();
        p.moveTo(X, Y - S * 1.5); p.lineTo(X, Y + S * 1.5);
        p.moveTo(X - S * 0.55, Y); p.lineTo(X, Y - S * 0.5); p.lineTo(X + S * 0.55, Y);
      } else if (theme === 3) {                // radar arcs with a sweep
        a = beat * 0.35 + i * 1.7;
        for (k = 1; k <= 3; k++) { p.moveTo(X + Math.cos(a + k) * S * k * 0.36, Y + Math.sin(a + k) * S * k * 0.36); p.arc(X, Y, S * k * 0.36, a + k, a + k + 3.6); }
        p.moveTo(X, Y); p.lineTo(X + Math.cos(-a * 1.3) * S * 1.08, Y + Math.sin(-a * 1.3) * S * 1.08);
      } else if (theme === 4) {                // stacked chevrons, pointing the way
        for (k = 0; k < 3; k++) { var cx2 = X + k * S * 0.5; p.moveTo(cx2 - S * 0.5, Y - S * 0.8); p.lineTo(cx2, Y); p.lineTo(cx2 - S * 0.5, Y + S * 0.8); }
      } else {                                 // honeycomb cells
        for (var ring = 0; ring < 2; ring++) {
          var rr = S * (ring ? 0.55 : 1), ra = beat * (ring ? -0.12 : 0.08) + i;
          for (k = 0; k <= 6; k++) { a = ra + k * 1.0472; if (k === 0) p.moveTo(X + Math.cos(a) * rr, Y + Math.sin(a) * rr); else p.lineTo(X + Math.cos(a) * rr, Y + Math.sin(a) * rr); }
        }
      }
    }
    ctx.globalAlpha = 0.35 + 0.65 * pal.t;
    ctx.lineWidth = 5; ctx.strokeStyle = c.trGrid; ctx.stroke(p);
    ctx.lineWidth = 1.5; ctx.strokeStyle = c.trBack; ctx.stroke(p);
    ctx.globalAlpha = 1;
  }

  /* per-level ornaments, derived from the level itself so custom and daily levels get them too */
  var decoL = null, deco = null;
  function solidAt(L, x, y) { var g = L.grid[x], t = g && g[y]; return t === '#' || t === '=' || t === '-'; }
  function buildDeco(L) {
    var d = { struts: [], floaters: [], zones: [] }, i, c, y, g, t, mode = 0, zs = 0;
    for (i = 0; i < L.gates.length; i++) {
      var G = L.gates[i];
      if ((G.k === 'G' || G.k === 'Z') && !mode) { mode = 1; zs = G.x; }
      else if (G.k === 'H' && mode) { mode = 0; d.zones.push(zs - 1, G.x + 1); }
    }
    if (mode) d.zones.push(zs - 1, L.endX + 4);
    function inZone(x) { for (var z = 0; z < d.zones.length; z += 2) if (x >= d.zones[z] && x <= d.zones[z + 1]) return true; return false; }
    var lastF = -99;
    for (c = 0; c < L.length; c++) {
      g = L.grid[c];
      if (g && !inZone(c)) {
        for (y in g) {
          t = g[y]; y = +y;
          if (y < 1 || !(t === '#' || t === '=' || t === '-') || solidAt(L, c, y - 1)) continue;
          var endL = !solidAt(L, c - 1, y), endR = !solidAt(L, c + 1, y);
          if (!endL && !endR) continue;
          var yb = t === '=' ? y + 0.5 : y, yt = 0, yy;
          for (yy = y - 1; yy >= 0; yy--) if (solidAt(L, c, yy)) { yt = yy + 1; break; }
          if (yb - yt >= 1.5) d.struts.push(c + (endL ? 0.2 : 0.8), yb, yt);
        }
      }
      // floaters in open air above the action, never inside a flying corridor
      if (c > 5 && c < L.length - 3 && c - lastF >= 4 && h1(c * 7 + 3) < 0.3 && !inZone(c)) {
        var fy = 5 + Math.floor(h1(c * 13 + 1) * 4), free = true, dx, dy;
        for (dx = -1; dx <= 1 && free; dx++) { g = L.grid[c + dx]; if (g) for (dy = -2; dy <= 2; dy++) if (g[fy + dy]) { free = false; break; } }
        if (free) { d.floaters.push(c + 0.5, fy + 0.5, Math.floor(h1(c * 3 + 9) * 4), 0.3 + 0.24 * h1(c + 77), h1(c * 5 + 2) - 0.5); lastF = c; }
      }
    }
    return d;
  }

  function drawDeco(sc) {
    var L = sc.L, c = pal.c, i, X, Y;
    if (decoL !== L) { decoL = L; deco = buildDeco(L); }
    var xa = cam.x - px0 / B - 2, xb = cam.x + (W - px0) / B + 2, st = deco.struts, fl = deco.floaters;
    // support struts under anything that floats
    var p = new Path2D(), feet = new Path2D();
    for (i = 0; i < st.length; i += 3) {
      if (st[i] < xa || st[i] > xb) continue;
      X = sx(st[i]); p.moveTo(X, sy(st[i + 1])); p.lineTo(X, sy(st[i + 2]));
      feet.moveTo(X - B * 0.14, sy(st[i + 2])); feet.lineTo(X + B * 0.14, sy(st[i + 2]));
    }
    ctx.setLineDash([B * 0.14, B * 0.12]); ctx.lineWidth = Math.max(1, B * 0.035); ctx.strokeStyle = c.trDeco; ctx.stroke(p);
    ctx.setLineDash([]); ctx.lineWidth = Math.max(1.5, B * 0.05); ctx.strokeStyle = c.trDim; ctx.stroke(feet);
    // floaters: small frames that turn slowly and kick with the beat
    p = new Path2D();
    for (i = 0; i < fl.length; i += 5) {
      if (fl[i] < xa || fl[i] > xb) continue;
      X = sx(fl[i]); Y = sy(fl[i + 1] + Math.sin(sc.beat * 0.5 + fl[i]) * 0.12);
      var S = B * fl[i + 3] * (1 + sc.pulse * 0.28), a = sc.beat * fl[i + 4] * 0.9 + fl[i], kind = fl[i + 2], k, ca, sa;
      if (kind === 0 || kind === 3) {                      // square frame (kind 3: nested pair)
        for (var n = 0; n < (kind === 3 ? 2 : 1); n++) {
          var r = S * (n ? 0.5 : 1), aa = n ? -a * 1.4 : a;
          for (k = 0; k <= 4; k++) { ca = Math.cos(aa + k * 1.5708 + 0.7854) * r * 1.2; sa = Math.sin(aa + k * 1.5708 + 0.7854) * r * 1.2; if (k === 0) p.moveTo(X + ca, Y + sa); else p.lineTo(X + ca, Y + sa); }
        }
      } else if (kind === 1) {                             // plus
        ca = Math.cos(a) * S; sa = Math.sin(a) * S;
        p.moveTo(X - ca, Y - sa); p.lineTo(X + ca, Y + sa); p.moveTo(X + sa, Y - ca); p.lineTo(X - sa, Y + ca);
      } else {                                             // brackets
        p.moveTo(X - S * 0.5, Y - S); p.lineTo(X - S, Y - S); p.lineTo(X - S, Y + S); p.lineTo(X - S * 0.5, Y + S);
        p.moveTo(X + S * 0.5, Y - S); p.lineTo(X + S, Y - S); p.lineTo(X + S, Y + S); p.lineTo(X + S * 0.5, Y + S);
        p.rect(X - S * 0.14, Y - S * 0.14, S * 0.28, S * 0.28);
      }
    }
    ctx.lineJoin = 'miter';
    ctx.lineWidth = B * 0.14; ctx.strokeStyle = c.trGrid; ctx.stroke(p);
    ctx.lineWidth = Math.max(1.2, B * 0.04); ctx.strokeStyle = c.trDim; ctx.stroke(p);
  }

  /* streaks in front of everything when the level is running fast */
  function drawStreaks(sc) {
    var want = sc.editor ? 0 : Math.max(0, (sc.s.speed - 1) * 2);
    streakA += (want - streakA) * (1 - Math.exp(-sc.dt * 5));
    if (streakA < 0.03) return;
    var p = new Path2D(), n = 14, i, span = W * 1.5;
    for (i = 0; i < n; i++) {
      var y = h1(i * 19 + 4) * H, len = B * (1.2 + 2.6 * h1(i * 5 + 1)) * sc.s.speed;
      var x = ((h1(i * 11 + 2) * span - cam.x * B * (1.5 + h1(i * 3) * 0.8)) % span + span) % span - W * 0.25;
      p.moveTo(x, y); p.lineTo(x + len, y);
    }
    ctx.globalAlpha = Math.min(1, streakA);
    ctx.lineWidth = 1.5; ctx.strokeStyle = pal.c.trDeco; ctx.stroke(p);
    ctx.globalAlpha = 1;
  }

  function drawGround(sc) {
    var c = pal.c, y0 = sy(0), x, col;
    if (y0 < H + 4) {
      var g = ctx.createLinearGradient(0, y0, 0, Math.min(H, y0 + B * 4));
      g.addColorStop(0, rgba(cur.trace, 0.16 + sc.pulse * 0.06)); g.addColorStop(1, rgba(cur.trace, 0.0));
      ctx.fillStyle = c.bg0; ctx.fillRect(0, y0, W, H - y0);
      ctx.fillStyle = g; ctx.fillRect(0, y0, W, H - y0);
      // beat ruler: a tick per block, a long tick per beat (at 1x)
      var c0 = Math.floor(cam.x - px0 / B) - 1, c1 = Math.ceil(cam.x + (W - px0) / B) + 1;
      ctx.beginPath();
      for (col = c0; col <= c1; col++) {
        if (col % 4 === 0) continue;
        x = sx(col); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + B * 0.16);
      }
      ctx.lineWidth = 1; ctx.strokeStyle = c.trDim; ctx.stroke();
      ctx.beginPath();
      for (col = c0 - (((c0 % 4) + 4) % 4); col <= c1; col += 4) { x = sx(col); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + B * 0.5); }
      ctx.lineWidth = 1.5; ctx.strokeStyle = c.tr; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(W, y0);
      glow(c.trGlow, c.tr, B * 0.2, Math.max(1.5, B * 0.06));
      // runway lamps under every beat mark; alternate ones flash on the beat
      var bi = Math.floor(sc.beat), lampOn = new Path2D(), lampOff = new Path2D(), ls = B * 0.16;
      for (col = c0 - (((c0 % 4) + 4) % 4); col <= c1; col += 4) {
        x = sx(col);
        (((col / 4 + bi) & 1) === 0 ? lampOn : lampOff).rect(x - ls / 2, y0 + B * 0.66, ls, ls);
      }
      ctx.fillStyle = c.trDeco; ctx.fill(lampOff);
      ctx.fillStyle = rgba(cur.trace, 0.3 + sc.pulse * 0.7); ctx.fill(lampOn);
    }
    if (boundsA > 0.02) {
      var s = sc.s, yF = sy(s.bF), yC = sy(s.bC);
      ctx.globalAlpha = boundsA;
      ctx.fillStyle = c.bg0; ctx.fillRect(0, 0, W, Math.max(0, yC));
      ctx.fillStyle = c.trFaint; ctx.fillRect(0, 0, W, Math.max(0, yC));
      ctx.beginPath();
      ctx.moveTo(0, yC); ctx.lineTo(W, yC);
      if (s.bF > 0) { ctx.moveTo(0, yF); ctx.lineTo(W, yF); }
      glow(c.trGlow, c.tr, B * 0.2, Math.max(1.5, B * 0.06));
      ctx.globalAlpha = 1;
    }
  }

  function isBlock(L, x, y) { var g = L.grid[x]; return !!g && g[y] === '#'; }

  var GATE = {
    H: { label: 'HOP', col: null }, G: { label: 'FLY', col: null }, Z: { label: 'ZIG', col: null },
    U: { label: 'G UP', col: [120, 190, 255] }, D: { label: 'G DOWN', col: [255, 205, 100] },
    '1': { label: '0.75x', col: [130, 255, 170] }, '2': { label: '1x', col: [210, 220, 255] },
    '3': { label: '1.25x', col: [255, 176, 84] }, '4': { label: '1.5x', col: [255, 96, 96] }
  };

  function drawTiles(sc) {
    var L = sc.L, c = pal.c, col, y, t, g, X, Y;
    var c0 = Math.floor(cam.x - px0 / B) - 2, c1 = Math.ceil(cam.x + (W - px0) / B) + 2;
    var thin = Math.max(1.5, B * 0.055), wide = B * 0.2;
    var saws = [], inter = [];

    // solids: fill, hatch, exposed edges
    ctx.fillStyle = c.trFill;
    var edge = new Path2D(), hatch = new Path2D(), spikes = new Path2D(), inset = new Path2D(), rivet = new Path2D(), base = new Path2D();
    var di = B * 0.17, rv = B * 0.11;
    for (col = c0; col <= c1; col++) {
      g = L.grid[col]; if (!g) continue;
      X = sx(col);
      for (y in g) {
        t = g[y]; y = +y; Y = sy(y + 1);
        if (t === '#') {
          ctx.fillRect(X, Y, B + 0.5, B + 0.5);
          hatch.moveTo(X, Y + B); hatch.lineTo(X + B, Y);
          hatch.moveTo(X, Y + B * 0.5); hatch.lineTo(X + B * 0.5, Y);
          hatch.moveTo(X + B * 0.5, Y + B); hatch.lineTo(X + B, Y + B * 0.5);
          var eT = !isBlock(L, col, y + 1), eB = y > 0 && !isBlock(L, col, y - 1), eL = !isBlock(L, col - 1, y), eR = !isBlock(L, col + 1, y);
          if (eT) { edge.moveTo(X, Y); edge.lineTo(X + B, Y); inset.moveTo(X + (eL ? di : 0), Y + di); inset.lineTo(X + B - (eR ? di : 0), Y + di); }
          if (eB) { edge.moveTo(X, Y + B); edge.lineTo(X + B, Y + B); inset.moveTo(X + (eL ? di : 0), Y + B - di); inset.lineTo(X + B - (eR ? di : 0), Y + B - di); }
          if (eL) { edge.moveTo(X, Y); edge.lineTo(X, Y + B); inset.moveTo(X + di, Y + (eT ? di : 0)); inset.lineTo(X + di, Y + B - (eB ? di : 0)); }
          if (eR) { edge.moveTo(X + B, Y); edge.lineTo(X + B, Y + B); inset.moveTo(X + B - di, Y + (eT ? di : 0)); inset.lineTo(X + B - di, Y + B - (eB ? di : 0)); }
          if (eT && eL) rivet.rect(X + di - rv / 2, Y + di - rv / 2, rv, rv);
          if (eT && eR) rivet.rect(X + B - di - rv / 2, Y + di - rv / 2, rv, rv);
          if (eB && eL) rivet.rect(X + di - rv / 2, Y + B - di - rv / 2, rv, rv);
          if (eB && eR) rivet.rect(X + B - di - rv / 2, Y + B - di - rv / 2, rv, rv);
          if (!eT && !eB && !eL && !eR) { hatch.moveTo(X, Y); hatch.lineTo(X + B, Y + B); }
        } else if (t === '=' || t === '-') {
          var yy = t === '=' ? Y : Y + B * 0.5;
          ctx.fillRect(X, yy, B, B * 0.5);
          edge.rect(X, yy, B, B * 0.5);
          hatch.moveTo(X, yy + B * 0.5); hatch.lineTo(X + B * 0.5, yy);
          hatch.moveTo(X + B * 0.5, yy + B * 0.5); hatch.lineTo(X + B, yy);
        } else if (t === '^') { spikes.moveTo(X + B * 0.1, Y + B); spikes.lineTo(X + B * 0.5, Y + B * 0.08); spikes.lineTo(X + B * 0.9, Y + B); spikes.closePath(); base.moveTo(X, Y + B); base.lineTo(X + B, Y + B); }
        else if (t === 'v') { spikes.moveTo(X + B * 0.1, Y); spikes.lineTo(X + B * 0.5, Y + B * 0.92); spikes.lineTo(X + B * 0.9, Y); spikes.closePath(); base.moveTo(X, Y); base.lineTo(X + B, Y); }
        else if (t === ',') { spikes.moveTo(X + B * 0.14, Y + B); spikes.lineTo(X + B * 0.5, Y + B * 0.56); spikes.lineTo(X + B * 0.86, Y + B); spikes.closePath(); }
        else if (t === '`') { spikes.moveTo(X + B * 0.14, Y); spikes.lineTo(X + B * 0.5, Y + B * 0.44); spikes.lineTo(X + B * 0.86, Y); spikes.closePath(); }
        else if (t === '>') { spikes.moveTo(X, Y + B * 0.1); spikes.lineTo(X + B * 0.92, Y + B * 0.5); spikes.lineTo(X, Y + B * 0.9); spikes.closePath(); }
        else if (t === '<') { spikes.moveTo(X + B, Y + B * 0.1); spikes.lineTo(X + B * 0.08, Y + B * 0.5); spikes.lineTo(X + B, Y + B * 0.9); spikes.closePath(); }
        else if (t === '*' || t === 'x') saws.push(col, y, t === '*' ? 1 : 0);
        else if (t === 'o' || t === '_' || t === '~' || t === 'c') inter.push(col, y, t);
      }
    }
    ctx.lineWidth = 1; ctx.strokeStyle = c.trFaint; ctx.stroke(hatch);
    ctx.lineCap = 'square';
    ctx.lineWidth = wide; ctx.strokeStyle = c.trGlow; ctx.stroke(edge);
    ctx.lineWidth = thin; ctx.strokeStyle = c.tr; ctx.stroke(edge);
    ctx.lineCap = 'butt';
    ctx.lineWidth = Math.max(1, B * 0.03); ctx.strokeStyle = c.trInset; ctx.stroke(inset);
    ctx.fillStyle = rgba(cur.trace, 0.45 + sc.pulse * 0.55); ctx.fill(rivet);
    // a hot base plate under spike rows, so they read as one hazard strip
    ctx.lineWidth = B * 0.3; ctx.strokeStyle = c.hotGlow; ctx.stroke(base);

    ctx.lineJoin = 'round';
    ctx.fillStyle = c.hotFill; ctx.fill(spikes);
    ctx.lineWidth = wide; ctx.strokeStyle = c.hotGlow; ctx.stroke(spikes);
    ctx.lineWidth = thin; ctx.strokeStyle = c.hot; ctx.stroke(spikes);

    // saws and mines
    var i, k, a, r, rot = sc.beat * 2.2;
    for (i = 0; i < saws.length; i += 3) {
      X = sx(saws[i] + 0.5); Y = sy(saws[i + 1] + 0.5);
      var big = saws[i + 2], teeth = big ? 10 : 4, ro = (big ? 0.95 : 0.42 + sc.pulse * 0.06) * B, ri = ro * (big ? 0.72 : 0.42);
      ctx.beginPath();
      for (k = 0; k < teeth * 2; k++) {
        a = (big ? rot : -rot * 0.7) + k * Math.PI / teeth; r = k % 2 ? ri : ro;
        if (k === 0) ctx.moveTo(X + Math.cos(a) * r, Y + Math.sin(a) * r); else ctx.lineTo(X + Math.cos(a) * r, Y + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fillStyle = c.hotFill; ctx.fill();
      glow(c.hotGlow, c.hot, wide, thin);
      if (big) {
        ctx.beginPath(); ctx.arc(X, Y, B * 0.26, 0, 6.2832);
        for (k = 0; k < 3; k++) { a = -rot * 1.6 + k * 2.0944; ctx.moveTo(X + Math.cos(a) * B * 0.26, Y + Math.sin(a) * B * 0.26); ctx.lineTo(X + Math.cos(a) * B * 0.56, Y + Math.sin(a) * B * 0.56); }
        ctx.lineWidth = thin; ctx.strokeStyle = c.hot; ctx.stroke();
      }
    }

    // pads, rings, cores
    var pulse = sc.pulse;
    for (i = 0; i < inter.length; i += 3) {
      col = inter[i]; y = inter[i + 1]; t = inter[i + 2];
      X = sx(col); Y = sy(y + 1);
      var id = tileId(L, col, y);
      if (t === '_' || t === '~') {
        var up = t === '_', by = up ? Y + B : Y, d = up ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(X + B * 0.06, by); ctx.lineTo(X + B * 0.22, by + d * B * 0.22); ctx.lineTo(X + B * 0.78, by + d * B * 0.22); ctx.lineTo(X + B * 0.94, by);
        ctx.closePath(); ctx.fillStyle = c.accFill; ctx.fill();
        glow(c.accGlow, c.acc, wide, thin);
        var lift = ((sc.beat * 2) % 1) * 0.5;
        ctx.beginPath();
        for (k = 0; k < 2; k++) {
          var cyv = by + d * B * (0.42 + lift + k * 0.3);
          ctx.moveTo(X + B * 0.3, cyv); ctx.lineTo(X + B * 0.5, cyv + d * B * 0.16); ctx.lineTo(X + B * 0.7, cyv);
        }
        ctx.globalAlpha = 0.75 - lift; ctx.lineWidth = thin; ctx.strokeStyle = c.acc; ctx.stroke(); ctx.globalAlpha = 1;
      } else if (t === 'o') {
        var used = sc.used && sc.used[id];
        var cxp = X + B * 0.5, cyp = Y + B * 0.5;
        ctx.globalAlpha = used ? 0.3 : 1;
        ctx.beginPath(); ctx.arc(cxp, cyp, B * (0.3 + pulse * 0.05), 0, 6.2832);
        ctx.fillStyle = c.accFill; ctx.fill(); glow(c.accGlow, c.acc, wide, thin);
        ctx.beginPath(); ctx.arc(cxp, cyp, B * (0.52 + pulse * 0.1), 0, 6.2832);
        ctx.lineWidth = 1.2; ctx.strokeStyle = c.acc; ctx.globalAlpha = used ? 0.15 : 0.55; ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (t === 'c') {
        var bit = coinBit(L, col, y);
        if (sc.coins & bit) continue;
        var had = sc.owned & bit;
        var cxc = X + B * 0.5, cyc = Y + B * 0.5 + Math.sin(sc.beat * 1.5 + col) * B * 0.08, w2 = B * 0.34 * Math.abs(Math.cos(sc.beat * 0.9 + col)) + B * 0.05, h2 = B * 0.42;
        ctx.globalAlpha = had ? 0.4 : 1;
        ctx.beginPath(); ctx.moveTo(cxc, cyc - h2); ctx.lineTo(cxc + w2, cyc); ctx.lineTo(cxc, cyc + h2); ctx.lineTo(cxc - w2, cyc); ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fill();
        glow('rgba(255,255,255,0.22)', '#ffffff', wide, thin);
        ctx.globalAlpha = 1;
      }
    }

    // gates: a beam through the whole column plus a tag
    var gates = L.gates, top = -4;
    ctx.font = '600 ' + Math.round(B * 0.34) + 'px "Share Tech Mono", ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (i = 0; i < gates.length; i++) {
      var G = gates[i];
      if (G.x < c0 || G.x > c1) continue;
      var info = GATE[G.k], gc = info.col || cur.acc, passed = G.x <= sc.x;
      X = sx(G.x);
      var y1 = sy(G.k === 'G' || G.k === 'Z' ? G.floor : 0);
      ctx.globalAlpha = passed ? 0.25 : 1;
      ctx.beginPath(); ctx.moveTo(X, y1); ctx.lineTo(X, top);
      ctx.lineWidth = B * (0.5 + pulse * 0.15); ctx.strokeStyle = rgba(gc, 0.1); ctx.stroke();
      ctx.setLineDash([B * 0.35, B * 0.2]); ctx.lineDashOffset = -sc.beat * B * 1.2;
      ctx.lineWidth = thin; ctx.strokeStyle = rgba(gc, 1); ctx.stroke();
      ctx.setLineDash([]);
      if (G.k === 'U' || G.k === 'D' || (G.k >= '1' && G.k <= '4')) {
        var ar = new Path2D(), az = B * 0.2, j, q;
        if (G.k === 'U' || G.k === 'D') {                 // arrowheads sliding along the beam, the way you will fall
          var dirY = G.k === 'U' ? -1 : 1;
          for (j = 0; j < 5; j++) {
            q = ((sc.beat * 1.5 + j * 2.1) % 10.5 + 10.5) % 10.5;
            var ay = sy(dirY < 0 ? q : 10.5 - q);
            for (var side = -1; side <= 1; side += 2) { var axp = X + side * B * 0.5; ar.moveTo(axp - az, ay - dirY * az); ar.lineTo(axp, ay); ar.lineTo(axp + az, ay - dirY * az); }
          }
        } else {                                           // chevrons: more of them for more speed, pointing back for slow
          var cnt = G.k === '4' ? 3 : (G.k === '3' ? 2 : 1), dirX = G.k === '1' ? -1 : 1, osc = Math.sin(sc.beat * 6.2832) * B * 0.06;
          for (var rowY = 1.5; rowY < 9; rowY += 3) {
            if (Math.abs(rowY - (G.row + 3.5)) < 0.9) continue;
            for (j = 0; j < cnt; j++) { var cxg = X + dirX * (B * 0.34 + j * B * 0.3 + osc), cyg = sy(rowY); ar.moveTo(cxg - dirX * az, cyg - az * 1.3); ar.lineTo(cxg, cyg); ar.lineTo(cxg - dirX * az, cyg + az * 1.3); }
          }
        }
        ctx.lineWidth = thin; ctx.strokeStyle = rgba(gc, 0.8); ctx.stroke(ar);
      }
      var ty = sy(G.row + 0.5 + (G.k === 'G' || G.k === 'Z' ? 0 : 3)), tw = ctx.measureText(info.label).width + B * 0.4, thh = B * 0.56;
      ctx.fillStyle = c.bg0; ctx.fillRect(X - tw / 2, ty - thh / 2, tw, thh);
      ctx.lineWidth = thin; ctx.strokeStyle = rgba(gc, 1); ctx.strokeRect(X - tw / 2, ty - thh / 2, tw, thh);
      ctx.fillStyle = rgba(gc, 1); ctx.fillText(info.label, X, ty + 1);
      ctx.globalAlpha = 1;
    }

    // finish line
    if (L.endX >= c0 && L.endX <= c1 + 2) {
      X = sx(L.endX);
      ctx.beginPath(); ctx.moveTo(X, sy(0)); ctx.lineTo(X, top);
      ctx.lineWidth = B * (0.9 + pulse * 0.3); ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.stroke();
      ctx.lineWidth = thin * 1.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    }

    // practice checkpoints
    if (sc.cps) {
      for (i = 0; i < sc.cps.length; i++) {
        X = sx(sc.cps[i].x); Y = sy(sc.cps[i].y);
        if (X < -B || X > W + B) continue;
        ctx.beginPath(); ctx.moveTo(X, Y - B * 0.36); ctx.lineTo(X + B * 0.26, Y); ctx.lineTo(X, Y + B * 0.36); ctx.lineTo(X - B * 0.26, Y); ctx.closePath();
        ctx.fillStyle = c.accFill; ctx.fill(); glow(c.accGlow, c.acc, wide * 0.7, thin);
      }
    }
  }

  var idCache = null, idCacheL = null;
  function buildIds(L) {
    idCache = {}; idCacheL = L;
    for (var i = 0; i < L.objs.length; i++) { var o = L.objs[i]; idCache[o.x + ',' + o.y] = o; }
  }
  function tileId(L, x, y) { if (idCacheL !== L) buildIds(L); var o = idCache[x + ',' + y]; return o ? o.id : -1; }
  function coinBit(L, x, y) { if (idCacheL !== L) buildIds(L); var o = idCache[x + ',' + y]; return o ? o.bit : 0; }

  /* inner glyphs, drawn in a unit box centred on 0,0 */
  var SKINS = [
    function (c, u) { c.moveTo(0, -u * 0.24); c.lineTo(u * 0.24, 0); c.lineTo(0, u * 0.24); c.lineTo(-u * 0.24, 0); c.closePath(); },
    function (c, u) { c.moveTo(-u * 0.26, 0); c.lineTo(u * 0.26, 0); c.moveTo(0, -u * 0.26); c.lineTo(0, u * 0.26); },
    function (c, u) { c.arc(0, 0, u * 0.2, 0, 6.2832); c.moveTo(-u * 0.34, 0); c.lineTo(-u * 0.12, 0); c.moveTo(u * 0.12, 0); c.lineTo(u * 0.34, 0); },
    function (c, u) { c.moveTo(-u * 0.24, -u * 0.11); c.lineTo(u * 0.24, -u * 0.11); c.moveTo(-u * 0.24, u * 0.11); c.lineTo(u * 0.24, u * 0.11); },
    function (c, u) { c.moveTo(-u * 0.28, 0); c.quadraticCurveTo(-u * 0.14, -u * 0.34, 0, 0); c.quadraticCurveTo(u * 0.14, u * 0.34, u * 0.28, 0); },
    function (c, u) { c.moveTo(u * 0.1, -u * 0.28); c.lineTo(-u * 0.14, u * 0.04); c.lineTo(u * 0.12, u * 0.0); c.lineTo(-u * 0.1, u * 0.28); }
  ];
  var TINTS = [[255, 255, 255], [93, 255, 160], [255, 184, 77], [112, 212, 255], [255, 120, 200], [255, 240, 122]];

  function drawPlayerShape(c2, mode, u, skin, tint, thin) {
    var col = rgba(tint, 1), glowC = rgba(tint, 0.25);
    c2.lineJoin = 'round';
    c2.beginPath();
    if (mode === C.HOP) {
      var h = u * 0.5, r = u * 0.16;
      c2.moveTo(-h + r, -h); c2.lineTo(h - r, -h); c2.quadraticCurveTo(h, -h, h, -h + r); c2.lineTo(h, h - r);
      c2.quadraticCurveTo(h, h, h - r, h); c2.lineTo(-h + r, h); c2.quadraticCurveTo(-h, h, -h, h - r); c2.lineTo(-h, -h + r);
      c2.quadraticCurveTo(-h, -h, -h + r, -h); c2.closePath();
    } else if (mode === C.GLIDE) {
      c2.moveTo(u * 0.62, 0); c2.lineTo(-u * 0.5, -u * 0.4); c2.lineTo(-u * 0.26, 0); c2.lineTo(-u * 0.5, u * 0.4); c2.closePath();
    } else {
      c2.moveTo(u * 0.34, 0); c2.lineTo(-u * 0.26, -u * 0.26); c2.lineTo(-u * 0.1, 0); c2.lineTo(-u * 0.26, u * 0.26); c2.closePath();
    }
    c2.fillStyle = 'rgba(8,12,12,0.85)'; c2.fill();
    c2.lineWidth = u * 0.2; c2.strokeStyle = glowC; c2.stroke();
    c2.lineWidth = thin * 1.25; c2.strokeStyle = col; c2.stroke();
    if (mode === C.HOP) {
      c2.beginPath(); SKINS[skin % SKINS.length](c2, u);
      c2.lineWidth = thin * 1.1; c2.strokeStyle = col; c2.stroke();
    }
  }

  function drawTrail(sc) {
    var tr = sc.trail, n = tr.length, i, c = pal.c;
    if (n < 4) return;
    var zig = sc.s.mode === C.ZIG;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    var parts = zig ? 1 : 4, per = Math.floor(n / 2 / parts) || 1;
    for (var p = 0; p < parts; p++) {
      var a = p * per * 2, b = p === parts - 1 ? n - 2 : (p + 1) * per * 2;
      ctx.beginPath();
      for (i = a; i <= b; i += 2) { if (i === a) ctx.moveTo(sx(tr[i]), sy(tr[i + 1])); else ctx.lineTo(sx(tr[i]), sy(tr[i + 1])); }
      ctx.globalAlpha = zig ? 0.9 : (p + 1) / parts * 0.5;
      ctx.lineWidth = zig ? B * 0.3 : B * 0.3; ctx.strokeStyle = c.accGlow; ctx.stroke();
      ctx.lineWidth = zig ? B * 0.1 : B * 0.05; ctx.strokeStyle = c.acc; ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.lineCap = 'butt';
  }

  function drawPlayer(sc) {
    if (sc.hidePlayer) return;
    var X = sx(sc.x), Y = sy(sc.y);
    ctx.save();
    ctx.translate(X, Y);
    if (sc.squash) {
      // squash on landing, stretch on take-off, anchored at the feet
      var q = sc.squash, g = sc.s.grav;
      ctx.translate(0, g * B * 0.5 * q);
      ctx.scale(1 + q * 0.7, 1 - q);
    }
    ctx.rotate(sc.rot);
    if (sc.s.grav < 0 && sc.s.mode !== C.HOP) ctx.scale(1, -1);
    drawPlayerShape(ctx, sc.s.mode, B, sc.skin || 0, TINTS[sc.tint || 0], Math.max(1.5, B * 0.055));
    ctx.restore();
  }

  function drawParticles(sc) {
    var ps = sc.parts, i, p, cols = [cur.trace, cur.hot, cur.acc, [255, 255, 255]];
    for (i = 0; i < ps.length; i++) {
      p = ps[i];
      var a = Math.max(0, p.life / p.max), X = sx(p.x), Y = sy(p.y);
      if (X < -40 || X > W + 40) continue;
      ctx.globalAlpha = a;
      if (p.ring) {
        ctx.beginPath(); ctx.arc(X, Y, B * p.size * (1.2 - a), 0, 6.2832);
        ctx.lineWidth = Math.max(1, B * 0.07 * a); ctx.strokeStyle = rgba(cols[p.col], 1); ctx.stroke();
      } else if (p.line) {
        ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X - p.vx * B * 0.045, Y + p.vy * B * 0.045);
        ctx.lineWidth = Math.max(1, B * p.size); ctx.strokeStyle = rgba(cols[p.col], 1); ctx.stroke();
      } else {
        var z = B * p.size * (0.4 + a * 0.6);
        ctx.fillStyle = rgba(cols[p.col], 1); ctx.fillRect(X - z / 2, Y - z / 2, z, z);
      }
    }
    ctx.globalAlpha = 1;
  }

  function draw(sc) {
    // the editor may zoom out (sc.zoom < 1) to see more of the level; play is always at 1
    var z = sc.editor ? Math.max(0.35, Math.min(1.5, sc.zoom || 1)) : 1;
    if (z !== zoomNow) { zoomNow = z; B = baseB * z; api.view.B = B; }
    setPalette(sc.pal, sc.dt, sc.snap);
    updateCam(sc);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var shx = 0, shy = 0;
    if (sc.shake > 0) { shx = (Math.random() - 0.5) * sc.shake * B * 0.5; shy = (Math.random() - 0.5) * sc.shake * B * 0.5; }
    drawBackground(sc);
    drawBackdrop(sc);
    ctx.translate(shx, shy);
    drawGround(sc);
    drawDeco(sc);
    drawTiles(sc);
    drawStreaks(sc);
    drawTrail(sc);
    drawParticles(sc);
    drawPlayer(sc);
    ctx.translate(-shx, -shy);
    if (sc.flash > 0) {
      ctx.fillStyle = rgba(sc.flashCol === 1 ? cur.hot : (sc.flashCol === 2 ? cur.acc : [255, 255, 255]), Math.min(0.5, sc.flash));
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* small preview of a skin for the menu */
  function drawSkin(canvas, skin, tint) {
    var c2 = canvas.getContext('2d'), s = canvas.width;
    c2.clearRect(0, 0, s, s);
    c2.save(); c2.translate(s / 2, s / 2);
    drawPlayerShape(c2, C.HOP, s * 0.62, skin, TINTS[tint], Math.max(1.5, s * 0.04));
    c2.restore();
  }

  /* screen <-> world helpers (used by the level editor) */
  function toWorld(px, py) { return { x: cam.x + (px - px0) / B, y: cam.y + (baseY - py) / B }; }
  function toScreen(wx, wy) { return { x: sx(wx), y: sy(wy) }; }

  var api = {
    init: init, resize: resize, draw: draw, drawSkin: drawSkin, toWorld: toWorld, toScreen: toScreen,
    ctx: function () { return ctx; }, view: { W: 0, H: 0, B: 40, portrait: false },
    palette: function (i) { return PALS[i % PALS.length]; }, SKINS: SKINS.length, TINTS: TINTS
  };
  root.PRender = api;
})(window);
