# Phosphor

An original one-button rhythm auto-runner for the browser. Jump, fly, zigzag and flip gravity
through levels that are locked to their own procedurally synthesized tracks. Vector-CRT look,
no assets, no dependencies: the whole game is one HTML file.

## Play

Open `dist/phosphor.html` in any modern browser (desktop or phone). That file is self-contained,
so it can also be hosted anywhere as a static page.

- Jump: tap, click, or Space / Up / W. Hold to keep jumping.
- P or Esc: pause. R: restart. Z / X: add or remove a checkpoint (practice mode).

## How it is built

| File | What it does |
| --- | --- |
| `src/engine.js` | Deterministic fixed-step physics in beat units. One jump is exactly one beat and four blocks, so geometry is the same at every tempo. Also compiles the ASCII level format. |
| `src/levels.js` | The levels, drawn as rows of tiles. The legend is at the top of the file. Also the chunk pool the Daily level is generated from. |
| `src/solver.js` | A search bot that proves a level (and each core) can be beaten using the real engine. |
| `src/audio.js` | Web Audio synth: sequenced music per level, sound effects, kick pulse for visuals. |
| `src/render.js` | Canvas renderer (layered-stroke glow, palettes, camera). |
| `src/game.js` | Loop, input, audio sync, menus, practice checkpoints, saved progress. |
| `src/editor.js`, `src/editor.html` | Level editor. |
| `src/demos.js` | Generated bot runs, used for the menu background. |
| `build.js` | Inlines everything into `dist/`. |

```bash
node build.js
```

```bash
node tools/lint.js
```

```bash
node tools/solve.js all --coins --write
```

```bash
node tools/smoke.js --full
```

```bash
node tools/test.js
```

```bash
node tools/windows.js
```

`test.js` checks engine invariants (jump = one beat, four blocks) and that the stored bot runs still
win. `windows.js` is the bot playtest: it reports how many milliseconds of timing slack each level
leaves, and where its tightest spot is.

`solve.js` must pass after any level or physics change: it fails if a level cannot be finished,
and `--write` regenerates the bot runs. `smoke.js` drives the real page in headless Chromium at
desktop and phone sizes and lets the bot clear the levels.

## Level format

Each chunk is a list of strings, top row first, bottom row on the ground. At normal speed one
beat is four columns. The player is centred on column `4 * beat`, and a jump covers four columns,
so a spike two columns after a beat line sits under the top of an on-beat jump.
