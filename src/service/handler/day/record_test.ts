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
