import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { buildDayRecord } from './record.ts'

test('day record merges linked meetings with files and retains inline notes', async () => {
  const base = await makeTempDir({ prefix: 'sky-meetings-' })
  const day = new PlainDate('2026-01-27')
  const timeDir = path.join(base, 'time')
  const dir = path.join(timeDir, dayDir(day))
  await mkdir(path.join(dir, 'actions/meetings'), { recursive: true })
  await writeFile(
    path.join(timeDir, dayFile(day)),
    `---
date: 2026-01-27
---
## Professional Complete
- 10:00 > Jane Doe Zoom -> discussed next steps
- 11:00 > Alex Chen Zoom -> [Planning](actions/meetings/planning.md)
`,
  )
  await writeFile(
    path.join(dir, 'actions/meetings/planning.md'),
    `---
who: Alex Chen
when: 2026-01-27 11:00 - 11:30
summary: Planning the next release together.
---
# Planning

We discussed the release plan and agreed on next steps.
`,
  )
  const record = await buildDayRecord({ day, timeDir, dayDirPath: dir, markdownBaseDir: base, ownerNames: [] })
  assert({
    given: 'an inline meeting and a linked meeting with its file',
    should: 'show two records with a day link for the inline note',
    actual: record.meetings.map((m) => ({ title: m.title, path: m.path, when: m.when, inline: m.inline ?? false })),
    expected: [
      { title: 'Jane Doe Zoom', path: path.join('time', dayFile(day)), when: '10:00', inline: true },
      {
        title: 'Planning',
        path: path.join('time', dayDir(day), 'actions/meetings/planning.md'),
        when: '11:00 - 11:30',
        inline: false,
      },
    ],
  })
})

test('timed manual meetings appear once under Meetings while ordinary arrows stay in Done', async () => {
  const base = await makeTempDir({ prefix: 'sky-inline-meeting-' })
  const day = new PlainDate('2026-01-27')
  const timeDir = path.join(base, 'time')
  const dir = path.join(timeDir, dayDir(day))
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(timeDir, dayFile(day)),
    `# 2026-01-27

## Personal Complete
- 10:15(45m) > Jane Doe In Person -> Reviewed the launch plan
- 11:00 30m > Jane Doe Phone -> Discussed next steps
- 12:00(30m) > Draft -> Revised the launch plan
- 12:40 > Notebook -> 2026-01-26 End
- 13:00 > Notes -> [Summary](actions/notes/summary.md)
- 13:30 > projects/Atlas -> Created
`,
  )
  const record = await buildDayRecord({ day, timeDir, dayDirPath: dir, markdownBaseDir: base, ownerNames: [] })
  assert({
    given: 'manual meeting notes, a completed activity with an arrow, and automatic logs',
    should: 'keep meeting notes and durations under Meetings and only the ordinary activity under Done',
    actual: {
      meetings: record.meetings.map(({ when, minutes, who, summary, inline }) => ({
        when,
        minutes,
        who,
        summary,
        inline,
      })),
      done: record.done.map(({ time, minutes, text }) => ({ time, minutes, text })),
    },
    expected: {
      meetings: [
        { when: '10:15', minutes: 45, who: 'Jane Doe', summary: 'Reviewed the launch plan', inline: true },
        { when: '11:00', minutes: 30, who: 'Jane Doe', summary: 'Discussed next steps', inline: true },
      ],
      done: [{ time: '12:00', minutes: 30, text: 'Draft -> Revised the launch plan' }],
    },
  })
})
