import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { appliesAtStart, mayTurnOff, readChoice, writeChoice } from '../hooks/register'

// The rules every theme mod in ~/claude-mods follows (see "Remembered theme choice").
test('at session start Deep Field goes on only when no one else was chosen', () => {
  expect(appliesAtStart(undefined)).toBe(true) // no choice yet
  expect(appliesAtStart('deep-field')).toBe(true)
  expect(appliesAtStart('firefly-meadow')).toBe(false)
  expect(appliesAtStart('none')).toBe(false)
})

test("/deep-field off never clears another mod's chosen theme", () => {
  expect(mayTurnOff(undefined)).toBe(true)
  expect(mayTurnOff('deep-field')).toBe(true)
  expect(mayTurnOff('firefly-meadow')).toBe(false)
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
  await writeChoice(fake, 'deep-field')
  expect(file).toBe('deep-field\n')
  expect(await readChoice(fake)).toBe('deep-field')
  file = '  firefly-meadow \n'
  expect(await readChoice(fake)).toBe('firefly-meadow')
  file = '\n'
  expect(await readChoice(fake)).toBe(undefined) // an empty file is no choice either
  await writeChoice(fake, 'none')
  expect(await readChoice(fake)).toBe('none')
  expect(new Set(paths)).toEqual(new Set(['/home/t/.claude/active-theme']))
})

test('with no HOME there is no choice, and nothing is written', async () => {
  let writes = 0
  const fake = {
    env: { get: async () => undefined },
    fs: {
      read: async () => 'deep-field',
      write: async () => { writes++ },
    },
  } as unknown as EngineInterface

  expect(await readChoice(fake)).toBe(undefined)
  await writeChoice(fake, 'deep-field')
  expect(writes).toBe(0)
})
