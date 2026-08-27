import { assert, test } from '#test'
import { unclosedFence } from './_stripHtmlComments.ts'

test('unclosedFence() - balanced fences leave nothing open', () => {
  const markdown = ['Before.', '```ts', 'const x = 1', '```', 'After.'].join('\n')

  assert({
    given: 'a document whose fences all close',
    should: 'return null',
    actual: unclosedFence(markdown),
    expected: null,
  })
})

test('unclosedFence() - an unclosed backtick fence stays open to the end', () => {
  const markdown = ['```ts', 'const x = 1', '// reply truncated mid-block'].join('\n')

  assert({
    given: 'a fence opened and never closed',
    should: 'return the open fence',
    actual: unclosedFence(markdown),
    expected: { marker: '`', length: 3 },
  })
})

test('unclosedFence() - line-leading inline code opens nothing', () => {
  const markdown = ['```json``` is inline code.', 'More prose.'].join('\n')

  assert({
    given: 'a line-leading ```code``` span (backtick info strings may not contain backticks)',
    should: 'return null',
    actual: unclosedFence(markdown),
    expected: null,
  })
})

test('unclosedFence() - unclosed tilde fences report their marker and length', () => {
  const markdown = ['~~~~sh', 'echo hi'].join('\n')

  assert({
    given: 'a four-tilde fence opened and never closed',
    should: 'return the open fence with its length',
    actual: unclosedFence(markdown),
    expected: { marker: '~', length: 4 },
  })
})

test('unclosedFence() - fence-looking lines inside comments open nothing', () => {
  const markdown = ['<!--', '```ts', '-->', 'After.'].join('\n')

  assert({
    given: 'a ``` line that sits inside an HTML comment',
    should: 'return null — the stripper never treats comment content as fences',
    actual: unclosedFence(markdown),
    expected: null,
  })
})

test('unclosedFence() - a closer shorter than the opener does not close', () => {
  const markdown = ['````ts', 'code', '```'].join('\n')

  assert({
    given: 'a four-backtick fence followed by a three-backtick line',
    should: 'stay open — closers must be at least as long as the opener',
    actual: unclosedFence(markdown),
    expected: { marker: '`', length: 4 },
  })
})

test('unclosedFence() - a longer closer closes', () => {
  const markdown = ['```ts', 'code', '`````'].join('\n')

  assert({
    given: 'a three-backtick fence followed by a five-backtick line',
    should: 'return null',
    actual: unclosedFence(markdown),
    expected: null,
  })
})
