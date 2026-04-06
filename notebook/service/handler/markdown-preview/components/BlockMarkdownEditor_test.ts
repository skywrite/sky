import { assert, test } from '#test'
import { EDITOR_SCRIPT } from './BlockMarkdownEditor.tsx'

test('block markdown editor script parses as valid javascript', () => {
  let error: Error | null = null

  try {
    new Function(EDITOR_SCRIPT)
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err))
  }

  assert({
    given: 'the embedded block editor client script',
    should: 'parse without syntax errors',
    actual: error,
    expected: null,
  })
})
