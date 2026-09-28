import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readlink, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { linkSharedPackages } from './install.ts'

describe('linkSharedPackages', () => {
  test('an extension with screens gets links to the host copies, replacing its own', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-ext-'))
    const host = path.join(root, 'host', 'node_modules')
    for (const name of ['react', 'react-dom', '@mantine/core', '@mantine/hooks'])
      await mkdir(path.join(host, name), { recursive: true })
    const ext = path.join(root, 'ext')
    await mkdir(path.join(ext, 'ui'), { recursive: true })
    await mkdir(path.join(ext, 'node_modules', 'react'), { recursive: true })
    await writeFile(path.join(ext, 'node_modules', 'react', 'own.js'), '')

    expect(await linkSharedPackages(ext, host)).toEqual(['react', 'react-dom', '@mantine/core', '@mantine/hooks'])
    expect(await realpath(path.join(ext, 'node_modules', 'react'))).toBe(await realpath(path.join(host, 'react')))
    expect(await readlink(path.join(ext, 'node_modules', '@mantine', 'core'))).toBe(path.join(host, '@mantine', 'core'))
    expect(await linkSharedPackages(ext, host)).toEqual([])
  })

  test('an extension without screens is left alone', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-ext-'))
    expect(await linkSharedPackages(path.join(root, 'ext'), path.join(root, 'host'))).toEqual([])
  })
})
