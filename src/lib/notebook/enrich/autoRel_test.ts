import { assert, test } from '#test'
import { mergeRel, subsetOf } from './autoRel.ts'

test('mergeRel keeps existing refs first and verbatim', () => {
  assert({
    given: 'pipeline refs and a fresh proposal',
    should: 'append the proposal after them',
    actual: mergeRel(['Jane Doe', 'Acme Corp'], ['projects/Atlas-Rollout']),
    expected: ['Jane Doe', 'Acme Corp', 'projects/Atlas-Rollout'],
  })
})

test('mergeRel drops proposals already present, however they are spelled', () => {
  assert({
    given: 'a proposal matching an existing ref under normalization',
    should: 'keep the existing spelling and add nothing',
    actual: mergeRel(['projects/Atlas-Rollout'], ['projects/atlas rollout', 'Acme Corp']),
    expected: ['projects/Atlas-Rollout', 'Acme Corp'],
  })
  assert({
    given: 'a proposal repeated within itself',
    should: 'add it once',
    actual: mergeRel([], ['Jane Doe', 'jane doe']),
    expected: ['Jane Doe'],
  })
})

test('mergeRel handles either side being absent', () => {
  assert({
    given: 'only proposals',
    should: 'use them',
    actual: mergeRel(undefined, ['Jane Doe']),
    expected: ['Jane Doe'],
  })
  assert({
    given: 'only existing refs',
    should: 'leave them untouched',
    actual: mergeRel(['Jane Doe'], undefined),
    expected: ['Jane Doe'],
  })
  assert({
    given: 'nothing on either side',
    should: 'stay undefined',
    actual: mergeRel(undefined, undefined),
    expected: undefined,
  })
})

test('subsetOf keeps candidates in candidate order, matched loosely, deduped', () => {
  const candidates = ['Jane Doe', 'Acme Corp', 'projects/Atlas-Rollout']

  assert({
    given: 'a reply in a different order and casing, with an invention',
    should: 'keep only real candidates, in candidate order',
    actual: subsetOf(['acme corp', 'JANE DOE', 'Nonsense Inc', 'jane doe'], candidates),
    expected: ['Jane Doe', 'Acme Corp'],
  })
  assert({ given: 'an empty reply', should: 'keep nothing', actual: subsetOf([], candidates), expected: [] })
})
