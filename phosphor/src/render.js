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
    var edge = new Path2D(), hatch = new Path2D(), spikes = new Path2D();
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
          if (!isBlock(L, col, y + 1)) { edge.moveTo(X, Y); edge.lineTo(X + B, Y); }
          if (y > 0 && !isBlock(L, col, y - 1)) { edge.moveTo(X, Y + B); edge.lineTo(X + B, Y + B); }
          if (!isBlock(L, col - 1, y)) { edge.moveTo(X, Y); edge.lineTo(X, Y + B); }
          if (!isBlock(L, col + 1, y)) { edge.moveTo(X + B, Y); edge.lineTo(X + B, Y + B); }
        } else if (t === '=' || t === '-') {
          var yy = t === '=' ? Y : Y + B * 0.5;
          ctx.fillRect(X, yy, B, B * 0.5);
          edge.rect(X, yy, B, B * 0.5);
          hatch.moveTo(X, yy + B * 0.5); hatch.lineTo(X + B * 0.5, yy);
          hatch.moveTo(X + B * 0.5, yy + B * 0.5); hatch.lineTo(X + B, yy);
        } else if (t === '^') { spikes.moveTo(X + B * 0.1, Y + B); spikes.lineTo(X + B * 0.5, Y + B * 0.08); spikes.lineTo(X + B * 0.9, Y + B); spikes.closePath(); }
        else if (t === 'v') { spikes.moveTo(X + B * 0.1, Y); spikes.lineTo(X + B * 0.5, Y + B * 0.92); spikes.lineTo(X + B * 0.9, Y); spikes.closePath(); }
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
      if (big) { ctx.beginPath(); ctx.arc(X, Y, B * 0.26, 0, 6.2832); ctx.lineWidth = thin; ctx.strokeStyle = c.hot; ctx.stroke(); }
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
    ctx.translate(shx, shy);
    drawGround(sc);
    drawTiles(sc);
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
