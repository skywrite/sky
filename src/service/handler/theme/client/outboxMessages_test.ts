import type { OutboxRecord } from '#lib/outbox/types.ts'
import { assert, test } from '#test'
import { conversationMessages, newMessageCount, sourceMessages } from './outboxMessages.ts'

const SLACK = [
  '## 2026-09-11 16:40 - Jane Doe',
  '',
  'Can we approve the Atlas pilot budget this week?',
  '',
  '## 2026-09-12 9:05 - Maya Okafor',
  '',
  'Bumping this — the vendor needs an answer.',
].join('\n')

function record(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    id: '2026-09-12_1705_Approve-the-Atlas-pilot-budget',
    revision: 'r1',
    created: '2026-09-11 17:00',
    updated: '2026-09-12 17:10',
    status: 'needs_review',
    conversation: {
      key: 'Slack:atlas',
      version: 'v1',
      medium: 'Slack',
      sources: [
        {
          ref: '2026-09-12/actions/messages/17-05_slack_atlas-launch.md',
          hash: 'h2',
          from: 'Maya Okafor',
          to: '#atlas-launch',
          body: SLACK,
          times: ['2026-09-11 16:40', '2026-09-12 09:05'],
        },
        {
          ref: '2026-09-10/actions/messages/08-00_slack_atlas-launch.md',
          hash: 'h1',
          from: 'Jane Doe',
          to: '#atlas-launch',
          body: 'Not a sectioned capture.',
          times: ['2026-09-10 08:00'],
        },
      ],
      target: null,
      limitations: [],
    },
    title: 'Approve the Atlas pilot budget',
    situation: '',
    reasoning: '',
    questions: [],
    originalDraft: 'Approved.',
    draft: 'Approved.',
    edited: false,
    stale: false,
    reviews: [],
    native: null,
    placementError: null,
    ...overrides,
  }
}

test('outbox messages - captures read as messages in date order', () => {
  const entries = conversationMessages(record())
  assert({
    given: 'a sectioned Slack capture and an older plain one',
    should: 'order the captures by day and parse the sectioned one into its messages',
    actual: [
      entries.map((entry) => entry.date),
      entries[1]!.messages.map((message) => [message.author, message.at, message.parsed]),
      entries[0]!.messages.map((message) => [message.author, message.at, message.parsed, message.body]),
    ],
    expected: [
      ['2026-09-10', '2026-09-12'],
      [
        ['Jane Doe', '2026-09-11 16:40', true],
        ['Maya Okafor', '2026-09-12 09:05', true],
      ],
      [['Jane Doe', '2026-09-10 08:00', false, 'Not a sectioned capture.']],
    ],
  })
  assert({
    given: 'an email capture',
    should: 'stand as one message from its sender at its latest time',
    actual: sourceMessages(
      {
        ref: '2026-09-12/actions/messages/email_atlas.md',
        hash: 'h',
        from: 'Jane Doe',
        to: 'alex@example.com',
        body: 'Hello',
        times: ['2026-09-12 08:00'],
      },
      'Email',
    ).map((message) => [message.author, message.at, message.body, message.parsed]),
    expected: [['Jane Doe', '2026-09-12 08:00', 'Hello', false]],
  })
})

test('outbox messages - only a stale item has new messages, dated after the reply was written', () => {
  assert({
    given: 'a fresh item, a stale one, and a stale one reviewed after every message',
    should: 'count the messages that arrived after the reply was last written',
    actual: [
      newMessageCount(record()),
      newMessageCount(record({ stale: true })),
      newMessageCount(
        record({ stale: true, reviews: [{ at: '2026-09-13 08:00', original: '', final: '', sourceVersion: 'v' }] }),
      ),
    ],
    expected: [0, 1, 0],
  })
})
