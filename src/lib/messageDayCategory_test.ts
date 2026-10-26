import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { createTypeSafeClient } from '#shared/ai/typesafe/client.ts'
import type { AIUsageRecord } from '#shared/ai/usageLog.ts'
import PeopleStore from '#shared/models/Store/PeopleStore/mod.ts'
import { assert, test } from '#test'
import { createMessageDayCategorizer, type MessageDayCategoryInput } from './messageDayCategory.ts'

const message: MessageDayCategoryInput = {
  medium: 'iMessage',
  from: 'Alex Doe',
  to: 'Jane Doe',
  summary: 'Dinner',
  body: 'Dinner at six?',
}

function answer(category: 'Personal' | 'Professional', probability = 0.98, confidence = probability) {
  return {
    model: 'jev-test',
    answers: {
      day_category: {
        type: 'choice',
        choice: category,
        confidence,
        probabilities: { Personal: 1 - probability, Professional: 1 - probability, [category]: probability },
      },
    },
    usage: { input_tokens: 100, output_tokens: 0 },
  }
}

async function fixture() {
  const people = await PeopleStore.build([])
  const calls: Array<{
    state: {
      participants: string[]
      relationships: Array<{ name: string; notes: string }>
      owner: unknown
      conversation: string
    }
    questions: unknown
  }> = []
  const usage: AIUsageRecord[] = []
  const warnings: string[] = []
  const control = { response: () => Response.json(answer('Personal')), contexts: 0 }
  const client = createTypeSafeClient({
    secrets: new TestSecretsProvider({ 'typesafe/main': createSecret('synthetic-key') }),
    fetch: (async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)))
      return control.response()
    }) as typeof fetch,
  })
  const categorize = createMessageDayCategorizer({
    client,
    context: async () => {
      control.contexts++
      return { people, owner: { name: 'Jane Doe', family: 'Alex Doe is my spouse.' } }
    },
    sink: (record) => {
      usage.push(record)
    },
    warn: (text) => warnings.push(text),
  })
  return { people, calls, control, usage, warnings, categorize }
}

test('iMessage day sections favor Personal and require a clear Professional probability', async () => {
  const f = await fixture()
  const results: string[] = []
  for (const [category, probability, confidence] of [
    ['Personal', 0.99, 0.99],
    ['Professional', 0.84, 0.99],
    ['Professional', 0.85, 0.1],
  ] as const) {
    f.control.response = () => Response.json(answer(category, probability, confidence))
    results.push(await f.categorize(message))
  }
  assert({
    given: 'a personal judgment, an uncertain work judgment, and clear work evidence with low distribution confidence',
    should: 'prefer Personal below the work threshold, use probability rather than confidence, and log model usage',
    actual: [results, f.control.contexts, f.usage.map((entry) => entry.provider)],
    expected: [['Personal', 'Personal', 'Professional'], 1, ['typesafe', 'typesafe', 'typesafe']],
  })
})

test('day categorization uses only unambiguous participant profiles and owner relationships', async () => {
  const f = await fixture()
  f.people.set(
    '/synthetic/people/alex.md',
    '---\nname: [Alex Doe, Alex]\nphone: 555-010-1001\ntitle: Engineer\norg: Atlas\n---\nAlex is Jane’s spouse.\n',
  )
  f.people.set(
    '/synthetic/people/jordan.md',
    '---\nname: [Jordan Lee, Jordan]\nemail: {business: jordan@example.com}\n---\nJordan is a client.\n',
  )
  f.people.set('/synthetic/people/sam-one.md', '---\nname: [Sam Lee, Sam]\n---\nClient\n')
  f.people.set('/synthetic/people/sam-two.md', '---\nname: [Sam Quinn, Sam]\n---\nFriend\n')
  f.people.set('/synthetic/people/mentioned.md', '---\nname: Taylor Quinn\n---\nInvestor\n')
  f.people.set('/synthetic/people/owner.md', '---\nname: [Jane Doe, Me]\n---\nOwner’s work biography\n')
  await f.categorize({
    ...message,
    medium: 'iMessage Audio',
    from: 'Me',
    to: 'Weekend group',
    participants: ['+1 (555) 010-1001', 'jordan@example.com', 'Sam'],
    body: '**Alex Doe:**\n\nTaylor Quinn mentioned a budget. Dinner at six?',
  })
  const state = f.calls[0].state
  assert({
    given: 'a family member with a job, a client matched by email, an ambiguous nickname and someone only mentioned',
    should:
      'supply actual relationship notes, exclude the owner and unrelated profiles, and keep the complete exchange',
    actual: [
      state.owner,
      state.relationships.map((person) => person.name).sort(),
      state.relationships.some((person) => person.notes.includes('spouse')),
      state.participants.includes('Alex Doe'),
      state.conversation,
    ],
    expected: [
      { name: 'Jane Doe', family: 'Alex Doe is my spouse.' },
      ['Alex Doe', 'Jordan Lee'],
      true,
      true,
      '**Alex Doe:**\n\nTaylor Quinn mentioned a budget. Dinner at six?',
    ],
  })
})

test('invalid or unavailable judgments fall back to Personal without repeatedly delaying capture', async () => {
  for (const kind of ['unavailable', 'invalid distribution', 'wrong winner'] as const) {
    const f = await fixture()
    f.control.response = () => {
      if (kind === 'unavailable') throw new Error('Synthetic provider outage')
      const response = answer('Professional')
      response.answers.day_category.probabilities =
        kind === 'invalid distribution' ? { Personal: 0.8, Professional: 0.9 } : { Personal: 0.95, Professional: 0.05 }
      return Response.json(response)
    }
    assert({
      given: kind,
      should: 'file both entries under Personal, report fallback once and stop retrying this run',
      actual: [await f.categorize(message), await f.categorize(message), f.calls.length, f.warnings.length],
      expected: ['Personal', 'Personal', 1, 1],
    })
  }
})

test('other networks keep their default and oversized iMessages are never judged from clipped evidence', async () => {
  const f = await fixture()
  assert({
    given: 'another network and an iMessage too long for the bounded decision',
    should: 'retain the other network’s behavior and default the iMessage to Personal without model calls',
    actual: [
      await f.categorize({ ...message, medium: 'Signal' }),
      await f.categorize({ ...message, body: 'A'.repeat(25_000) }),
      f.calls.length,
    ],
    expected: ['Professional', 'Personal', 0],
  })
})

test('an unconfigured notebook can capture iMessages without a TypeSafe key', async () => {
  let requests = 0
  const categorize = createMessageDayCategorizer({
    client: createTypeSafeClient({
      secrets: new TestSecretsProvider(),
      fetch: (async (_url, _init) => {
        requests++
        return Response.json(answer('Professional'))
      }) as typeof fetch,
    }),
    context: async () => ({ people: null, owner: { name: '', family: '' } }),
    sink: () => {},
  })
  assert({
    given: 'no people records, owner profile or model key',
    should: 'use Personal and keep onboarding optional',
    actual: [await categorize(message), requests],
    expected: ['Personal', 0],
  })
})
