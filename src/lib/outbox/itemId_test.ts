import { assert, test } from '#test'
import { isOutboxItemId, newOutboxItemId, outboxDraftItemId, OutboxItemId, outboxItemSlug } from './itemId.ts'

const LEGACY = 'a'.repeat(32)
const READABLE = '2026-09-12_1705_Approve-the-Atlas-pilot-budget'

test('Outbox accepts the legacy hash and the readable id, and nothing else', () => {
  const rejected = [
    '',
    'A'.repeat(32),
    'a'.repeat(31),
    '2026-09-12_1705_',
    '2026-09-12_1705_Approve-',
    '2026-09-12_1705_-Approve',
    '2026-09-12_1705_Approve--twice',
    '2026-09-12_1705_snake_case',
    '2026-09-12_1705_With space',
    '2026-09-12_175_Short-time',
    '../2026-09-12_1705_Traversal',
    '2026-09-12_1705_Approve.md',
  ]
  assert({
    given: 'both valid shapes, their draft-source form, and malformed candidates',
    should: 'validate both shapes through the same rule and reject everything else',
    actual: [
      isOutboxItemId(LEGACY),
      isOutboxItemId(READABLE),
      isOutboxItemId('2026-09-12_2530_Late-night-reply-2'),
      OutboxItemId.parse(READABLE),
      OutboxItemId.safeParse('nope').success,
      outboxDraftItemId(`outbox:${READABLE}`),
      outboxDraftItemId(`outbox:${LEGACY}`),
      outboxDraftItemId('outbox:nope'),
      outboxDraftItemId(READABLE),
      rejected.filter(isOutboxItemId),
    ],
    expected: [true, true, true, READABLE, false, READABLE, LEGACY, undefined, undefined, []],
  })
})

test('Outbox slugs keep capitalization, drop punctuation, and stop after six words', () => {
  assert({
    given: 'titles with punctuation, accents, underscores, extra words, and no usable characters',
    should: 'produce a hyphenated slug of at most six words or the Reply fallback',
    actual: [
      outboxItemSlug('Approve the Atlas pilot budget'),
      outboxItemSlug('Confirm: the update arrived?'),
      outboxItemSlug('Réunion with Jane Doe, Maya Okafor and the #atlas-launch team'),
      outboxItemSlug('snake_case title'),
      outboxItemSlug('  - leading dash and   spaces  '),
      outboxItemSlug('???'),
      outboxItemSlug(''),
    ],
    expected: [
      'Approve-the-Atlas-pilot-budget',
      'Confirm-the-update-arrived',
      'Reunion-with-Jane-Doe-Maya-Okafor',
      'snakecase-title',
      'leading-dash-and-spaces',
      'Reply',
      'Reply',
    ],
  })
})

test('Outbox allocates readable ids from the local time and title, suffixing namesakes', async () => {
  const existing = new Set([
    '2026-09-12_1705_Approve-the-Atlas-pilot-budget',
    '2026-09-12_1705_Approve-the-Atlas-pilot-budget-2',
  ])
  const taken = async (id: string) => existing.has(id)
  const first = await newOutboxItemId({ at: '2026-09-12 17:05', title: 'Approve the Atlas pilot budget', taken })
  const early = await newOutboxItemId({ at: '2026-09-12 7:05', title: 'Approve the Atlas pilot budget', taken })
  const late = await newOutboxItemId({ at: '2026-09-12 25:30', title: 'Late night reply', taken })
  const seconds = await newOutboxItemId({ at: '2026-09-12 17:05:30', title: 'With seconds', taken })
  const blank = await newOutboxItemId({ at: '2026-09-12 17:05', title: '!!!', taken })
  let invalid = ''
  try {
    await newOutboxItemId({ at: 'today', title: 'Approve', taken })
  } catch (error) {
    invalid = (error as Error).message
  }
  assert({
    given: 'two namesakes already stored, an extended hour, seconds, an unusable title, and a bad time',
    should: 'take the next free suffix, pad hours, keep extended hours, fall back to Reply, and refuse the bad time',
    actual: [first, early, late, seconds, blank, invalid, [first, early, late, seconds, blank].every(isOutboxItemId)],
    expected: [
      '2026-09-12_1705_Approve-the-Atlas-pilot-budget-3',
      '2026-09-12_0705_Approve-the-Atlas-pilot-budget',
      '2026-09-12_2530_Late-night-reply',
      '2026-09-12_1705_With-seconds',
      '2026-09-12_1705_Reply',
      'An Outbox item id needs a notebook-local date and time.',
      true,
    ],
  })
})
