/* Phosphor level editor: paint tiles on the live scope, test-play, let the bot verify, save in this
   browser, share as a text code. Loaded last. It draws through PRender and hands test runs to PGame.

   The level being edited is one chunk: S.grid[y][x], y = 0 on the ground up to ROWS - 1.
   A saved level is { id, name, song, pal, width, rows, updated } with rows written top row first,
   exactly like a chunk in levels.js, so compiling is { pal, rows } with no conversion. */
(function (root) {
  'use strict';
  var doc = root.document;
  var E = null, R = null, PG = null, cv = null;

  var ROWS = 10, W_START = 96, W_MIN = 32, W_MAX = 1200, W_STEP = 32, MAX_CORES = 3, RUNUP = 8;
  var STORE_KEY = 'phosphor.custom.v1', MAX_SAVED = 60, HIST = 200, NAME_MAX = 32, CODE_MAX = 40000;
  var SOLVE_LIMIT = 1500000;
  var DEFAULT_NAME = 'Untitled level';
  var FONT = '"Share Tech Mono", ui-monospace, monospace';
  var SONGS = [
    { id: 'trace', name: 'First Trace', bpm: 128 },
    { id: 'carrier', name: 'Carrier Wave', bpm: 140 },
    { id: 'overdrive', name: 'Overdrive', bpm: 150 }
  ];
  var PAL_NAMES = ['Green', 'Amber', 'Ice', 'Violet', 'White-hot', 'Red alert'];
  var TILES = '.#=-^v,`<>*xo_~cHGZUD1234', HAZ = '^v,`<>*x', GATES = 'HGZUD1234';
  var GATE_COL = { U: [120, 190, 255], D: [255, 205, 100], '1': [130, 255, 170], '2': [210, 220, 255], '3': [255, 176, 84], '4': [255, 96, 96] };
  var COL = ' Acts on the whole column, whatever row it sits in.';
  var FLY = ' Acts on the whole column; its row sets the 9-tall corridor (floor = row - 4, min 0).';
  var TOOLS = [
    { id: 'pan', grp: 0, name: 'Pan', hint: 'Pan: drag to move the view. Two fingers, the wheel and the slider scroll too.' },
    { id: 'erase', grp: 0, name: 'Erase', hint: 'Erase: tap or drag over tiles to remove them.' },
    { id: 'block', grp: 1, t: '#', name: 'Block', hint: 'Block: land on top of it, crash into its side.' },
    { id: 'slabTop', grp: 1, t: '=', name: 'Slab, upper half', hint: 'Slab filling the upper half of its cell.' },
    { id: 'slabLow', grp: 1, t: '-', name: 'Slab, lower half', hint: 'Slab filling the lower half of its cell.' },
    { id: 'spike', grp: 2, t: '^', name: 'Spike', hint: 'Spike: ends the run on contact.' },
    { id: 'spikeDown', grp: 2, t: 'v', name: 'Hanging spike', hint: 'Hanging spike: points down from the cell above.' },
    { id: 'spikeSmall', grp: 2, t: ',', name: 'Small spike', hint: 'Small spike: half the height, easier to clear.' },
    { id: 'spikeSmallDown', grp: 2, t: '`', name: 'Small hanging spike', hint: 'Small hanging spike.' },
    { id: 'spikeRight', grp: 2, t: '>', name: 'Wall spike pointing right', hint: 'Wall spike pointing right: put it against the block on its left.' },
    { id: 'spikeLeft', grp: 2, t: '<', name: 'Wall spike pointing left', hint: 'Wall spike pointing left: put it against the block on its right.' },
    { id: 'saw', grp: 2, t: '*', name: 'Saw', hint: 'Saw: a spinning hazard 1.5 blocks across, wider than its cell.' },
    { id: 'mine', grp: 2, t: 'x', name: 'Mine', hint: 'Mine: a small floating hazard.' },
    { id: 'ring', grp: 3, t: 'o', name: 'Jump ring', hint: 'Jump ring: tap while touching it for a jump in mid-air.' },
    { id: 'pad', grp: 3, t: '_', name: 'Jump pad', hint: 'Jump pad: launches on contact, higher and longer than a jump.' },
    { id: 'padCeil', grp: 3, t: '~', name: 'Ceiling pad', hint: 'Ceiling pad: a jump pad for flipped gravity.' },
    { id: 'core', grp: 3, t: 'c', name: 'Core', single: true, hint: 'Core: an optional pickup. A level holds 3 at most.' },
    { id: 'gateH', grp: 4, t: 'H', tag: 'HOP', name: 'Hop gate', single: true, hint: 'HOP gate: back to jumping.' + COL },
    { id: 'gateG', grp: 4, t: 'G', tag: 'FLY', name: 'Fly gate', single: true, hint: 'FLY gate: hold to climb.' + FLY },
    { id: 'gateZ', grp: 4, t: 'Z', tag: 'ZIG', name: 'Zig gate', single: true, hint: 'ZIG gate: hold to rise.' + FLY },
    { id: 'gateU', grp: 4, t: 'U', tag: 'G UP', name: 'Gravity up gate', single: true, hint: 'G UP gate: gravity flips to the ceiling.' + COL },
    { id: 'gateD', grp: 4, t: 'D', tag: 'G DOWN', name: 'Gravity down gate', single: true, hint: 'G DOWN gate: gravity back to the ground.' + COL },
    { id: 'gate1', grp: 5, t: '1', tag: '0.75x', name: 'Speed 0.75x gate', single: true, hint: '0.75x gate: slows the scroll.' + COL },
    { id: 'gate2', grp: 5, t: '2', tag: '1x', name: 'Speed 1x gate', single: true, hint: '1x gate: normal speed.' + COL },
    { id: 'gate3', grp: 5, t: '3', tag: '1.25x', name: 'Speed 1.25x gate', single: true, hint: '1.25x gate: faster scroll.' + COL },
    { id: 'gate4', grp: 5, t: '4', tag: '1.5x', name: 'Speed 1.5x gate', single: true, hint: '1.5x gate: fastest scroll.' + COL }
  ];

  var S = {
    ready: false, active: false, store: true,
    id: '', name: DEFAULT_NAME, song: 'trace', pal: 0, width: W_START, grid: null, cores: 0,
    dirty: false, stale: true, L: null, tool: TOOLS[2],
    camX: 0, camY: 0, camInit: false, snap: true, beat: 0,
    hist: [], redo: [], stroke: null, ptrs: {}, nptr: 0, pinch: null, hover: null,
    panel: null, opener: null, mark: null, busy: false, lastVerify: null,
    msg: '', kind: '', sticky: false, warn: ''
  };
  var V = { W: 0, H: 0, B: 40, px0: 0, baseY: 0, top: 0, bot: 0, minX: 0, maxX: 0, lo: 0, hi: 0, panY: false, statusMin: -1 };
  var el = {}, sc = null, reduced = false, mqWide = null, msgT = 0, seq = 0;

  function $(id) { return doc.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rgba(a, al) { return 'rgba(' + a[0] + ',' + a[1] + ',' + a[2] + ',' + al + ')'; }
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  function songOf(id) { for (var i = 0; i < SONGS.length; i++) if (SONGS[i].id === id) return SONGS[i]; return null; }
  /* the audio engine is the source of truth for level songs and their tempo; the list above is the fallback */
  function readSongs() {
    var tbl = root.PAudio && root.PAudio.songs, out = [], seen = {}, id;
    if (!tbl || typeof tbl !== 'object') return;
    function add(k) {
      var s = tbl[k];
      if (!s || seen[k] || k === 'menu' || !(s.bpm > 0)) return;
      seen[k] = 1; out.push({ id: k, name: String(s.name || k), bpm: s.bpm });
    }
    SONGS.forEach(function (s) { add(s.id); });
    for (id in tbl) if (Object.prototype.hasOwnProperty.call(tbl, id)) add(id);
    if (out.length) SONGS = out;
  }
  function fail(msg) { var e = new Error(msg); e.friendly = true; throw e; }

  /* ---------- level data ---------- */
  function blankGrid(w) {
    var g = [], y, x, row;
    for (y = 0; y < ROWS; y++) { row = new Array(w); for (x = 0; x < w; x++) row[x] = '.'; g.push(row); }
    return g;
  }
  function rowsOf(grid) { var out = [], y; for (y = ROWS - 1; y >= 0; y--) out.push(grid[y].join('')); return out; }
  function gridOf(rows) { var g = [], y; for (y = 0; y < ROWS; y++) g.push(rows[ROWS - 1 - y].split('')); return g; }
  function countCores(grid) {
    var n = 0, y, x, row;
    for (y = 0; y < ROWS; y++) { row = grid[y]; for (x = 0; x < row.length; x++) if (row[x] === 'c') n++; }
    return n;
  }
  /* drops half surrogate pairs (a cut-off emoji), which cannot be encoded into a share code */
  function wellFormed(s) {
    var out = '', i, c, d;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) { d = s.charCodeAt(i + 1); if (d >= 0xDC00 && d <= 0xDFFF) { out += s.charAt(i) + s.charAt(i + 1); i++; } }
      else if (c < 0xDC00 || c > 0xDFFF) out += s.charAt(i);
    }
    return out;
  }
  function cleanName(v) {
    var s = String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    return wellFormed(s.slice(0, NAME_MAX)).trim() || DEFAULT_NAME;
  }
  function newId(taken) {
    var t = Date.now() + (seq++), id;
    do { id = 'custom-' + (t++).toString(36); } while (id === S.id || (taken && taken[id]));
    return id;
  }

  /* Returns a clean record or throws a friendly Error. Used for stored levels and imported codes. */
  function checkLevel(o) {
    if (!o || typeof o !== 'object') fail('That is not a level.');
    var song = songOf(o.song);
    if (!song) fail('The level uses a song this version does not have.');
    if (!isInt(o.pal) || o.pal < 0 || o.pal >= PAL_NAMES.length) fail('The level uses a colour this version does not have.');
    var w = o.width;
    if (!isInt(w) || w < W_MIN || w > W_MAX) fail('A level must be ' + W_MIN + ' to ' + W_MAX + ' columns long.');
    var rows = o.rows, r, i, ch, cores = 0;
    if (!Array.isArray(rows) || rows.length !== ROWS) fail('A level must have exactly ' + ROWS + ' rows.');
    for (r = 0; r < ROWS; r++) {
      if (typeof rows[r] !== 'string' || rows[r].length !== w) fail('Row ' + (r + 1) + ' has the wrong length.');
      for (i = 0; i < w; i++) {
        ch = rows[r].charAt(i);
        if (TILES.indexOf(ch) < 0) fail('The level contains a tile this version does not know.');
        if (ch === 'c') cores++;
      }
    }
    if (cores > MAX_CORES) fail('The level has ' + cores + ' cores. ' + MAX_CORES + ' is the most a level can hold.');
    return {
      id: typeof o.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(o.id) ? o.id : '',
      name: cleanName(o.name), song: song.id, pal: o.pal, width: w, rows: rows.slice(),
      updated: typeof o.updated === 'number' && isFinite(o.updated) ? o.updated : 0
    };
  }

  function record() {
    return { id: S.id, name: cleanName(S.name), song: S.song, pal: S.pal, width: S.width, rows: rowsOf(S.grid), updated: Date.now() };
  }
  function makeDef() {
    var song = songOf(S.song) || SONGS[0];
    return { id: S.id, name: cleanName(S.name), song: song.id, bpm: song.bpm, diff: 'Custom', color: S.pal, chunks: [{ pal: S.pal, rows: rowsOf(S.grid) }] };
  }

  /* a small layout so the first view is not an empty grid: a core, spikes, a block step, a pad, a ring, stairs.
     Checked with the solver: beatable with comfortable slack, and the core can be collected. */
  function exampleRows() {
    var g = blankGrid(W_START);
    [[5, 2, 'c'], [10, 0, '^'], [16, 0, '###'], [24, 0, '^^'], [31, 0, '_^^^'], [41, 0, '^^^^^'], [42, 2, 'o'],
      [53, 0, '###'], [56, 0, '####'], [56, 1, '####'], [67, 0, '^'], [76, 0, '^^']].forEach(function (it) {
      for (var i = 0; i < it[2].length; i++) g[it[1]][it[0] + i] = it[2].charAt(i);
    });
    return rowsOf(g);
  }

  function loadRecord(rec, dirty) {
    cancelStroke();
    S.id = rec.id || newId(); S.name = rec.name; S.song = rec.song; S.pal = rec.pal; S.width = rec.width;
    S.grid = gridOf(rec.rows); S.cores = countCores(S.grid);
    S.hist.length = 0; S.redo.length = 0; S.dirty = !!dirty; S.stale = true; S.mark = null; S.lastVerify = null;
    S.camInit = false; S.snap = true;
    if (S.ready) { syncForm(); applyPal(); checkWarn(); syncButtons(); note(); renderStatus(); }
  }
  function newLevel() {
    loadRecord({ id: newId(), name: DEFAULT_NAME, song: 'trace', pal: 0, width: W_START, rows: exampleRows() }, false);
  }

  /* ---------- share codes: PH1.<base64url of JSON { v, n, s, p, w, g }>, g = run-length rows ---------- */
  function rle(s) {
    var out = '', i = 0, n = s.length, c, j, k;
    while (i < n) {
      c = s.charAt(i); j = i + 1;
      while (j < n && s.charAt(j) === c) j++;
      k = j - i;
      out += k > 3 ? '(' + k + ')' + c : (k === 3 ? c + c + c : (k === 2 ? c + c : c));
      i = j;
    }
    return out;
  }
  function unrle(s, want) {
    if (typeof s !== 'string') fail('The code has no tile data.');
    var out = [], len = 0, i = 0, n = s.length, c, k, j;
    while (i < n) {
      c = s.charAt(i); k = 1;
      if (c === '(') {
        j = s.indexOf(')', i);
        if (j < 0 || j - i > 7 || !/^\d+$/.test(s.slice(i + 1, j))) fail('The tile data in the code is damaged.');
        k = parseInt(s.slice(i + 1, j), 10); c = s.charAt(j + 1); i = j + 2;
      } else i++;
      if (c === '' || TILES.indexOf(c) < 0) fail('The code contains a tile this version does not know.');
      if (k < 1 || len + k > want) fail('The tile data does not match the level size in the code.');
      out.push(k === 1 ? c : new Array(k + 1).join(c)); len += k;
    }
    if (len !== want) fail('The tile data does not match the level size in the code.');
    return out.join('');
  }
  function toB64(s) {
    var bin = encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
    return root.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64(b) {
    b = b.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    while (b.length % 4) b += '=';
    var bin = root.atob(b), s = '', i;
    for (i = 0; i < bin.length; i++) s += '%' + ('0' + bin.charCodeAt(i).toString(16)).slice(-2);
    return decodeURIComponent(s);
  }
  function encode(rec) {
    return 'PH1.' + toB64(JSON.stringify({ v: 1, n: rec.name, s: rec.song, p: rec.pal, w: rec.width, g: rle(rec.rows.join('')) }));
  }
  function decode(text) {
    var t = String(text === undefined || text === null ? '' : text).replace(/\s+/g, '');
    if (!t) fail('Paste a level code first.');
    if (t.length > CODE_MAX) fail('That is too long to be a Phosphor level code.');
    if (t.slice(0, 4) !== 'PH1.') fail('That is not a Phosphor level code. A code starts with PH1.');
    var body = t.slice(4), o = null;
    if (!/^[A-Za-z0-9+\/_=-]+$/.test(body)) fail('The code has characters that do not belong in it. Copy it again in full.');
    try { o = JSON.parse(fromB64(body)); } catch (e) { o = null; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) fail('The code is damaged or cut short. Copy it again in full.');
    if (o.v !== 1) fail('The code comes from a version this editor cannot read.');
    if (!isInt(o.w) || o.w < W_MIN || o.w > W_MAX) fail('A level must be ' + W_MIN + ' to ' + W_MAX + ' columns long.');
    var flat = unrle(o.g, o.w * ROWS), rows = [], r;
    for (r = 0; r < ROWS; r++) rows.push(flat.substr(r * o.w, o.w));
    return checkLevel({ name: o.n, song: o.s, pal: o.p, width: o.w, rows: rows });
  }

  /* ---------- storage: every access can throw when the host blocks it ---------- */
  function probeStore() {
    try { var k = 'phosphor.probe'; root.localStorage.setItem(k, '1'); root.localStorage.removeItem(k); return true; } catch (e) { return false; }
  }
  /* returns the saved levels (newest first), or null when storage cannot be read at all */
  function readStore() {
    var raw, arr, out = [], seen = {}, i, rec;
    try { raw = root.localStorage.getItem(STORE_KEY); } catch (e) { return null; }
    try { arr = JSON.parse(raw || '[]'); } catch (e2) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    for (i = 0; i < arr.length && out.length < MAX_SAVED; i++) {
      try { rec = checkLevel(arr[i]); } catch (e3) { continue; }
      if (!rec.id || seen[rec.id]) continue;
      seen[rec.id] = 1; out.push(rec);
    }
    out.sort(function (a, b) { return b.updated - a.updated; });
    return out;
  }
  function writeStore(list) {
    try { root.localStorage.setItem(STORE_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }
  var BLOCKED = 'This browser is blocking storage, so levels cannot be saved here. Copy code keeps a level instead.';

  function saveLevel() {
    commitName();
    var list = readStore(), rec = record(), i, at = -1;
    if (list === null) { say(BLOCKED, 'bad'); return false; }
    for (i = 0; i < list.length; i++) if (list[i].id === rec.id) at = i;
    if (at < 0 && list.length >= MAX_SAVED) { say('You already have ' + MAX_SAVED + ' saved levels. Delete one under Levels first.', 'bad'); return false; }
    if (at >= 0) list.splice(at, 1);
    list.unshift(rec);
    if (!writeStore(list)) { say(S.store ? 'Could not save: storage is full. Delete a level or use Copy code.' : BLOCKED, 'bad'); return false; }
    S.dirty = false; syncButtons();
    say('Saved "' + rec.name + '" in this browser.', 'ok');
    return true;
  }

  /* ---------- editing, undo, redo ---------- */
  function setRaw(x, y, t) {
    var cur = S.grid[y][x];
    if (cur === t) return;
    if (cur === 'c') S.cores--;
    if (t === 'c') S.cores++;
    S.grid[y][x] = t; S.stale = true;
  }
  function put(st, x, y, t) {
    if (x < 0 || x >= S.width || y < 0 || y >= ROWS) { st.out = true; if (x >= S.width) st.past = true; return false; }
    var cur = S.grid[y][x], key = x + ',' + y;
    if (cur === t) return false;
    if (t === 'c' && S.cores >= MAX_CORES) { st.full = true; return false; }
    if (!st.ch[key]) st.ch[key] = { x: x, y: y, b: cur };
    setRaw(x, y, t);
    return true;
  }
  function strokeTo(x, y) {
    var st = S.stroke, a = st.last, c;
    if (a && a.x === x && a.y === y) return;
    if (st.single) {                 // gates and cores: one per stroke, it follows the pointer
      if (st.lastKey) { c = st.ch[st.lastKey]; setRaw(c.x, c.y, c.b); delete st.ch[st.lastKey]; st.lastKey = null; }
      if (put(st, x, y, st.t)) st.lastKey = x + ',' + y;
    } else if (!a) put(st, x, y, st.t);
    else {                           // fill the cells between two pointer samples
      var dx = Math.abs(x - a.x), dy = Math.abs(y - a.y), sx = a.x < x ? 1 : -1, sy = a.y < y ? 1 : -1, err = dx - dy, px = a.x, py = a.y, n = 0, e2;
      while ((px !== x || py !== y) && n++ < 4000) {
        e2 = err * 2;
        if (e2 > -dy) { err -= dy; px += sx; }
        if (e2 < dx) { err += dx; py += sy; }
        put(st, px, py, st.t);
      }
    }
    st.last = { x: x, y: y };
  }
  function endStroke() {
    var st = S.stroke, list = [], k, c, now;
    S.stroke = null;
    if (!st || st.kind === 'pan') return;
    for (k in st.ch) { c = st.ch[k]; now = S.grid[c.y][c.x]; if (now !== c.b) list.push(c.x, c.y, c.b, now); }
    if (list.length) pushHist({ cells: list });
    if (st.full) say('A level holds ' + MAX_CORES + ' cores at most. Erase one to place another.', 'warn');
    else if (st.out && !list.length && st.kind === 'paint') say(st.past ? 'That is past the end of the level. More has a button to add columns.' : 'Tiles go in the ten rows above the ground.', 'warn');
  }
  function cancelStroke() {
    var st = S.stroke, k, c;
    S.stroke = null; S.pinch = null;
    if (!st || st.kind === 'pan') return;
    for (k in st.ch) { c = st.ch[k]; setRaw(c.x, c.y, c.b); }
  }

  function pushHist(e) {
    S.hist.push(e);
    if (S.hist.length > HIST) S.hist.shift();
    S.redo.length = 0;
    changed();
  }
  function applyEntry(e, fwd) {
    var i, l = e.cells;
    if (l) { for (i = 0; i < l.length; i += 4) S.grid[l[i + 1]][l[i]] = fwd ? l[i + 3] : l[i + 2]; }
    else { S.width = fwd ? e.w1 : e.w0; S.grid = gridOf(fwd ? e.r1 : e.r0); }
    S.cores = countCores(S.grid);
  }
  function undo() {
    cancelStroke();
    var e = S.hist.pop();
    if (!e) { say('Nothing to undo.'); return; }
    applyEntry(e, false); S.redo.push(e); changed();
  }
  function redo() {
    cancelStroke();
    var e = S.redo.pop();
    if (!e) { say('Nothing to redo.'); return; }
    applyEntry(e, true); S.hist.push(e); changed();
  }
  function changed() {
    S.stale = true; S.dirty = true; S.mark = null; S.lastVerify = null;
    if (S.sticky) clearMsg();
    checkWarn(); syncButtons(); note(); renderStatus();
  }

  /* whole-grid operations keep a before / after snapshot so they undo like a stroke */
  function reshape(w, fill) {
    var before = rowsOf(S.grid), w0 = S.width, g = blankGrid(w), y, x, n = Math.min(w, w0);
    cancelStroke();
    if (!fill) for (y = 0; y < ROWS; y++) for (x = 0; x < n; x++) g[y][x] = S.grid[y][x];
    S.grid = g; S.width = w; S.cores = countCores(g);
    pushHist({ w0: w0, r0: before, w1: w, r1: rowsOf(g) });
  }
  function lastUsed() {
    var last = -1, y, x, row;
    for (y = 0; y < ROWS; y++) { row = S.grid[y]; for (x = S.width - 1; x > last; x--) if (row[x] !== '.') { last = x; break; } }
    return last;
  }
  function grow() {
    if (S.width >= W_MAX) { say(W_MAX + ' columns is the longest a level can be.', 'warn'); return; }
    var w = Math.min(W_MAX, S.width + W_STEP);
    reshape(w, false);
    say('The level is now ' + w + ' columns long.', 'ok');
  }
  function trim() {
    var w = Math.max(W_MIN, Math.ceil((lastUsed() + 1 + RUNUP) / 4) * 4);
    if (w >= S.width) { say('Nothing to trim: the level already ends just after its last tile.'); return; }
    reshape(w, false);
    say('Trimmed to ' + w + ' columns. Undo brings the tail back.', 'ok');
  }
  function clearTiles() {
    if (lastUsed() < 0) { say('The level is already empty.'); return; }
    reshape(S.width, true);
    say('All tiles cleared. Undo brings them back.', 'ok');
  }

  function checkWarn() {
    var bad = false, y, x;
    for (y = 0; y < ROWS && !bad; y++) for (x = 0; x < RUNUP && x < S.width; x++) if (HAZ.indexOf(S.grid[y][x]) >= 0) { bad = true; break; }
    S.warn = bad ? 'Heads up: there are hazards in the first ' + RUNUP + ' columns. Keep them clear so every run gets a run-up.' : '';
  }

  /* ---------- status line: message, else warning, else the hint for the selected tool ---------- */
  function say(text, kind, sticky, ms) {
    S.msg = text; S.kind = kind || ''; S.sticky = !!sticky;
    root.clearTimeout(msgT);
    if (!sticky) msgT = root.setTimeout(clearMsg, ms || 4500);
    renderStatus();
  }
  function clearMsg() { root.clearTimeout(msgT); S.msg = ''; S.kind = ''; S.sticky = false; renderStatus(); }
  function renderStatus() {
    if (!el.status) return;
    var t = S.msg || S.warn || S.tool.hint, cls = 'ed-status' + (S.msg ? (S.kind ? ' ' + S.kind : '') : (S.warn ? ' warn' : ''));
    if (el.status.textContent !== t) el.status.textContent = t;
    if (el.status.className !== cls) el.status.className = cls;
  }

  /* ---------- form controls ---------- */
  function setOff(b, off) { b.setAttribute('aria-disabled', off ? 'true' : 'false'); }
  function syncButtons() {
    if (!el.undo) return;
    setOff(el.undo, !S.hist.length); setOff(el.redo, !S.redo.length);
    el.save.classList.toggle('ed-unsaved', S.dirty);
    el.save.title = S.dirty ? 'Save: there are unsaved changes' : 'Save in this browser';
  }
  function syncForm() {
    el.name.value = S.name; el.song.value = S.song; el.pal.value = String(S.pal);
  }
  function commitName() { S.name = cleanName(el.name.value); if (el.name.value !== S.name) el.name.value = S.name; }
  function note() {
    if (!el.len) return;
    var song = songOf(S.song) || SONGS[0], beats = S.width / 4, secs = Math.round(beats * 60 / song.bpm);
    el.len.textContent = S.width + ' columns = ' + beats + ' beats, about ' + secs + ' s at 1x speed. Cores placed: ' + S.cores + ' of ' + MAX_CORES + '.';
  }
  function applyPal() {
    var p = R.palette(S.pal), i, t;
    if (S.active) doc.documentElement.style.setProperty('--trace', 'rgb(' + p.trace.join(',') + ')');
    for (i = 0; i < TOOLS.length; i++) {
      t = TOOLS[i];
      if (t.cv) glyph(t.cv, t.t, p);
      else if (t.tagEl) t.tagEl.style.setProperty('--g', 'rgb(' + (GATE_COL[t.t] || p.acc).join(',') + ')');
    }
  }
  function setCursor() { cv.style.cursor = S.active ? (S.tool.id === 'pan' ? 'grab' : 'crosshair') : ''; }
  function selectTool(t) {
    S.tool = t; setCursor();
    for (var i = 0; i < TOOLS.length; i++) TOOLS[i].btn.setAttribute('aria-pressed', TOOLS[i] === t ? 'true' : 'false');
    say(t.hint, '', false, 7000);
  }
  function toolById(id) { for (var i = 0; i < TOOLS.length; i++) if (TOOLS[i].id === id) return TOOLS[i]; return null; }

  /* tile pictures for the tool strip, drawn like the renderer draws them */
  function glyph(c2, t, p) {
    var dpr = Math.min(root.devicePixelRatio || 1, 2), n = 28, u = 20, o = 4, k, a, r;
    c2.width = c2.height = Math.round(n * dpr);
    var c = c2.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, n, n);
    c.lineWidth = 1.5; c.lineJoin = 'round';
    function cell() { c.strokeStyle = rgba(p.trace, 0.22); c.lineWidth = 1; c.strokeRect(o + 0.5, o + 0.5, u - 1, u - 1); c.lineWidth = 1.5; }
    function tri(x1, y1, x2, y2, x3, y3) {
      c.beginPath(); c.moveTo(o + x1 * u, o + y1 * u); c.lineTo(o + x2 * u, o + y2 * u); c.lineTo(o + x3 * u, o + y3 * u); c.closePath();
      c.fillStyle = rgba(p.hot, 0.28); c.fill(); c.strokeStyle = rgba(p.hot, 1); c.stroke();
    }
    function box(y0, h) {
      c.fillStyle = rgba(p.trace, 0.18); c.fillRect(o, o + y0 * u, u, h * u);
      c.strokeStyle = rgba(p.trace, 1); c.strokeRect(o + 0.75, o + y0 * u + 0.75, u - 1.5, h * u - 1.5);
    }
    function star(teeth, ro, ri, spin) {
      c.beginPath();
      for (k = 0; k < teeth * 2; k++) {
        a = spin + k * Math.PI / teeth; r = (k % 2 ? ri : ro) * u;
        if (k) c.lineTo(n / 2 + Math.cos(a) * r, n / 2 + Math.sin(a) * r); else c.moveTo(n / 2 + Math.cos(a) * r, n / 2 + Math.sin(a) * r);
      }
      c.closePath(); c.fillStyle = rgba(p.hot, 0.28); c.fill(); c.strokeStyle = rgba(p.hot, 1); c.stroke();
    }
    function pad(up) {
      var by = up ? o + u : o, d = up ? -1 : 1;
      c.beginPath(); c.moveTo(o + u * 0.04, by); c.lineTo(o + u * 0.22, by + d * u * 0.26); c.lineTo(o + u * 0.78, by + d * u * 0.26); c.lineTo(o + u * 0.96, by); c.closePath();
      c.fillStyle = rgba(p.acc, 0.25); c.fill(); c.strokeStyle = rgba(p.acc, 1); c.stroke();
      c.beginPath();
      for (k = 0; k < 2; k++) { a = by + d * u * (0.5 + k * 0.3); c.moveTo(o + u * 0.3, a); c.lineTo(o + u * 0.5, a + d * u * 0.18); c.lineTo(o + u * 0.7, a); }
      c.stroke();
    }
    switch (t) {
      case '#':
        box(0, 1); c.beginPath(); c.moveTo(o, o + u); c.lineTo(o + u, o); c.moveTo(o, o + u * 0.5); c.lineTo(o + u * 0.5, o); c.moveTo(o + u * 0.5, o + u); c.lineTo(o + u, o + u * 0.5);
        c.lineWidth = 1; c.strokeStyle = rgba(p.trace, 0.35); c.stroke(); break;
      case '=': cell(); box(0, 0.5); break;
      case '-': cell(); box(0.5, 0.5); break;
      case '^': tri(0.1, 1, 0.5, 0.08, 0.9, 1); break;
      case 'v': tri(0.1, 0, 0.5, 0.92, 0.9, 0); break;
      case ',': cell(); tri(0.14, 1, 0.5, 0.56, 0.86, 1); break;
      case '`': cell(); tri(0.14, 0, 0.5, 0.44, 0.86, 0); break;
      case '>': tri(0, 0.1, 0.92, 0.5, 0, 0.9); break;
      case '<': tri(1, 0.1, 0.08, 0.5, 1, 0.9); break;
      case '*': star(10, 0.66, 0.48, 0.2); c.beginPath(); c.arc(n / 2, n / 2, u * 0.18, 0, 6.2832); c.stroke(); break;
      case 'x': cell(); star(4, 0.4, 0.17, 0.785); break;
      case 'o':
        c.beginPath(); c.arc(n / 2, n / 2, u * 0.28, 0, 6.2832); c.fillStyle = rgba(p.acc, 0.25); c.fill(); c.strokeStyle = rgba(p.acc, 1); c.stroke();
        c.beginPath(); c.arc(n / 2, n / 2, u * 0.52, 0, 6.2832); c.lineWidth = 1; c.strokeStyle = rgba(p.acc, 0.6); c.stroke(); break;
      case '_': pad(true); break;
      case '~': pad(false); break;
      case 'c':
        c.beginPath(); c.moveTo(n / 2, o + u * 0.06); c.lineTo(n / 2 + u * 0.34, n / 2); c.lineTo(n / 2, o + u * 0.94); c.lineTo(n / 2 - u * 0.34, n / 2); c.closePath();
        c.fillStyle = 'rgba(255,255,255,0.2)'; c.fill(); c.strokeStyle = '#ffffff'; c.stroke(); break;
    }
  }

  function buildTools() {
    var last = 0, box = el.tools;
    TOOLS.forEach(function (t) {
      if (t.grp !== last) { var s = doc.createElement('span'); s.className = 'ed-sep'; s.setAttribute('aria-hidden', 'true'); box.appendChild(s); last = t.grp; }
      var b = doc.createElement('button');
      b.type = 'button'; b.id = 'edTool-' + t.id; b.className = 'ed-tool'; b.title = t.name;
      b.setAttribute('aria-label', t.name); b.setAttribute('aria-pressed', t === S.tool ? 'true' : 'false'); b.setAttribute('data-tool', t.id);
      if (t.tag) { t.tagEl = doc.createElement('span'); t.tagEl.className = 'ed-gate'; t.tagEl.textContent = t.tag; b.appendChild(t.tagEl); }
      else if (t.t) { t.cv = doc.createElement('canvas'); t.cv.setAttribute('aria-hidden', 'true'); b.appendChild(t.cv); }
      else { b.className += ' ed-word'; b.textContent = t.name; }
      t.btn = b; box.appendChild(b);
    });
    box.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-tool]') : null, t = b && toolById(b.getAttribute('data-tool'));
      if (t) selectTool(t);
    });
    box.addEventListener('wheel', function (e) {       // a plain mouse wheel scrolls the strip sideways
      if (box.scrollWidth <= box.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault(); box.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 32 : 1);
    }, { passive: false });
  }
  function fillSelects() {
    SONGS.forEach(function (s) { var o = doc.createElement('option'); o.value = s.id; o.textContent = s.name + ' / ' + s.bpm + ' BPM'; el.song.appendChild(o); });
    PAL_NAMES.forEach(function (n, i) { var o = doc.createElement('option'); o.value = String(i); o.textContent = n; el.pal.appendChild(o); });
  }
  /* wide screens carry the secondary controls in the top bar; narrower ones fold them into More */
  function place() {
    var wide = !!(mqWide && mqWide.matches);
    el.moreFields.hidden = wide;
    if (wide) {
      el.row1.insertBefore(el.songField, el.moreBtn); el.row1.insertBefore(el.palField, el.moreBtn);
      el.row2.insertBefore(el.practice, el.verify); el.row2.appendChild(el.levels);
    } else {
      el.moreFields.appendChild(el.songField); el.moreFields.appendChild(el.palField);
      el.moreActs.insertBefore(el.levels, el.moreActs.firstChild); el.moreActs.insertBefore(el.practice, el.levels);
    }
  }

  /* ---------- panels ---------- */
  var armBtn = null, armLabel = '', armT = 0, armNote = null, armText = '';
  function disarm() {
    root.clearTimeout(armT);
    if (armBtn) { armBtn.textContent = armLabel; armBtn.classList.remove('ed-armed'); }
    if (armNote) armNote.textContent = armText;
    armBtn = null; armNote = null;
  }
  /* two-step confirm built into the page: the first press turns the button into Confirm and says why
     in noteEl, the second press within 4 s acts. Anything else puts it back. */
  function confirmTap(btn, noteEl, why, fn) {
    if (armBtn === btn) { armNote = null; disarm(); fn(); return; }
    disarm();
    armBtn = btn; armLabel = btn.textContent; btn.textContent = 'Confirm'; btn.classList.add('ed-armed');
    armNote = noteEl; armText = noteEl.textContent; noteEl.textContent = why;
    armT = root.setTimeout(disarm, 4000);
  }
  function panelEl(name) { return name === 'more' ? el.more : (name === 'levels' ? el.levelsPanel : el.codePanel); }
  function openPanel(name, focusEl) {
    var opener = S.panel ? S.opener : doc.activeElement;
    closePanel(true);
    S.panel = name; S.opener = opener;
    cancelStroke(); S.hover = null;
    var p = panelEl(name);
    if (name === 'more') {
      el.more.style.maxHeight = Math.max(160, el.root.clientHeight - el.bar.offsetHeight - 6) + 'px';
      el.moreBtn.setAttribute('aria-expanded', 'true');
    }
    el.shade.hidden = false; p.hidden = false;
    el.bar.inert = true; el.bottom.inert = true;
    var f = focusEl || p;                    // the panel itself takes focus; Tab then walks its controls
    if (f === p) p.tabIndex = -1;
    if (f.focus) f.focus({ preventScroll: true });
  }
  function closePanel(quiet) {
    if (!S.panel) return;
    disarm();
    panelEl(S.panel).hidden = true; el.shade.hidden = true;
    el.moreBtn.setAttribute('aria-expanded', 'false');
    el.bar.inert = false; el.bottom.inert = false;
    var o = S.opener;
    S.panel = null; S.opener = null;
    if (!quiet && o && o.focus && doc.contains(o)) o.focus({ preventScroll: true });
  }

  function stamp(ms) {
    if (!ms) return '';
    try { return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch (e) { return ''; }
  }
  function buildList() {
    disarm();
    var list = readStore(), box = el.list;
    box.textContent = '';
    if (list === null) { el.levelsInfo.textContent = BLOCKED; return; }
    el.levelsInfo.textContent = list.length
      ? list.length + (list.length === 1 ? ' level' : ' levels') + ' saved in this browser. Copy code moves a level to another device.'
      : 'Nothing saved yet. Save keeps the open level in this browser. Copy code moves it to another device.';
    list.forEach(function (rec) {
      var li = doc.createElement('li'), head = doc.createElement('div'), b = doc.createElement('b'), meta = doc.createElement('span'), row = doc.createElement('div');
      var song = songOf(rec.song), when = stamp(rec.updated);
      li.className = 'ed-item'; row.className = 'rowb';
      b.textContent = rec.name;
      meta.textContent = (rec.id === S.id ? 'Open now / ' : '') + song.name + ' / ' + rec.width + ' columns' + (when ? ' / ' + when : '');
      head.appendChild(b); head.appendChild(meta); li.appendChild(head);
      [['load', 'Load', 'edLoad-'], ['dup', 'Duplicate', 'edDup-'], ['del', 'Delete', 'edDel-']].forEach(function (a) {
        var btn = doc.createElement('button');
        btn.type = 'button'; btn.id = a[2] + rec.id; btn.textContent = a[1];
        btn.setAttribute('data-act', a[0]); btn.setAttribute('data-id', rec.id);
        btn.setAttribute('aria-label', a[1] + ' ' + rec.name);
        if (a[0] === 'del') btn.className = 'danger';
        row.appendChild(btn);
      });
      li.appendChild(row); box.appendChild(li);
    });
  }
  function onListClick(e) {
    var btn = e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!btn) return;
    var act = btn.getAttribute('data-act'), id = btn.getAttribute('data-id'), list = readStore(), i, rec = null, at = -1, taken = {};
    if (list === null) { el.levelsInfo.textContent = BLOCKED; return; }
    for (i = 0; i < list.length; i++) { taken[list[i].id] = 1; if (list[i].id === id) { rec = list[i]; at = i; } }
    if (!rec) { buildList(); return; }
    if (act === 'load') {
      var go = function () { loadRecord(rec, false); closePanel(); say('Loaded "' + rec.name + '".', 'ok'); };
      if (S.dirty) confirmTap(btn, el.levelsInfo, 'The open level has unsaved changes. Confirm drops them and loads "' + rec.name + '".', go); else go();
    } else if (act === 'dup') {
      if (list.length >= MAX_SAVED) { el.levelsInfo.textContent = 'You already have ' + MAX_SAVED + ' saved levels. Delete one first.'; return; }
      var copy = { id: newId(taken), name: cleanName(rec.name.slice(0, NAME_MAX - 5) + ' copy'), song: rec.song, pal: rec.pal, width: rec.width, rows: rec.rows, updated: Date.now() };
      list.unshift(copy);
      if (writeStore(list)) { buildList(); el.levelsInfo.textContent = 'Made "' + copy.name + '".'; var nb = $('edLoad-' + copy.id); if (nb) nb.focus({ preventScroll: true }); }
      else el.levelsInfo.textContent = 'Could not duplicate: storage is full or blocked.';
    } else if (act === 'del') {
      confirmTap(btn, el.levelsInfo, 'Delete "' + rec.name + '" for good? Press Confirm.', function () {
        list.splice(at, 1);
        if (!writeStore(list)) { el.levelsInfo.textContent = 'Could not delete: storage is blocked.'; return; }
        if (rec.id === S.id) { S.dirty = true; syncButtons(); }
        buildList(); el.levelsInfo.textContent = 'Deleted "' + rec.name + '".';
        el.newBtn.focus({ preventScroll: true });
      });
    }
  }

  function showCode(mode, code) {
    var paste = mode === 'paste';
    el.codeTitle.textContent = paste ? 'Paste a level code' : 'Level code';
    el.codeInfo.textContent = paste
      ? 'Paste a code that starts with PH1. and press Import. It replaces the level that is open.'
      : 'Copying was blocked here. The code is selected below: copy it by hand.';
    el.codeText.readOnly = !paste; el.codeText.value = paste ? '' : code;
    el.codeMsg.textContent = ''; el.importBtn.hidden = !paste;
    openPanel('code', el.codeText);
    if (!paste) { try { el.codeText.select(); el.codeText.setSelectionRange(0, code.length); } catch (e) { /* selection is a convenience */ } }
  }
  function copyCode() {
    commitName();
    var code = encode(record());
    closePanel();
    function done() { say('Level code copied: ' + code.length + ' characters. Paste it anywhere to share the level.', 'ok'); }
    function manual() { showCode('copy', code); }
    try {
      if (root.navigator.clipboard && root.navigator.clipboard.writeText) root.navigator.clipboard.writeText(code).then(done, manual);
      else manual();
    } catch (e) { manual(); }
  }
  function importCode() {
    var rec;
    try { rec = decode(el.codeText.value); }
    catch (e) { disarm(); el.codeMsg.textContent = e.friendly ? e.message : 'The code could not be read. Copy it again in full.'; return; }
    if (armBtn !== el.importBtn) el.codeMsg.textContent = '';
    var go = function () {
      rec.id = newId(); loadRecord(rec, true); closePanel();
      say('Imported "' + rec.name + '". Save keeps it in this browser.', 'ok');
    };
    if (S.dirty) confirmTap(el.importBtn, el.codeMsg, 'The open level has unsaved changes. Confirm replaces it.', go); else go();
  }

  /* ---------- test play and the bot ---------- */
  function onEnter() {
    S.active = true; S.snap = true; S.stroke = null; S.pinch = null; S.ptrs = {}; S.nptr = 0; S.hover = null;
    V.statusMin = -1;
    place(); applyPal(); renderStatus(); syncButtons(); setCursor();
  }
  function open() {
    if (!S.ready) return;
    PG.enterEditor();
    onEnter();
  }
  function leave() { closePanel(true); cancelStroke(); S.active = false; S.hover = null; setCursor(); }
  function exit() { leave(); PG.exitEditor(); }
  function play(practice) {
    commitName();
    var def = makeDef();
    leave();
    if (!PG.playCustom(def, { practice: !!practice, onExit: open })) { onEnter(); say('This level could not be started.', 'bad'); }
  }
  function centerOn(x) { S.camX = x - (V.W * 0.5 - V.px0) / V.B; clampCam(); }
  function verify() {
    if (S.busy) return;
    if (!root.PSolver) { say('The bot is not part of this build.', 'bad'); return; }
    commitName();
    S.busy = true; el.verify.setAttribute('aria-busy', 'true');
    say('Checking...', '', true);
    root.setTimeout(function () {              // give the label a frame to paint: the search blocks the page
      var msg, kind = 'ok', res = null;
      try {
        var def = makeDef(), L = E.compile(def), r = root.PSolver.solve(L, { margin: 0.1, limit: SOLVE_LIMIT });
        if (r.ok) {
          var slack = root.PSolver.solve(E.compile(def), { margin: 0.3, limit: SOLVE_LIMIT }).ok ? 'comfortable' : 'tight';
          msg = 'Beatable. Timing slack: ' + slack + '.'; res = { ok: true, slack: slack }; S.mark = null;
        } else {
          var pct = clamp(Math.floor(100 * r.best / L.endX), 0, 99);
          res = { ok: false, pct: pct, x: r.best };
          if (r.nodes > SOLVE_LIMIT) { msg = 'The bot ran out of search time at ' + pct + '%, so this level is unproven. Test it by hand.'; kind = 'warn'; res.unproven = true; }
          else if (root.PSolver.solve(E.compile(def), { margin: 0, limit: SOLVE_LIMIT }).ok) { msg = 'Beatable, but only with near-perfect timing. The tight spot is at ' + pct + '%.'; kind = 'warn'; res.ok = true; res.slack = 'none'; }
          else { msg = 'The bot gets stuck at ' + pct + '%.'; kind = 'bad'; }
          S.mark = { x: r.best, label: res.ok ? 'TIGHT SPOT' : (res.unproven ? 'BOT STOPPED' : 'BOT STUCK') };
          centerOn(r.best);
        }
      } catch (e) { msg = 'This level could not be checked: ' + e.message; kind = 'bad'; }
      S.busy = false; el.verify.removeAttribute('aria-busy');
      S.lastVerify = res;
      say(msg, kind, true);
    }, 60);
  }

  /* ---------- camera ---------- */
  /* returns true when the camera had to move */
  function clampCam() {
    var x0 = S.camX, y0 = S.camY, B = V.B || 40;
    V.minX = V.px0 / B - 1.5;
    V.maxX = Math.max(V.minX, S.width + 1.5 - (V.W - V.px0) / B);
    V.lo = (V.bot - 18 - V.baseY) / B;                 // ground line just above the bottom bar
    V.hi = ROWS + (V.top + 6 - V.baseY) / B;           // top row just below the top bar
    V.panY = V.lo < V.hi - 0.02;
    if (!S.camInit) { S.camX = V.minX; S.camY = V.lo; S.camInit = true; }
    S.camX = clamp(S.camX, V.minX, V.maxX);
    S.camY = V.panY ? clamp(S.camY, V.lo, V.hi) : clamp(0, V.hi, V.lo);
    return Math.abs(S.camX - x0) > 1e-6 || Math.abs(S.camY - y0) > 1e-6;
  }
  function measure() {
    var v = R.view, o = R.toScreen(S.camX, S.camY);
    V.W = v.W; V.H = v.H; V.B = v.B; V.px0 = o.x; V.baseY = o.y;
    if (V.statusMin < 0) V.statusMin = parseFloat(root.getComputedStyle(el.status).minHeight) || 0;
    V.top = el.bar.getBoundingClientRect().bottom;
    // a message that wraps past the reserved lines grows the bar upwards; ignore that so the view holds still
    V.bot = el.bottom.getBoundingClientRect().top + Math.max(0, el.status.offsetHeight - V.statusMin);
  }
  function panBy(dx, dy) { S.camX += dx; S.camY += dy; clampCam(); }
  function flipView() { S.camY = S.camY - V.lo < (V.hi - V.lo) / 2 ? V.hi : V.lo; clampCam(); }
  function syncNav() {
    var span = Math.max(0, Math.ceil(V.maxX - V.minX)), val = clamp(Math.round(S.camX - V.minX), 0, span), sc2 = el.scrub;
    if (+sc2.max !== Math.max(1, span)) sc2.max = String(Math.max(1, span));
    if (sc2.disabled !== (span === 0)) sc2.disabled = span === 0;
    if (+sc2.value !== val) sc2.value = String(val);
    var a = clamp(Math.floor(S.camX - V.px0 / V.B + 0.5), 0, S.width), b = clamp(Math.floor(S.camX + (V.W - V.px0) / V.B), 0, S.width);
    var txt = 'Col ' + a + '-' + b + ' / ' + S.width;
    if (el.pos.textContent !== txt) el.pos.textContent = txt;
    if (el.view.hidden === V.panY) el.view.hidden = !V.panY;
    var up = S.camY - V.lo < (V.hi - V.lo) / 2, lab = up ? 'Show the upper rows' : 'Show the lower rows';
    if (el.view.getAttribute('aria-label') !== lab) el.view.setAttribute('aria-label', lab);
  }

  /* ---------- drawing ---------- */
  function frame(dt) {
    if (!S.ready) return;
    if (!S.active) onEnter();
    if (S.stale || !S.L) {
      try { S.L = E.compile(makeDef()); } catch (e) { if (!S.L) S.L = E.compile({ id: 'x', name: '', bpm: 120, song: 'trace', chunks: [['.']] }); }
      S.stale = false;
    }
    var song = songOf(S.song) || SONGS[0];
    if (!reduced) S.beat += dt * song.bpm / 60;
    sc.L = S.L; sc.dt = dt; sc.beat = S.beat; sc.pal = S.pal; sc.snap = S.snap; S.snap = false;
    sc.camX = S.camX; sc.camY = S.camY;
    R.draw(sc);
    measure();
    if (clampCam()) { sc.camX = S.camX; sc.camY = S.camY; R.draw(sc); }
    overlay();
    syncNav();
  }

  function overlay() {
    var c = R.ctx(), B = V.B, p = R.palette(S.pal), tr = p.trace, i, x, y, t;
    var wl = R.toWorld(0, 0).x, wr = R.toWorld(V.W, 0).x;
    var c0 = Math.max(0, Math.floor(wl)), c1 = Math.min(S.width, Math.ceil(wr));
    var g0 = R.toScreen(0, 0), g1 = R.toScreen(S.width, ROWS);          // g0 = left / ground, g1 = right / top
    function X(wx) { return g0.x + wx * B; }
    function Y(wy) { return g0.y - wy * B; }
    c.save();
    c.setLineDash([]); c.globalAlpha = 1; c.lineCap = 'butt'; c.lineJoin = 'miter';

    // everything past the end is out of bounds
    if (g1.x < V.W) { c.fillStyle = 'rgba(0,0,0,0.42)'; c.fillRect(g1.x, 0, V.W - g1.x, V.H); }

    // cell grid, with a stronger line on every beat (4 columns at 1x)
    var xa = Math.max(-1, X(c0)), xb = Math.min(V.W + 1, X(c1));
    c.beginPath();
    for (i = c0; i <= c1; i++) if (i % 4) { x = Math.round(X(i)) + 0.5; c.moveTo(x, g1.y); c.lineTo(x, g0.y); }
    for (y = 1; y < ROWS; y++) { t = Math.round(Y(y)) + 0.5; c.moveTo(xa, t); c.lineTo(xb, t); }
    c.lineWidth = 1; c.strokeStyle = rgba(tr, 0.1); c.stroke();
    c.beginPath();
    for (i = c0 + ((4 - c0 % 4) % 4); i <= c1; i += 4) { x = Math.round(X(i)) + 0.5; c.moveTo(x, g1.y); c.lineTo(x, g0.y); }
    c.strokeStyle = rgba(tr, 0.24); c.stroke();
    c.beginPath(); t = Math.round(g1.y) + 0.5; c.moveTo(xa, t); c.lineTo(xb, t);
    c.strokeStyle = rgba(tr, 0.5); c.stroke();

    // column numbers under the ground line
    c.font = '10px ' + FONT; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillStyle = rgba(tr, 0.75);
    var stepN = B >= 26 ? 8 : 16;
    for (i = Math.ceil(c0 / stepN) * stepN; i <= c1; i += stepN) c.fillText(String(i), X(i) + 3, g0.y + 4);

    // run-up zone and the spot where every run starts
    if (c0 < RUNUP) {
      c.setLineDash([3, 5]); c.beginPath(); x = Math.round(X(RUNUP)) + 0.5; c.moveTo(x, g1.y); c.lineTo(x, g0.y);
      c.strokeStyle = rgba(S.warn ? p.hot : p.acc, 0.6); c.stroke(); c.setLineDash([]);
      c.textBaseline = 'bottom'; c.fillStyle = rgba(S.warn ? p.hot : p.acc, 0.8);
      c.fillText('RUN-UP', X(1.2), g0.y - 4);
    }
    if (wl < 1) {
      c.setLineDash([4, 3]); c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,255,255,0.8)';
      c.strokeRect(X(-0.5) + 2, Y(1) + 2, B - 4, B - 4); c.setLineDash([]); c.lineWidth = 1;
      c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillStyle = 'rgba(255,255,255,0.85)';
      c.fillText('START', X(0), Y(1) - 3);
    }
    if (g1.x < V.W - 30) { c.textAlign = 'left'; c.textBaseline = 'top'; c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillText('END', g1.x + 6, g1.y + 4); }

    // flying corridors: FLY and ZIG keep the player between these two lines until the next mode gate
    var gs = S.L ? S.L.gates : [], j, xe, fl;
    c.lineWidth = 1.5; c.setLineDash([7, 5]); c.strokeStyle = rgba(p.acc, 0.6);
    for (i = 0; i < gs.length; i++) {
      if (gs[i].k !== 'G' && gs[i].k !== 'Z') continue;
      xe = S.width;
      for (j = i + 1; j < gs.length; j++) if ('HGZ'.indexOf(gs[j].k) >= 0) { xe = gs[j].x; break; }
      if (xe < wl || gs[i].x > wr) continue;
      fl = gs[i].floor;
      c.beginPath(); c.moveTo(X(gs[i].x), Y(fl + 9)); c.lineTo(X(xe), Y(fl + 9));
      if (fl > 0) { c.moveTo(X(gs[i].x), Y(fl)); c.lineTo(X(xe), Y(fl)); }
      c.stroke();
    }
    c.setLineDash([]);

    // where the bot gave up
    if (S.mark && S.mark.x >= wl - 1 && S.mark.x <= wr + 1) {
      x = X(S.mark.x);
      c.beginPath(); c.moveTo(x, g1.y); c.lineTo(x, g0.y); c.lineWidth = 2; c.setLineDash([6, 4]); c.strokeStyle = rgba(p.hot, 1); c.stroke(); c.setLineDash([]);
      c.font = '11px ' + FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
      t = c.measureText(S.mark.label).width + 12; y = clamp(Y(ROWS - 0.5), V.top + 14, g0.y - 14);
      c.fillStyle = 'rgba(0,0,0,0.85)'; c.fillRect(x - t / 2, y - 9, t, 18);
      c.lineWidth = 1; c.strokeRect(x - t / 2 + 0.5, y - 8.5, t - 1, 17);
      c.fillStyle = rgba(p.hot, 1); c.fillText(S.mark.label, x, y + 1);
    }

    // the cell under the mouse
    var h = S.hover, tool = S.tool;
    if (h && !S.panel && tool.id !== 'pan' && !(S.stroke && S.stroke.kind === 'pan')) {
      var w = R.toWorld(h.x, h.y), hx = Math.floor(w.x), hy = Math.floor(w.y);
      if (hx >= 0 && hx < S.width && hy >= 0 && hy < ROWS && h.y > V.top && h.y < V.bot) {
        var hc = tool.id === 'erase' ? p.hot : p.acc;
        if (tool.t && GATES.indexOf(tool.t) >= 0) {
          c.fillStyle = rgba(hc, 0.1); c.fillRect(X(hx), g1.y, B, g0.y - g1.y);
          if (tool.t === 'G' || tool.t === 'Z') {
            fl = Math.max(0, hy - 4);
            c.setLineDash([7, 5]); c.lineWidth = 1.5; c.strokeStyle = rgba(hc, 0.9);
            c.beginPath(); c.moveTo(X(hx + 0.5), Y(fl + 9)); c.lineTo(X(hx + 8.5), Y(fl + 9)); c.moveTo(X(hx + 0.5), Y(fl)); c.lineTo(X(hx + 8.5), Y(fl)); c.stroke();
            c.setLineDash([]);
          }
        }
        c.lineWidth = 2; c.strokeStyle = rgba(hc, 0.95); c.strokeRect(X(hx) + 1, Y(hy + 1) + 1, B - 2, B - 2);
      }
    }
    c.restore();
  }

  /* ---------- pointer, wheel and keys on the scope ---------- */
  function pt(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function cellAt(p) { var w = R.toWorld(p.x, p.y); return { x: Math.floor(w.x), y: Math.floor(w.y) }; }
  function centroid() {
    var n = 0, x = 0, y = 0, k;
    for (k in S.ptrs) { x += S.ptrs[k].x; y += S.ptrs[k].y; n++; }
    return { x: x / (n || 1), y: y / (n || 1) };
  }
  function onDown(e) {
    if (!S.active || S.panel) return;
    e.preventDefault();
    var a = doc.activeElement, p = pt(e), c;
    if (a && a !== cv && a !== doc.body && a.blur) a.blur();
    if (!S.ptrs[e.pointerId]) S.nptr++;
    S.ptrs[e.pointerId] = p;
    if (S.nptr >= 2) {                     // a second finger: drop the stroke and pan with both
      cancelStroke();
      S.pinch = { c: centroid(), x: S.camX, y: S.camY };
      return;
    }
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    var tool = S.tool, kind = tool.id === 'pan' || e.button === 1 ? 'pan' : (tool.id === 'erase' || e.button === 2 ? 'erase' : 'paint');
    S.hover = e.pointerType === 'touch' ? null : p;
    S.stroke = { kind: kind, pid: e.pointerId, t: kind === 'paint' ? tool.t : '.', single: kind === 'paint' && !!tool.single, ch: {}, last: null, lastKey: null, p0: p, cx: S.camX, cy: S.camY, out: false, past: false, full: false };
    if (kind !== 'pan') { c = cellAt(p); strokeTo(c.x, c.y); }
  }
  function onMove(e) {
    if (!S.active) return;
    var p = pt(e), st = S.stroke, c;
    if (e.pointerType !== 'touch') S.hover = p;
    if (!S.ptrs[e.pointerId]) return;
    S.ptrs[e.pointerId] = p;
    if (S.pinch) { c = centroid(); S.camX = S.pinch.x - (c.x - S.pinch.c.x) / V.B; S.camY = S.pinch.y + (c.y - S.pinch.c.y) / V.B; clampCam(); return; }
    if (!st || st.pid !== e.pointerId) return;
    if (st.kind === 'pan') { S.camX = st.cx - (p.x - st.p0.x) / V.B; S.camY = st.cy + (p.y - st.p0.y) / V.B; clampCam(); }
    else { c = cellAt(p); strokeTo(c.x, c.y); }
  }
  function onUp(e) {
    if (!S.ptrs[e.pointerId]) return;
    delete S.ptrs[e.pointerId]; S.nptr = Math.max(0, S.nptr - 1);
    if (S.pinch) S.pinch = S.nptr >= 2 ? { c: centroid(), x: S.camX, y: S.camY } : null;
    if (S.stroke && S.stroke.pid === e.pointerId) endStroke();
  }
  function onWheel(e) {
    if (!S.active || S.panel) return;
    e.preventDefault();
    var unit = e.deltaMode === 1 ? 32 : (e.deltaMode === 2 ? V.W : 1), dx = e.deltaX * unit, dy = e.deltaY * unit;
    var d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    if (e.shiftKey) panBy(0, -d / V.B); else panBy(d / V.B, 0);
  }
  function onKey(e) {
    if (!S.active) return;
    var k = e.code, tag = e.target && e.target.tagName, typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (k === 'Escape') { if (S.panel) { e.preventDefault(); closePanel(); } else if (typing && e.target.blur) e.target.blur(); return; }
    if (S.panel) return;
    if (k === 'Enter' && e.target === el.name) { el.name.blur(); return; }
    if (typing) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.altKey) return;
      if (k === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (k === 'KeyY') { e.preventDefault(); redo(); }
      else if (k === 'KeyS') { e.preventDefault(); saveLevel(); }
      return;
    }
    if (e.altKey) return;
    var step = e.shiftKey ? 8 : 2;
    if (k === 'ArrowLeft') { e.preventDefault(); panBy(-step, 0); }
    else if (k === 'ArrowRight') { e.preventDefault(); panBy(step, 0); }
    else if (k === 'ArrowUp') { e.preventDefault(); panBy(0, 1); }
    else if (k === 'ArrowDown') { e.preventDefault(); panBy(0, -1); }
    else if (k === 'Home') { e.preventDefault(); panBy(-1e6, 0); }
    else if (k === 'End') { e.preventDefault(); panBy(1e6, 0); }
    else if (k === 'KeyE' && !e.repeat) selectTool(toolById('erase'));
  }

  function wire() {
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('lostpointercapture', onUp);
    cv.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') S.hover = null; });
    cv.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('keydown', onKey);
    root.addEventListener('blur', function () { if (S.active) { cancelStroke(); S.ptrs = {}; S.nptr = 0; S.hover = null; } });

    function click(node, fn) { node.addEventListener('click', function () { if (node.getAttribute('aria-disabled') !== 'true') fn(); }); }
    click(el.exit, exit);
    click(el.undo, undo);
    click(el.redo, redo);
    click(el.test, function () { play(false); });
    click(el.practice, function () { play(true); });
    click(el.verify, function () { closePanel(true); verify(); });
    click(el.save, saveLevel);
    click(el.levels, function () { buildList(); openPanel('levels', el.levelsClose); });
    click(el.moreBtn, function () { if (S.panel === 'more') closePanel(); else { note(); openPanel('more'); } });
    click(el.copy, copyCode);
    click(el.paste, function () { showCode('paste', ''); });
    click(el.grow, function () { closePanel(); grow(); });
    click(el.trim, function () { closePanel(); trim(); });
    click(el.clear, function () { closePanel(); clearTiles(); });
    click(el.view, flipView);
    click(el.shade, function () { closePanel(); });
    click(el.levelsClose, function () { closePanel(); });
    click(el.codeClose, function () { closePanel(); });
    click(el.importBtn, importCode);
    click(el.newBtn, function () {
      var go = function () { newLevel(); closePanel(); say('New level. The tiles are an example: paint over them or use Clear tiles under More.', 'ok', false, 7000); };
      if (S.dirty) confirmTap(el.newBtn, el.levelsInfo, 'The open level has unsaved changes. Confirm drops them.', go); else go();
    });
    el.list.addEventListener('click', onListClick);

    el.name.addEventListener('input', function () { S.name = el.name.value; if (!S.dirty) { S.dirty = true; syncButtons(); } });
    el.name.addEventListener('change', commitName);
    el.song.addEventListener('change', function () {
      if (!songOf(el.song.value)) { el.song.value = S.song; return; }
      S.song = el.song.value; S.dirty = true; S.stale = true; syncButtons(); note();
      var s = songOf(S.song); say('Song: ' + s.name + ', ' + s.bpm + ' BPM. The level plays faster or slower, its layout stays the same.', 'ok');
    });
    el.pal.addEventListener('change', function () {
      var v = parseInt(el.pal.value, 10);
      if (!(v >= 0 && v < PAL_NAMES.length)) { el.pal.value = String(S.pal); return; }
      S.pal = v; S.dirty = true; S.stale = true; applyPal(); syncButtons();
    });
    el.scrub.addEventListener('input', function () { S.camX = V.minX + (+el.scrub.value); clampCam(); });

    if (mqWide) {
      var onMq = function () { closePanel(true); place(); };
      if (mqWide.addEventListener) mqWide.addEventListener('change', onMq); else if (mqWide.addListener) mqWide.addListener(onMq);
    }
    root.addEventListener('resize', function () { V.statusMin = -1; if (S.panel === 'more') closePanel(true); });
  }

  function init() {
    if (S.ready) return;
    PG = root.PGame; E = root.PEngine; R = root.PRender;
    if (!PG || !E || !R || !$('editor') || !$('scope')) return;
    cv = $('scope');
    el = {
      root: $('editor'), bar: $('edBar'), row1: $('edRow1'), row2: $('edRow2'), exit: $('edExit'), name: $('edName'), moreBtn: $('edMoreBtn'),
      undo: $('edUndo'), redo: $('edRedo'), test: $('edTest'), verify: $('edVerify'), save: $('edSave'),
      more: $('edMore'), moreFields: $('edMoreFields'), moreActs: $('edMoreActs'), songField: $('edSongField'), palField: $('edPalField'),
      song: $('edSong'), pal: $('edPal'), practice: $('edPractice'), levels: $('edLevels'), copy: $('edCopy'), paste: $('edPaste'),
      grow: $('edGrow'), trim: $('edTrim'), clear: $('edClear'), len: $('edLen'),
      bottom: $('edBottom'), status: $('edStatus'), pos: $('edPos'), scrub: $('edScrub'), tools: $('edTools'), view: $('edView'),
      shade: $('edShade'), levelsPanel: $('edLevelsPanel'), levelsInfo: $('edLevelsInfo'), list: $('edList'), newBtn: $('edNew'), levelsClose: $('edLevelsClose'),
      codePanel: $('edCodePanel'), codeTitle: $('edCodeTitle'), codeInfo: $('edCodeInfo'), codeText: $('edCodeText'), codeMsg: $('edCodeMsg'),
      importBtn: $('edImport'), codeClose: $('edCodeClose')
    };
    sc = {
      editor: true, hidePlayer: true, L: null, s: E.newState(), dt: 0, beat: 0, pulse: 0, x: 0, y: 0.5, rot: 0,
      used: {}, coins: 0, owned: 0, cps: null, shake: 0, flash: 0, flashCol: 0, trail: [], parts: [], skin: 0, tint: 0, pal: 0, snap: true, camX: 0, camY: 0
    };
    try {
      reduced = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
      mqWide = root.matchMedia ? root.matchMedia('(min-width: 1280px)') : null;
    } catch (e) { mqWide = null; }
    S.store = probeStore();
    readSongs();
    buildTools(); fillSelects();
    S.ready = true;
    newLevel();
    wire(); place();
    var btn = $('btnEditor');
    if (btn) { btn.hidden = false; btn.addEventListener('click', open); }
  }

  root.PEditor = {
    init: init, frame: frame, open: open,
    /* read-only views of the editor, used by tools/editor-test.js */
    state: function () {
      return { active: S.active, id: S.id, name: S.name, song: S.song, pal: S.pal, width: S.width, cores: S.cores, dirty: S.dirty, tool: S.tool.id,
        undo: S.hist.length, redo: S.redo.length, camX: S.camX, camY: S.camY, panY: V.panY, panel: S.panel, warn: S.warn, verify: S.lastVerify, store: S.store };
    },
    cell: function (x, y) { return S.grid[y] ? S.grid[y][x] : undefined; },
    def: makeDef, code: function () { return encode(record()); }, decode: decode
  };
  if (root.PGame) init();
})(window);
