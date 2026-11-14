import type { EngineInterface, Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { SCENE } from './scene'

const NAME = 'deep-field'

// Dark, slightly blue-black panels taken from the scene's sky, with accents from
// the game itself: the cyan of the ship's shots and the warm orange of the explosions.
const { theme, problems } = makeColors({
  label: 'Deep Field',
  only: 'dark',
  roles: {
    accent: '#6edcff',   // plasma bolts
    warning: '#ff7828',  // explosion sparks as they cool
    danger: '#e5533d',   // the last red of a spark
    success: '#4ecb8a',
    pro: '#9b7bff',      // the nebula's violet
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#05070d',
        'surface-1': '#090c15',
        'surface-2': '#0d111c',
        'surface-3': '#121726',
        'text-primary': '#e8eef8',
        'text-secondary': '#bcc7d8',
        'text-muted': '#93a0b6',
      },
    },
  },
})

// Brightness levels. The scene layer's opacity stacks under the panels' frost,
// so what shows through a panel is about scene × (1 − glass opacity).
type Level = 'normal' | 'dim' | 'bright'
// (`glass: false` would leave the app's own opaque panels, hiding the scene, so every level sets one.)
const LEVELS: Record<Level, { scene: number; glass: { blur: number; tint: string; opacity: number } }> = {
  normal: { scene: 0.85, glass: { blur: 2, tint: '#05070d', opacity: 0.3 } },
  dim: { scene: 0.55, glass: { blur: 4, tint: '#05070d', opacity: 0.45 } },
  // The scene at full strength under nearly clear panels.
  bright: { scene: 1, glass: { blur: 0, tint: '#05070d', opacity: 0.12 } },
}

// The scene at a level's strength. (The app freezes a backdrop that holds a <filter>, <mask> or <image>, so the scene has none.)
const sceneFor = (level: Level) => SCENE.replace('<g opacity=".35">', `<g opacity="${LEVELS[level].scene}">`)

// Each level is its own scene name, so a switch redraws the backdrop.
const sceneName = (level: Level) => (level === 'normal' ? NAME : `${NAME}-${level}`)
const levelOf = (scene: string): Level | undefined =>
  (Object.keys(LEVELS) as Level[]).find(level => sceneName(level) === scene)

const lookFor = (level: Level): ThemeSetArgs => ({
  colors: theme,
  backdrop: { scene: sceneName(level), glass: LEVELS[level].glass },
})

async function apply($: EngineInterface, level: Level = 'normal') {
  const set = await $.theme.set(lookFor(level))
  if (!set.isDrawn) {
    $.ui.status(`Deep Field: ${set.reason}`)
  }
  return set
}

// ── Remembered theme choice, shared by the theme mods in ~/claude-mods ──
// One line of text in ~/.claude/active-theme names the theme you picked last: a mod's
// name (its slash command), or "none" for the app's own look. Every theme mod follows
// the same rules, so several can stay enabled without racing at startup:
//   • session start: apply your theme only if the file names you, or if there is no file;
//   • /<mod>: apply your theme and write your name;
//   • /<mod> off: only if the file names you (or is missing), clear the theme and write "none".
/** At session start: does this mod put its theme on, given the remembered choice? */
export const appliesAtStart = (choice: string | undefined) => choice === undefined || choice === NAME
/** May `/<mod> off` turn the theme off, given the remembered choice? */
export const mayTurnOff = (choice: string | undefined) => choice === undefined || choice === NAME

async function choicePath($: EngineInterface) {
  const home = await $.env.get('HOME')
  return home === undefined ? undefined : `${home}/.claude/active-theme`
}

export async function readChoice($: EngineInterface): Promise<string | undefined> {
  const path = await choicePath($)
  if (path === undefined) return undefined
  try {
    const text = (await $.fs.read(path)).trim()
    return text === '' ? undefined : text
  } catch {
    return undefined // no file yet
  }
}

export async function writeChoice($: EngineInterface, name: string) {
  const path = await choicePath($)
  if (path !== undefined) await $.fs.write(path, `${name}\n`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))
    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }
    await $.command.register({
      name: NAME,
      description: "Deep Field theme: /deep-field to switch to it (remembered for new sessions), dim or bright for its strength, off for the app's own look",
    })
    if (appliesAtStart(await readChoice($))) {
      await apply($)
    }

    return next(e)
  })

  on('command.run', { command: NAME }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'off') {
      const choice = await readChoice($)
      if (!mayTurnOff(choice)) {
        return { text: `Deep Field isn't the active theme (${choice} is), so nothing changed.` }
      }
      await $.theme.clear()
      await writeChoice($, 'none')
      return { text: "Deep Field is off, here and in new sessions: the app's own look is back. /deep-field puts it on again." }
    }
    // /deep-field, and its dim and bright strengths, all make Deep Field the chosen theme
    const level: Level = (Object.keys(LEVELS) as Level[]).find(l => l === arg) ?? 'normal'
    const set = await apply($, level)
    await writeChoice($, NAME)
    if (!set.isDrawn) {
      return { text: `Deep Field is now your chosen theme, but it could not draw here: ${set.reason}` }
    }
    const notes: Record<Level, string> = {
      normal: 'Deep Field is on, and new sessions will open with it. Also: /deep-field bright, dim, off.',
      dim: 'Deep Field is on (dim), and new sessions will open with it (at normal strength).',
      bright: 'Deep Field is on (bright), and new sessions will open with it (at normal strength).',
    }
    return { text: notes[level] }
  }).catch(() => ({ text: 'Deep Field could not change the theme just now.' }))

  // The scene: deep-field.html's game, baked into an animated SVG by tools/build-scene.mjs.
  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    const level = levelOf(e.props.scene)
    if (e.props.plugin !== NAME || level === undefined) {
      return next(e)
    }
    if (e.surface !== 'desktop' && e.surface !== 'mobile') {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)

    return (
      <Svg
        source={sceneFor(level)}
        alt="A self-playing asteroid field: a small ship shoots cyan bolts at tumbling, cratered rocks that burst into orange sparks, over a nebula and an ice giant"
        isInteractive
      />
    )
  })
}
