# LOCKIN: Phosphor

Original one-tap rhythm auto-runner for the browser (oscilloscope / vector-CRT look).
Same genre as Geometry Dash, but its own name, art, levels and music.

Layout: `src/` (classic scripts sharing globals), `build.js` inlines everything into
`dist/phosphor.html` (standalone) and `dist/artifact.html` (published page).
Physics runs in beat units (1 jump = 1 beat = 4 blocks). See README.md.

Checks to run after any change:
`node tools/lint.js && node tools/solve.js all --coins --write && node build.js && node tools/smoke.js --full`

## Now
- Integrate the music engine (sync, latency), publish, push
- Level editor (parallel agent): review, integrate, test

## Next
- Level 4 that mixes every mechanic
- Audio offset setting for Bluetooth lag
- Per-level stats on the cards (attempts, best run)

## Later
- Daily level from a seeded chunk generator (solver-verified at build time)
- Mini / dual modes
- More glyphs unlocked by cores

## Needs User
- Feel check from a real player: jump height, flying sensitivity, difficulty of Overdrive.
  The bot proves the levels are possible, it cannot say whether they are fun. All physics
  constants live in `C` at the top of `src/engine.js`.
- Music taste: the three tracks are synthesized in `src/audio.js`. Say what you want changed.

## Done
- Engine: hopper, glider, zigzag, gravity flip, speed gates, pads, rings, cores
- Solver: proves each level and each core, with timing-slack margins; writes bot runs
- Renderer: palettes, glow, camera, particles, trail, gates, finish line
- Game shell: menu with bot attract mode, HUD, pause, results, settings, practice checkpoints, saves
- Levels: First Trace (128), Carrier Wave (140), Overdrive (150), 3 cores each
- Browser smoke test at desktop / phone landscape / phone portrait

## Log
- Engine + solver written, level 1 passes at margin 0.4
- Renderer + shell + page built, smoke test green
- Levels 2 and 3 added, both pass first try, all cores proven
- Solver moved to src/solver.js so the editor can verify custom levels in the browser
- Custom-level and editor hooks added to game.js / render.js
