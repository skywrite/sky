import { assert, test } from '#test'
import type { ImportJob } from '../import/import.tsx'
import type { ScheduledMeeting } from './dayRail.tsx'
import { meetingImports } from './meetingImports.ts'

const DAY = '2026-08-05'
const FILED = 'time/2026/08-August/W32/08-05/actions/meetings/2026-08-05_093000_Atlas-Sync.md'

function meeting(title: string, start: string, overrides: Partial<ScheduledMeeting> = {}): ScheduledMeeting {
  return { title, start, end: '', allDay: false, who: [], joinUrl: null, state: 'past', record: null, ...overrides }
}

function job(id: string, when: string, overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id,
    file: { name: 'recap.vtt', size: 10, lastModified: null },
    readback: {
      source: 'transcript',
      kinds: ['meeting'],
      summary: '',
      detail: null,
      durationMinutes: null,
      speakers: [],
      refusal: null,
    },
    listen: null,
    calendar: null,
    suggestedWhen: when,
    resume: null,
    fields: { kind: 'meeting', when, category: 'Professional', journalType: null },
    state: 'running',
    plan: null,
    stage: null,
    tick: null,
    line: null,
    title: 'recap.vtt',
    result: null,
    error: null,
    created: '',
    when: '',
    ...overrides,
  }
}

const titles = (found: Map<ScheduledMeeting, ImportJob>) => [...found].map(([m, j]) => `${m.title} ← ${j.id}`)

test('a meeting import marks the meeting the schedule will file it under', () => {
  const atlas = meeting('Atlas sync', '09:30')
  const widget = meeting('Widget review', '11:00')
  const survey = meeting('Team survey', '14:00')
  assert({
    given: 'imports started for a slot, a few minutes after another, and waiting on the person',
    should: 'mark each meeting within fifteen minutes of its start, nearest first',
    actual: titles(
      meetingImports(
        [atlas, widget, survey],
        [job('late', `${DAY} 11:12`), job('slot', `${DAY} 09:30`, { state: 'needs-you' }), job('far', `${DAY} 14:16`)],
        DAY,
      ),
    ),
    expected: ['Atlas sync ← slot', 'Widget review ← late'],
  })
})

test('only imports still filing a meeting on that day mark a row', () => {
  const rows = [meeting('Atlas sync', '09:30'), meeting('Widget review', '11:00'), meeting('Team survey', '14:00')]
  assert({
    given: 'another day, a note, a failed import, an unstarted one, and a refused file',
    should: 'mark nothing',
    actual: titles(
      meetingImports(
        rows,
        [
          job('yesterday', '2026-08-04 09:30'),
          job('note', `${DAY} 11:00`, {
            fields: { kind: 'note', when: `${DAY} 11:00`, category: 'Professional', journalType: null },
          }),
          job('failed', `${DAY} 14:00`, { state: 'failed' }),
          job('new', `${DAY} 09:30`, { state: 'new' }),
          job('refused', `${DAY} 11:00`, {
            readback: { ...job('x', DAY).readback, refusal: 'Sky cannot read this file.' },
          }),
        ],
        DAY,
      ),
    ),
    expected: [],
  })
})

test('a filed import holds its row until the schedule lists the record', () => {
  const done = job('done', `${DAY} 09:30`, { state: 'done', result: { file: FILED } })
  const waiting = [meeting('Atlas sync', '09:30'), meeting('Widget review', '09:45')]
  const listed = [
    meeting('Atlas sync', '09:30', { record: { path: FILED, title: 'Atlas sync' } }),
    meeting('Widget review', '09:45'),
  ]
  assert({
    given: 'a finished import before and after the schedule reads its record',
    should: 'keep the slot marked, then let the record speak without marking the next meeting',
    actual: [titles(meetingImports(waiting, [done], DAY)), titles(meetingImports(listed, [done], DAY))],
    expected: [['Atlas sync ← done'], []],
  })
})
