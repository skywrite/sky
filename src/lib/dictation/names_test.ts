import type { Glossary } from '#commands/all/audio/transcript/lib/glossary.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createDictationNames, type DictationNameSources } from './names.ts'

const TODAY = new PlainDate('2026-01-27')
const GLOSSARY: Glossary = {
  version: 1,
  entries: [
    {
      wrong: 'Atlus Consul',
      right: 'Atlas Console',
      action: 'correct',
      count: 2,
      firstSeen: '2026-01-02',
      lastSeen: '2026-01-20',
    },
    {
      wrong: 'Open Notes',
      right: 'Open Atlas',
      action: 'correct',
      count: 1,
      firstSeen: '2026-01-03',
      lastSeen: '2026-01-03',
    },
  ],
}

function sources(over: Partial<DictationNameSources> = {}): DictationNameSources & { prompts: string[] } {
  const prompts: string[] = []
  return {
    prompts,
    people: () => [
      { name: 'Sam Rivera', score: 12, lastInteraction: '2026-01-20' },
      { name: 'Jane Doe', score: 140, lastInteraction: '2026-01-26' },
      { name: 'Old Contact', score: 900, lastInteraction: '2024-06-01' },
      { name: 'Never Met', score: 3, lastInteraction: null },
      { name: 'acme/jdoe', score: 50, lastInteraction: '2026-01-25' },
    ],
    orgs: () => [
      { name: 'Atlas Labs', score: 80, lastInteraction: '2026-01-26' },
      { name: 'Dormant Co', score: 0, lastInteraction: null },
    ],
    projects: () => ['Widget-V2', 'atlas labs'],
    today: () => TODAY,
    glossary: async () => GLOSSARY,
    ask: async (prompt) => {
      prompts.push(prompt)
      return '{"fixes":[]}'
    },
    ...over,
  }
}

test('dictation keywords are the names a person is likely to say, strongest first', async () => {
  assert({
    given: 'recent and stale people, a handle, scored and unscored companies, projects and saved corrections',
    should: 'list recent people by score, scored companies, projects as spoken, then saved names, each once',
    actual: await createDictationNames(sources()).keywords(),
    expected: ['Jane Doe', 'Sam Rivera', 'Atlas Labs', 'Widget V2', 'Atlas Console', 'Open Atlas'],
  })
})

test('the names check rewrites a misheard name to the spelling the notebook lists', async () => {
  const host = sources({
    ask: async (prompt) => {
      host.prompts.push(prompt)
      return '```json\n{"fixes":[{"from":"Jane Doh\'s","to":"Jane Doe\'s"},{"from":"atlus consul","to":"Atlas Console"}]}\n```'
    },
  })
  const corrected = await createDictationNames(host).correct("Review Jane Doh's plan for the atlus consul")
  const prompt = host.prompts[0] ?? ''
  assert({
    given: 'a note with a misheard person and a misheard product, and a model that matches both to listed names',
    should:
      'apply both fixes, keep the possessive, and show the model the note, the scored lists and the saved corrections',
    actual: [
      corrected,
      host.prompts.length,
      prompt.includes("## Note\n\nReview Jane Doh's plan for the atlus consul"),
      prompt.includes('Jane Doe (140)\nacme/jdoe (50)\nSam Rivera (12)'),
      prompt.includes('Old Contact'),
      prompt.includes('Atlas Labs (80)'),
      prompt.includes('Widget-V2'),
      prompt.includes('"Atlus Consul" → "Atlas Console"'),
    ],
    expected: ["Review Jane Doe's plan for the Atlas Console", 1, true, true, false, true, true, true],
  })
})

test('the names check never rewrites ordinary words', async () => {
  const reworded = createDictationNames(
    sources({
      ask: async () => '{"fixes":[{"from":"Open","to":"Opened"},{"from":"shared drive","to":"team folder"}]}',
    }),
  )
  const firstNameOnly = createDictationNames(sources({ ask: async () => '{"fixes":[{"from":"Jayne","to":"Jane"}]}' }))
  assert({
    given: 'replies that reword the sentence, and a reply that fixes a first name on its own',
    should: 'drop every replacement that is not a listed name and keep the one that is',
    actual: [
      await reworded.correct('Open Notes file on the shared drive'),
      await firstNameOnly.correct('Ask Jayne about the plan'),
    ],
    expected: ['Open Notes file on the shared drive', 'Ask Jane about the plan'],
  })
})

test('the names check asks nothing when there is nothing to check', async () => {
  const empty = sources({ people: () => [], orgs: () => [], projects: () => [], glossary: async () => null })
  const filled = sources()
  assert({
    given: 'a notebook with no names yet, and a blank note in a notebook that has names',
    should: 'return each text as it came without a model call',
    actual: [
      await createDictationNames(empty).correct('Review the plan'),
      await createDictationNames(filled).correct('  '),
      empty.prompts.length + filled.prompts.length,
    ],
    expected: ['Review the plan', '  ', 0],
  })
})

test('the names check fails loudly on a reply it cannot read', async () => {
  let message = ''
  try {
    await createDictationNames(sources({ ask: async () => 'I could not decide.' })).correct('Review the plan')
  } catch (error) {
    message = error instanceof Error ? 'threw' : 'threw something else'
  }
  assert({
    given: 'a model reply with no JSON in it',
    should: 'throw so the page can say the names were not checked',
    actual: message,
    expected: 'threw',
  })
})
