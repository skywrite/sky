import TagSet from '#shared/models/TagSet/mod.ts'
import { assert, test } from '#test'
import { enrichDecision } from './enrich.ts'

const decision = {
  title: 'Who leads sales through the launch',
  context: 'You lead sales yourself.',
  desiredOutcomes: '1. Keep your time free',
  record: '## Options weighed\n\n- Promote Jane Doe. Sky’s: 40–60%.',
  decision: 'Promote Jane Doe.',
  rel: ['goals/Run-a-Marathon'],
}

test('A decision is tagged and tied to who and what it names, from the whole record', async () => {
  const asked: unknown[] = []
  const enriched = await enrichDecision(decision, undefined, {
    tags: async (input, options) => {
      asked.push(['tags', input, options])
      return 'Atlas/Sales; Atlas/Hiring'
    },
    rel: async (input, options) => {
      asked.push(['rel', input, options])
      return ['Jane Doe', 'goals/Run-a-Marathon']
    },
  })
  const body =
    'You lead sales yourself.\n\n1. Keep your time free\n\n## Options weighed\n\n- Promote Jane Doe. Sky’s: 40–60%.\n\nPromote Jane Doe.'
  assert({
    given: 'a decision with one reference and no tags',
    should:
      'read the whole record, name Sky as the other party so it is never taken for a person, keep the reference it had first without repeating it, and set the tags found',
    actual: [asked, [...(enriched.tags ?? [])], enriched.rel],
    expected: [
      [
        ['tags', { summary: decision.title, body }, { mediums: ['journal'], kind: 'decision', maxTags: 5 }],
        [
          'rel',
          { summary: decision.title, body, existingRel: ['goals/Run-a-Marathon'], from: 'Sky' },
          { mediums: ['journal'], kind: 'decision', comprehensive: true },
        ],
      ],
      ['Atlas/Sales', 'Atlas/Hiring'],
      ['goals/Run-a-Marathon', 'Jane Doe'],
    ],
  })
})

test('A decision keeps the tags it was given, and saves as it is when enrichment abstains or is off', async () => {
  const calls: string[] = []
  const services = {
    tags: async () => {
      calls.push('tags')
      return undefined
    },
    rel: async () => {
      calls.push('rel')
      return undefined
    },
  }
  const tags = TagSet.fromArray(['Atlas/Board'])
  const given = await enrichDecision({ ...decision, tags }, undefined, services)
  const abstained = await enrichDecision(decision, undefined, services)
  const off = await enrichDecision(decision, { autoTag: false, autoRel: false }, services)
  assert({
    given: 'tags already chosen, then lookups that find nothing, then enrichment turned off',
    should: 'never look for tags when some were given, leave the decision as it came, and make no lookup when off',
    actual: [[...(given.tags ?? [])], [abstained.tags, abstained.rel], [off.tags, off.rel], calls],
    expected: [
      ['Atlas/Board'],
      [undefined, ['goals/Run-a-Marathon']],
      [undefined, ['goals/Run-a-Marathon']],
      ['rel', 'tags', 'rel'],
    ],
  })
})
