import { assert, test } from '#test'
import resolveContent from './resolveContent.ts'

test('resolveContent: replaces user ID with name', () => {
  const names = new Map([['U0123ABCDEF', 'Jane Smith']])
  assert({
    given: 'content with a known @mention',
    should: 'replace the ID with the name',
    actual: resolveContent('Hey @U0123ABCDEF check this', names),
    expected: 'Hey @Jane Smith check this',
  })
})

test('resolveContent: leaves unknown user IDs as-is', () => {
  const names = new Map<string, string>()
  assert({
    given: 'content with an unknown @mention',
    should: 'keep the raw ID',
    actual: resolveContent('Hey @U0999UNKNOWN', names),
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
    actual: resolveContent('@U0123ABCDEF and @U0456GHIJKL', names),
    expected: '@Jane and @Mike',
  })
})

test('resolveContent: no mentions returns content unchanged', () => {
  assert({
    given: 'content with no mentions',
    should: 'return as-is',
    actual: resolveContent('Just a regular message', new Map()),
    expected: 'Just a regular message',
  })
})
