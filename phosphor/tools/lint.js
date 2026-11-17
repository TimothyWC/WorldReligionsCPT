#!/usr/bin/env node
/* Checks level chunks: every row in a chunk has the same width, and reports beat ranges. */
'use strict';
const LV = require('../src/levels.js');
let bad = 0;
LV.levels.forEach(def => {
  let x = 0;
  def.chunks.forEach((ch, i) => {
    const rows = ch.rows || ch;
    const w = rows[0].length;
    rows.forEach((r, j) => {
      if (r.length !== w) { bad++; console.log(def.id + ' chunk ' + i + ' (x=' + x + ') row ' + j + ' has width ' + r.length + ', expected ' + w); }
    });
    x += w;
  });
  console.log(def.id + ': ' + def.chunks.length + ' chunks, ' + x + ' columns');
});
process.exit(bad ? 1 : 0);
