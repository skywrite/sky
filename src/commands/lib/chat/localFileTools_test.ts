import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createFileTools } from './fileTools.ts'
import { createChatFileTools, createDirectory, listDirectory, movePath } from './localFileTools.ts'

const call = { toolCallId: 'example-file-call', messages: [], context: {} }
const exists = (location: string) =>
  lstat(location).then(
    () => true,
    () => false,
  )
async function fixture(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-local-files-'))
  try {
    await work(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
const options = (root: string) => ({
  cwd: root,
  today: new PlainDate('2026-01-27'),
  attachmentsRoot: path.join(root, 'attachments'),
  onAttachments: () => {},
})

test('chat organizes verified documents through tools and leaves the other owner’s folder alone', async () =>
  fixture(async (root) => {
    await mkdir(path.join(root, 'Jane'))
    await mkdir(path.join(root, 'Other'))
    await mkdir(path.join(root, 'Atlas', 'Empty'), { recursive: true })
    await writeFile(path.join(root, 'Jane', 'statement.pdf'), '%PDF-1.4 synthetic statement')
    await writeFile(path.join(root, 'Atlas', 'fund-a.pdf'), '%PDF-1.4 synthetic fund A')
    await writeFile(path.join(root, 'Atlas', 'fund-b.pdf'), '%PDF-1.4 synthetic fund B')
    await writeFile(path.join(root, 'Other', 'keep.pdf'), '%PDF-1.4 other owner')
    const tools = createChatFileTools(options(root))
    const before = (await tools.list_directory.execute!({ path: '.' }, call)) as Awaited<
      ReturnType<typeof listDirectory>
    >
    const created = (await tools.create_directory.execute!({ path: 'Jane/Downloaded' }, call)) as Awaited<
      ReturnType<typeof createDirectory>
    >
    const again = (await tools.create_directory.execute!({ path: 'Jane/Downloaded' }, call)) as Awaited<
      ReturnType<typeof createDirectory>
    >
    const file = (await tools.move_path.execute!(
      { source: 'Jane/statement.pdf', destination: 'Jane/Done/Example Bank/statement.pdf' },
      call,
    )) as Awaited<ReturnType<typeof movePath>>
    const folder = (await tools.move_path.execute!(
      { source: 'Atlas', destination: 'Jane/Done/Atlas' },
      call,
    )) as Awaited<ReturnType<typeof movePath>>
    const after = (await tools.list_directory.execute!({ path: 'Jane/Done/Atlas' }, call)) as Awaited<
      ReturnType<typeof listDirectory>
    >
    assert({
      given: 'a requested owner folder layout and real file tool calls',
      should: 'create the layout, move intact files and a folder, and report their exact final paths',
      actual: [
        before.entries?.map((entry) => entry.name),
        created.success,
        again.created,
        file.success,
        file.destination,
        folder.success,
        folder.filesMoved,
        after.entries?.map((entry) => entry.name),
        await readFile(path.join(root, 'Jane/Done/Example Bank/statement.pdf'), 'utf8'),
        await readFile(path.join(root, 'Jane/Done/Atlas/fund-a.pdf'), 'utf8'),
        await readFile(path.join(root, 'Other/keep.pdf'), 'utf8'),
        await exists(path.join(root, 'Atlas')),
        await exists(path.join(root, 'Jane/statement.pdf')),
      ],
      expected: [
        ['Atlas', 'Jane', 'Other'],
        true,
        false,
        true,
        path.join(root, 'Jane/Done/Example Bank/statement.pdf'),
        true,
        2,
        ['Empty', 'fund-a.pdf', 'fund-b.pdf'],
        '%PDF-1.4 synthetic statement',
        '%PDF-1.4 synthetic fund A',
        '%PDF-1.4 other owner',
        false,
        false,
      ],
    })
  }))

test('directory listings are bounded, resumable, and report symlinks without reading through them', async () =>
  fixture(async (root) => {
    await writeFile(path.join(root, '.keep'), 'hidden')
    await writeFile(path.join(root, 'atlas.txt'), 'Atlas')
    await symlink('missing-target', path.join(root, 'shortcut'))
    const first = await listDirectory({ path: '.', limit: 2 }, root)
    const last = await listDirectory({ path: '.', offset: first.nextOffset!, limit: 2 }, root)
    assert({
      given: 'three entries including a hidden file and a broken symlink',
      should: 'return all names across pages without following or reading the link',
      actual: [first.entries?.map((entry) => entry.name), first.total, first.nextOffset, last.entries, last.nextOffset],
      expected: [
        ['.keep', 'atlas.txt'],
        3,
        2,
        [{ name: 'shortcut', path: path.join(root, 'shortcut'), kind: 'symlink' }],
        null,
      ],
    })
  }))

test('existing files, folders, and broken destination links are never overwritten or merged', async () =>
  fixture(async (root) => {
    await writeFile(path.join(root, 'source.txt'), 'source')
    await writeFile(path.join(root, 'taken.txt'), 'existing')
    await mkdir(path.join(root, 'source-folder'))
    await mkdir(path.join(root, 'taken-folder'))
    await writeFile(path.join(root, 'source-folder', 'keep.txt'), 'keep')
    await symlink('absent', path.join(root, 'taken-link'))
    const results = await Promise.all([
      movePath({ source: 'source.txt', destination: 'taken.txt' }, root),
      movePath({ source: 'source-folder', destination: 'taken-folder' }, root),
      movePath({ source: 'source.txt', destination: 'taken-link' }, root),
      createDirectory({ path: 'taken.txt' }, root),
    ])
    assert({
      given: 'three kinds of destination collision and a folder creation over a file',
      should: 'report failure and preserve every source and destination',
      actual: [
        results.every((result) => !result.success),
        await readFile(path.join(root, 'source.txt'), 'utf8'),
        await readFile(path.join(root, 'taken.txt'), 'utf8'),
        await readdir(path.join(root, 'source-folder')),
        await readdir(path.join(root, 'taken-folder')),
        (await lstat(path.join(root, 'taken-link'))).isSymbolicLink(),
      ],
      expected: [true, 'source', 'existing', ['keep.txt'], [], true],
    })
  }))

test('simultaneous file and directory moves to one destination have only one winner', async () =>
  fixture(async (root) => {
    for (const directory of [false, true]) {
      const prefix = directory ? 'folder' : 'file'
      for (const name of ['one', 'two']) {
        const source = path.join(root, `${prefix}-${name}`)
        if (directory) await mkdir(source)
        await writeFile(directory ? path.join(source, 'document.txt') : source, name)
      }
      const results = await Promise.all(
        ['one', 'two'].map((name) =>
          movePath({ source: `${prefix}-${name}`, destination: `${prefix}-destination` }, root),
        ),
      )
      const loser = results.find((result) => !result.success)!
      const winner = results.find((result) => result.success)!
      const content = (location: string) => readFile(directory ? path.join(location, 'document.txt') : location, 'utf8')
      assert({
        given: `two concurrent ${prefix} moves claiming the same destination`,
        should: 'keep one original and one moved copy without losing or overwriting either document',
        actual: [
          results.filter((result) => result.success).length,
          [await content(loser.source), await content(winner.destination)].sort(),
          await exists(winner.source),
        ],
        expected: [1, ['one', 'two'], false],
      })
    }
  }))

test('recursive moves reject symlinks and destinations inside the source before changing files', async () =>
  fixture(async (root) => {
    await mkdir(path.join(root, 'source'))
    await writeFile(path.join(root, 'source', 'a.txt'), 'intact')
    await symlink(path.join(root, 'source'), path.join(root, 'alias'))
    const nested = await movePath({ source: 'source', destination: 'alias/nested' }, root)
    const link = await movePath({ source: 'alias/', destination: 'moved-link' }, root)
    await symlink('../missing', path.join(root, 'source', 'z-link'))
    const child = await movePath({ source: 'source', destination: 'moved-folder' }, root)
    assert({
      given: 'a destination alias into the source, a trailing-slash source link, and a nested link',
      should: 'refuse all three before moving any file or creating a destination',
      actual: [
        [nested, link, child].every((result) => !result.success && !result.partial),
        (await readdir(path.join(root, 'source'))).sort(),
        await exists(path.join(root, 'moved-folder')),
        await readFile(path.join(root, 'source', 'a.txt'), 'utf8'),
      ],
      expected: [true, ['a.txt', 'z-link'], false, 'intact'],
    })
  }))

test('a cancelled file operation preserves the original and creates no destination', async () =>
  fixture(async (root) => {
    await writeFile(path.join(root, 'original.txt'), 'keep')
    const signal = AbortSignal.abort()
    const result = await movePath({ source: 'original.txt', destination: 'new/target.txt' }, root, signal)
    const folder = await createDirectory({ path: 'new' }, root, signal)
    assert({
      given: 'Stop before a move or folder creation begins',
      should: 'return failure without changing the filesystem',
      actual: [
        result.success,
        folder.success,
        await readdir(root),
        await readFile(path.join(root, 'original.txt'), 'utf8'),
      ],
      expected: [false, false, ['original.txt'], 'keep'],
    })
  }))

test(
  'an interrupted move reports both remaining locations without removing the source',
  { ignore: process.getuid?.() === 0 },
  async () =>
    fixture(async (root) => {
      const source = path.join(root, 'read-only')
      await mkdir(source)
      await writeFile(path.join(source, 'statement.txt'), 'keep both')
      await chmod(source, 0o555)
      try {
        const result = await movePath({ source, destination: 'destination' }, root)
        assert({
          given: 'the destination was claimed but the source directory does not permit unlinking',
          should: 'report a partial move and leave the original plus its destination copy available',
          actual: [
            result.success,
            result.partial,
            result.sourceExists,
            result.destinationExists,
            result.error?.includes('Inspect both paths'),
            await readFile(path.join(source, 'statement.txt'), 'utf8'),
            await readFile(path.join(root, 'destination', 'statement.txt'), 'utf8'),
          ],
          expected: [false, true, true, true, true, 'keep both', 'keep both'],
        })
      } finally {
        await chmod(source, 0o755)
      }
    }),
)

test('full chats expose file management while browser file tools remain read-only', async () =>
  fixture(async (root) => {
    const full = createChatFileTools(options(root))
    const browser = createFileTools({ ...options(root), allowedRoot: root })
    assert({
      given: 'the factories used by chat hosts and the private browser task',
      should: 'add folder operations only to full chat',
      actual: [Object.keys(full).sort(), Object.keys(browser)],
      expected: [['create_directory', 'find_downloads', 'list_directory', 'move_path', 'read_file'], ['read_file']],
    })
  }))
