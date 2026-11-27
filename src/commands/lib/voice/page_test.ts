import type { DayItemList } from '#commands/all/day/items/lib/items.ts'
import type { MeetingCheck } from '#commands/all/day/meeting/lib/meetingCheck.ts'
import type { CalendarEvent } from '#lib/google/calendar.ts'
import type { MemoryEntry } from '#shared/models/Memory/mod.ts'
import { assert, test } from '#test'
import {
  betterCheck,
  byteLength,
  PAGE_MAX_BYTES,
  renderCalendar,
  renderDecisions,
  renderGoals,
  renderLists,
  renderMemory,
  renderNow,
  renderVoicePage,
  spokenTime,
  todayUpdates,
  UPDATE_MAX_BYTES,
} from './page.ts'

const CLOCK = { date: '2026-03-12', time: '14:05', timezone: 'America/Chicago' }

function event(title: string, start: string, end: string, attendees: string[] = []): CalendarEvent {
  return {
    id: title,
    account: 'jane@example.com',
    title,
    start: `2026-03-12T${start}:00-05:00`,
    end: `2026-03-12T${end}:00-05:00`,
    allDay: false,
    eventType: 'default',
    status: 'confirmed',
    attendees: [
      { email: 'jane@example.com', self: true, response: 'accepted' },
      ...attendees.map((name) => ({
        email: `${name.toLowerCase().replace(/ /g, '.')}@example.com`,
        name,
        self: false,
        response: 'accepted' as const,
      })),
    ],
  }
}

function check(meetings: Array<{ event: CalendarEvent; logged?: boolean }>): MeetingCheck {
  return {
    day: '2026-03-12',
    timeZone: 'America/Chicago',
    calendarRead: true,
    notebookRead: true,
    meetings: meetings.map(({ event, logged }) => ({
      event,
      record: logged ? { who: 'Joe Smith', medium: 'Zoom', when: null } : null,
    })),
    errors: [],
  }
}

function memory(kind: MemoryEntry['kind'], summary: string, uses = 0, freshness = '2026-03-01'): MemoryEntry {
  return { path: `/notebook/ai/memory/${summary}.md`, slug: summary, kind, summary, body: summary, freshness, uses }
}

test('the page states the date and a 12-hour time, including after midnight in the notebook', () => {
  assert({
    given: 'an afternoon clock and a 25:30 clock',
    should: 'spell out the weekday and month, and keep "today" on the notebook day after midnight',
    actual: [renderNow(CLOCK), renderNow({ ...CLOCK, time: '25:30' }), spokenTime('00:15'), spokenTime('12:00')],
    expected: [
      'It is Thursday, March 12, 2026, 2:05 PM (America/Chicago), when this call started.',
      'It is 1:30 AM, after midnight, but in the notebook it is still Thursday, March 12, 2026: "today" means that day (America/Chicago).',
      '12:15 AM',
      '12:00 PM',
    ],
  })
})

test("today's calendar reads absolute times, two names, and where each meeting stands", () => {
  const day = check([
    { event: event('Atlas standup', '09:00', '09:30', ['Joe Smith']), logged: true },
    { event: event('Widget review', '13:30', '14:30', ['Jane Roe', 'Joe Smith', 'Ann Lee', 'Bo Park']) },
    { event: event('Team survey debrief', '16:00', '16:45') },
  ])
  assert({
    given: 'a past logged meeting, one in progress with four guests, and one later',
    should: 'say each one plainly',
    actual: renderCalendar(day, CLOCK),
    expected: [
      '- 9:00 AM to 9:30 AM: Atlas standup with Joe Smith; over, notes logged.',
      '- 1:30 PM to 2:30 PM: Widget review with Jane Roe and Joe Smith and 2 others; happening now.',
      '- 4:00 PM to 4:45 PM: Team survey debrief; upcoming.',
    ].join('\n'),
  })
  const busy = check(
    Array.from({ length: 30 }, (_, i) => ({
      event: event(
        `Atlas meeting number ${i + 1} with a long title`,
        `${String(8 + Math.floor(i / 3)).padStart(2, '0')}:${['00', '20', '40'][i % 3]}`,
        `${String(8 + Math.floor(i / 3)).padStart(2, '0')}:${['15', '35', '55'][i % 3]}`,
        ['Jane Roe', 'Joe Smith', 'Ann Lee'],
      ),
      logged: i % 2 === 0,
    })),
  )
  const rendered = renderCalendar(busy, CLOCK)
  assert({
    given: 'thirty meetings, the first eighteen already over',
    should: 'fold the past into one line, keep what is next, and stay within its budget',
    actual: {
      folds: rendered.startsWith('Earlier today: 18 meetings, 9 with notes logged.'),
      keepsNext: rendered.includes('Atlas meeting number 19'),
      withinBudget: byteLength(rendered) <= 1100,
    },
    expected: { folds: true, keepsNext: true, withinBudget: true },
  })
  assert({
    given: 'a calendar that could not be read, and no check at all',
    should: 'say so instead of claiming an empty day',
    actual: [renderCalendar({ ...day, calendarRead: false, meetings: [] }, CLOCK), renderCalendar(undefined, CLOCK)],
    expected: [
      'The calendar could not be read when this call started.',
      'The calendar was not checked when this call started.',
    ],
  })
})

test("today's lists keep open items by priority, put times first, and give no done count", () => {
  const lists: DayItemList[] = [
    { title: 'Most Important', items: [{ text: 'Ship the Atlas plan', done: false }] },
    { title: 'Professional Commitments', items: [{ text: '15:00 > Call Jane Roe about Widget-V2', done: false }] },
    { title: 'Personal Commitments', items: [] },
    {
      title: 'Professional Todos',
      items: [
        { text: 'Send the survey https://example.com/survey', done: false },
        { text: 'https://example.com/only-a-link', done: false },
        { text: 'Book the venue', done: true },
      ],
    },
    { title: 'Personal Todos', items: [{ text: 'Buy milk', done: false }] },
    { title: 'Reminders', items: Array.from({ length: 40 }, (_, i) => ({ text: `Reminder ${i + 1}`, done: false })) },
    { title: 'Streaks', items: [{ text: 'Exercise', done: false }] },
    { title: 'Professional Complete', items: [{ text: '09:30 > Atlas standup', done: true }] },
  ]
  const rendered = renderLists(lists)
  assert({
    given: 'a day with one priority, one timed commitment, to-dos in two categories, forty reminders and a streak',
    should: 'read each list in order, drop links, link-only items and streaks, and fold the long tail',
    actual: {
      lines: rendered.split('\n').filter((line) => !line.startsWith('Reminders:')),
      foldsReminders: /^Reminders: Reminder 1; Reminder 2;.*; and \d+ more\.$/m.test(rendered),
      withinBudget: byteLength(rendered) <= 1100,
    },
    expected: {
      lines: [
        'Most important: Ship the Atlas plan.',
        'Commitments: 3:00 PM, Call Jane Roe about Widget-V2 (professional).',
        'To-dos: Send the survey (professional); Buy milk (personal).',
      ],
      foldsReminders: true,
      withinBudget: true,
    },
  })
  assert({
    given: 'a day with nothing open, and lists that could not be read',
    should: 'say none open, and say the lists were not read',
    actual: [renderLists([{ title: 'Professional Todos', items: [] }]), renderLists(undefined)],
    expected: [
      'Most important: none open.\nCommitments: none open.\nTo-dos: none open.',
      "Today's lists could not be read when this call started.",
    ],
  })
})

test('pending decisions read as their questions with spoken targets, and an unread index is not "none"', () => {
  // The index's shape: the name is a slug cut to about 25 characters, the question is the summary.
  const decisions = [
    { body: 'Whether-to-move-Atlas-to\nSummary: Whether to move Atlas to the new office\nTarget: 2026-11-30' },
    { body: 'Which-vendor-runs-the\nSummary: Which vendor runs the Team-Survey\nTarget: end of quarter' },
    { body: 'Whether-to-hire-for-Widget' },
  ]
  const many = Array.from({ length: 12 }, (_, i) => ({
    body: `Whether to approve Atlas proposal number ${i + 1} for the spring`,
  }))
  const rendered = renderDecisions(many)
  assert({
    given: 'three pending decisions, none, an unread index, and the twelve the index returns at most',
    should:
      'list each with its target, say none, say it was not read, and say there may be more when it fills its budget',
    actual: {
      three: renderDecisions(decisions),
      none: renderDecisions([]),
      unread: renderDecisions(undefined),
      many: [
        rendered.startsWith('At least 12 pending: Whether to approve Atlas proposal number 1 for the spring;'),
        / and \d+ more\.$/.test(rendered),
        byteLength(rendered) <= 500,
      ],
    },
    expected: {
      three:
        '3 pending: Whether to move Atlas to the new office (target November 30, 2026); Which vendor runs the Team-Survey (target end of quarter); Whether to hire for Widget.',
      none: 'None pending.',
      unread: 'Pending decisions could not be read when this call started.',
      many: [true, true, true],
    },
  })
})

test('memory is summarized from one-line gists: shorthand, the most-confirmed preferences, open threads', () => {
  const rendered = renderMemory([
    memory('preference', 'Lead with the answer', 9),
    memory('preference', 'Never use em dashes', 2),
    memory('glossary', 'MI means the Most Important task'),
    memory('thread', 'Atlas launch date still open'),
    memory('lesson', 'Search meetings by date first'),
  ])
  assert({
    given: 'two preferences, a glossary entry, a thread and a lesson',
    should: 'list shorthand, preferences by confirmations, and threads, and leave lessons for the backend',
    actual: rendered,
    expected: [
      'Shorthand the user uses: MI means the Most Important task.',
      'How the user wants things done: Lead with the answer; Never use em dashes.',
      'Open threads: Atlas launch date still open.',
    ].join('\n'),
  })
})

test('the whole page stays small even on a heavy day, and in scripts that need several bytes a character', () => {
  const heavy = renderVoicePage({
    clock: CLOCK,
    profileText:
      '---\nname: Jane Doe\n---\n## Personal\n\nLocation: Springfield\n\n## Bio\n\n' + 'Jane runs Atlas. '.repeat(200),
    goals: Array.from({ length: 12 }, (_, i) => ({
      source: `goals/active/goal-${i}.md`,
      body: `# Goal number ${i} for Atlas\n`,
    })),
    decisions: Array.from({ length: 12 }, (_, i) => ({
      body: `決定 ${i} ${'長い説明'.repeat(12)}\nTarget: 2026-12-0${(i % 9) + 1}`,
    })),
    people: Array.from({ length: 30 }, (_, i) => ({ body: `Person ${i}\nTitle: Engineer\nOrganization: Atlas` })),
    check: check(
      Array.from({ length: 20 }, (_, i) => ({
        event: event(`会議 ${i} ${'長い題名'.repeat(10)}`, '15:00', '15:30', ['山田 太郎']),
      })),
    ),
    lists: [
      {
        title: 'Professional Todos',
        items: Array.from({ length: 60 }, (_, i) => ({ text: `タスク ${i} ${'詳細'.repeat(30)}`, done: false })),
      },
    ],
    memories: Array.from({ length: 90 }, (_, i) => memory('preference', `Preference ${i} ${'x'.repeat(150)}`, i)),
  })
  assert({
    given: 'thirty people, twenty meetings and sixty to-dos in Japanese, and ninety long memories',
    should: 'stay under the page cap and keep every section heading',
    actual: {
      withinCap: byteLength(heavy) <= PAGE_MAX_BYTES,
      sections: [
        'Now:',
        'About the user:',
        'Goals:',
        'Pending decisions:',
        'People the user deals with most:',
        "Today's calendar:",
        "Today's lists:",
      ].every((heading) => heavy.includes(heading)),
    },
    expected: { withinCap: true, sections: true },
  })
})

test('a mid-call update names the part it replaces, only for parts that changed, within one append', () => {
  const before = { calendar: 'No meetings on the calendar today.', lists: 'To-dos: Buy milk.' }
  const longLists = `To-dos: ${'Book the Atlas venue; '.repeat(80)}`
  assert({
    given: 'no change, a changed list, and a changed list too long for one append',
    should: 'send nothing, then one note naming the lists, then a note cut to the append limit',
    actual: [
      todayUpdates(before, before, '15:41'),
      todayUpdates(before, { ...before, lists: 'To-dos: Buy milk; Call Jane.' }, '15:41'),
      todayUpdates(before, { ...before, lists: longLists }, '15:41').map(
        (note) => byteLength(note) <= UPDATE_MAX_BYTES,
      ),
    ],
    expected: [
      [],
      ['Update at 3:41 PM. This replaces "Today\'s lists"; no reply needed.\nTo-dos: Buy milk; Call Jane.'],
      [true],
    ],
  })
})

test('goals read as titles from one-goal files, and as written goals from older category files', () => {
  assert({
    given:
      'one-goal files with a title, a heading, a frontmatter comment and nothing, plus category files with and without goals',
    should:
      "use the title, then the heading, then the name, list a category file's goals, and skip empty category files",
    actual: [
      renderGoals([
        {
          source: '/notebook/goals/active/widget.md',
          body: '---\n# set by the Future screen\ntitle: Ship Widget-V2 to ten customers\n---\n\nNotes.\n',
        },
        { source: '/notebook/goals/active/atlas.md', body: '# Launch Atlas\n\nWhy it matters.\n' },
        {
          source: '/notebook/goals/active/run-a-marathon.md',
          body: '---\ncategory: Personal\n---\n\nTraining notes.\n',
        },
      ]),
      renderGoals([
        { source: '/notebook/goals/personal.md', body: '---\ntitle: Personal Goals\n---\n\n' },
        { source: '/notebook/goals/professional.md', body: '---\ntitle: Professional Goals\n---\n\n' },
      ]),
      renderGoals([
        {
          source: '/notebook/goals/personal.md',
          body: '---\ntitle: Personal Goals\n---\n\n# Personal Goals\n\n## Health\n\n**Outcome:** Run a marathon\n',
        },
      ]),
    ],
    expected: ['Ship Widget-V2 to ten customers; Launch Atlas; run a marathon', '', 'Health: Run a marathon'],
  })
})

test('the page states the real date when no day has been started for more than a night', () => {
  assert({
    given: 'a notebook day two days behind, and a calendar that could not be read for a stated reason',
    should: 'lead with the real date and name the notebook day; and say why the calendar is missing',
    actual: [
      renderNow({ ...CLOCK, time: '58:05', systemDate: '2026-03-14', systemTime: '10:05' }),
      renderCalendar({ ...check([]), calendarRead: false, errors: ['No Google accounts are authorized yet.'] }, CLOCK),
    ],
    expected: [
      "It is Saturday, March 14, 2026, 10:05 AM (America/Chicago), when this call started. The notebook's last started day is Thursday, March 12, 2026; the calendar and lists below are from that day.",
      'The calendar could not be read when this call started: No Google accounts are authorized yet.',
    ],
  })
})

test("the stale-day line gives the computer's time in its own zone", () => {
  assert({
    given: 'a notebook day two days behind, on a computer in another zone',
    should: "label the computer's time with the computer's zone",
    actual: renderNow({
      ...CLOCK,
      time: '58:05',
      systemDate: '2026-03-14',
      systemTime: '16:05',
      systemTimezone: 'Europe/London',
    }),
    expected:
      "It is Saturday, March 14, 2026, 4:05 PM (Europe/London), when this call started. The notebook's last started day is Thursday, March 12, 2026; the calendar and lists below are from that day.",
  })
})

test('a calendar fetched again mid-call replaces the one the call has only when it is at least as complete', () => {
  const clean = check([{ event: event('Atlas standup', '09:00', '09:30') }])
  const partial = { ...clean, errors: ['jane@example.com: token expired'] }
  const unread = { ...check([]), calendarRead: false, errors: ['offline'] }
  const noNotebook = { ...clean, notebookRead: false }
  assert({
    given:
      'a clean check against a partial, an unread against a partial, a clean against one without the notebook, and two clean',
    should: 'keep the fuller one each time, and say when a calendar is partial',
    actual: [
      betterCheck(clean, partial) === clean,
      betterCheck(unread, partial) === partial,
      betterCheck(clean, noNotebook) === clean,
      betterCheck(clean, { ...clean }) !== clean,
      renderCalendar(partial, CLOCK).includes('Some calendar accounts could not be read, so meetings may be missing.'),
    ],
    expected: [true, true, true, true, true],
  })
})
