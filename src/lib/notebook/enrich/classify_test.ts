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
