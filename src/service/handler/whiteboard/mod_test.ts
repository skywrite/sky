import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { assert, test } from '#test'
import { createWhiteboardRoutes, type WhiteboardSnapshot } from './mod.ts'

async function withTempNotebook(run: (notebookDir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-whiteboard-route-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('whiteboard routes — missing file returns empty snapshot and first PUT creates time/whiteboard.md', async () => {
  await withTempNotebook(async (dir) => {
    const timeDir = path.join(dir, 'time')
    const indexed: Array<[string, string]> = []
    const store = {
      set: (file: string, content: string) => {
        indexed.push([file, content])
      },
    } as unknown as MarkdownStore
    const app = createWhiteboardRoutes({ markdownBaseDir: dir, timeDir, markdownStore: store })

    const initialRes = await app.request('/')
    const initial = (await initialRes.json()) as WhiteboardSnapshot

    const saveRes = await app.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '# Atlas notes\n\nSend Jane the summary.\n', version: null }),
    })
    const saved = (await saveRes.json()) as WhiteboardSnapshot
    const onDisk = await readFile(path.join(timeDir, 'whiteboard.md'), 'utf8')

    assert({
      given: 'a notebook without time/whiteboard.md yet',
      should: 'return an empty snapshot on GET, then create the file and update the index on PUT',
      actual: [
        initialRes.status,
        initial,
        saveRes.status,
        saved.exists,
        saved.path,
        typeof saved.version,
        onDisk,
        indexed,
      ],
      expected: [
        200,
        { path: 'time/whiteboard.md', exists: false, content: '', version: null },
        200,
        true,
        'time/whiteboard.md',
        'number',
        '# Atlas notes\n\nSend Jane the summary.\n',
        [[path.join(timeDir, 'whiteboard.md'), '# Atlas notes\n\nSend Jane the summary.\n']],
      ],
    })
  })
})

test('whiteboard routes — detects disk conflicts on stale version and allows force overwrite', async () => {
  await withTempNotebook(async (dir) => {
    const timeDir = path.join(dir, 'time')
    const app = createWhiteboardRoutes({ markdownBaseDir: dir, timeDir, markdownStore: null })

    const firstRes = await app.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Initial draft\n', version: null }),
    })
    const first = (await firstRes.json()) as WhiteboardSnapshot

    // External edit on disk
    await writeFile(path.join(timeDir, 'whiteboard.md'), 'Edited outside the web app\n', 'utf8')

    const conflictRes = await app.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Local edit\n', version: first.version }),
    })
    const conflict = (await conflictRes.json()) as { message: string; content: string; version: number }

    const forceRes = await app.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Local edit\n', version: first.version, force: true }),
    })
    const forced = (await forceRes.json()) as WhiteboardSnapshot

    assert({
      given: 'a whiteboard changed on disk since the client read it',
      should: 'reject stale version with 409 and current disk content, and accept force overwrite',
      actual: [conflictRes.status, conflict.content, typeof conflict.version, forceRes.status, forced.content],
      expected: [409, 'Edited outside the web app\n', 'number', 200, 'Local edit\n'],
    })
  })
})
