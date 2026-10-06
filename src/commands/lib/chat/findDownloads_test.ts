import { mkdir, mkdtemp, readFile, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { resolveDownloadLocations } from '#lib/browser/downloadLocations.ts'
import { assert, test } from '#test'
import { findDownloads } from './findDownloads.ts'

async function fixture(work: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'sky-find-downloads-')))
  try {
    await work(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function discovery(root: string) {
  return async (additionalDirectories: readonly string[] = []) => ({
    browser: 'brave' as const,
    ...(await resolveDownloadLocations({
      homeDir: root,
      userDataDir: path.join(root, 'profile'),
      additionalDirectories,
    })),
  })
}

test('chat finds downloads across a configured folder, Desktop, Downloads and requested task destinations', async () =>
  fixture(async (root) => {
    await mkdir(path.join(root, 'profile', 'Default'), { recursive: true })
    await writeFile(
      path.join(root, 'profile', 'Default', 'Preferences'),
      JSON.stringify({ download: { default_directory: path.join(root, 'Custom') } }),
    )
    for (const [index, name] of ['Custom', 'Desktop', 'Downloads', 'Task', 'Destination'].entries()) {
      await mkdir(path.join(root, name))
      const file = path.join(root, name, `${name}.PDF`)
      await writeFile(file, `%PDF-1.4 synthetic ${name}`)
      await utimes(file, 1_800_000_000 + index, 1_800_000_000 + index)
    }
    const input = { directories: ['Task', 'Destination'], extensions: ['pdf'], limit: 2 }
    const first = await findDownloads(input, root, undefined, discovery(root))
    const rest = await findDownloads({ ...input, offset: 2, limit: 10 }, root, undefined, discovery(root))
    if (!first.success || !rest.success) throw new Error('Synthetic download search failed')
    assert({
      given: 'five documents with different ages across browser, fallback and task folders',
      should: 'return every candidate newest first over pages, with the exact configured and checked locations',
      actual: [
        first.configuredDirectories,
        first.checkedDirectories.map((entry) => [path.basename(entry.path), entry.status]),
        first.matches.map((entry) => entry.name),
        first.totalMatches,
        first.nextOffset,
        rest.matches.map((entry) => entry.name),
        rest.nextOffset,
        first.allFoldersChecked,
        rest.matches.every((entry) => entry.state === 'candidate' && entry.bytes > 0 && entry.modifiedAt.endsWith('Z')),
        await readFile(path.join(root, 'Custom', 'Custom.PDF'), 'utf8'),
      ],
      expected: [
        [{ profile: 'Default', path: path.join(root, 'Custom') }],
        [
          ['Custom', 'checked'],
          ['Task', 'checked'],
          ['Destination', 'checked'],
          ['Desktop', 'checked'],
          ['Downloads', 'checked'],
        ],
        ['Destination.PDF', 'Task.PDF'],
        5,
        2,
        ['Downloads.PDF', 'Desktop.PDF', 'Custom.PDF'],
        null,
        true,
        true,
        '%PDF-1.4 synthetic Custom',
      ],
    })
  }))

test('download recovery surfaces incomplete files and ignores symlinks and nested unrelated content', async () =>
  fixture(async (root) => {
    const desktop = path.join(root, 'Desktop')
    await mkdir(desktop)
    for (const name of ['Atlas.pdf', 'Atlas (1).pdf', 'Atlas.pdf.crdownload', 'Atlas.pdf.part', 'Atlas.txt']) {
      await writeFile(path.join(desktop, name), 'synthetic')
    }
    await writeFile(path.join(desktop, 'Atlas-empty.pdf'), '')
    await mkdir(path.join(desktop, 'Atlas.pdf.download'))
    await mkdir(path.join(desktop, 'nested'))
    await writeFile(path.join(desktop, 'nested', 'Atlas-hidden.pdf'), 'unrelated')
    await symlink(path.join(desktop, 'Atlas.pdf'), path.join(desktop, 'Atlas-link.pdf'))
    const result = await findDownloads(
      { extensions: ['.PDF'], nameContains: 'atlas' },
      root,
      undefined,
      discovery(root),
    )
    if (!result.success) throw new Error(result.error)
    assert({
      given: 'completed duplicates, partial downloads, an empty file, and an unrelated linked document',
      should: 'return metadata without choosing a duplicate or mistaking partials for completed downloads',
      actual: [
        result.matches
          .filter((entry) => entry.state === 'candidate')
          .map((entry) => entry.name)
          .sort(),
        result.matches
          .filter((entry) => entry.state === 'incomplete')
          .map((entry) => entry.name)
          .sort(),
        result.checkedDirectories.find((entry) => entry.path.endsWith('/Downloads'))?.status,
        result.matches.some((entry) => entry.name.includes('link') || entry.name.includes('hidden')),
      ],
      expected: [
        ['Atlas (1).pdf', 'Atlas.pdf'],
        ['Atlas-empty.pdf', 'Atlas.pdf.crdownload', 'Atlas.pdf.download', 'Atlas.pdf.part'],
        'missing',
        false,
      ],
    })
  }))

test('an inaccessible candidate folder does not suppress other results or pretend the search was complete', async () =>
  fixture(async (root) => {
    await writeFile(path.join(root, 'Unavailable'), 'not a directory')
    await mkdir(path.join(root, 'Desktop'))
    await writeFile(path.join(root, 'Desktop', 'statement.pdf'), 'synthetic')
    const result = await findDownloads({ directories: ['Unavailable', 'Missing'] }, root, undefined, discovery(root))
    if (!result.success) throw new Error(result.error)
    assert({
      given: 'one requested folder cannot be listed and another does not exist',
      should: 'still find the Desktop document and report exactly what could not be checked',
      actual: [
        result.matches.map((entry) => entry.name),
        result.allFoldersChecked,
        result.checkedDirectories.slice(0, 2).map((entry) => [path.basename(entry.path), entry.status, !!entry.error]),
        result.issues.length > 0,
      ],
      expected: [
        ['statement.pdf'],
        false,
        [
          ['Unavailable', 'unavailable', true],
          ['Missing', 'missing', true],
        ],
        true,
      ],
    })
  }))

test('download recency is optional so files from prior attempts remain discoverable', async () =>
  fixture(async (root) => {
    await mkdir(path.join(root, 'Desktop'))
    const document = path.join(root, 'Desktop', 'statement.pdf')
    await writeFile(document, 'synthetic')
    await utimes(document, 1_700_000_000, 1_700_000_000)
    const old = await findDownloads({ modifiedSince: '2026-01-01T00:00:00Z' }, root, undefined, discovery(root))
    const all = await findDownloads({}, root, undefined, discovery(root))
    const invalid = await findDownloads({ modifiedSince: 'yesterday' }, root, undefined, discovery(root))
    let searched = false
    const canceled = await findDownloads({}, root, AbortSignal.abort(), async () => {
      searched = true
      return discovery(root)()
    })
    assert({
      given: 'an older download, an invalid timestamp, and a canceled request',
      should: 'filter only when asked and stop before accessing folders after cancellation',
      actual: [
        old.success && old.totalMatches,
        all.success && all.totalMatches,
        invalid.success,
        canceled.success,
        searched,
      ],
      expected: [0, 1, false, false, false],
    })
  }))
