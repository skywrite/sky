import { assert, test } from '#test'
import { mergeRel } from './autoRel.ts'

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
