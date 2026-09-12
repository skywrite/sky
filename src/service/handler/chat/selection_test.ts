import { mkdtemp, readdir, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Hono } from 'hono'
import { assert, test } from '#test'
import { registerSelectionStarts, reserveSelectionChat } from './selection.ts'

test('selection chat names are readable, stable reservations with case-insensitive collision protection', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-selection-names-'))
  try {
    const now = () => '2025-03-15T12:34:56.123Z'
    const first = await reserveSelectionChat({ dir, now, name: async () => 'Atlas API Review' }, 'Selected passage')
    const concurrent = await Promise.all(
      ['Atlas API Review', 'atlas api review'].map((summary) =>
        reserveSelectionChat({ dir, now, name: async () => summary }, 'Selected passage'),
      ),
    )
    assert({
      given: 'three requests within one second, including a differently capitalized title',
      should: 'preserve the first title and reserve three different names atomically',
      actual: {
        first,
        unique: new Set([first, ...concurrent].map((id) => id.toLowerCase())).size,
        names: (await readdir(dir)).sort(),
      },
      expected: {
        first: '2025-03-15_123456_Atlas-API-Review',
        unique: 3,
        names: [
          '2025-03-15_123456_atlas-api-review',
          '2025-03-15_123456_atlas-api-review-2',
          '2025-03-15_123456_atlas-api-review-3',
        ],
      },
    })
    const fallback = await reserveSelectionChat(
      {
        dir,
        now,
        name: async () => {
          throw new Error('Naming unavailable')
        },
      },
      'Confirm the Atlas API rollout date',
    )
    assert({
      given: 'the naming service fails',
      should: 'still prepare the chat with a descriptive name from its passage',
      actual: fallback,
      expected: '2025-03-15_123456_Confirm-the-Atlas-API-rollout-date',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('selection preparation validates the passage and does not create or inherit a conversation', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-selection-route-'))
  try {
    const app = new Hono()
    const named: string[] = []
    registerSelectionStarts(app, {
      dir,
      now: () => '2025-03-15T12:34:56Z',
      name: async (text) => {
        named.push(text)
        return 'Atlas questions'
      },
    })
    const post = (text: string) =>
      app.request('/selections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
    const empty = await post('  ')
    const large = await post('x'.repeat(80_001))
    const prepared = await post('Which Atlas questions should we resolve?')
    assert({
      given: 'invalid passages followed by a valid selection',
      should: 'name only the selected text and return only a new identity, with no message or inherited state',
      actual: {
        statuses: [empty.status, large.status, prepared.status],
        result: await prepared.json(),
        named,
      },
      expected: {
        statuses: [400, 400, 201],
        result: { id: '2025-03-15_123456_Atlas-questions' },
        named: ['Which Atlas questions should we resolve?'],
      },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
