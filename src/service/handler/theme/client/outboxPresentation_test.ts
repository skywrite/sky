import type { OutboxRecord } from '#lib/outbox/types.ts'
import { assert, test } from '#test'
import {
  outboxCardSummary,
  outboxDone,
  outboxGlyph,
  outboxHeading,
  outboxNeedsReview,
  outboxSender,
  outboxToken,
  outboxWhere,
  outboxWho,
} from './outboxPresentation.ts'

function record(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    id: '2026-09-12_1705_Approve-the-Atlas-pilot-budget',
    revision: 'r1',
    created: '2026-09-12 17:10',
    updated: '2026-09-12 17:10',
    status: 'needs_review',
    conversation: {
      key: 'Slack:atlas',
      version: 'v1',
      medium: 'Slack',
      sources: [
        {
          ref: '2026-09-12/actions/messages/17-05_slack_atlas-launch.md',
          hash: 'h',
          from: 'Maya Okafor',
          to: '#atlas-launch',
          body: '',
        },
      ],
      target: null,
      limitations: [],
    },
    title: 'Approve the Atlas pilot budget',
    situation: 'Maya asked for a budget decision.',
    reasoning: 'A decision is owed.',
    questions: ['Approve the budget?'],
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

function source(from: string, to: string): OutboxRecord['conversation'] {
  return {
    key: 'k',
    version: 'v',
    medium: 'Slack',
    sources: [{ ref: 'r.md', hash: 'h', from, to, body: '' }],
    target: null,
    limitations: [],
  }
}

test('outbox presentation - who and where read from the last saved message', () => {
  assert({
    given: 'a channel capture, a direct message, an email, and a capture without names',
    should: 'name the channel, else the medium plainly, and never show an empty name',
    actual: [
      [outboxWho(record()), outboxWhere(record()), outboxGlyph(record())],
      [
        outboxWho(record({ conversation: source('Jane Doe', 'Alex Example') })),
        outboxWhere(record({ conversation: source('Jane Doe', 'Alex Example') })),
        outboxGlyph(record({ conversation: source('Jane Doe', 'Alex Example') })),
      ],
      [
        outboxWho(record({ conversation: { ...source('Jane Doe', 'alex@example.com'), medium: 'Email' } })),
        outboxWhere(record({ conversation: { ...source('Jane Doe', 'alex@example.com'), medium: 'Email' } })),
        outboxGlyph(record({ conversation: { ...source('Jane Doe', 'alex@example.com'), medium: 'Email' } })),
      ],
      [outboxWho(record({ conversation: source('', '') })), outboxWhere(record({ conversation: source('', '') }))],
      outboxWho(record({ recipient: 'Jane Doe' })),
    ],
    expected: [
      ['Maya Okafor', '#atlas-launch', 'channel'],
      ['Jane Doe', 'direct message', 'direct'],
      ['Jane Doe', 'email', 'email'],
      ['direct message', 'direct message'],
      'To Jane Doe',
    ],
  })
})

test('outbox presentation - one token names the state', () => {
  const label = (item: OutboxRecord, options?: { awaiting?: boolean; unsavedDraft?: string }) =>
    outboxToken(item, options).label
  assert({
    given: 'open items in each state',
    should: 'read what the person does next',
    actual: [
      label(record()),
      label(record({ draft: 'Approved, go ahead.' })),
      label(record(), { unsavedDraft: 'My words' }),
      label(record({ stale: true, draft: 'x' })),
      label(record(), { awaiting: true }),
      label(record({ status: 'ready', draft: 'x' })),
      label(record({ status: 'ready', draft: 'x', conversation: { ...source('a', 'b'), medium: 'Email' } })),
      label(record({ status: 'placement_unknown', draft: 'x' })),
      label(record({ status: 'placing', draft: 'x' })),
    ],
    expected: [
      'Your decision',
      'Draft ready',
      'Draft ready',
      'New messages',
      'Checking',
      'Ready in Slack',
      'Ready in Gmail',
      'Could not place',
      'Saving draft',
    ],
  })
  const sent = record({ delivery: { at: '2026-09-13 12:00', evidence: 'Sent it', kind: 'owner_report' } })
  const answered = record({
    status: 'dismissed',
    responseHistory: [{ at: '2026-09-13 12:00', sourceVersion: 'v', kind: 'captured_reply', evidence: 'Reply seen' }],
  })
  const dismissed = record({ status: 'dismissed' })
  assert({
    given: 'finished items',
    should: 'read Sent, Answered, or Dismissed, and count as done',
    actual: [
      label(sent),
      label(answered),
      label(dismissed),
      outboxDone(sent),
      outboxDone(answered),
      outboxDone(dismissed),
      outboxDone(record()),
      outboxNeedsReview(record({ status: 'ready' })),
      outboxNeedsReview(record({ status: 'ready', stale: true })),
    ],
    expected: ['Sent', 'Answered', 'Dismissed', true, true, true, false, false, true],
  })
})

test('outbox presentation - headings and summaries stay useful for older reviews', () => {
  const legacy = record({
    title: '3 requests need a reply',
    situation: '3 requests remain in this conversation. The background is long. '.repeat(12),
    conversation: {
      ...source('Jane Doe', '#atlas-launch'),
      sources: [
        {
          ref: '2026-09-12/actions/messages/slack_Atlas-pilot.md',
          hash: 'h',
          from: 'Jane Doe',
          to: '#atlas-launch',
          body: '# Atlas pilot scope\n\nText',
        },
      ],
    },
  })
  assert({
    given: 'a count title, a heading in the capture, and no summary',
    should: 'use the capture heading and a bounded preview of the situation',
    actual: [
      outboxHeading(legacy),
      outboxCardSummary(legacy).length <= 281,
      outboxCardSummary(legacy).startsWith('The background'),
    ],
    expected: ['Atlas pilot scope', true, true],
  })
  assert({
    given: 'a proper title and a summary',
    should: 'use them as they are',
    actual: [outboxHeading(record()), outboxCardSummary(record({ summary: 'Maya needs a budget answer.' }))],
    expected: ['Approve the Atlas pilot budget', 'Maya needs a budget answer.'],
  })
})

test({ name: 'outbox presentation - an older capture with no sender reads as nobody, not as two quotes' }, () => {
  assert({
    given: 'a saved message whose sender was written as "", one with a name, and none at all',
    should: 'show nothing, the name, and nothing',
    actual: [outboxSender({ from: '""' }), outboxSender({ from: 'Jane Doe' }), outboxSender(undefined)],
    expected: ['', 'Jane Doe', ''],
  })
})
