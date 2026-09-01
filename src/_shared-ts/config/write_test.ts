import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { parse } from 'jsonc-parser'
import { assert, test } from '#test'
import { removeConfigValue, setConfigValue } from './write.ts'

const FILE = `{
  // Sky configuration — https://github.com/skywrite/sky
  // Config version (do not change manually)
  "version": 1,

  // Root directory for your notebook (notes, journal, projects, etc.)
  "dir": "~/Sky",

  // Preferred editor for opening files after creation
  "editor": "code"
}
`

async function withDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-config-write-'))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test({ name: 'config write - a new nested key lands without touching the rest' }, async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, 'config.jsonc')
    await writeFile(file, FILE)

    setConfigValue(['web', 'theme'], 'dark', file)
    const text = await readFile(file, 'utf-8')

    assert({
      given: 'a write of web.theme',
      should: 'parse back with the value and the old keys',
      actual: parse(text) as unknown,
      expected: { version: 1, dir: '~/Sky', editor: 'code', web: { theme: 'dark' } },
    })
    assert({
      given: 'the same file',
      should: 'keep every comment sky init wrote',
      actual: [text.includes('// Config version (do not change manually)'), text.includes('// Preferred editor')],
      expected: [true, true],
    })
  })
})

test({ name: 'config write - an existing key changes in place' }, async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, 'config.jsonc')
    await writeFile(file, FILE)

    setConfigValue(['editor'], 'zed', file)
    setConfigValue(['web', 'theme'], 'light', file)
    setConfigValue(['web', 'theme'], 'system', file)
    const text = await readFile(file, 'utf-8')
    const parsed = parse(text) as { editor?: string; web?: { theme?: string } }

    assert({
      given: 'two writes to the same key',
      should: 'leave the last value, once',
      actual: [parsed.editor, parsed.web?.theme, text.split('"theme"').length - 1],
      expected: ['zed', 'system', 1],
    })
  })
})

test({ name: 'config write - no file yet: one is created' }, async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, 'deeper', 'config.jsonc')

    setConfigValue(['voice', 'voice'], 'marin', file)
    const text = await readFile(file, 'utf-8')

    assert({
      given: 'a write with no file',
      should: 'create it with the value and a header comment',
      actual: [parse(text) as unknown, text.startsWith('// Sky configuration')],
      expected: [{ voice: { voice: 'marin' } }, true],
    })
  })
})

test({ name: 'config write - an object value lands whole, and undefined removes the key' }, async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, 'config.jsonc')
    await writeFile(file, FILE)

    setConfigValue(
      ['ai', 'profiles', 'probe'],
      { provider: 'ollama', model: 'llama3', options: { temperature: 0.2 } },
      file,
    )
    const withProfile = await readFile(file, 'utf-8')
    assert({
      given: 'an object written to ai.profiles.probe',
      should: 'parse back whole',
      actual: (parse(withProfile) as { ai?: { profiles?: Record<string, unknown> } }).ai?.profiles?.probe,
      expected: { provider: 'ollama', model: 'llama3', options: { temperature: 0.2 } },
    })

    setConfigValue(['ai', 'profiles', 'probe'], undefined, file)
    const removed = await readFile(file, 'utf-8')
    const parsed = parse(removed) as { ai?: { profiles?: Record<string, unknown> }; editor?: string }
    assert({
      given: 'the same key written as undefined',
      should: 'be gone, with the rest and the comments intact',
      actual: [parsed.ai?.profiles?.probe, parsed.editor, removed.includes('// Preferred editor')],
      expected: [undefined, 'code', true],
    })
  })
})

test({ name: 'config write - removing the last key prunes the shells it emptied' }, async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, 'config.jsonc')
    await writeFile(file, FILE)
    const before = await readFile(file, 'utf-8')

    setConfigValue(['ai', 'profiles', 'probe'], { provider: 'ollama', model: 'llama3' }, file)
    removeConfigValue(['ai', 'profiles', 'probe'], file)

    assert({
      given: 'a profile written and then removed',
      should: 'leave the file exactly as it was — no empty ai/profiles shells',
      actual: await readFile(file, 'utf-8'),
      expected: before,
    })
  })
})
