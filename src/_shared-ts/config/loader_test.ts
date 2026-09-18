import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { parse } from 'jsonc-parser'
import { assert, test } from '#test'
import { loadSkyConfig } from './loader.ts'
import { setConfigValue } from './write.ts'

test('experimental Workstreams is off unless the config explicitly enables the boolean', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sky-experimental-config-'))
  const file = path.join(dir, 'config.jsonc')
  try {
    const missing = loadSkyConfig(file).experimental.workstreams
    const results: unknown[] = []
    for (const workstreams of [undefined, true, false, 'true', 1, null]) {
      await writeFile(file, JSON.stringify({ experimental: { contextPreflight: true, workstreams } }))
      results.push(loadSkyConfig(file).experimental)
    }
    assert({
      given: 'no config file, an omitted switch, valid booleans and truthy non-boolean values',
      should: 'enable Workstreams only for true and preserve the independent preflight switch',
      actual: [missing, results],
      expected: [
        false,
        [false, true, false, false, false, false].map((workstreams) => ({ workstreams, contextPreflight: true })),
      ],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('saving the Workstreams switch preserves other experimental preferences and JSONC comments', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sky-experimental-config-'))
  const file = path.join(dir, 'config.jsonc')
  try {
    await writeFile(file, '{\n  // Keep the other experiment.\n  "experimental": { "contextPreflight": true }\n}\n')
    setConfigValue(['experimental', 'workstreams'], true, file)
    const enabled = loadSkyConfig(file).experimental
    setConfigValue(['experimental', 'workstreams'], false, file)
    const text = await readFile(file, 'utf8')
    assert({
      given: 'the Workstreams preference enabled and then disabled in an existing commented config',
      should: 'retain actual boolean values, the preflight setting and the owner’s comment',
      actual: [
        enabled,
        loadSkyConfig(file).experimental,
        parse(text).experimental,
        text.includes('// Keep the other experiment.'),
      ],
      expected: [
        { workstreams: true, contextPreflight: true },
        { workstreams: false, contextPreflight: true },
        { contextPreflight: true, workstreams: false },
        true,
      ],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
