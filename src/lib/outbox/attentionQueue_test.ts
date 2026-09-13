import { sampleOutboxItem } from '#lib/writingVoice/testHelpers.ts'
import { assert, test } from '#test'
import { attentionQueue, awaitingAttention } from './attentionQueue.ts'
import type { OutboxRecord } from './types.ts'

test('Unverified scanner output cannot appear as a confirmed owner decision while a scan is still running', () => {
  const legacy: OutboxRecord = { ...sampleOutboxItem(), origin: 'conversation', revision: 'legacy' }
  const requestId = 'b'.repeat(32)
  const verified: OutboxRecord = {
    ...legacy,
    id: 'b'.repeat(32),
    requestIds: [requestId],
    requestAnalysis: { version: 'verified', sourceVersion: 'source', updated: '2025-03-15 12:00', units: 1 },
    requests: [
      {
        id: requestId,
        summary: 'Choose the Atlas pilot scope',
        status: 'open',
        present: true,
        explanation: 'Jane directly asked Alex to decide.',
        context: '',
        origin: {
          kind: 'message',
          ref: '2025-03-15/actions/messages/slack_Atlas.md',
          message: 'message',
          at: '2025-03-15 09:00',
          quote: '@Alex, choose the pilot scope.',
        },
        evidence: [],
        resolution: null,
        reports: [],
        attention: {
          action: 'reply',
          basis: 'direct_request',
          explanation: 'Jane needs your scope decision.',
          evidence: [
            {
              kind: 'message',
              ref: '2025-03-15/actions/messages/slack_Atlas.md',
              message: 'message',
              at: '2025-03-15 09:00',
              quote: '@Alex, choose the pilot scope.',
            },
          ],
        },
      },
    ],
  }
  const queue = attentionQueue([legacy, verified])
  assert({
    given: 'an earlier unverified judgment and a freshly verified direct request',
    should: 'keep the earlier result accessible separately and publish only the confirmed obligation',
    actual: [queue.items.map((item) => item.id), queue.awaitingCheck.map((item) => item.id)],
    expected: [[verified.id], [legacy.id]],
  })
  assert({
    given: 'a human-edited draft, an approved native draft, or an explicitly prepared follow-up',
    should: 'preserve that work in the main queue without demanding scanner evidence',
    actual: [
      awaitingAttention({ ...legacy, edited: true }),
      awaitingAttention({ ...legacy, native: { id: 'native', url: 'https://example.com/draft' } }),
      awaitingAttention({ ...legacy, origin: 'followup' }),
    ],
    expected: [false, false, false],
  })
})
