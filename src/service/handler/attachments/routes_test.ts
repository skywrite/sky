// A file added to a document from the rail: the look for its original, the move in beside the
// document, the undo — each landing where the document keeps its files.

import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { exists, makeTempDir } from '#shared/fs/mod.ts'
import dayDir from '#shared/nbfs/dayDir.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { LocateAnswer } from './keep.ts'
import { ATTACHMENT_MOUNT, createAttachmentRoutes } from './routes.ts'

const DAY = new PlainDate('2026-03-05')
const DAY_DOC = path.posix.join('time', dayDir(DAY), 'standup.md')
const GUIDE_DOC = 'library/guides/spreadsheets.md'
const MODIFIED = new Date('2026-03-05T14:22:31.575Z')

interface World {
  notebook: string
  userData: string
  downloads: string
  app: ReturnType<typeof createAttachmentRoutes>
}

async function world(): Promise<World> {
  const root = await makeTempDir({ prefix: 'sky-attach-routes-' })
  const notebook = path.join(root, 'notebook')
  const userData = path.join(root, 'user-data')
  const downloads = path.join(root, 'Downloads')
  for (const doc of [DAY_DOC, GUIDE_DOC]) {
    await mkdir(path.dirname(path.join(notebook, doc)), { recursive: true })
    await writeFile(path.join(notebook, doc), '---\ntitle: A document\n---\n\nHello\n')
  }
  await Promise.all([mkdir(userData, { recursive: true }), mkdir(downloads)])
  const app = createAttachmentRoutes({
    markdownBaseDir: notebook,
    markdownDirs: [path.join(notebook, 'time'), path.join(notebook, 'library')],
    userDataDir: userData,
    keep: { searchDirs: [downloads], spotlight: false },
  })
  return { notebook, userData, downloads, app }
}

/** A file as a person dropped it: bytes on disk, stamped with the fixed modified time. */
async function fileOn(dir: string, name: string, bytes: string): Promise<string> {
  const file = path.join(dir, name)
  await writeFile(file, bytes)
  await utimes(file, MODIFIED, MODIFIED)
  return file
}

const facts = (name: string, size: number) => ({ name, size, lastModified: MODIFIED.getTime() })

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const route = (name: string, doc: string) => `${ATTACHMENT_MOUNT}/${name}/${doc}`

test(
  { name: "attach routes - a day document's file moves into the day's attachments, and undo puts it back" },
  async () => {
    const w = await world()
    const original = await fileOn(w.downloads, 'report.pdf', 'twelve bytes')
    const look = (await (
      await w.app.request(route('attach-locate', DAY_DOC), json(facts('report.pdf', 12)))
    ).json()) as LocateAnswer
    assert({
      given: 'the facts a drop carries, for a file in Downloads',
      should: 'settle on that file and name its folder',
      actual: [look.match?.path, look.match?.where, look.ambiguous, look.already],
      expected: [original, 'Downloads', [], false],
    })

    const moved = await w.app.request(
      route('attach-move', DAY_DOC),
      json({ token: look.token, path: look.match?.path, name: 'report.pdf' }),
    )
    const body = (await moved.json()) as { file: string; day?: string; moveId: string; from: { where: string } }
    const landed = path.join(w.userData, 'attachments', '2026', '03', '05', 'report.pdf')
    assert({
      given: 'a move quoting the look',
      should: "land the file in the day's attachments, name the day, and say where it came from",
      actual: [moved.status, body.file, body.day, body.from.where, await exists(original), await exists(landed)],
      expected: [200, 'report.pdf', '2026-03-05', 'Downloads', false, true],
    })

    const undone = await w.app.request(`${ATTACHMENT_MOUNT}/attach-undo`, json({ moveId: body.moveId }))
    assert({
      given: 'undo while the move is fresh',
      should: 'put the file back in Downloads',
      actual: [undone.status, await exists(original), await exists(landed)],
      expected: [200, true, false],
    })
  },
)

test({ name: "attach routes - any other document's file moves into the mirror of its directory" }, async () => {
  const w = await world()
  const original = await fileOn(w.downloads, 'chart.png', 'twelve bytes')
  const look = (await (
    await w.app.request(route('attach-locate', GUIDE_DOC), json(facts('chart.png', 12)))
  ).json()) as LocateAnswer
  const moved = await w.app.request(
    route('attach-move', GUIDE_DOC),
    json({ token: look.token, path: look.match?.path, name: 'chart.png' }),
  )
  const body = (await moved.json()) as { file: string; day?: string }
  assert({
    given: 'a move for a document under library/',
    should: 'land the file in the user-data mirror of library/guides, with no day',
    actual: [
      moved.status,
      body.file,
      body.day,
      await exists(original),
      await readFile(path.join(w.userData, 'library', 'guides', 'chart.png'), 'utf8'),
    ],
    expected: [200, 'chart.png', undefined, false, 'twelve bytes'],
  })
})

test({ name: 'attach routes - only a located file moves, and only for a document in the notebook' }, async () => {
  const w = await world()
  const original = await fileOn(w.downloads, 'report.pdf', 'twelve bytes')
  const forged = await w.app.request(
    route('attach-move', DAY_DOC),
    json({ token: 'made-up', path: original, name: 'report.pdf' }),
  )
  const outside = await w.app.request(route('attach-locate', 'secrets/notes.md'), json(facts('report.pdf', 12)))
  const noFacts = await w.app.request(route('attach-locate', DAY_DOC), json({ name: 'report.pdf' }))
  const nothing = await w.app.request(`${ATTACHMENT_MOUNT}/attach-undo`, json({ moveId: 'made-up' }))
  assert({
    given:
      'a move quoting no look, a look for a document outside the configured directories, a look without facts, and an undo of nothing',
    should: 'refuse each — the file stays where it is',
    actual: [forged.status, outside.status, noFacts.status, nothing.status, await exists(original)],
    expected: [409, 403, 400, 404, true],
  })
})

test({ name: 'attach routes - the bytes land as a copy, deduplicated by content' }, async () => {
  const w = await world()
  const put = await w.app.request(`${route('attach', DAY_DOC)}?name=notes.txt`, {
    method: 'PUT',
    body: new Uint8Array(Buffer.from('from a mail attachment')),
  })
  const body = (await put.json()) as { file: string; day?: string }
  assert({
    given: 'a PUT of the bytes with a name, for a day document',
    should: "store them in the day's attachments and name the day",
    actual: [
      put.status,
      body,
      await readFile(path.join(w.userData, 'attachments', '2026', '03', '05', 'notes.txt'), 'utf8'),
    ],
    expected: [200, { file: 'notes.txt', day: '2026-03-05' }, 'from a mail attachment'],
  })
})

test({ name: "attach routes - the list is the document's directory, empty until something lands" }, async () => {
  const w = await world()
  const empty = await (await w.app.request(route('attach', DAY_DOC))).json()
  await w.app.request(`${route('attach', DAY_DOC)}?name=notes.txt`, {
    method: 'PUT',
    body: new Uint8Array(Buffer.from('a few notes')),
  })
  const listed = (await (await w.app.request(route('attach', DAY_DOC))).json()) as {
    files: Array<Record<string, unknown>>
  }
  assert({
    given: 'a day document whose day holds nothing yet, then a file put beside it',
    should: 'answer an empty list, then the file with its size and kind',
    actual: [empty, listed.files.map((f) => [f.name, f.size, f.kind])],
    expected: [{ files: [] }, [['notes.txt', 11, 'text']]],
  })
})
