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

test('buildInstructions omits the channel block when history is empty', () => {
  const withHistory = buildInstructions({ body: 'x', channelHistory: [MENU[0]], menu: MENU })
  const withoutHistory = buildInstructions({ body: 'x', channelHistory: [], menu: MENU })
  assert({
    given: 'history present',
    should: 'mention the block',
    actual: withHistory.includes('Previously in this channel'),
    expected: true,
  })
  assert({
    given: 'history empty',
    should: 'omit the block',
    actual: withoutHistory.includes('Previously in this channel'),
    expected: false,
  })
})

test('buildPrompt wraps the conversation as data', () => {
  const prompt = buildPrompt({ body: 'Jane: shipping update', channel: '#atlas', channelHistory: [], menu: MENU })
  assert({
    given: 'a conversation body',
    should: 'wrap it in conversation tags',
    actual: prompt.includes('<conversation>') && prompt.includes('</conversation>'),
    expected: true,
  })
  assert({ given: 'a channel', should: 'include it', actual: prompt.includes('Channel: #atlas'), expected: true })
})
