# LOCKIN: Phosphor

Original one-tap rhythm auto-runner for the browser (oscilloscope / vector-CRT look).
Same genre as Geometry Dash, but its own name, art, levels and music.

Layout: `src/` (classic scripts sharing globals), `build.js` inlines everything into
`dist/phosphor.html` (standalone) and `dist/artifact.html` (published page).
Physics runs in beat units (1 jump = 1 beat = 4 blocks). See README.md.

Published page: https://claude.ai/artifact/UjnEFNQDsz6pV1axdChxYH
(republish by building, copying `dist/artifact.html` over the staged file, and publishing that same path)

Checks to run after any change:
`node tools/lint.js && node tools/solve.js all --coins --write --margin=0.1 && node tools/test.js && node build.js && node tools/smoke.js --full && node tools/daily-test.js && node tools/flow-test.js && node tools/editor-test.js`
Level tuning: `node tools/windows.js` (timing slack per level in ms, and the tightest spot).

## Now
- Nothing in flight. Next step is a real playtest (see Needs User), then tune from that feedback.

## Next
- Level 5 using mini / dual ideas, or a second Hard level
- Show attempts and best run on the level cards
- Daily: streak counter, and yesterday's level as a replay

## Later
- Mini mode and dual mode gates
- More glyphs / trails unlocked by cores
- Share a Daily result as a short text line

## Needs User
- GitHub push is blocked: the Claude GitHub App has no access to TimothyWC/WorldReligionsCPT.
  Commits exist only in this session's container. Fix: connect GitHub at
  https://claude.ai/connect-github and install the app on the repo, then ask for a push.
  Until then the published page and the downloaded `phosphor.html` are the durable copies.
- Feel check from a real player: jump height, flying sensitivity, difficulty order.
  The bot proves levels are possible and measures timing slack, it cannot say whether they are fun.
  All physics constants live in `C` at the top of `src/engine.js`.
- Music taste: five tracks are synthesized in `src/audio.js` and were only checked by numbers
  (levels, no clipping, no silent gaps). Nobody has listened to them yet.
- Not tested on a real phone, Safari or Firefox. Headless Chromium only.

## Done
- Engine: hopper, glider, zigzag, gravity flip, speed gates, pads, ceiling pads, rings, cores
- Solver: proves each level and each core; margins; grid-timing playtest; writes bot runs
- Renderer: palettes, glow, camera, particles, trail, gates, finish line, squash and stretch
- Game shell: menu with bot attract mode, HUD, pause, results, settings, practice checkpoints, saves,
  glyph unlocks, audio sync offset, wake lock, fullscreen
- Music: 4 level tracks + menu loop, 10 sound effects, kick pulse drives visuals
- Levels: First Trace (128, window 156 ms+), Carrier Wave (140, 143 ms+), Sidebands (136, 92 ms),
  Overdrive (150, 100 ms), 3 cores each, all proven collectible in one run
- Daily level: seeded from the chunk pool, proven in the browser, cached per day (60 days tested offline)
- Level editor: paint, pan, zoom, undo, test-play, bot verify, 60 save slots, autosave draft, share codes
  (by a parallel agent; default zoom fits all 10 rows, `CELL_MIN` in editor.js trades rows for finger size)
- Tests: engine invariants and fairness fuzz (12), browser smoke test at 3 screen sizes, daily test, flow test (40 checks:
  checkpoints, pause, restart, saves, held input, next level), editor test (546 checks), audio render test

## Log
- Engine + solver written, level 1 passes at margin 0.4
- Renderer + shell + page built, smoke test green
- Levels 2 and 3 added, both pass first try, all cores proven
- Solver moved to src/solver.js so the editor can verify custom levels in the browser
- Level 4 added; its zig tunnel was the tightest spot in the game (55 ms), widened to 92 ms
- Music engine delivered by a parallel agent (5 songs, latency reporting)
- Daily level generator added and tested for 60 days
- First publish, then republished with 4 levels + Daily + music
- git push refused (403, app not installed on the repo)
- Level editor delivered; its review flagged a missing box-sizing / [hidden] reset in the published page, fixed
- Flow test written, passed first run
- Fairness tests added (seams, ceiling runs, ledge landings, sliding): all pass, no unfair deaths found
- Editor zoom + autosave draft delivered, all suites green, republished (version 5)
