import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createExplorerRoutes } from './mod.ts'
import type { RemoveAnswer } from './remove.ts'

const YMD = '2026-01-28'
const DAY_DIR = `time/${dayDir(new PlainDate(YMD))}`
const ROADMAP = `${DAY_DIR}/notes/09-15_Roadmap.md`
const OTHER = `${DAY_DIR}/notes/10-00_Other.md`
const SPACED = `${DAY_DIR}/notes/10-30_Road map.md`
const MESSAGE = `${DAY_DIR}/actions/messages/07-10_slack_Jane-to-John.md`
const DAY_FILE = `${DAY_DIR}/day.md`

const DAY_MD = `---
started: 09:00
---

# **2026-01-28 - Wed**

## Professional Complete

- 07:10 > Jane to John Slack -> [Widget check-in][msg]
- 09:15 > Notes -> [Roadmap](notes/09-15_Roadmap.md)
  - a thought kept under the line
- 10:00 > Notes -> [Other](notes/10-00_Other.md)
- 10:30 > Notes -> [Road map](notes/10-30_Road%20map.md)

## Personal Todos

- Review the roadmap — [Roadmap](notes/09-15_Roadmap.md)

## Personal Reminders

- Buy milk
  - the list is in [the roadmap](notes/09-15_Roadmap.md)

[msg]: actions/messages/07-10_slack_Jane-to-John.md
`

/** The day without the two lines that were about the roadmap: the capture and the to-do, the reminder's nested mention kept. */
const DAY_MD_AFTER = `---
started: 09:00
---

# **2026-01-28 - Wed**

## Professional Complete

- 07:10 > Jane to John Slack -> [Widget check-in][msg]
- 10:00 > Notes -> [Other](notes/10-00_Other.md)
- 10:30 > Notes -> [Road map](notes/10-30_Road%20map.md)

## Personal Todos

-

## Personal Reminders

- Buy milk
  - the list is in [the roadmap](notes/09-15_Roadmap.md)

[msg]: actions/messages/07-10_slack_Jane-to-John.md
`

/** A notebook with a day, its notes and a message, a project file no day lists, and a directory outside the roots. */
async function notebook() {
  const base = await makeTempDir({ prefix: 'sky-explorer-remove-' })
  const trash = path.join(base, 'Trash')
  const files: Record<string, string> = {
    [DAY_FILE]: DAY_MD,
    [ROADMAP]: '---\ntitle: Roadmap\n---\n\n# Roadmap\n',
    [OTHER]: '# Other\n',
    [SPACED]: '# Road map\n',
    [MESSAGE]: '---\nsummary: Widget check-in\n---\n',
    'projects/Atlas/Roadmap.md': '# Atlas roadmap\n',
    'journal/about-me.md': '# Me\n',
  }
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(base, file)), { recursive: true })
    await writeFile(path.join(base, file), content)
  }
  const app = createExplorerRoutes({
    markdownBaseDir: base,
    markdownDirs: ['time', 'projects'].map((name) => path.join(base, name)),
    remove: { userDataDir: path.join(base, '.user-data'), timeDir: path.join(base, 'time'), trashDir: trash },
  })
  const post = async (route: string, body: unknown) =>
    app.request(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const remove = async (file: string) => (await post('/remove', { path: file })).json() as Promise<RemoveAnswer>
  const undo = (moveId: string) => post('/undo', { moveId })
  const trashed = async () => (existsSync(trash) ? (await readdir(trash)).sort() : [])
  const day = () => readFile(path.join(base, DAY_FILE), 'utf8')
  const has = (file: string) => existsSync(path.join(base, file))
  return { base, app, post, remove, undo, trashed, day, has }
}

test({ name: 'explorer - Delete moves the file to the Trash and takes its lines off its day' }, async () => {
  const nb = await notebook()
  const answer = await nb.remove(ROADMAP)

  assert({
    given: 'a note captured under a day, which the day lists once as the capture and once in a to-do',
    should: 'move the note to the Trash and name the day that let go of both lines',
    actual: { ok: answer.ok, day: answer.day, gone: !nb.has(ROADMAP), trash: await nb.trashed() },
    expected: {
      ok: true,
      day: { ymd: YMD, label: 'Wednesday, January 28, 2026', lines: 2 },
      gone: true,
      trash: ['09-15_Roadmap.md'],
    },
  })

  assert({
    given: 'the day file afterwards',
    should:
      'lose the capture line with the thought under it and the to-do, keep the neighbours, the reminder whose nested note mentions the file, and the reference definition, and leave the emptied list its slot',
    actual: await nb.day(),
    expected: DAY_MD_AFTER,
  })
})

test({ name: 'explorer - Undo puts the file back and its lines where they were' }, async () => {
  const nb = await notebook()
  const answer = await nb.remove(ROADMAP)
  const undone = (await nb.undo(answer.moveId)).status
  const again = (await nb.undo(answer.moveId)).status

  assert({
    given: 'a delete undone while it is fresh, then undone once more',
    should: 'put the file back out of the Trash, restore the day byte for byte, and have nothing left to undo',
    actual: { undone, again, back: nb.has(ROADMAP), trash: await nb.trashed(), day: await nb.day() },
    expected: { undone: 200, again: 404, back: true, trash: [], day: DAY_MD },
  })
})

test({ name: 'explorer - a line linking by reference, or with a percent-encoded name, leaves too' }, async () => {
  const nb = await notebook()
  const message = await nb.remove(MESSAGE)
  const spaced = await nb.remove(SPACED)
  const day = await nb.day()

  assert({
    given: 'a message the day links through a `[msg]` definition, and a note whose name is written percent-encoded',
    should: 'take both lines off the day, keeping the definition line and the other captures',
    actual: {
      lines: [message.day?.lines, spaced.day?.lines],
      hasMessageLine: day.includes('[Widget check-in][msg]'),
      hasDefinition: day.includes('[msg]: actions/messages/07-10_slack_Jane-to-John.md'),
      hasSpacedLine: day.includes('Road%20map'),
      hasOtherLine: day.includes('[Other](notes/10-00_Other.md)'),
      trash: await nb.trashed(),
    },
    expected: {
      lines: [1, 1],
      hasMessageLine: false,
      hasDefinition: true,
      hasSpacedLine: false,
      hasOtherLine: true,
      trash: ['07-10_slack_Jane-to-John.md', '10-30_Road map.md'],
    },
  })
})

test({ name: 'explorer - a file no day lists, and the day file itself, only go to the Trash' }, async () => {
  const nb = await notebook()
  const project = await nb.remove('projects/Atlas/Roadmap.md')
  const dayItself = await nb.remove(DAY_FILE)

  assert({
    given: 'a project file outside the days, and a day file',
    should: 'move each to the Trash and name no day for either',
    actual: {
      days: [project.day, dayItself.day],
      gone: [!nb.has('projects/Atlas/Roadmap.md'), !nb.has(DAY_FILE)],
      trash: await nb.trashed(),
    },
    expected: { days: [null, null], gone: [true, true], trash: ['Roadmap.md', 'day.md'] },
  })
})

test({ name: 'explorer - what cannot be deleted or undone is refused with the status that says why' }, async () => {
  const nb = await notebook()
  const statuses = await Promise.all(
    [
      { path: 'journal/about-me.md' },
      { path: `${DAY_DIR}/notes/nope.md` },
      { path: `${DAY_DIR}/notes` },
      { path: '/etc/passwd.md' },
      {},
    ].map(async (body) => (await nb.post('/remove', body)).status),
  )
  const answer = await nb.remove(OTHER)
  await rm(path.join(nb.base, 'Trash', '10-00_Other.md'))
  const movedOn = (await nb.undo(answer.moveId)).status
  const nothing = (await nb.undo('not-a-move')).status

  assert({
    given:
      'a file outside the roots, a missing file, a directory, an absolute path, no path at all, an undo after the Trash was emptied, and an undo of nothing',
    should: 'refuse each with its own status',
    actual: [...statuses, movedOn, nothing],
    expected: [403, 404, 400, 400, 400, 409, 404],
  })
})
