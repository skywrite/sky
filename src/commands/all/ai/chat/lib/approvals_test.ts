import { assert, test } from '#test'
import { SessionBlessings, harvestFileRefs } from './approvals.ts'

const ID = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'

test('SessionBlessings - durable and mention tiers both answer has(), only durable serializes', () => {
  const blessings = new SessionBlessings()
  blessings.blessDurably('google_agent', 'f-created-1')
  blessings.blessMention('f-pasted-2')

  assert({
    given: 'one durable and one mention blessing',
    should: 'answer has() for both, serialize only the durable one',
    expected: {
      created: true,
      pasted: true,
      other: false,
      serialized: ['google_agent:f-created-1'],
    },
    actual: {
      created: blessings.has('google_agent', 'f-created-1'),
      pasted: blessings.has('google_agent', 'f-pasted-2'),
      other: blessings.has('google_agent', 'f-unknown'),
      serialized: blessings.serializeDurable(),
    },
  })
})

test('SessionBlessings - durable blessings scope to the tool, mentions cover any tool', () => {
  const blessings = new SessionBlessings()
  blessings.blessDurably('google_agent', 'f1')
  blessings.blessMention('f2')

  assert({
    given: 'a durable key for one tool and a pasted-file mention',
    should: 'scope the durable key to its tool but answer any tool for the mention',
    expected: { durableOtherTool: false, mentionAnyTool: true },
    actual: {
      durableOtherTool: blessings.has('other_tool', 'f1'),
      mentionAnyTool: blessings.has('other_tool', 'f2'),
    },
  })
})

test('SessionBlessings - restoreDurable round-trips serializeDurable', () => {
  const first = new SessionBlessings()
  first.blessDurably('google_agent', 'f2')
  first.blessDurably('google_agent', 'f1')

  const resumed = new SessionBlessings()
  resumed.restoreDurable(first.serializeDurable())

  assert({
    given: 'a resumed session seeded from a saved session',
    should: 'answer has() for the saved keys and serialize them back sorted',
    expected: { f1: true, f2: true, serialized: ['google_agent:f1', 'google_agent:f2'] },
    actual: {
      f1: resumed.has('google_agent', 'f1'),
      f2: resumed.has('google_agent', 'f2'),
      serialized: resumed.serializeDurable(),
    },
  })
})

test('harvestFileRefs - lifts ids from Google URLs, prose punctuation and all', () => {
  const text = [
    `Look at https://docs.google.com/document/d/${ID}/edit?tab=t.abc123.`,
    `(also https://drive.google.com/file/d/x9Y8z7W6v5U4t3S2r1Q0p9O8n7M6l5K4j3I2/view)`,
  ].join('\n')

  assert({
    given: 'a message pasting two Google URLs, one sentence-final, one parenthesized',
    should: 'return both file ids exactly once',
    expected: [ID, 'x9Y8z7W6v5U4t3S2r1Q0p9O8n7M6l5K4j3I2'],
    actual: harvestFileRefs(text),
  })
})

test('harvestFileRefs - accepts bare id tokens but never id-shaped words', () => {
  assert({
    given: 'a bare file id pasted alone',
    should: 'return it',
    expected: [ID],
    actual: harvestFileRefs(`use ${ID} please`),
  })

  assert({
    given: 'long digit-free words and slashed paths',
    should: 'return nothing',
    expected: [],
    actual: harvestFileRefs('internationalization considerations for docs/architecture-decisions-2026 rollout'),
  })
})
