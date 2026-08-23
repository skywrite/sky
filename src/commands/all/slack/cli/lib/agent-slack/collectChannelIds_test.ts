import { assert, test } from '#test'
import collectChannelIds from './collectChannelIds.ts'

test('collectChannelIds: extracts bare channel mentions', () => {
  assert({
    given: 'a message with a <#C…> mention',
    should: 'return the channel ID',
    actual: collectChannelIds([{ content: 'is <#C0123ATLASX> the right channel?' }]),
    expected: ['C0123ATLASX'],
  })
})

test('collectChannelIds: extracts labeled channel mentions', () => {
  assert({
    given: 'a message with a <#C…|label> mention',
    should: 'return the channel ID',
    actual: collectChannelIds([{ content: 'see <#C0123ATLASX|atlas-team>' }]),
    expected: ['C0123ATLASX'],
  })
})

test('collectChannelIds: deduplicates across messages', () => {
  assert({
    given: 'two messages mentioning the same channel',
    should: 'return the ID once',
    actual: collectChannelIds([
      { content: 'see <#C0123ATLASX>' },
      { content: 'again <#C0123ATLASX> and <#C0456ORIONX>' },
    ]).sort(),
    expected: ['C0123ATLASX', 'C0456ORIONX'],
  })
})

test('collectChannelIds: ignores user mentions and plain text', () => {
  assert({
    given: 'a message with only a user mention',
    should: 'return empty array',
    actual: collectChannelIds([{ content: 'hey @U0123ABCDEF, no channels here' }]),
    expected: [],
  })
})

test('collectChannelIds: handles messages with no content', () => {
  assert({
    given: 'a message with no content',
    should: 'return empty array',
    actual: collectChannelIds([{}]),
    expected: [],
  })
})
