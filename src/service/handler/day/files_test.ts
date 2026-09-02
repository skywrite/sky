import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { exists, makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { type LocateAnswer, placeFile } from '../attachments/keep.ts'
import { createDayFilesRoutes, kindOf, listDayFiles } from './files.ts'

const YMD = '2026-03-05'
const MODIFIED = new Date('2026-03-05T14:22:31.575Z')

interface World {
  userData: string
  desktop: string
  downloads: string
  trash: string
  dayDir: string
  app: ReturnType<typeof createDayFilesRoutes>
}

async function world(): Promise<World> {
  const root = await makeTempDir({ prefix: 'sky-day-files-' })
  const userData = path.join(root, 'user-data')
  const desktop = path.join(root, 'Desktop')
  const downloads = path.join(root, 'Downloads')
  const trash = path.join(root, 'Trash')
  await Promise.all([mkdir(userData, { recursive: true }), mkdir(desktop), mkdir(downloads)])
  const app = createDayFilesRoutes({
    userDataDir: userData,
    searchDirs: [desktop, downloads],
    spotlight: false,
    trashDir: trash,
  })
  return { userData, desktop, downloads, trash, dayDir: path.join(userData, 'attachments', '2026', '03', '05'), app }
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

test({ name: 'day files - the list is the directory, empty until something lands' }, async () => {
  const w = await world()
  const empty = await (await w.app.request(`/${YMD}/files`)).json()
  await mkdir(w.dayDir, { recursive: true })
  await fileOn(w.dayDir, 'report.pdf', 'twelve bytes')
  await fileOn(w.dayDir, '.DS_Store', 'noise')
  const listed = (await (await w.app.request(`/${YMD}/files`)).json()) as { files: Array<Record<string, unknown>> }
  assert({ given: 'a day with no files yet', should: 'answer an empty list', actual: empty, expected: { files: [] } })
  assert({
    given: 'a PDF in the day directory beside a hidden file',
    should: 'list the PDF with its size and kind, and skip the hidden file',
    actual: listed.files.map((f) => [f.name, f.size, f.kind]),
    expected: [['report.pdf', 12, 'pdf']],
  })
  const notADay = await w.app.request('/2026-13-45/files')
  assert({ given: 'a date that is not a day', should: 'be a 404', actual: notADay.status, expected: 404 })
})

test({ name: 'day files - a located file moves off the desktop into the day, and undo puts it back' }, async () => {
  const w = await world()
  const original = await fileOn(w.desktop, 'report.pdf', 'twelve bytes')
  const look = (await (
    await w.app.request(`/${YMD}/files/locate`, json(facts('report.pdf', 12)))
  ).json()) as LocateAnswer
  assert({
    given: 'the facts a drop carries, for a file on the desktop',
    should: 'settle on that file and name its folder',
    actual: [look.match?.path, look.match?.where, look.ambiguous, look.already],
    expected: [original, 'Desktop', [], false],
  })

  const moved = await w.app.request(
    `/${YMD}/files/move`,
    json({ token: look.token, path: look.match?.path, name: '2026-03-05_report.pdf' }),
  )
  const body = (await moved.json()) as { file: { name: string }; moveId: string; from: { where: string } }
  assert({
    given: 'a move quoting the look and the name chosen',
    should: 'land the file in the day under that name and say where it came from',
    actual: [
      moved.status,
      body.file.name,
      body.from.where,
      await exists(original),
      await exists(path.join(w.dayDir, '2026-03-05_report.pdf')),
    ],
    expected: [200, '2026-03-05_report.pdf', 'Desktop', false, true],
  })

  const undone = await w.app.request(`/${YMD}/files/undo`, json({ moveId: body.moveId }))
  assert({
    given: 'undo while the move is fresh',
    should: 'put the file back on the desktop',
    actual: [undone.status, await exists(original), await exists(path.join(w.dayDir, '2026-03-05_report.pdf'))],
    expected: [200, true, false],
  })
})

test({ name: 'day files - only a located file moves' }, async () => {
  const w = await world()
  const original = await fileOn(w.desktop, 'report.pdf', 'twelve bytes')
  const forged = await w.app.request(
    `/${YMD}/files/move`,
    json({ token: 'made-up', path: original, name: 'report.pdf' }),
  )
  assert({
    given: 'a move that quotes no look',
    should: 'refuse and leave the file where it is',
    actual: [forged.status, await exists(original)],
    expected: [409, true],
  })
  const look = (await (
    await w.app.request(`/${YMD}/files/locate`, json(facts('report.pdf', 12)))
  ).json()) as LocateAnswer
  await writeFile(original, 'the file changed after the look')
  const stale = await w.app.request(
    `/${YMD}/files/move`,
    json({ token: look.token, path: original, name: 'report.pdf' }),
  )
  assert({
    given: 'a file rewritten between the look and the move',
    should: 'refuse rather than move what was not seen',
    actual: [stale.status, await exists(original)],
    expected: [409, true],
  })
})

test({ name: 'day files - duplicates are a question, a namesake elsewhere is not' }, async () => {
  const w = await world()
  await fileOn(w.desktop, 'report.pdf', 'twelve bytes')
  await fileOn(w.downloads, 'report.pdf', 'twelve bytes')
  const look = (await (
    await w.app.request(`/${YMD}/files/locate`, json(facts('report.pdf', 12)))
  ).json()) as LocateAnswer
  assert({
    given: 'the same file on the desktop and in downloads',
    should: 'settle on neither and offer both, desktop first',
    actual: [look.match, look.ambiguous.map((f) => f.where)],
    expected: [null, ['Desktop', 'Downloads']],
  })
  const elsewhere = await world()
  await fileOn(elsewhere.desktop, 'notes.txt', 'twelve bytes')
  const none = (await (
    await elsewhere.app.request(`/${YMD}/files/locate`, json(facts('report.pdf', 12)))
  ).json()) as LocateAnswer
  assert({
    given: 'a name no folder holds',
    should: 'find nothing, so the bytes will be kept as a copy',
    actual: [none.match, none.ambiguous, none.already],
    expected: [null, [], false],
  })
})

test({ name: 'day files - a file already in the day says so' }, async () => {
  const w = await world()
  await mkdir(w.dayDir, { recursive: true })
  await fileOn(w.dayDir, 'report.pdf', 'twelve bytes')
  const app = createDayFilesRoutes({
    userDataDir: w.userData,
    searchDirs: [w.desktop, w.dayDir],
    spotlight: false,
    trashDir: w.trash,
  })
  const look = (await (await app.request(`/${YMD}/files/locate`, json(facts('report.pdf', 12)))).json()) as LocateAnswer
  assert({
    given: "a drop of a file that is already among the day's files",
    should: 'say already, with nothing to move',
    actual: [look.already, look.match, look.ambiguous],
    expected: [true, null, []],
  })
})

test({ name: 'day files - moving onto a namesake dedupes by content' }, async () => {
  const w = await world()
  await mkdir(w.dayDir, { recursive: true })
  await fileOn(w.dayDir, 'report.pdf', 'twelve bytes')
  const same = await fileOn(w.desktop, 'report.pdf', 'twelve bytes')
  const kept = await placeFile(same, w.dayDir, 'report.pdf')
  const different = await fileOn(w.downloads, 'report.pdf', 'other bytes here')
  const pushed = await placeFile(different, w.dayDir, 'report.pdf')
  assert({
    given: 'an identical file moved onto its namesake, then a different one',
    should: 'keep one copy for the identical file and name the different one _2',
    actual: [
      kept,
      pushed,
      await exists(same),
      await exists(different),
      await readFile(path.join(w.dayDir, 'report_2.pdf'), 'utf8'),
    ],
    expected: ['report.pdf', 'report_2.pdf', false, false, 'other bytes here'],
  })
})

test({ name: 'day files - bytes upload as a copy when the original is nowhere' }, async () => {
  const w = await world()
  const put = await w.app.request(`/${YMD}/files?name=${encodeURIComponent('2026-03-05_mail.pdf')}`, {
    method: 'PUT',
    body: new Uint8Array(Buffer.from('from a mail attachment')),
  })
  const body = (await put.json()) as { file: { name: string; size: number } }
  assert({
    given: 'a PUT of the bytes with a name',
    should: 'store them under that name in the day',
    actual: [
      put.status,
      body.file.name,
      body.file.size,
      await readFile(path.join(w.dayDir, '2026-03-05_mail.pdf'), 'utf8'),
    ],
    expected: [200, '2026-03-05_mail.pdf', 22, 'from a mail attachment'],
  })
  const empty = await w.app.request(`/${YMD}/files?name=empty.pdf`, { method: 'PUT', body: new Uint8Array() })
  const noName = await w.app.request(`/${YMD}/files`, { method: 'PUT', body: new Uint8Array([1]) })
  assert({
    given: 'an empty upload, and one without a name',
    should: 'refuse both',
    actual: [empty.status, noName.status],
    expected: [400, 400],
  })
})

test({ name: 'day files - the file itself is served inline, and only by a clean name' }, async () => {
  const w = await world()
  await mkdir(w.dayDir, { recursive: true })
  await fileOn(w.dayDir, 'chart.png', 'PNG bytes')
  const served = await w.app.request(`/${YMD}/files/chart.png`)
  assert({
    given: 'a file in the day',
    should: 'serve its bytes with the image type, inline',
    actual: [
      served.status,
      served.headers.get('content-type'),
      served.headers.get('content-disposition')?.startsWith('inline'),
      await served.text(),
    ],
    expected: [200, 'image/png', true, 'PNG bytes'],
  })
  const missing = await w.app.request(`/${YMD}/files/nothing.png`)
  const hidden = await w.app.request(`/${YMD}/files/.env`)
  assert({
    given: 'a name the day does not hold, and a hidden-file name',
    should: 'answer 404 and 400',
    actual: [missing.status, hidden.status],
    expected: [404, 400],
  })
})

test({ name: 'day files - remove sends the file to the Trash' }, async () => {
  const w = await world()
  await mkdir(w.dayDir, { recursive: true })
  await fileOn(w.dayDir, 'report.pdf', 'twelve bytes')
  const removed = await w.app.request(`/${YMD}/files/remove`, json({ name: 'report.pdf' }))
  assert({
    given: 'remove for a file in the day',
    should: 'move it into the Trash, out of the day',
    actual: [
      removed.status,
      await exists(path.join(w.dayDir, 'report.pdf')),
      await exists(path.join(w.trash, 'report.pdf')),
    ],
    expected: [200, false, true],
  })
  const again = await w.app.request(`/${YMD}/files/remove`, json({ name: 'report.pdf' }))
  assert({ given: 'remove for a file no longer there', should: 'be a 404', actual: again.status, expected: 404 })
})

test({ name: 'day files - kinds come from the extension' }, () => {
  assert({
    given: 'a spread of names',
    should: 'sort them into the kinds the page draws',
    actual: ['a.PDF', 'b.heic', 'c.m4a', 'd.mov', 'e.docx', 'f.zip', 'g.vtt', 'h.unknown', 'noext'].map(kindOf),
    expected: ['pdf', 'image', 'audio', 'video', 'document', 'archive', 'text', 'file', 'file'],
  })
})

test({ name: 'day files - listDayFiles sorts by name' }, async () => {
  const w = await world()
  await mkdir(w.dayDir, { recursive: true })
  await fileOn(w.dayDir, 'b.txt', 'b')
  await fileOn(w.dayDir, 'a.txt', 'a')
  assert({
    given: 'two files',
    should: 'list them by name',
    actual: (await listDayFiles(w.dayDir)).map((f) => f.name),
    expected: ['a.txt', 'b.txt'],
  })
})
