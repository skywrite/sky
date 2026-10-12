import type { OutboxRecord } from '#lib/outbox/types.ts'
import { assert, test } from '#test'
import {
  askedAt,
  askedLabel,
  dateLabel,
  dayNumber,
  doneAt,
  normalizeStamp,
  waitingLabel,
  weekdayLabel,
  writtenAt,
} from './outboxTime.ts'

function record(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    id: '2026-09-12_1705_Approve-the-Atlas-pilot-budget',
    revision: 'r1',
    created: '2026-09-12 17:10',
    updated: '2026-09-13 09:00',
    status: 'needs_review',
    conversation: {
      key: 'Slack:atlas',
      version: 'v1',
      medium: 'Slack',
      sources: [
        {
          ref: '2026-09-11/actions/messages/16-40_slack_atlas-launch.md',
          hash: 'h1',
          from: 'Jane Doe',
          to: '#atlas-launch',
          body: '',
          times: ['2026-09-11 16:40', '2026-09-11 9:05'],
        },
        {
          ref: '2026-09-12/actions/messages/17-05_slack_atlas-launch.md',
          hash: 'h2',
          from: 'Maya Okafor',
          to: '#atlas-launch',
          body: '',
          times: ['2026-09-12 17:05', '2026-09-12 16:55'],
        },
      ],
      target: null,
      limitations: [],
    },
    title: 'Approve the Atlas pilot budget',
    situation: 'Maya asked for a budget decision.',
    reasoning: 'A decision is owed.',
    questions: [],
    originalDraft: '',
    draft: '',
    edited: false,
    stale: false,
    reviews: [],
    native: null,
    placementError: null,
    ...overrides,
  }
}

const request = (id: string, status: 'open' | 'resolved', at: string | null) => ({
  id,
  summary: 'Approve the budget',
  origin: { kind: 'message' as const, ref: 'r', message: 'm', at, quote: 'Can you approve the budget?' },
  status,
  explanation: '',
  context: '',
  evidence: [],
  resolution: null,
  present: true,
  reports: [],
})

test('outbox time - stamps, day numbers, and labels come from the text alone', () => {
  assert({
    given: 'stamps with a T, a single-digit hour, and no date',
    should: 'normalize to YYYY-MM-DD HH:MM or read as empty',
    actual: [
      normalizeStamp('2026-09-12T17:05'),
      normalizeStamp('2026-09-11 9:05'),
      normalizeStamp('later'),
      normalizeStamp(null),
    ],
    expected: ['2026-09-12 17:05', '2026-09-11 09:05', '', ''],
  })
  assert({
    given: 'dates across a month end, a leap day, and the epoch',
    should: 'count days by the calendar',
    actual: [
      dayNumber('1970-01-01'),
      dayNumber('2026-10-01') - dayNumber('2026-09-30'),
      dayNumber('2028-03-01') - dayNumber('2028-02-28'),
      dayNumber('2026-09-14 08:00') - dayNumber('2026-09-12 17:05'),
      dayNumber('not a date'),
    ],
    expected: [0, 1, 2, 2, NaN],
  })
  assert({
    given: 'known dates',
    should: 'name their weekdays',
    actual: [weekdayLabel('2026-09-14'), weekdayLabel('2025-03-15'), weekdayLabel('1970-01-01'), weekdayLabel('')],
    expected: ['Mon', 'Sat', 'Thu', ''],
  })
  assert({
    given: 'a stamp, a bare date, and a stamp with a T',
    should: 'read as a short weekday date with the time when there is one',
    actual: [
      askedLabel('2026-09-12 17:05'),
      askedLabel('2026-09-12'),
      askedLabel('2025-03-15T17:45'),
      dateLabel('2026-09-11'),
    ],
    expected: ['Sat 12 Sep, 17:05', 'Sat 12 Sep', 'Sat 15 Mar, 17:45', 'Fri 11 Sep'],
  })
})

test('outbox time - waiting is counted from the report day, never the clock', () => {
  assert({
    given: 'asks from today back to a month ago',
    should: 'read today, yesterday, days, then weeks',
    actual: [
      waitingLabel('2026-09-14 09:00', '2026-09-14'),
      waitingLabel('2026-09-15 09:00', '2026-09-14'),
      waitingLabel('2026-09-13 23:59', '2026-09-14'),
      waitingLabel('2026-09-12 17:05', '2026-09-14'),
      waitingLabel('2026-09-01 08:00', '2026-09-14'),
      waitingLabel('2026-08-14 08:00', '2026-09-14'),
      waitingLabel('', '2026-09-14'),
    ],
    expected: ['today', 'today', 'yesterday', '2 days', '13 days', '4 weeks', 'today'],
  })
})

test('outbox time - the ask is the newest open request, else the last message, else creation', () => {
  const open = record({
    requestIds: ['a'.repeat(32), 'b'.repeat(32)],
    requests: [
      request('a'.repeat(32), 'open', '2026-09-11 16:40'),
      request('b'.repeat(32), 'open', '2026-09-12 17:05'),
      request('c'.repeat(32), 'open', '2026-09-13 08:00'),
      request('d'.repeat(32), 'resolved', '2026-09-13 09:00'),
    ],
  })
  assert({
    given: 'open requests inside and outside the review, and a resolved one',
    should: 'take the newest open request of this review',
    actual: askedAt(open),
    expected: '2026-09-12 17:05',
  })
  assert({
    given: 'no requests',
    should: 'take the last saved message time of the last capture',
    actual: askedAt(record()),
    expected: '2026-09-12 17:05',
  })
  const bare = record()
  bare.conversation.sources = [{ ref: 'x.md', hash: 'h', from: '', to: '', body: '' }]
  assert({
    given: 'a capture without times',
    should: 'fall back to the item creation',
    actual: askedAt(bare),
    expected: '2026-09-12 17:10',
  })
  assert({
    given: 'a reviewed and redirected item, and a finished one',
    should: 'date the reply by its last change and the finish by its report',
    actual: [
      writtenAt(record({ reviews: [{ at: '2026-09-13 10:00', original: '', final: '', sourceVersion: 'v' }] })),
      writtenAt(
        record({
          replyDirections: [{ at: '2026-09-13 11:30', text: 'Shorter', sourceVersion: 'v' }],
          reviews: [{ at: '2026-09-13 10:00', original: '', final: '', sourceVersion: 'v' }],
        }),
      ),
      writtenAt(record()),
      doneAt(record({ delivery: { at: '2026-09-13 12:00', evidence: 'Sent in Slack', kind: 'owner_report' } })),
      doneAt(record()),
    ],
    expected: ['2026-09-13 10:00', '2026-09-13 11:30', '2026-09-12 17:10', '2026-09-13 12:00', '2026-09-13 09:00'],
  })
})
