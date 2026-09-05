import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { dayFile, weekDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime, type Week, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { buildWeekView, createWeekRoutes, type WeekCommands, type WeekView } from './mod.ts'

/** Friday morning, 06:52 — the notebook still on Thursday, its clock past 24:00. */
const NOW = () => new ZonedDateTime(new PlainDateTime('30:52', '2026-09-03'), 'America/Chicago')

const WEEK_MD = `---
created: 2026-08-31
updated: 2026-08-31
summary: Ship the Atlas checklist and keep the mornings for writing.
---

# 2026-W36: Week Plan

## Summary

Ship the Atlas checklist; hire the ops lead.

## Priorities

1. Atlas launch readiness
   - WHY: the launch date is fixed
2. Hiring the ops lead
   - WHY: the team is stretched

## Goals

### Professional

- ~~Atlas launch checklist signed off~~
  - WHY: the launch depends on it
- Ops lead: two finalist interviews
  - WHY: the role is open
- Vendor contract renewal decided
  - WHY: it lapses Friday

### Personal

- Morning walk on five days
  - WHY: energy
`

const CHECKINS_MD = `---
created: 2026-09-01
updated: 2026-09-03
---

# 2026-W36: Checkins

## Plan snapshot — captured 2026-09-01

_week.md as first seen by week:checkin._

\`\`\`\`markdown
${WEEK_MD.trimEnd()}
\`\`\`\`

## Checkin — Tue 2026-09-01 9:40 (day 2 of 7)
<!-- model: test -->

**Grade: B+** — early days.

### Goals

- **ON TRACK** Atlas launch checklist — motion Monday

### Suggested edits

None — the plan holds.

## Checkin — Thu 2026-09-03 6:24 (day 4 of 7)
<!-- model: test · 14000 in, 900 out -->

**Grade: B** — the launch work landed on time; hiring is moving, the vendor decision is drifting.

### Goals

- **DONE** Atlas launch checklist signed off — struck by hand Tuesday
- **ON TRACK** Ops lead finalist interviews — two scheduled, per Wednesday's day.md
- **AT RISK** Vendor contract renewal decision — due Friday, no trace in the record
- **NO MOTION** Morning walks — one of five so far

### Priorities

Attention went to the launch, as planned.

### Plan drift

None — the plan stands as captured.

### Suggested edits

1. Give the vendor decision a date, Friday, or drop it — two days left and no motion.
2. Push the board update to next week — nothing in the record touches it.
`

const NEXT_PROFESSIONAL = `---
---

# Next Actions Professional

## Week-Next

- Decide the vendor contract renewal (pushed 2026-W36)
- Board update draft (pushed 2026-W36)

## Next

- Write the hiring rubric
- Follow up with the vendor on the SLA
`

const NEXT_PERSONAL = `---
---

# Next Actions Personal

## Next

- Renew the passport

## Content

- [A talk on decision journals](https://example.com/talk)
- https://example.com/sleep
`

const SCHEDULE_PROFESSIONAL = `---
---

# Professional Todos

## 2026-09-07

- 10:00 > Kick off the Atlas retro
- Send the September invoice run

## 2026-09-15

- Renew the domain
`

const SCHEDULE_PERSONAL = `---
---

# Personal Todos

## 2026-03-21

- 18:00 > Book club, chapter five
`

function dayMd(ymd: string, yaml: string): string {
  const day = new PlainDate(ymd)
  return `---\n${yaml}---\n\n# **${ymd} - ${day.dayShort}**\n\n## Professional Todos\n\n- Reply to the vendor\n`
}

/** A notebook with one planned week in flight: four days lived, Friday waiting, the weekend ahead. */
async function weekNotebook(): Promise<{
  base: string
  timeDir: string
  write: (rel: string, text: string) => Promise<void>
}> {
  const base = await makeTempDir({ prefix: 'sky-week-route-' })
  const timeDir = path.join(base, 'time')
  const write = async (rel: string, text: string) => {
    const file = path.join(timeDir, rel)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, text)
  }
  await write(
    dayFile(new PlainDate('2026-08-31')),
    dayMd('2026-08-31', 'started: 06:10\nended: 16h\nperfect: true\ntz: America/Chicago\n'),
  )
  await write(
    dayFile(new PlainDate('2026-09-01')),
    dayMd('2026-09-01', 'started: 07:05\nended:\ntz: America/Chicago\n'),
  )
  await write(
    dayFile(new PlainDate('2026-09-02')),
    dayMd('2026-09-02', 'started: 06:48\nended:\ntz: America/Chicago\n'),
  )
  await write(
    dayFile(new PlainDate('2026-09-03')),
    dayMd('2026-09-03', 'started: 06:20\nended:\ntz: America/Chicago\n'),
  )
  for (const ymd of ['2026-09-04', '2026-09-05', '2026-09-06']) await write(dayFile(new PlainDate(ymd)), dayMd(ymd, ''))
  await write(path.join(weekDir(new PlainDate('2026-08-31')), 'week.md'), WEEK_MD)
  await write(path.join(weekDir(new PlainDate('2026-08-31')), 'checkins.md'), CHECKINS_MD)
  await write('next-professional.md', NEXT_PROFESSIONAL)
  await write('next-personal.md', NEXT_PERSONAL)
  await write('schedule-professional.md', SCHEDULE_PROFESSIONAL)
  await write('schedule-personal.md', SCHEDULE_PERSONAL)
  return { base, timeDir, write }
}

test({ name: "week view - the days carry their state, and the day after the notebook's is due" }, async () => {
  const { base, timeDir } = await weekNotebook()
  const view: WeekView = await buildWeekView({ markdownBaseDir: base, timeDir, now: NOW })

  assert({
    given: 'Friday 06:52 on the clock with Thursday still the started day, three days never ended',
    should: 'read the week of the calendar day, mark Friday due, and say what each day is',
    actual: {
      id: view.id,
      current: view.current,
      states: view.days.map((d) => d.state),
      monday: { started: view.days[0].started, ended: view.days[0].ended, perfect: view.days[0].perfect },
      today: view.days.find((d) => d.today)?.ymd,
      due: view.due,
      queue: view.queue,
      next: view.next,
      paths: view.days.map((d) => d.dayRelativePath !== null),
    },
    expected: {
      id: '2026-W36',
      current: true,
      states: ['ended', 'open', 'open', 'open', 'due', 'upcoming', 'upcoming'],
      monday: { started: '06:10', ended: '22:10', perfect: true },
      today: '2026-09-03',
      due: { ymd: '2026-09-04', weekday: 'Friday' },
      queue: null,
      next: { id: '2026-W37', exists: false, planned: false },
      paths: [true, true, true, true, true, true, true],
    },
  })
})

test({ name: "week view - the plan reads by heading and takes the latest check-in's word on each goal" }, async () => {
  const { base, timeDir } = await weekNotebook()
  const view = await buildWeekView({ markdownBaseDir: base, timeDir, now: NOW })

  assert({
    given: 'a week.md with two priorities and four goals, one struck, and two check-in entries',
    should: 'list the priorities and goals with done marks, the status the last entry gave each, and that entry itself',
    actual: {
      summary: view.plan?.summary,
      priorities: view.plan?.priorities,
      goals: view.plan?.goals.map(
        (g) => `${g.category} · ${g.text} · ${g.done ? 'done' : 'open'} · ${g.status?.status ?? '-'}`,
      ),
      count: view.checkins?.count,
      latest: {
        day: view.checkins?.latest?.day,
        time: view.checkins?.latest?.time,
        position: view.checkins?.latest?.position,
        grade: view.checkins?.latest?.grade,
        verdict: view.checkins?.latest?.verdict,
        edits: view.checkins?.latest?.edits.length,
        goals: view.checkins?.latest?.goals.length,
      },
      paths: [view.plan?.path, view.checkins?.path],
    },
    expected: {
      summary: 'Ship the Atlas checklist and keep the mornings for writing.',
      priorities: ['Atlas launch readiness', 'Hiring the ops lead'],
      goals: [
        'Professional · Atlas launch checklist signed off · done · done',
        'Professional · Ops lead: two finalist interviews · open · on track',
        'Professional · Vendor contract renewal decided · open · at risk',
        'Personal · Morning walk on five days · open · no motion',
      ],
      count: 2,
      latest: {
        day: '2026-09-03',
        time: '6:24',
        position: 'day 4 of 7',
        grade: 'B',
        verdict: 'the launch work landed on time; hiring is moving, the vendor decision is drifting.',
        edits: 2,
        goals: 4,
      },
      paths: [
        path.join('time', weekDir(new PlainDate('2026-08-31')), 'week.md'),
        path.join('time', weekDir(new PlainDate('2026-08-31')), 'checkins.md'),
      ],
    },
  })
})

test({ name: 'week view - next week shows what is already waiting for it' }, async () => {
  const { base, timeDir } = await weekNotebook()
  const view = await buildWeekView({ markdownBaseDir: base, timeDir, now: NOW }, '2026-W37')

  assert({
    given: 'the week after, with no files of its own, and the standing next and schedule files',
    should:
      'carry the queue with its pushed-from stamps, the dated items sorted into the week, later and past, and the backlog',
    actual: {
      future: view.future,
      exists: view.exists,
      plan: view.plan,
      states: view.days.map((d) => d.state),
      weekNext: view.queue?.weekNext.professional.map((i) => `${i.text} · ${i.from}`),
      personalQueue: view.queue?.weekNext.personal.length,
      next: view.queue?.next.professional.map((i) => i.text),
      personalNext: view.queue?.next.personal.map((i) => i.text),
      content: view.queue?.next.content.map((i) => `${i.text} → ${i.link}`),
      inWeek: view.queue?.scheduled.inWeek.map(
        (g) => `${g.date}: ${g.items.map((i) => `${i.time ?? '-'} ${i.text}`).join(' | ')}`,
      ),
      later: view.queue?.scheduled.later.map((g) => g.date),
      past: view.queue?.scheduled.past.map((g) => `${g.date}: ${g.items[0].category} ${g.items[0].time}`),
    },
    expected: {
      future: true,
      exists: false,
      plan: null,
      states: ['upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming'],
      weekNext: ['Decide the vendor contract renewal · W36', 'Board update draft · W36'],
      personalQueue: 0,
      next: ['Write the hiring rubric', 'Follow up with the vendor on the SLA'],
      personalNext: ['Renew the passport'],
      content: [
        'A talk on decision journals → https://example.com/talk',
        'https://example.com/sleep → https://example.com/sleep',
      ],
      inWeek: ['2026-09-07: 10:00 Kick off the Atlas retro | - Send the September invoice run'],
      later: ['2026-09-15'],
      past: ['2026-03-21: Personal 18:00'],
    },
  })
})

/** POST a JSON body and hand back status plus the served view. */
async function post(
  app: ReturnType<typeof createWeekRoutes>,
  route: string,
  body?: unknown,
): Promise<{ status: number; view: WeekView | null; error: string | null }> {
  const response = await app.request(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await response.json()) as WeekView & { error?: string }
  return { status: response.status, view: response.status === 200 ? json : null, error: json.error ?? null }
}

test({ name: 'week route - something for next week lands in the queue, or under its day' }, async () => {
  const { base, timeDir } = await weekNotebook()
  const app = createWeekRoutes({ markdownBaseDir: base, timeDir, now: NOW })

  const queued = await post(app, '/2026-W37/queue', {
    text: 'Get a quote for the office lease renewal',
    category: 'Professional',
  })
  const dated = await post(app, '/2026-W37/queue', {
    text: 'Walk the dog before the call',
    category: 'Personal',
    day: '2026-09-09',
  })
  const nextFile = await readFile(path.join(timeDir, 'next-professional.md'), 'utf8')
  const scheduleFile = await readFile(path.join(timeDir, 'schedule-personal.md'), 'utf8')

  assert({
    given: 'one item with no day and one with a day of the week',
    should: 'append the first to Week-Next stamped with this week, and file the second under its date in date order',
    actual: {
      statuses: [queued.status, dated.status],
      queuedLine: nextFile.includes('- Get a quote for the office lease renewal (pushed 2026-W36)'),
      queuedUnderWeekNext: nextFile.indexOf('Get a quote') < nextFile.indexOf('## Next'),
      queueShows: queued.view?.queue?.weekNext.professional.length,
      datedOrder: scheduleFile.indexOf('## 2026-03-21') < scheduleFile.indexOf('## 2026-09-09'),
      datedLine: scheduleFile.includes('## 2026-09-09\n- Walk the dog before the call'),
      inWeek: dated.view?.queue?.scheduled.inWeek.map((g) => `${g.date} ${g.items.map((i) => i.category).join(',')}`),
    },
    expected: {
      statuses: [200, 200],
      queuedLine: true,
      queuedUnderWeekNext: true,
      queueShows: 3,
      datedOrder: true,
      datedLine: true,
      inWeek: ['2026-09-07 Professional,Professional', '2026-09-09 Personal'],
    },
  })
})

test({ name: 'week route - the × takes the line out, and an emptied date leaves with its heading' }, async () => {
  const { base, timeDir } = await weekNotebook()
  const app = createWeekRoutes({ markdownBaseDir: base, timeDir, now: NOW })

  const removed = await post(app, '/2026-W37/queue/remove', {
    file: 'schedule-professional.md',
    list: '2026-09-15',
    raw: 'Renew the domain',
  })
  const stale = await post(app, '/2026-W37/queue/remove', {
    file: 'schedule-professional.md',
    list: '2026-09-15',
    raw: 'Renew the domain',
  })
  const one = await post(app, '/2026-W37/queue/remove', {
    file: 'next-professional.md',
    list: 'Week-Next',
    raw: 'Board update draft (pushed 2026-W36)',
  })
  const scheduleFile = await readFile(path.join(timeDir, 'schedule-professional.md'), 'utf8')
  const nextFile = await readFile(path.join(timeDir, 'next-professional.md'), 'utf8')

  assert({
    given: "a date's only item removed, the same removal again, and one of two queue lines removed",
    should:
      'drop the line and its heading, answer 404 the second time, and leave the other queue line and heading standing',
    actual: {
      statuses: [removed.status, stale.status, one.status],
      headingGone: !scheduleFile.includes('2026-09-15'),
      othersKept: scheduleFile.includes(
        '## 2026-09-07\n\n- 10:00 > Kick off the Atlas retro\n- Send the September invoice run\n',
      ),
      staleError: stale.error,
      queueKept: nextFile.includes('## Week-Next\n\n- Decide the vendor contract renewal (pushed 2026-W36)\n\n## Next'),
      later: removed.view?.queue?.scheduled.later,
    },
    expected: {
      statuses: [200, 404, 200],
      headingGone: true,
      othersKept: true,
      staleError: 'no such line — the file changed under the page',
      queueKept: true,
      later: [],
    },
  })
})

test({ name: 'week route - a backlog line moves into the queue' }, async () => {
  const { base, timeDir } = await weekNotebook()
  const app = createWeekRoutes({ markdownBaseDir: base, timeDir, now: NOW })

  const moved = await post(app, '/2026-W37/queue/promote', {
    file: 'next-professional.md',
    list: 'Next',
    raw: 'Write the hiring rubric',
  })
  const nextFile = await readFile(path.join(timeDir, 'next-professional.md'), 'utf8')

  assert({
    given: 'a Next line sent to next week',
    should: 'leave Next without it and end Week-Next with it, stamped with this week',
    actual: {
      status: moved.status,
      inNext: nextFile.split('## Next')[1].includes('Write the hiring rubric'),
      inQueue: nextFile.split('## Next')[0].includes('- Write the hiring rubric (pushed 2026-W36)'),
      queue: moved.view?.queue?.weekNext.professional.map((i) => i.text),
      backlog: moved.view?.queue?.next.professional.map((i) => i.text),
    },
    expected: {
      status: 200,
      inNext: false,
      inQueue: true,
      queue: ['Decide the vendor contract renewal', 'Board update draft', 'Write the hiring rubric'],
      backlog: ['Follow up with the vendor on the SLA'],
    },
  })
})

test(
  { name: 'week route - start, end and create run the host and answer the fresh view; a failure is reported' },
  async () => {
    const { base, timeDir } = await weekNotebook()
    const calls: string[] = []
    const commands: WeekCommands = {
      startDay: async (day: PlainDate) => {
        calls.push(`start ${day.ymd}`)
      },
      endDay: async (day: PlainDate) => {
        calls.push(`end ${day.ymd}`)
        if (day.ymd === '2026-09-01') throw new Error('day:end did not finish')
      },
      createWeek: async (week: Week) => {
        calls.push(`create ${week.toString()}`)
      },
    }
    const app = createWeekRoutes({ markdownBaseDir: base, timeDir, now: NOW, commands })
    const bare = createWeekRoutes({ markdownBaseDir: base, timeDir, now: NOW })

    const started = await post(app, '/2026-W36/day/2026-09-04/start')
    const ended = await post(app, '/2026-W36/day/2026-09-02/end')
    const failed = await post(app, '/2026-W36/day/2026-09-01/end')
    const created = await post(app, '/2026-W37/create')
    const notADay = await post(app, '/2026-W36/day/tomorrow/start')
    const notAWeek = await post(app, '/week-36/create')
    const noHost = await post(bare, '/2026-W36/day/2026-09-04/start')

    assert({
      given: 'the four commands through scripted hosts, one of them failing, and requests with no host or bad names',
      should: 'run each once with its day or week, answer the view on success, and say what went wrong otherwise',
      actual: {
        calls,
        statuses: [
          started.status,
          ended.status,
          failed.status,
          created.status,
          notADay.status,
          notAWeek.status,
          noHost.status,
        ],
        failure: failed.error,
        viewId: created.view?.id,
      },
      expected: {
        calls: ['start 2026-09-04', 'end 2026-09-02', 'end 2026-09-01', 'create 2026-W37'],
        statuses: [200, 200, 502, 200, 404, 404, 501],
        failure: 'day:end did not finish',
        viewId: '2026-W37',
      },
    })
  },
)
