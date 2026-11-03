import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { createNoteRoutes, noteFileStem, noteTitle, stampNote } from './notes.ts'

const DAY = new PlainDate('2026-01-27')
const DAY_MD = `---
date: 2026-01-27
---

# **2026-01-27**

## Professional Complete

- 09:00 > Called Jane about Atlas

## Personal Complete

-
`

/** A notebook with one started day, and the note routes over it at 10:30 on the notebook clock. */
async function notebook() {
  const base = await makeTempDir({ prefix: 'sky-day-notes-' })
  const timeDir = path.join(base, 'time')
  const dayPath = path.join(timeDir, dayFile(DAY))
  await mkdir(path.dirname(dayPath), { recursive: true })
  await writeFile(dayPath, DAY_MD)
  const app = createNoteRoutes({
    timeDir,
    markdownBaseDir: base,
    stateDir: path.join(base, 'state'),
    clock: () => new ZonedDateTime('2026-01-27T10:30:00', 'UTC'),
  })
  const send = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const notesDir = path.join(timeDir, dayDir(DAY), 'actions', 'notes')
  return { base, send, dayPath, notesDir }
}

const WRITTEN = `---
type: Notes
tags: atlas
---

# Atlas launch plan

Launch moves to **November 12**.
`

test('day notes - the first save files the note under the day and lists it, the way notes:new does', async () => {
  const { send, dayPath, notesDir } = await notebook()
  const response = await send('POST', '/2026-01-27/notes', { content: WRITTEN, category: 'Professional' })
  const body = (await response.json()) as { path: string; slug: string; content: string; category: string }
  const file = await readFile(path.join(notesDir, 'Atlas-launch-plan.md'), 'utf8')
  const day = await readFile(dayPath, 'utf8')

  assert({
    given: 'a note with a title, a tag added in the rail, and a body, saved as Professional at 10:30',
    should: 'write summary, when and type first, keep the tag and the body, and add its line to Professional Complete',
    actual: [
      response.status,
      body.path,
      body.slug,
      body.category,
      body.content === file,
      file,
      day.split('\n').slice(8, 11),
    ],
    expected: [
      201,
      path.join('time', dayDir(DAY), 'actions', 'notes', 'Atlas-launch-plan.md'),
      'Atlas-launch-plan',
      'Professional',
      true,
      '---\nsummary: Atlas launch plan\nwhen: 10:30\ntype: Notes\ntags: atlas\n---\n\n# Atlas launch plan\n\nLaunch moves to **November 12**.\n',
      [
        '- 09:00 > Called Jane about Atlas',
        '- 10:30 > Notes -> [Atlas launch plan](actions/notes/Atlas-launch-plan.md)',
        '',
      ],
    ],
  })
})

test('day notes - a second note with the same title gets its own file, and a body-only note takes its first words', async () => {
  const { send, notesDir } = await notebook()
  await send('POST', '/2026-01-27/notes', { content: '# Standup\n', category: 'Personal' })
  const again = (await (
    await send('POST', '/2026-01-27/notes', { content: '# Standup\n', category: 'Personal' })
  ).json()) as {
    slug: string
  }
  const untitled = (await (
    await send('POST', '/2026-01-27/notes', { content: '# \n\nCalled Jamal about the pilot\n', category: 'Personal' })
  ).json()) as { slug: string; content: string }

  assert({
    given: 'two notes titled Standup, then one with an empty heading and a line of text',
    should: 'name the second Standup-2, and the third from its first line, with that line as its summary',
    actual: [
      again.slug,
      untitled.slug,
      untitled.content.split('\n')[1],
      (await readFile(path.join(notesDir, 'Standup-2.md'), 'utf8')).length > 0,
    ],
    expected: ['Standup-2', 'Called-Jamal-about-the-pilot', 'summary: Called Jamal about the pilot', true],
  })
})

test('day notes - a note is found by its name with its category, and moves between Professional and Personal', async () => {
  const { send, dayPath } = await notebook()
  await send('POST', '/2026-01-27/notes', { content: '# Board prep\n', category: 'Professional' })
  const found = (await (await send('GET', '/2026-01-27/notes/Board-prep')).json()) as Record<string, unknown>
  const moved = await send('PUT', '/2026-01-27/notes/Board-prep/category', { category: 'Personal' })
  const after = (await (await send('GET', '/2026-01-27/notes/Board-prep')).json()) as Record<string, unknown>
  const day = await readFile(dayPath, 'utf8')

  assert({
    given: 'a Professional note, looked up, moved to Personal, and looked up again',
    should: 'answer its path and category, then list its line under Personal Complete only',
    actual: [
      found,
      moved.status,
      after['category'],
      day.includes(
        '## Professional Complete\n\n- 09:00 > Called Jane about Atlas\n\n## Personal Complete\n\n- 10:30 > Notes -> [Board prep](actions/notes/Board-prep.md)',
      ),
    ],
    expected: [
      {
        path: path.join('time', dayDir(DAY), 'actions', 'notes', 'Board-prep.md'),
        slug: 'Board-prep',
        category: 'Professional',
      },
      200,
      'Personal',
      true,
    ],
  })
})

test('day notes - what is refused, and why', async () => {
  const { send } = await notebook()
  const statuses = await Promise.all([
    send(
      'POST',
      '/2026-01-27/notes',
      { content: '# Hi\n', category: 'Professional' },
      { 'sec-fetch-site': 'cross-site' },
    ),
    send(
      'POST',
      '/2026-01-27/notes',
      { content: '# Hi\n', category: 'Professional' },
      { 'content-type': 'text/plain' },
    ),
    send('POST', '/2026-01-27/notes', { content: '  \n', category: 'Professional' }),
    send('POST', '/2026-01-27/notes', { content: '# Hi\n', category: 'Hobby' }),
    send('POST', '/2026-02-30/notes', { content: '# Hi\n', category: 'Personal' }),
    send('GET', '/2026-01-27/notes/Nothing-here'),
    send('GET', '/2026-01-27/notes/.hidden'),
  ])

  assert({
    given:
      'a cross-site write, a non-JSON write, an empty note, an unknown category, a day that does not exist, a missing note, and a hidden name',
    should: 'refuse each, saying so',
    actual: statuses.map((response) => response.status),
    expected: [403, 400, 400, 400, 404, 404, 400],
  })
})

test('day notes - the title, the file name, and the front matter a first save writes', () => {
  assert({
    given: 'a heading with marks and a link, no heading but a list line, a long first line, and nothing',
    should: 'read the words, the line without its marker, the first eight words, and Note',
    actual: [
      noteTitle('---\nsummary: Old\n---\n\n# The **Atlas** [plan](x.md)\n'),
      noteTitle('- [ ] Book the venue\n'),
      noteTitle('one two three four five six seven eight nine ten\n'),
      noteTitle('# \n\n'),
    ],
    expected: ['The Atlas plan', 'Book the venue', 'one two three four five six seven eight…', 'Note'],
  })
  assert({
    given: 'a title that would name the blank page, and one ending in an ellipsis',
    should: 'keep the blank page’s address free and drop the ellipsis',
    actual: [noteFileStem('new'), noteFileStem('one two three…')],
    expected: ['new-Note', 'one-two-three'],
  })
  assert({
    given: 'a title with a colon, and front matter whose summary is already written',
    should: 'quote the summary, and leave a written one as it is',
    actual: [stampNote('# Q3: plan\n', 'Q3: plan', '25:30'), stampNote('---\nsummary: Mine\n---\n# B\n', 'B', '09:00')],
    expected: [
      '---\nsummary: "Q3: plan"\nwhen: 25:30\ntype: Notes\n---\n\n# Q3: plan\n',
      '---\nwhen: 09:00\ntype: Notes\nsummary: Mine\n---\n\n# B\n',
    ],
  })
})
