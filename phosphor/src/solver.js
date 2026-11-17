/* Phosphor solver: searches the input space with the real engine to prove a level can be beaten.
   margin > 0 inflates hazards and shrinks ledges, so a pass means a human has timing slack.
   needCoins is a bit mask of cores that must be collected on the winning run. */
(function (root) {
  'use strict';
  var E = typeof require === 'function' && typeof module !== 'undefined' ? require('./engine.js') : root.PEngine;
  var C = E.C;

  function key(s) {
    var yq = Math.round((s.y + 4) * 32);               // < 2048
    var vq = Math.round((s.vy + 12) * 8);              // < 256
    var k = yq;
    k = k * 256 + vq;
    k = k * 4 + s.mode;
    k = k * 2 + (s.grav === 1 ? 1 : 0);
    k = k * 2 + (s.grounded ? 1 : 0);
    k = k * 2 + (s.hold ? 1 : 0);
    k = k * 2 + (s.buf ? 1 : 0);
    k = k * 8 + (s.coins & 7);
    k = k * 8 + ((s.last + 1) & 7);
    return k;
  }

  function solve(L, opts) {
    opts = opts || {};
    var DEC = opts.dec || 4;
    var needCoins = opts.needCoins || 0;
    L.margin = opts.margin || 0;
    var visited = [];
    // a needed core that is already behind the player can never be collected: prune those branches early
    var need = L.objs.filter(o => o.t === 'c' && (o.bit & needCoins)).map(o => ({ bit: o.bit, x: o.x + 2.2 }));
    var stack = [{ s: E.newState(), a: 0, first: false, act: false }];
    var best = 0, bestState = null, nodes = 0;
    var limit = opts.limit || 4e7;
    while (stack.length) {
      var f = stack[stack.length - 1];
      if (f.a >= 2) { stack.pop(); continue; }
      var hold = f.a === 0 ? f.first : !f.first;
      f.a++;
      var s = E.copy(f.s);
      for (var i = 0; i < DEC && !s.dead && !s.done; i++) E.step(L, s, hold, null);
      nodes++;
      if (s.x > best) { best = s.x; bestState = E.copy(s); }
      if (s.done) {
        if ((s.coins & needCoins) !== needCoins) continue;
        var acts = [];
        for (var i = 1; i < stack.length; i++) acts.push(stack[i].act);
        acts.push(hold);
        L.margin = 0;
        return { ok: true, acts: acts, dec: DEC, nodes: nodes, steps: s.t };
      }
      if (s.dead) continue;
      var missed = false;
      for (var i = 0; i < need.length; i++) if (!(s.coins & need[i].bit) && s.x > need[i].x) { missed = true; break; }
      if (missed) continue;
      var d = Math.round(s.t / DEC);
      var set = visited[d];
      if (!set) set = visited[d] = new Set();
      var k = key(s);
      if (set.has(k)) continue;
      set.add(k);
      if (nodes > limit) break;
      // prefer not pressing as a hopper, prefer keeping the current input when flying
      var first = s.mode === C.HOP ? false : hold;
      stack.push({ s: s, a: 0, first: first, act: hold });
    }
    L.margin = 0;
    return { ok: false, best: best, bestState: bestState, nodes: nodes };
  }

  /* Replays a decision list and returns toggles as step indices (compact demo format). */
  function toToggles(res) {
    var out = [];
    var prev = false;
    for (var i = 0; i < res.acts.length; i++) {
      if (res.acts[i] !== prev) { out.push(i * res.dec); prev = res.acts[i]; }
    }
    return out;
  }

  function verifyToggles(L, toggles) {
    var s = E.newState();
    var hold = false, ti = 0;
    while (!s.dead && !s.done && s.t < 1e6) {
      while (ti < toggles.length && toggles[ti] <= s.t) { hold = !hold; ti++; }
      E.step(L, s, hold, null);
    }
    return s;
  }

  var api = { solve: solve, toToggles: toToggles, verifyToggles: verifyToggles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PSolver = api;
})(typeof window !== 'undefined' ? window : this);
