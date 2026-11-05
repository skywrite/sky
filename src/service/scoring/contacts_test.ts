import { assert, test } from '#test'
import type { Store } from '../store.ts'
import { createContactLookup, createScoreLookup } from './contacts.ts'

const store = {
  // As the service reports them: most active first
  getPeopleWithScores: () => [
    { name: 'Jane Doe', score: 120, lastContact: '2026-10-28', lastInteraction: '2026-10-30' },
    { name: 'Sam Rivera', score: 35, lastContact: null, lastInteraction: '2026-09-01' },
    { name: 'Alex Kim', score: 0, lastContact: null, lastInteraction: null },
  ],
} as unknown as Store

test('contacts: each person’s place by interaction score, by any of their names', () => {
  const contactOf = createContactLookup(store)
  const scoreFor = createScoreLookup(store)
  assert({
    given: 'two people with logged contact, one without, a second name, and a stranger',
    should: 'number the active by score, leave the rest unranked, and take a profile’s best name',
    actual: [
      contactOf(['Jane Doe']),
      contactOf(['Sam Rivera']),
      contactOf(['Alex Kim']),
      contactOf(['Samuel', 'sam rivera']),
      contactOf(['Nobody Here']),
      [scoreFor('jane doe'), scoreFor('Nobody Here')],
    ],
    expected: [
      { rank: 1, lastContact: '2026-10-28' },
      { rank: 2, lastContact: null },
      { lastContact: null },
      { rank: 2, lastContact: null },
      null,
      [120, 0],
    ],
  })
})
