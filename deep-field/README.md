# Deep Field

A theme for the Claude desktop app, adapted from a canvas asteroid game page. A self-playing asteroid
game runs behind the whole window: a small silver ship hunts tumbling, cratered rocks
with cyan bolts, trailing a blue engine plume, and the rocks burst into orange sparks.
Behind it are a nebula band with dust lanes, twinkling stars, the occasional shooting
star, a ringed ice giant with a small moon, and the sun in the upper left with a faint
lens flare. The panels are dark and lightly frosted. The accents come from the scene: cyan
from the shots and orange from the explosions.

## How it works

The desktop app draws a theme's backdrop as SVG without script, so the original canvas
page can't run behind the UI. `tools/build-scene.mjs` runs the game's own simulation
(same autopilot, physics and splitting) for one full wave and bakes it into a
CSS-animated SVG loop of about 44 seconds (`hooks/scene.ts`).

- No `<filter>`, `<mask>` or `<image>` anywhere: the app freezes the whole backdrop
  if it holds any of them, so everything is gradients, clip paths and shapes.
- Each rock has a notched outline, faint angular facets like chipped faces, ragged
  blotches, fine grit and crater bowls with a pale lip, all turning with it. Over
  that, clipped to its outline, a shading disc turns the other way, so the sun stays
  fixed in the upper left. The planet's cloud bands, the nebula and its dust lanes,
  and the star clusters are layered shapes.
- Every keyframe sits on a 1/30 s grid and moves in `steps()`, so the scene changes at
  most 30 times a second. The app's browser engine stops painting it while the window
  is hidden.

Rebuild with a different game: `node tools/build-scene.mjs <seed>`. The result must stay
under 131,072 characters, and the script refuses anything larger. The default seed (99)
plays one wave and comes to about 127,000 characters; seeds that play two waves are far
too big. The simulation still supports a second ship that chases the first, but it no
longer fits alongside the detailed rocks.

## Switching themes

Several theme mods can stay enabled together. Which one shows is a remembered choice:
one line in `~/.claude/active-theme` naming a theme mod (its slash command, such as
`deep-field` or `firefly-meadow`) or `none` for the app's own look. Every theme mod in
`~/claude-mods` follows the same rules, so they never race at startup:

- **Session start:** Deep Field puts its theme on only if the file names `deep-field`, or
  if there is no choice yet (no file, or an empty one). Otherwise it leaves the theme alone.
- **`/deep-field`:** switches to Deep Field now and records it, so new sessions open with it.
  `/deep-field bright` and `/deep-field dim` do the same at that strength for this session;
  new sessions open at normal strength.
- **`/deep-field off`:** if Deep Field is the chosen theme (or nothing is chosen yet), clears
  it and records `none`: the app's own look, here and in new sessions. If another theme is
  chosen, it changes nothing and says which one is active.

To switch to another theme, run that mod's own command, such as `/firefly-meadow`.

Strengths:

- `/deep-field`: the normal look (scene at 85%, light frost on the panels)
- `/deep-field bright`: the scene at full strength under nearly clear panels
- `/deep-field dim`: a darker, more subtle scene
