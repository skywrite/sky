import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { extensionCommandRoots } from '#lib/extensions/installed.ts'
import { commandNameOf } from './_commandsManifest.ts'

describe('commandNameOf', () => {
  test('a path under a root is a colon name', () => {
    expect(commandNameOf('prices/crypto/fetch.ts')).toBe('prices:crypto:fetch')
    expect(commandNameOf('services/mod.ts')).toBe('services')
  })
  test("an extension's commands carry its slug in front", () => {
    expect(commandNameOf('auth.ts', 'atlas')).toBe('atlas:auth')
    expect(commandNameOf('contact/fetch.ts', 'atlas')).toBe('atlas:contact:fetch')
    expect(commandNameOf('deal/mod.ts', 'atlas')).toBe('atlas:deal')
  })
})

describe('extensionCommandRoots', () => {
  const manifest = (name: string) =>
    JSON.stringify({
      name,
      version: '0.1.0',
      description: 'd',
      author: { name: 'Jane Doe', email: 'jane@example.com', url: 'https://github.com/jane-doe' },
      sky: { manifest: 1, name, categories: ['Utilities'] },
    })

  async function extension(
    root: string,
    slug: string,
    options: { manifest?: string; commands?: boolean; disabled?: boolean } = {},
  ) {
    const dir = path.join(root, 'jane-doe', slug)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'package.json'), options.manifest ?? manifest(slug))
    if (options.commands ?? true) await mkdir(path.join(dir, 'commands'), { recursive: true })
    if (options.disabled) await writeFile(path.join(root, 'jane-doe', `${slug}.disabled`), '')
    return dir
  }

  test('a healthy, switched-on extension with commands is a root prefixed by its slug', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-roots-'))
    const dir = await extension(root, 'atlas')
    expect(await extensionCommandRoots(root)).toEqual([{ dir: path.join(dir, 'commands'), prefix: 'atlas' }])
  })

  test('switched off, broken, or without commands: no root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-roots-'))
    await extension(root, 'off', { disabled: true })
    await extension(root, 'broken', { manifest: '{ "name": "broken" }' })
    await extension(root, 'quiet', { commands: false })
    expect(await extensionCommandRoots(root)).toEqual([])
  })
})
