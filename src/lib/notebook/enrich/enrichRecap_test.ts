import { assert, test } from '#test'
import enrichRecap, { openSlots } from './enrichRecap.ts'

test('comprehensive recap regeneration adds all topics and refs while retaining curation', async () => {
  const calls: boolean[] = []
  const tags = ['Work/Engineering', 'Work/Finance', 'Work/Support', 'Work/Planning']
  const rel = ['projects/Atlas', 'projects/Beacon', 'Acme Corp', 'Jane Doe']
  const actual = await enrichRecap(
    { app: 'slack', what: 'Channel activity', body: 'Synthetic channel summaries.', kind: 'daily Slack recap' },
    { tags: 'Work/Curated', rel: ['projects/Curated'] },
    { comprehensive: true },
    {
      tag: async (_input, opts) => {
        calls.push(opts.comprehensive === true)
        return tags.join('; ')
      },
      rel: async (_input, opts) => {
        calls.push(opts.comprehensive === true)
        return rel
      },
    },
  )
  assert({
    given: 'four proposed tags and refs alongside existing curation on a regenerated recap',
    should: 'retain everything and request comprehensive classification for both slots',
    actual: { actual, calls },
    expected: {
      actual: { tags: ['Work/Curated', ...tags].join('; '), rel: ['projects/Curated', ...rel] },
      calls: [true, true],
    },
  })
})

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
