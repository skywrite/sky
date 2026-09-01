import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { buildDayRecord } from './record.ts'

const TODAY = new PlainDate('2026-01-27')
const OWNER = ['Alex Atlas', 'Alex']

const DAY_MD = `---
date: 2026-01-27
---

# **2026-01-27 - Tue**

## Most Important

- Ship the Atlas pricing page

## Professional Commitments

- ~~Send Jane the flat-floor math~~
- Reply to the vendor shortlist by Friday

## Personal Commitments

- 17:30 > Pick up the retreat keys

## Personal Todos

- Book the retreat holds

## Reminders

- Passport window opens Monday
- ~~Water the plants~~

## Professional Complete

- ~~Submit the expense report~~
- 09:30 > Jane to #atlas-general Slack -> [Pricing](actions/messages/slack_Jane-Doe-to-Alex-Atlas_Pricing.md)
- 09:30 > ~~[Atlas Launch Planning](actions/ai-chats/09-30_Atlas-Launch-Planning.md)~~
- 14:10 > Notebook -> 2026-01-26 End

## Personal Complete

-
`

const MEETING_MD = `---
when: 2026-01-27 11:00 - 11:45
who: Jane Doe
summary: Pricing objections and the invoicing question
---

# Atlas Sync

Jane pushed back on annual invoicing; the flat-floor math is the answer we owe her by Friday.
`

const ARCHIVE_MD = `---
from: Ops
to: atlas-general
medium: slack
---

# Standup Notes

Vendor shortlist narrowed to three candidates pending pricing; the retreat holds both expire Monday.
`

const INVOLVED_MD = `---
from: Jane Doe
to: Alex Atlas
medium: slack
summary: The invoicing question, again
---

# Pricing

## 2026-01-27 10:12 - **Jane Doe**

Can we do monthly against a usage tier instead of annual? The flat floor is fine, the invoice isn't.
`

const JOURNAL_MD = `---
created: 2026-01-27
---

# Morning

Dithering is a data problem, not a courage problem. Put the real numbers on one page first, always.
`

const STAMPED_JOURNAL_MD = `---
created: 2026-01-27
---

# Focus: 2026-01-27 - Tue - 13:30

One page of real numbers before any more dithering.
`

/** A notebook with one fully furnished day. */
async function notebook(): Promise<{ base: string; timeDir: string; dayDirPath: string }> {
  const base = await makeTempDir({ prefix: 'sky-day-record-' })
  const timeDir = path.join(base, 'time')
  const dayDirPath = path.join(timeDir, dayDir(TODAY))
  await mkdir(path.join(dayDirPath, 'actions', 'meetings'), { recursive: true })
  await mkdir(path.join(dayDirPath, 'actions', 'messages'), { recursive: true })
  await mkdir(path.join(dayDirPath, 'journal'), { recursive: true })
  await writeFile(path.join(timeDir, dayFile(TODAY)), DAY_MD)
  await writeFile(path.join(dayDirPath, 'actions', 'meetings', '11-00_Atlas_Sync.md'), MEETING_MD)
  await writeFile(
    path.join(dayDirPath, 'actions', 'messages', 'slack_Ops-to-atlas-general_Standup-Notes.md'),
    ARCHIVE_MD,
  )
  await writeFile(path.join(dayDirPath, 'actions', 'messages', 'slack_Jane-Doe-to-Alex-Atlas_Pricing.md'), INVOLVED_MD)
  await writeFile(path.join(dayDirPath, 'journal', '08_Morning.md'), JOURNAL_MD)
  await writeFile(path.join(dayDirPath, 'journal', '13-30_Focus.md'), STAMPED_JOURNAL_MD)
  return { base, timeDir, dayDirPath }
}

test({ name: 'day record - the plan and its outcome come from the day file' }, async () => {
  const { base, timeDir, dayDirPath } = await notebook()
  const record = await buildDayRecord({ day: TODAY, timeDir, dayDirPath, markdownBaseDir: base, ownerNames: OWNER })

  assert({
    given: 'a day file with every section, a linkless routine log, and an empty `-` slot',
    should: 'read each list as items — capture and routine logs are not Done, and a blank bullet is nothing',
    actual: {
      mostImportant: record.mostImportant.map((i) => i.text),
      commitments: record.commitments.map((i) => ({ text: i.text, done: i.done, category: i.category, time: i.time })),
      todos: record.todos.map((i) => ({ text: i.text, category: i.category })),
      reminders: record.reminders.map((i) => ({ text: i.text, done: i.done })),
      done: record.done,
    },
    expected: {
      mostImportant: ['Ship the Atlas pricing page'],
      commitments: [
        { text: 'Send Jane the flat-floor math', done: true, category: 'Professional', time: null },
        { text: 'Reply to the vendor shortlist by Friday', done: false, category: 'Professional', time: null },
        { text: 'Pick up the retreat keys', done: false, category: 'Personal', time: '17:30' },
      ],
      todos: [{ text: 'Book the retreat holds', category: 'Personal' }],
      reminders: [
        { text: 'Passport window opens Monday', done: false },
        { text: 'Water the plants', done: true },
      ],
      done: [
        {
          text: 'Submit the expense report',
          done: true,
          category: 'Professional',
          time: null,
          link: null,
          list: 'Professional Complete',
          raw: '~~Submit the expense report~~',
        },
      ],
    },
  })

  assert({
    given: 'an open commitment the view will want to strike',
    should: 'carry its exact list heading and stored text as the write-back address',
    actual: {
      list: record.commitments[1].list,
      raw: record.commitments[1].raw,
      timedRaw: record.commitments[2].raw,
    },
    expected: {
      list: 'Professional Commitments',
      raw: 'Reply to the vendor shortlist by Friday',
      timedRaw: '17:30 > Pick up the retreat keys',
    },
  })
})

test({ name: 'day record - meetings, messages, and journals come from what was filed' }, async () => {
  const { base, timeDir, dayDirPath } = await notebook()
  const record = await buildDayRecord({ day: TODAY, timeDir, dayDirPath, markdownBaseDir: base, ownerNames: OWNER })
  const rel = (...parts: string[]) => path.join('time', dayDir(TODAY), ...parts)

  assert({
    given: 'a meeting, two messages, and two journals filed under the day',
    should: 'list the meeting with its range and who; a stamp-named journal reads as its name at its time',
    actual: {
      meetings: record.meetings,
      journals: record.journals.map((j) => ({ title: j.title, when: j.when })),
      skipped: record.skipped,
    },
    expected: {
      meetings: [
        {
          title: 'Atlas Sync',
          path: rel('actions', 'meetings', '11-00_Atlas_Sync.md'),
          when: '11:00 - 11:45',
          summary: 'Pricing objections and the invoicing question',
          who: 'Jane Doe',
        },
      ],
      journals: [
        { title: 'Morning', when: null },
        { title: 'Focus', when: '13:30' },
      ],
      skipped: 0,
    },
  })

  assert({
    given: 'one thread the owner is a party to and one channel capture they appear nowhere in',
    should: "split them by summary:day's rule — involved versus archival",
    actual: {
      involved: record.messages.involved.map((m) => ({ title: m.title, from: m.from, to: m.to })),
      archive: record.messages.archive.map((m) => ({ title: m.title, from: m.from, to: m.to })),
    },
    expected: {
      involved: [{ title: 'Pricing', from: 'Jane Doe', to: 'Alex Atlas' }],
      archive: [{ title: 'Standup Notes', from: 'Ops', to: 'atlas-general' }],
    },
  })
})

test({ name: 'day record - a day with no file yet has an empty plan, not an error' }, async () => {
  const base = await makeTempDir({ prefix: 'sky-day-record-empty-' })
  const timeDir = path.join(base, 'time')
  const record = await buildDayRecord({
    day: TODAY,
    timeDir,
    dayDirPath: path.join(timeDir, dayDir(TODAY)),
    markdownBaseDir: base,
    ownerNames: OWNER,
  })

  assert({
    given: 'a day directory that does not exist',
    should: 'return an empty record',
    actual: {
      items:
        record.mostImportant.length +
        record.commitments.length +
        record.todos.length +
        record.reminders.length +
        record.done.length,
      filed:
        record.meetings.length +
        record.messages.involved.length +
        record.messages.archive.length +
        record.journals.length,
    },
    expected: { items: 0, filed: 0 },
  })
})
