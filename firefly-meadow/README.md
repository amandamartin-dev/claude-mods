# Firefly Meadow

A cozy anime-style summer night behind your Claude Code session, seen from eye level as if you're standing in the meadow. Six layers of tall grass rise to nearly half the screen, swaying in a slow breeze that rolls across the field. Two trees, grown branch by branch and leafed with sprays of real pointed leaves (some catching the moonlight), stand against the sky under a soft gibbous moon. Now and then a single leaf on a crown's edge flutters as a breeze passes through. Misty woods line the horizon under a deep indigo sky, with slow-twinkling stars. Around 55 fireflies fly and blink at every depth, beyond the grass, between its layers and in front of it, with a few big out-of-focus glows right beside you. A shooting star crosses the sky every 12–30 seconds. The app's panels are tinted translucent indigo so text stays easy to read. The UI colors come from the scene: warm white text, lavender-gray muted text, firefly-amber accents, meadow-green success and muted-rose errors.

It draws in the Claude desktop and mobile apps. The terminal doesn't draw themes.

## Tuning

The constants at the top of `hooks/register.tsx`:

| Constant | Default | What it does |
| --- | --- | --- |
| `FIREFLY_COUNT` | 56 | number of fireflies |
| `NEAR_GLOW_COUNT` | 5 | big out-of-focus fireflies close to you |
| `GRASS_SWAY` | true | the tall grass sways in the breeze |
| `LEAF_RUSTLE` | true | a few single leaves flutter now and then |
| `FLUTTER_LEAVES` | 12 | how many leaves flutter (each only occasionally) |
| `GRASS_LAYERS` | 6 | layers of tall grass (3–8) |
| `GRASS_FPS` | 15 | frame rate of the grass sway |
| `PANEL_TINT` | 0.36 | how much the panels darken the scene behind text (0–1) |
| `SHOOTING_STAR_GAP_S` | `[12, 30]` | seconds between shooting stars (never two at once) |
| `FPS_CAP` | 30 | frame-rate cap for all slow motion |
| `BRIGHTNESS` | 1.0 | 0.5 dim … 1.5 bright (fireflies, stars, moon) |
| `STAR_COUNT`, `TWINKLE_COUNT`, `SHOW_MOON`, `SEED` | | stars, twinklers, moon, and the arrangement |

Save the file and the mod reloads when the session's turn ends.

## Turning it on and off

Keep Firefly Meadow enabled (once):

```bash
claude plugin enable firefly-meadow@my-mods
```

Then switch from inside any session:

- `/firefly-meadow` puts the meadow on right away, and new sessions open with it.
- `/firefly-meadow off` goes back to the app's own look, here and in new sessions.

**Several theme mods can stay enabled together.** Your last choice is kept in `~/.claude/active-theme` (one line: a mod's name, or `none`). At session start a theme mod puts its theme on only if that file names it, or if there's no file yet. `/<mod>` writes its own name there, and `/<mod> off` turns its theme off only if it's the one chosen. Every theme mod in `~/claude-mods` needs to follow these rules (see "Remembered theme choice" in `hooks/register.tsx`); a mod that doesn't will still put its theme on at every session start.

`claude plugin list` shows what's enabled. The rules are tested in `tests/theme-choice.test.ts` (`claude plugin test .`).

## How it stays light

The app draws a theme's moving scene as a sandboxed SVG with no scripts, and it keeps only SVG elements (no HTML inside a `<foreignObject>`). So everything here is plain SVG animated by CSS `transform` and `opacity`, the same way deep-field is built.

- **Painted once:** sky, stars, moon, distant woods, trees and the far meadow have no animation, so they're only repainted where something moves over them.
- **Reused shapes:** each grass layer's blades and the trees' leaf sprays are drawn once as `<symbol>`s and placed with `<use>`, which keeps the file under the app's 131,072-character limit.
- **Glows:** each glow is one shared radial gradient. There's no blur, shadow or filter anywhere.
- **Frame cap:** all animation uses `steps()` on one shared 1/30-second grid (the grass on a 1/15-second one), so every element changes on the same frames and nothing changes in between.
- **Flight paths:** fireflies share 18 looping paths made of layered sine waves (three sizes for far, middle and near), each with its own place, speed and phase.
- **Shooting stars:** they follow one fixed but irregular schedule of 7 stars, so two can never appear at once.
- **No blur behind panels:** the panels are tinted rather than frosted, so nothing has to be re-blurred each time something moves.
- **Reduced motion:** with `prefers-reduced-motion`, fireflies stay still and glow softly, and the grass, leaves, shooting stars and twinkling stop.
- **Hidden windows:** Chromium normally stops producing animation frames when the window is minimized or hidden (not yet measured inside the app).
- **Vector art:** everything is drawn at your screen's own resolution, so nothing is ever pixelated.
