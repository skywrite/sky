import { assert, test } from '#test'
import { selectedJournalTypes } from './typeSelection.ts'

test('journal type review accepts new names, reuses existing spellings, and merges equivalent selections', () => {
  assert({
    given: 'an edited type, an existing type entered with spaces, and the same new type twice',
    should: 'keep the new name and use each canonical type once',
    actual: selectedJournalTypes(['  Atlas Notes  ', 'widget notes', 'atlas-notes'], ['Widget-Notes']),
    expected: ['Atlas Notes', 'Widget-Notes'],
  })
  assert({
    given: 'all journals unchecked',
    should: 'allow the existing whole-recording fallback',
    actual: selectedJournalTypes([], ['Widget-Notes']),
    expected: [],
  })
})

test('journal type review rejects missing names and names that would break a single type tag', () => {
  for (const values of [
    null,
    'Atlas',
    [1],
    [''],
    ['  '],
    ['Atlas;Widget'],
    ['Atlas/Widget'],
    ['Atlas\\Widget'],
    ['Atlas\nWidget'],
  ]) {
    let error = ''
    try {
      selectedJournalTypes(values, [])
    } catch (problem) {
      error = (problem as Error).message
    }
    assert({
      given: `invalid journal type selection ${JSON.stringify(values)}`,
      should: 'explain why it cannot be used before any journal is written',
      actual: Boolean(error),
      expected: true,
    })
  }
})
