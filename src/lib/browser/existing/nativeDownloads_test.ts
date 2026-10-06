import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import type { PageProtocol } from './connection.ts'
import { NativeDownloads } from './nativeDownloads.ts'

async function fixture(work: (directory: string) => Promise<void>) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'sky-native-download-test-')))
  try {
    await work(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function capture(directories: string | string[] = []) {
  const events = new EventEmitter()
  const saved: { name: string; body: string }[] = []
  const notices: string[] = []
  const jobs: Promise<void>[] = []
  const downloads = await NativeDownloads.create({
    directories: typeof directories === 'string' ? [directories] : directories,
    save: async (name, bytes) => {
      saved.push({ name, body: bytes.toString() })
    },
    notice: (message) => notices.push(message),
    track: (work) => {
      jobs.push(work)
      return work
    },
    timeoutMs: 50,
  })
  downloads.attach(events as unknown as PageProtocol)
  return {
    saved,
    notices,
    downloads,
    begin: () => events.emit('Page.downloadWillBegin', { guid: 'mock-guid', suggestedFilename: 'Atlas.pdf' }),
    complete: (body: string, state = 'completed') =>
      events.emit('Page.downloadProgress', {
        guid: 'mock-guid',
        state,
        receivedBytes: Buffer.byteLength(body),
      }),
    settle: () => Promise.all(jobs),
  }
}

test('native downloads use the configured folder and preserve existing and unrelated files', async () =>
  fixture(async (directory) => {
    await writeFile(path.join(directory, 'Atlas.pdf'), 'old')
    const f = await capture(directory)
    try {
      f.begin()
      await writeFile(path.join(directory, 'Atlas (1).pdf'), '%PDF-1.4 synthetic Atlas')
      await writeFile(path.join(directory, 'Other.pdf'), 'unrelated')
      f.complete('%PDF-1.4 synthetic Atlas')
      await f.settle()
      assert({
        given: 'an owned-tab download saved with a collision suffix in the browser’s custom folder',
        should: 'collect only the completed new file and leave all browser originals intact',
        actual: [
          f.saved,
          f.notices,
          (await readdir(directory)).sort(),
          await readFile(path.join(directory, 'Atlas.pdf'), 'utf8'),
        ],
        expected: [
          [{ name: 'Atlas (1).pdf', body: '%PDF-1.4 synthetic Atlas' }],
          [],
          ['Atlas (1).pdf', 'Atlas.pdf', 'Other.pdf'],
          'old',
        ],
      })
    } finally {
      f.downloads.close()
    }
  }))

test('native completion waits for the final filename to appear', async () =>
  fixture(async (directory) => {
    const f = await capture(directory)
    try {
      f.begin()
      f.complete('new')
      await writeFile(path.join(directory, 'Atlas.pdf'), 'new')
      await f.settle()
      assert({
        given: 'completion before the file is visible',
        should: 'collect after the browser rename',
        actual: f.saved,
        expected: [{ name: 'Atlas.pdf', body: 'new' }],
      })
    } finally {
      f.downloads.close()
    }
  }))

test('native downloads do not guess between files or admit incomplete, old or linked files', async () => {
  for (const problem of [
    'ambiguous',
    'incomplete',
    'old',
    'symlink',
    'canceled',
    'timeout',
    'unknown-directory',
    'closed',
  ]) {
    await fixture(async (directory) => {
      if (problem === 'old') await writeFile(path.join(directory, 'Atlas.pdf'), 'new')
      const f = await capture(problem === 'unknown-directory' ? undefined : directory)
      try {
        f.begin()
        if (problem === 'ambiguous') {
          await writeFile(path.join(directory, 'Atlas.pdf'), 'new')
          await writeFile(path.join(directory, 'Atlas (1).pdf'), 'new')
        }
        if (problem === 'incomplete') await writeFile(path.join(directory, 'Atlas.pdf'), 'n')
        if (problem === 'symlink') {
          await writeFile(path.join(directory, 'Other.pdf'), 'new')
          await symlink(path.join(directory, 'Other.pdf'), path.join(directory, 'Atlas.pdf'))
        }
        if (problem === 'closed') f.downloads.close()
        else if (problem !== 'timeout') f.complete('new', problem === 'canceled' ? 'canceled' : 'completed')
        await f.settle()
        assert({
          given: problem,
          should: 'leave files alone and explain uncertainty instead of claiming nothing reached disk',
          actual: [
            f.saved.length,
            f.notices.length,
            f.notices.every((notice) => /Brave.*download|Brave completed/.test(notice)),
          ],
          expected: [0, problem === 'closed' ? 0 : 1, true],
        })
      } finally {
        f.downloads.close()
      }
    })
  }
})

test('native downloads search every folder even when a configured location is unavailable', async () =>
  fixture(async (root) => {
    const desktop = path.join(root, 'Desktop')
    const downloads = path.join(root, 'Downloads')
    const configured = path.join(root, 'unavailable')
    await mkdir(desktop)
    await writeFile(configured, 'not a directory')
    await symlink(desktop, path.join(root, 'Desktop-alias'))
    for (const destination of [desktop, downloads]) {
      const f = await capture([configured, desktop, path.join(root, 'Desktop-alias'), downloads])
      try {
        f.begin()
        await mkdir(destination, { recursive: true })
        await writeFile(path.join(destination, 'Atlas.pdf'), 'new')
        f.complete('new')
        await f.settle()
        assert({
          given: `a completed download in ${path.basename(destination)}, a broken configured path, and a duplicate alias`,
          should: 'collect the single new file, including when the browser creates its folder during the task',
          actual: [f.saved, f.notices],
          expected: [[{ name: 'Atlas.pdf', body: 'new' }], []],
        })
      } finally {
        f.downloads.close()
      }
    }
  }))

test('native downloads report cross-folder ambiguity and identify every checked location', async () =>
  fixture(async (root) => {
    const folders = ['Desktop', 'Downloads', 'task'].map((name) => path.join(root, name))
    await mkdir(folders[0])
    await mkdir(folders[1])
    const f = await capture(folders)
    try {
      f.begin()
      await writeFile(path.join(folders[0], 'Atlas.pdf'), 'one')
      await writeFile(path.join(folders[1], 'Atlas.pdf'), 'two')
      f.complete('one')
      await f.settle()
      assert({
        given: 'two newly completed files with the same announced name and size in separate folders',
        should: 'leave both intact and give chat all locations to inspect',
        actual: [
          f.saved,
          f.notices.length,
          folders.every((folder) => f.notices[0].includes(folder)),
          f.notices[0].includes('find_downloads'),
        ],
        expected: [[], 1, true, true],
      })
    } finally {
      f.downloads.close()
    }
  }))
