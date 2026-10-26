import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { buildReviewRecords } from './reviewRecords.ts'

const TUESDAY = new PlainDate('2030-09-24')

/** Tuesday's meetings and events: one ranged, two stating only their start. */
const TUESDAY_FILES: Record<string, string> = {
  'actions/events/27-00_Earnings-call.md': `---
what: Northwind earnings call
when: 2030-09-24 27:00
---

# Northwind earnings call

Quarterly results, read later.
`,
  'actions/meetings/16-30_Zoom_Sam-Lee_Design-review.md': `---
who: Sam Lee
when: 2030-09-24 16:30 - 17:30
---

# Design review

- The partner portal ships after the launch.
`,
  'actions/meetings/11-00_Zoom_Jane-Doe_Release-sync.md': `---
who: Jane Doe, Sam Lee
when: 2030-09-24 11:00
---

# Release sync

- The release moves to Thursday.
`,
}

async function notebook(): Promise<{ base: string; timeDir: string }> {
  const base = await makeTempDir({ prefix: 'sky-day-review-' })
  const timeDir = path.join(base, 'time')
  for (const [relative, content] of Object.entries(TUESDAY_FILES)) {
    const file = path.join(timeDir, dayDir(TUESDAY), relative)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  return { base, timeDir }
}

test('review records - names the meetings and events that state no end time', async () => {
  const { base, timeDir } = await notebook()
  const records = await buildReviewRecords({ dayDirPath: path.join(timeDir, dayDir(TUESDAY)), markdownBaseDir: base })
  assert({
    given: 'a meeting stating only its start, one with a range, and an event stating only its start',
    should: 'name the two records with no end time, in start order',
    actual: records.endless,
    expected: [
      {
        start: '11:00',
        title: 'Release sync',
        path: path.join('time', dayDir(TUESDAY), 'actions/meetings/11-00_Zoom_Jane-Doe_Release-sync.md'),
      },
      {
        start: '27:00',
        title: 'Northwind earnings call',
        path: path.join('time', dayDir(TUESDAY), 'actions/events/27-00_Earnings-call.md'),
      },
    ],
  })
})
