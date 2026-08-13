import { assert, test } from '#test'
import resolveContent from './resolveContent.ts'

const noChannels = new Map<string, string>()

test('resolveContent: replaces user ID with name', () => {
  const names = new Map([['U0123ABCDEF', 'Jane Smith']])
  assert({
    given: 'content with a known @mention',
    should: 'replace the ID with the name',
    actual: resolveContent('Hey @U0123ABCDEF check this', names, noChannels),
    expected: 'Hey @Jane Smith check this',
  })
})

test('resolveContent: leaves unknown user IDs as-is', () => {
  const names = new Map<string, string>()
  assert({
    given: 'content with an unknown @mention',
    should: 'keep the raw ID',
    actual: resolveContent('Hey @U0999UNKNOWN', names, noChannels),
    expected: 'Hey @U0999UNKNOWN',
  })
})

test('resolveContent: handles multiple mentions', () => {
  const names = new Map([
    ['U0123ABCDEF', 'Jane'],
    ['U0456GHIJKL', 'Mike'],
  ])
  assert({
    given: 'content with two known mentions',
    should: 'replace both',
    actual: resolveContent('@U0123ABCDEF and @U0456GHIJKL', names, noChannels),
    expected: '@Jane and @Mike',
  })
})

test('resolveContent: no mentions returns content unchanged', () => {
  assert({
    given: 'content with no mentions',
    should: 'return as-is',
    actual: resolveContent('Just a regular message', new Map(), noChannels),
    expected: 'Just a regular message',
  })
})

test('resolveContent: replaces channel mention with known name', () => {
  const channels = new Map([['C0123ATLASX', 'atlas-team']])
  assert({
    given: 'content with a known <#C…> channel mention',
    should: 'replace it with #name',
    actual: resolveContent('is <#C0123ATLASX> the right channel?', new Map(), channels),
    expected: 'is #atlas-team the right channel?',
  })
})

test('resolveContent: prefers the pipe label of a channel mention', () => {
  assert({
    given: 'a channel mention carrying its own |label',
    should: 'use the label without needing the map',
    actual: resolveContent('see <#C0123ATLASX|atlas-team>', new Map(), new Map()),
    expected: 'see #atlas-team',
  })
})

test('resolveContent: empty pipe label falls back to the map', () => {
  const channels = new Map([['C0123ATLASX', 'atlas-team']])
  assert({
    given: 'a channel mention with an empty |label',
    should: 'resolve via the map',
    actual: resolveContent('see <#C0123ATLASX|>', new Map(), channels),
    expected: 'see #atlas-team',
  })
})

test('resolveContent: unknown channel keeps the ID readable', () => {
  assert({
    given: 'a channel mention with no name available',
    should: 'strip the brackets but keep the ID',
    actual: resolveContent('see <#C0999UNKNOWN>', new Map(), new Map()),
    expected: 'see #C0999UNKNOWN',
  })
})

test('resolveContent: resolves users and channels together', () => {
  const names = new Map([['U0123ABCDEF', 'Jane']])
  const channels = new Map([['C0123ATLASX', 'atlas-team']])
  assert({
    given: 'content with a user and a channel mention',
    should: 'resolve both',
    actual: resolveContent('@U0123ABCDEF see <#C0123ATLASX>', names, channels),
    expected: '@Jane see #atlas-team',
  })
})
