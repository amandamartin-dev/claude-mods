import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { appliesAtStart, mayTurnOff, readChoice, writeChoice } from '../hooks/register'

// The rules every theme mod in ~/claude-mods follows (see "Remembered theme choice").
test('at session start the meadow goes on only when no one else was chosen', () => {
  expect(appliesAtStart(undefined)).toBe(true) // no choice yet
  expect(appliesAtStart('firefly-meadow')).toBe(true)
  expect(appliesAtStart('deep-field')).toBe(false)
  expect(appliesAtStart('none')).toBe(false)
})

test("/firefly-meadow off never clears another mod's chosen theme", () => {
  expect(mayTurnOff(undefined)).toBe(true)
  expect(mayTurnOff('firefly-meadow')).toBe(true)
  expect(mayTurnOff('deep-field')).toBe(false)
  expect(mayTurnOff('none')).toBe(false)
})

test('the choice is one line in ~/.claude/active-theme', async () => {
  // A stand-in for the engine: HOME and one file.
  let file: string | undefined
  const paths: string[] = []
  const fake = {
    env: { get: async (name: string) => (name === 'HOME' ? '/home/t' : undefined) },
    fs: {
      read: async (path: string) => {
        paths.push(path)
        if (file === undefined) throw new Error('ENOENT')
        return file
      },
      write: async (path: string, text: string) => {
        paths.push(path)
        file = text
      },
    },
  } as unknown as EngineInterface

  expect(await readChoice(fake)).toBe(undefined) // a missing file reads as "no choice yet"
  await writeChoice(fake, 'firefly-meadow')
  expect(file).toBe('firefly-meadow\n')
  expect(await readChoice(fake)).toBe('firefly-meadow')
  file = '  deep-field \n'
  expect(await readChoice(fake)).toBe('deep-field')
  expect(new Set(paths)).toEqual(new Set(['/home/t/.claude/active-theme']))
})
