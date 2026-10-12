import { assert, test } from '#test'
import { laneBeforeAt, laneOrderChanges, moveLaneBefore } from './workstreamsOrder.ts'

test({ name: 'workstream lanes - moving between unequal-height rows uses canvas coordinates' }, () => {
  const lanes = [
    { id: 'atlas', y: 92, height: 250 },
    { id: 'outreach', y: 360, height: 150 },
    { id: 'review', y: 528, height: 300 },
  ]
  assert({
    given: 'a lane dragged down through rows of different heights',
    should: 'choose insertion by the moved center rather than a fixed row height',
    actual: [
      laneBeforeAt(lanes, 'atlas', 0),
      laneBeforeAt(lanes, 'atlas', 250),
      laneBeforeAt(lanes, 'atlas', 600),
      laneBeforeAt(lanes, 'review', -500),
    ],
    expected: ['outreach', 'review', null, 'atlas'],
  })
})

test({ name: 'workstream lanes - display order changes only the moved rank' }, () => {
  const ids = ['atlas', 'hidden', 'outreach', 'review']
  const ranks = { atlas: 0, hidden: 1, outreach: 2, review: 3 }
  assert({
    given: 'a move past a filtered-out lane',
    should: 'preserve other relative order and persist one display rank',
    actual: { ids: moveLaneBefore(ids, 'atlas', 'review'), changes: laneOrderChanges(ids, 'atlas', 'review', ranks) },
    expected: { ids: ['hidden', 'outreach', 'atlas', 'review'], changes: { atlas: 2.5 } },
  })
  assert({
    given: 'the same insertion point and moves to each end',
    should: 'avoid unnecessary writes and assign usable outer ranks',
    actual: [
      laneOrderChanges(ids, 'atlas', 'hidden', ranks),
      laneOrderChanges(ids, 'review', 'atlas', ranks),
      laneOrderChanges(ids, 'atlas', null, ranks),
    ],
    expected: [{}, { review: -1 }, { atlas: 4 }],
  })
})

test({ name: 'workstream lanes - equal stored ranks can be repaired without losing order' }, () => {
  assert({
    given: 'two neighboring lanes with the same stored rank',
    should: 'rebalance the requested order when a midpoint cannot be represented',
    actual: laneOrderChanges(['atlas', 'outreach', 'review'], 'review', 'outreach', {
      atlas: 1,
      outreach: 1,
      review: 2,
    }),
    expected: { atlas: 0, review: 1, outreach: 2 },
  })
})
