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

test('resolveContent: resolves W-prefixed Enterprise Grid user IDs', () => {
  const names = new Map([['W0123GRIDXY', 'Mike Doe']])
  assert({
    given: 'a grid-native @mention (W-prefixed id)',
    should: 'replace it like a U-prefixed one',
    actual: resolveContent('ping @W0123GRIDXY', names, noChannels),
    expected: 'ping @Mike Doe',
  })
})

test('resolveContent: prefers the label of a usergroup mention', () => {
  assert({
    given: 'a subteam mention carrying its own |@handle label',
    should: 'use the label without needing the map',
    actual: resolveContent('cc <!subteam^S0123TEAMAB|@atlas-core>', new Map(), noChannels),
    expected: 'cc @atlas-core',
  })
})

test('resolveContent: resolves a bare usergroup mention via the map', () => {
  const usergroups = new Map([['S0123TEAMAB', 'atlas-core']])
  assert({
    given: 'a label-less subteam mention with a known id',
    should: 'replace it with the @handle',
    actual: resolveContent('cc <!subteam^S0123TEAMAB> please', new Map(), noChannels, usergroups),
    expected: 'cc @atlas-core please',
  })
})

test('resolveContent: unknown usergroup keeps the ID readable', () => {
  assert({
    given: 'a subteam mention with no name available',
    should: 'strip the wrapper but keep the ID',
    actual: resolveContent('cc <!subteam^S0999UNKNOWN>', new Map(), noChannels),
    expected: 'cc @S0999UNKNOWN',
  })
})

test('resolveContent: strips a mailto link to the bare address', () => {
  assert({
    given: 'a Slack mailto link whose label repeats the address',
    should: 'keep only the address',
    actual: resolveContent('reach me at <mailto:jane@example.com|jane@example.com> anytime', new Map(), noChannels),
    expected: 'reach me at jane@example.com anytime',
  })
})

test('resolveContent: mailto link with a differing label still shows the address', () => {
  assert({
    given: 'a mailto link labeled with a display name',
    should: 'keep the address, not the label',
    actual: resolveContent('ask <mailto:jane@example.com|Jane Smith>', new Map(), noChannels),
    expected: 'ask jane@example.com',
  })
})

test('resolveContent: strips a label-less mailto link', () => {
  assert({
    given: 'a mailto link with no |label',
    should: 'keep only the address',
    actual: resolveContent('email <mailto:atlas@example.com> please', new Map(), noChannels),
    expected: 'email atlas@example.com please',
  })
})

test('resolveContent: strips a tel link to the number as typed', () => {
  assert({
    given: 'a Slack tel link whose label is the formatted number',
    should: 'keep the label, not the tel: wrapper',
    actual: resolveContent('call <tel:15555550123|1 555 555 0123> today', new Map(), noChannels),
    expected: 'call 1 555 555 0123 today',
  })
})

test('resolveContent: tel link keeps the label formatting intact', () => {
  assert({
    given: 'a tel link whose label carries plus, parens, and dashes',
    should: 'preserve the label exactly',
    actual: resolveContent('cell: <tel:+15555550123|+1 (555) 555-0123>', new Map(), noChannels),
    expected: 'cell: +1 (555) 555-0123',
  })
})

test('resolveContent: strips a label-less tel link to the digits', () => {
  assert({
    given: 'a tel link with no |label',
    should: 'keep only the number',
    actual: resolveContent('call <tel:15555550123> please', new Map(), noChannels),
    expected: 'call 15555550123 please',
  })
})
