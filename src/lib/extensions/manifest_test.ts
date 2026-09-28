import { describe, expect, test } from 'bun:test'
import { authorHandle, readManifest } from './manifest.ts'

const good = {
  name: 'atlas',
  version: '0.1.0',
  description: 'Atlas records in your notebook.',
  author: { name: 'Jane Doe', email: 'jane@example.com', url: 'https://github.com/jane-doe' },
  sky: { manifest: 1, name: 'Atlas', categories: ['CRM'] },
}

describe('readManifest', () => {
  test('accepts the required set', () => {
    const read = readManifest(JSON.stringify(good))
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.manifest.sky.name).toBe('Atlas')
  })

  test('a folder without a sky block is not an extension', () => {
    const { sky: _sky, ...plain } = good
    const read = readManifest(JSON.stringify(plain))
    expect(read).toEqual({ ok: false, reason: expect.stringContaining('no "sky" block') })
  })

  test('names the missing field', () => {
    const read = readManifest(JSON.stringify({ ...good, author: { name: 'Jane Doe', url: good.author.url } }))
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.reason).toMatch(/^author\.email/)
  })

  test('a newer manifest is refused as newer, not as wrong', () => {
    const read = readManifest(JSON.stringify({ ...good, sky: { ...good.sky, manifest: 2 } }))
    expect(read).toEqual({ ok: false, reason: expect.stringContaining('newer than this Sky') })
  })

  test('categories come from the fixed list', () => {
    const read = readManifest(JSON.stringify({ ...good, sky: { ...good.sky, categories: ['Gardening'] } }))
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.reason).toMatch(/^sky\.categories/)
  })

  test('the slug is lowercase and path-safe', () => {
    const read = readManifest(JSON.stringify({ ...good, name: 'Atlas CRM' }))
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.reason).toMatch(/^name/)
  })

  test('invalid JSON is refused as such', () => {
    expect(readManifest('{')).toEqual({ ok: false, reason: 'package.json is not valid JSON' })
  })
})

describe('authorHandle', () => {
  test('reads the GitHub profile from the author URL', () => {
    const read = readManifest(JSON.stringify(good))
    if (read.ok) expect(authorHandle(read.manifest)).toBe('jane-doe')
  })

  test('falls back to the repository owner', () => {
    const read = readManifest(
      JSON.stringify({
        ...good,
        author: { ...good.author, url: 'https://jane.example' },
        repository: 'https://github.com/Atlas-Org/atlas',
      }),
    )
    if (read.ok) expect(authorHandle(read.manifest)).toBe('atlas-org')
  })

  test('no GitHub anywhere means no handle', () => {
    const read = readManifest(JSON.stringify({ ...good, author: { ...good.author, url: 'https://jane.example' } }))
    if (read.ok) expect(authorHandle(read.manifest)).toBeNull()
  })
})
