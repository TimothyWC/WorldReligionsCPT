# LOCKIN: Phosphor

Original one-tap rhythm auto-runner for the browser (oscilloscope / vector-CRT look).
Same genre as Geometry Dash, but its own name, art, levels and music.

Layout: `src/` (classic scripts sharing globals), `build.js` inlines everything into
`dist/phosphor.html` (standalone) and `dist/artifact.html` (published page).
`tools/solve.js` proves levels are beatable. Physics runs in beat units (1 jump = 1 beat = 4 blocks).

## Now
- Core engine, solver, renderer, game shell, 3 levels, music

## Next
- Level editor (paint tiles, playtest, save locally)
- Watch-the-bot replay per level
- Skins / colour picker
- 4th level using all mechanics

## Later
- Audio offset setting for Bluetooth lag
- Daily random level from seeded chunk generator
- Share a custom level as a text code

## Needs User
- (none yet)

## Done

## Log
