import { assert, test } from '#test'
import { stripWrappingCodeFence } from './stripCodeFence.ts'

test('stripWrappingCodeFence removes a whole-document fence', () => {
  assert({
    given: 'output wrapped in a ```markdown fence',
    should: 'unwrap it',
    actual: stripWrappingCodeFence('```markdown\n# Title\n\nBody\n```'),
    expected: '# Title\n\nBody',
  })
  assert({
    given: 'output wrapped in a bare ``` fence',
    should: 'unwrap it',
    actual: stripWrappingCodeFence('```\n# Title\n```'),
    expected: '# Title',
  })
  assert({
    given: 'surrounding blank lines around the fence',
    should: 'unwrap and trim',
    actual: stripWrappingCodeFence('\n```md\nText\n```\n\n'),
    expected: 'Text',
  })
  assert({
    given: 'inner code blocks within an outer wrap',
    should: 'strip only the outer fence',
    actual: stripWrappingCodeFence('```markdown\n# T\n\n```js\nx\n```\n```'),
    expected: '# T\n\n```js\nx\n```',
  })
})

test('stripWrappingCodeFence leaves non-wrapped output alone', () => {
  assert({
    given: 'plain markdown',
    should: 'pass through trimmed',
    actual: stripWrappingCodeFence('# Title\n\nBody\n'),
    expected: '# Title\n\nBody',
  })
  assert({
    given: 'an internal code block only',
    should: 'not touch it',
    actual: stripWrappingCodeFence('# T\n\n```js\nx\n```\n\nEnd'),
    expected: '# T\n\n```js\nx\n```\n\nEnd',
  })
  assert({
    given: 'a language-tagged wrap (```js)',
    should: 'treat it as content, not a wrapper',
    actual: stripWrappingCodeFence('```js\nconst x = 1\n```'),
    expected: '```js\nconst x = 1\n```',
  })
})
