import { assert, test } from '#test'
import { buildInstructions, buildPrompt, validateTags } from './classify.ts'

const MENU = [
  { tag: 'Work/Eng', count: 12 },
  { tag: 'Work/Incident', count: 4 },
  { tag: 'Hobby/Music', count: 2 },
]

test('validateTags drops non-menu tags and counts them', () => {
  const result = validateTags(['Work/Eng', 'Work/Engineering'], new Set(MENU.map((m) => m.tag)))
  assert({
    given: 'one real and one invented tag',
    should: 'keep the real one',
    actual: result.tags,
    expected: ['Work/Eng'],
  })
  assert({ given: 'one invented tag', should: 'count it', actual: result.invented, expected: 1 })
})

test('validateTags dedupes and trims', () => {
  const result = validateTags([' Work/Eng ', 'Work/Eng'], new Set(MENU.map((m) => m.tag)))
  assert({
    given: 'duplicate padded entries',
    should: 'keep one clean tag',
    actual: result.tags,
    expected: ['Work/Eng'],
  })
  assert({ given: 'trimmed matches', should: 'not count as invented', actual: result.invented, expected: 0 })
})

test('buildInstructions omits the history block when history is empty', () => {
  const withHistory = buildInstructions({ body: 'x', tagHistory: [MENU[0]], menu: MENU })
  const withoutHistory = buildInstructions({ body: 'x', tagHistory: [], menu: MENU })
  assert({
    given: 'history present',
    should: 'mention the block',
    actual: withHistory.includes('Previously in this conversation'),
    expected: true,
  })
  assert({
    given: 'history empty',
    should: 'omit the block',
    actual: withoutHistory.includes('Previously in this conversation'),
    expected: false,
  })
})

test('buildPrompt wraps the conversation as data', () => {
  const prompt = buildPrompt({ body: 'Jane: shipping update', to: '#atlas', tagHistory: [], menu: MENU })
  assert({
    given: 'a conversation body',
    should: 'wrap it in document tags',
    actual: prompt.includes('<document>') && prompt.includes('</document>'),
    expected: true,
  })
  assert({ given: 'a to', should: 'include it', actual: prompt.includes('To: #atlas'), expected: true })
})

test('buildInstructions names what is being labeled', () => {
  const meeting = buildInstructions({ body: 'x', kind: 'meeting', tagHistory: [], menu: MENU })
  const fallback = buildInstructions({ body: 'x', tagHistory: [], menu: MENU })

  assert({
    given: 'a kind',
    should: 'call the document that',
    actual: meeting.includes('You label an archived meeting'),
    expected: true,
  })
  assert({
    given: 'a kind',
    should: 'never call it something else',
    actual: meeting.includes('Slack'),
    expected: false,
  })
  assert({
    given: 'no kind',
    should: 'fall back to a neutral noun',
    actual: fallback.includes('You label an archived conversation'),
    expected: true,
  })
})

test('validateTags honors a raised cap', () => {
  const allowed = new Set(MENU.map((m) => m.tag))
  const raw = ['Work/Eng', 'Work/Incident', 'Hobby/Music']

  assert({
    given: 'three valid tags at the default cap of three',
    should: 'keep all three',
    actual: validateTags(raw, allowed).tags.length,
    expected: 3,
  })
  assert({
    given: 'a cap of two',
    should: 'trim rather than fail',
    actual: validateTags(raw, allowed, 2).tags,
    expected: ['Work/Eng', 'Work/Incident'],
  })
})

test('buildInstructions states the cap it was given', () => {
  const deep = buildInstructions({ body: 'x', maxTags: 5, kind: 'journal entry', tagHistory: [], menu: MENU })
  const shallow = buildInstructions({ body: 'x', tagHistory: [], menu: MENU })

  assert({ given: 'a raised cap', should: 'ask for it', actual: deep.includes('Pick 0-5 tags'), expected: true })
  assert({
    given: 'a raised cap',
    should: 'drop the three-is-rare framing',
    actual: deep.includes('three rarely'),
    expected: false,
  })
  assert({
    given: 'the default cap',
    should: 'keep the original wording',
    actual: shallow.includes('- Pick 0-3 tags: one is typical, two sometimes, three rarely.'),
    expected: true,
  })
})

test('validateTags drops a tag whose own child was also picked', () => {
  const allowed = new Set(['Health/Sleep', 'Health/Sleep/Rested', 'Health/Weight/Loss', 'Health/Sleepless'])

  assert({
    given: 'a parent and its child',
    should: 'keep only the child',
    actual: validateTags(['Health/Sleep', 'Health/Sleep/Rested'], allowed).tags,
    expected: ['Health/Sleep/Rested'],
  })
  assert({
    given: 'names that merely share a prefix',
    should: 'keep both — Sleepless is not under Sleep',
    actual: validateTags(['Health/Sleep', 'Health/Sleepless'], allowed).tags,
    expected: ['Health/Sleep', 'Health/Sleepless'],
  })
  assert({
    given: 'a redundant parent at the cap',
    should: 'free the slot for a real subject',
    actual: validateTags(['Health/Sleep', 'Health/Sleep/Rested', 'Health/Weight/Loss'], allowed, 2).tags,
    expected: ['Health/Sleep/Rested', 'Health/Weight/Loss'],
  })
})
