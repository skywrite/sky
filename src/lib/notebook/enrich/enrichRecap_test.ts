import { assert, test } from '#test'
import { openSlots } from './enrichRecap.ts'

test('openSlots fills only absence and honors the escape flags', () => {
  assert({
    given: 'no curation and no flags',
    should: 'open both slots',
    expected: { tags: true, rel: true },
    actual: openSlots({}, {}),
  })

  assert({
    given: 'hand-curated tags and an empty rel list',
    should: 'keep the tags and open rel',
    expected: { tags: false, rel: true },
    actual: openSlots({ tags: 'Work/Eng', rel: [] }, {}),
  })

  assert({
    given: 'a --rel argument',
    should: 'close rel',
    expected: { tags: true, rel: false },
    actual: openSlots({ rel: ['projects/Atlas'] }, {}),
  })

  assert({
    given: 'a single-valued rel string',
    should: 'count as curated',
    expected: false,
    actual: openSlots({ rel: 'projects/Atlas' }, {}).rel,
  })

  assert({
    given: 'both escape flags',
    should: 'close both slots',
    expected: { tags: false, rel: false },
    actual: openSlots({}, { noAutoTag: true, noAutoRel: true }),
  })
})
