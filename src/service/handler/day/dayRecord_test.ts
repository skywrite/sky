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
      involved: [{ title: 'The invoicing question, again', from: 'Jane Doe', to: 'Alex Atlas' }],
      archive: [{ title: 'Standup Notes', from: 'Ops', to: 'atlas-general' }],
    },
  })
})

test('day record gives messages readable labels and preserves their document links', async () => {
  const { base, timeDir, dayDirPath } = await notebook()
  const captures = [
    {
      file: '08-15_email_Jane-Doe-to-Alex-Atlas_Atlas-release.md',
      metadata: 'medium: Email\nsummary: Atlas release approved',
      body: 'The release is approved.',
      title: 'Atlas release approved',
    },
    {
      file: '08-30_signal_Jane_Catch-up.md',
      metadata: 'medium: Signal\nsummary: Want to catch up?',
      body: 'Want to catch up after lunch?',
      title: 'Want to catch up?',
    },
    {
      file: '09-00_email_Jane-to-Alex_Atlas-pilot.md',
      metadata: 'medium: Email\nsubject: Atlas pilot feedback',
      body: '# Email\n\nThe pilot feedback is ready.',
      title: 'Atlas pilot feedback',
    },
    {
      file: '09-30_slack_Jane-to-Alex_Pricing.md',
      metadata: 'medium: Slack\nsummary: " "',
      body: '# Monthly pricing\n\nCan we invoice monthly?',
      title: 'Monthly pricing',
    },
    {
      file: '10-00_email_Jane-to-Alex_Event-sponsorship.md',
      metadata: 'medium: Email',
      body: 'Can we sponsor the event?',
      title: 'Event sponsorship',
    },
    {
      file: 'iMessage-Audio_Jane_Voice-note.md',
      metadata: 'medium: iMessage Audio',
      body: '# iMessage Audio\n\nThe transcript is ready.',
      title: 'Voice note',
    },
    {
      file: '2026-01-27_110000_signal_Jane_Lunch-plans.md',
      metadata: 'medium: Signal',
      body: 'Lunch at noon?',
      title: 'Lunch plans',
    },
    {
      file: '11-30_signal_Jane.md',
      metadata: 'medium: Signal',
      body: 'Hello!',
      title: 'Conversation',
    },
    {
      file: 'Atlas-pilot-update.md',
      metadata: '',
      body: 'The pilot is ready to begin.',
      title: 'Atlas pilot update',
    },
  ]
  for (const capture of captures) {
    await writeFile(
      path.join(dayDirPath, 'actions', 'messages', capture.file),
      `---\nfrom: Jane Doe\nto: Alex Atlas\n${capture.metadata}\n---\n\n${capture.body}\n`,
    )
  }
  const record = await buildDayRecord({ day: TODAY, timeDir, dayDirPath, markdownBaseDir: base, ownerNames: OWNER })
  for (const capture of captures) {
    const relativePath = path.join('time', dayDir(TODAY), 'actions', 'messages', capture.file)
    const row = record.messages.involved.find((message) => message.path === relativePath)
    assert({
      given: `a message saved as ${capture.file}`,
      should: 'show its summary, subject, heading or readable filename label while linking to the original document',
      actual: { title: row?.title, path: row?.path },
      expected: { title: capture.title, path: relativePath },
    })
  }
})

test({ name: 'day record - a Complete entry may say how long it took' }, async () => {
  const base = await makeTempDir({ prefix: 'sky-day-record-length-' })
  const timeDir = path.join(base, 'time')
  const dayDirPath = path.join(timeDir, dayDir(TODAY))
  await mkdir(dayDirPath, { recursive: true })
  await writeFile(
    path.join(timeDir, dayFile(TODAY)),
    `# **2026-01-27 - Tue**

## Professional Commitments

- 09:00 1h > Standup

## Personal Complete

- 08:30 4h > Ran the bake sale
- 10:00(45m) > Called the plumber
- 13:00 > Lunch
`,
  )
  const record = await buildDayRecord({ day: TODAY, timeDir, dayDirPath, markdownBaseDir: base, ownerNames: OWNER })

  assert({
    given: 'entries with a written length, a hand-typed one, and none, beside a commitment written with a length',
    should: 'read the entries’ minutes apart from their words, and leave the commitment’s words as written',
    actual: {
      done: record.done.map(({ time, minutes, text, raw }) => ({ time, minutes, text, raw })),
      commitments: record.commitments.map(({ time, minutes, text }) => ({ time, minutes, text })),
    },
    expected: {
      done: [
        { time: '08:30', minutes: 240, text: 'Ran the bake sale', raw: '08:30 4h > Ran the bake sale' },
        { time: '10:00', minutes: 45, text: 'Called the plumber', raw: '10:00(45m) > Called the plumber' },
        { time: '13:00', minutes: undefined, text: 'Lunch', raw: '13:00 > Lunch' },
      ],
      commitments: [{ time: '09:00', minutes: undefined, text: '1h > Standup' }],
    },
  })
})

test({ name: 'day record - an email address in a row is not the row’s link' }, async () => {
  const base = await makeTempDir({ prefix: 'sky-day-record-addresses-' })
  const timeDir = path.join(base, 'time')
  const dayDirPath = path.join(timeDir, dayDir(TODAY))
  const messages = path.join(dayDirPath, 'actions', 'messages')
  await mkdir(messages, { recursive: true })
  await writeFile(
    path.join(timeDir, dayFile(TODAY)),
    `# **2026-01-27 - Tue**

## Professional Todos

- Send jane@example.com the Atlas deck

## Professional Complete

- 09:15 > Jane Doe to alex@example.com, Sam Torres Email -> [Atlas kickoff](actions/messages/09-15_email_Jane-Doe-to-alexexamplecom_Atlas-kickoff.md)
- 10:40 > Sam Torres to Jane Doe Email -> [Atlas budget](actions/messages/10-40_email_Sam-Torres-to-Jane-Doe_Atlas-budget.md)
- Wrote the Atlas brief
`,
  )
  const email = (headers: string, summary: string) =>
    `---\n${headers}\nmedium: Email\nsummary: ${summary}\n---\n\n# ${summary}\n\nThe numbers are in the sheet; we can walk through them on Thursday if that suits everyone.\n`
  await writeFile(
    path.join(messages, '09-15_email_Jane-Doe-to-alexexamplecom_Atlas-kickoff.md'),
    email('from: Jane Doe\nto: alex@example.com, Sam Torres', 'Atlas kickoff'),
  )
  await writeFile(
    path.join(messages, '10-40_email_Sam-Torres-to-Jane-Doe_Atlas-budget.md'),
    email('from: Sam Torres\nto: Jane Doe\ncc: Alex Atlas', 'Atlas budget'),
  )
  await writeFile(
    path.join(messages, '11-05_email_Sam-Torres-to-Jane-Doe_Vendor-list.md'),
    email('from: Sam Torres\nto: Jane Doe', 'Vendor list'),
  )
  const record = await buildDayRecord({
    day: TODAY,
    timeDir,
    dayDirPath,
    markdownBaseDir: base,
    ownerNames: OWNER,
    ownerAddresses: ['alex@example.com'],
  })

  assert({
    given: 'an email capture line naming a recipient by bare address, and a to-do that mentions an address',
    should: 'still read the line as a capture log, not Done, and give the to-do no link',
    actual: {
      done: record.done.map((i) => i.text),
      todo: { text: record.todos[0].text, link: record.todos[0].link },
    },
    expected: {
      done: ['Wrote the Atlas brief'],
      todo: { text: 'Send jane@example.com the Atlas deck', link: null },
    },
  })

  assert({
    given: 'emails addressed to one of the owner’s addresses, copying the owner, and leaving the owner out',
    should: 'list the first two as the owner’s messages and file the third',
    actual: {
      involved: record.messages.involved.map((m) => m.title),
      archive: record.messages.archive.map((m) => m.title),
    },
    expected: { involved: ['Atlas kickoff', 'Atlas budget'], archive: ['Vendor list'] },
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
        record.events.length +
        record.messages.involved.length +
        record.messages.archive.length +
        record.journals.length,
    },
    expected: { items: 0, filed: 0 },
  })
})

test('day record includes video summaries, participants, and times from the day’s video files', async () => {
  const { base, timeDir, dayDirPath } = await notebook()
  const videos = path.join(dayDirPath, 'actions', 'videos')
  await mkdir(videos)
  await writeFile(
    path.join(videos, 'Loom_Atlas-update.md'),
    `---
from: Jane Doe
to: Atlas Team
when: 2026-01-27 15:00 - 15:10
medium: Loom
summary: Atlas launch walkthrough
---

# Loom

## Summary

The recording walks through the launch checklist and next steps.
`,
  )
  const record = await buildDayRecord({ day: TODAY, timeDir, dayDirPath, markdownBaseDir: base, ownerNames: OWNER })
  assert({
    given: 'a video whose heading is only its platform name',
    should: 'list the recording by its saved summary with its notebook link and communication metadata',
    actual: record.videos,
    expected: [
      {
        title: 'Atlas launch walkthrough',
        path: path.join('time', dayDir(TODAY), 'actions/videos/Loom_Atlas-update.md'),
        when: '15:00 - 15:10',
        summary: 'Atlas launch walkthrough',
        from: 'Jane Doe',
        to: 'Atlas Team',
        medium: 'Loom',
      },
    ],
  })
})

test('day record includes saved events once, in time order, with participants and locations', async () => {
  const { base, timeDir, dayDirPath } = await notebook()
  const events = path.join(dayDirPath, 'actions', 'events')
  await mkdir(events)
  await writeFile(
    path.join(events, 'Z_Pottery-workshop.md'),
    `---
what: Pottery workshop
when: 2026-01-27 18:30 - 20:00
who:
  - Jane Doe
  - Sam Lee
where: Atlas Studio
summary: Made a bowl together.
---

# Pottery workshop

We learned to shape a bowl and chose a blue glaze.
`,
  )
  await writeFile(
    path.join(events, 'A_Late-night-walk.md'),
    `---
what: Late night walk
when: 2026-01-27 25:30
who: Jane Doe
---

A quiet walk around the neighborhood after the workshop.
`,
  )
  await writeFile(
    path.join(timeDir, dayFile(TODAY)),
    DAY_MD.replace(
      '## Personal Complete\n\n-\n',
      '## Personal Complete\n\n- 18:30 > Event -> [Pottery workshop](actions/events/Z_Pottery-workshop.md)\n',
    ),
  )
  const record = await buildDayRecord({ day: TODAY, timeDir, dayDirPath, markdownBaseDir: base, ownerNames: OWNER })

  assert({
    given: 'two event files with a linked capture log, array or string participants, and an extended-hour time',
    should: 'retain each event once with a document link and metadata, without repeating its capture log in Done',
    actual: { events: record.events, done: record.done.map((item) => item.text) },
    expected: {
      events: [
        {
          title: 'Pottery workshop',
          path: path.join('time', dayDir(TODAY), 'actions/events/Z_Pottery-workshop.md'),
          when: '18:30 - 20:00',
          who: 'Jane Doe, Sam Lee',
          where: 'Atlas Studio',
          summary: 'Made a bowl together.',
        },
        {
          title: 'Late night walk',
          path: path.join('time', dayDir(TODAY), 'actions/events/A_Late-night-walk.md'),
          when: '25:30',
          who: 'Jane Doe',
          where: null,
          summary: null,
        },
      ],
      done: ['Submit the expense report'],
    },
  })
})
