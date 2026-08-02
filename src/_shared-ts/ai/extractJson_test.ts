import { assert, test } from '#test'
import { extractJson } from './extractJson.ts'

test('extractJson reads unwrapped and fenced payloads', () => {
  assert({
    given: 'bare JSON with no fence',
    should: 'parse it',
    actual: extractJson('{"medium": "Phone"}'),
    expected: { medium: 'Phone' },
  })
  assert({
    given: 'a ```json fenced block',
    should: 'parse the block body',
    actual: extractJson('```json\n{"medium": "Phone"}\n```'),
    expected: { medium: 'Phone' },
  })
  assert({
    given: 'a bare ``` fenced block',
    should: 'parse the block body',
    actual: extractJson('```\n{"medium": "Phone"}\n```'),
    expected: { medium: 'Phone' },
  })
  assert({
    given: 'a top-level array',
    should: 'parse it',
    actual: extractJson('```json\n["a", "b"]\n```'),
    expected: ['a', 'b'],
  })
})

test('extractJson survives prose around the payload', () => {
  // The regression this helper exists for: the model appends a note after the
  // closing fence, so an anchored /```$/ strip leaves the fence in the string.
  assert({
    given: 'a fenced block followed by commentary',
    should: 'parse the block and ignore the trailing prose',
    actual: extractJson('```json\n{"time": "2026-03-31 25:30"}\n```\n\n**Note:** that hour looks unusual to me.'),
    expected: { time: '2026-03-31 25:30' },
  })
  assert({
    given: 'prose before a fenced block',
    should: 'parse the block',
    actual: extractJson('Here is the result:\n\n```json\n{"medium": "Phone"}\n```'),
    expected: { medium: 'Phone' },
  })
  assert({
    given: 'unfenced JSON with prose on both sides',
    should: 'parse the balanced span',
    actual: extractJson('Sure — {"medium": "Phone"} — let me know if that helps.'),
    expected: { medium: 'Phone' },
  })
})

test('extractJson picks the first parseable block', () => {
  assert({
    given: 'several fenced blocks',
    should: 'return the first one that parses',
    actual: extractJson('```json\n{"first": true}\n```\n\n```json\n{"second": true}\n```'),
    expected: { first: true },
  })
  assert({
    given: 'a leading fenced block that is not JSON',
    should: 'skip it and parse the next',
    actual: extractJson('```text\nthinking out loud\n```\n\n```json\n{"medium": "Phone"}\n```'),
    expected: { medium: 'Phone' },
  })
})

test('extractJson respects string contents', () => {
  assert({
    given: 'a closing brace inside a string value',
    should: 'not end the span early',
    actual: extractJson('Result: {"note": "a } inside"} done'),
    expected: { note: 'a } inside' },
  })
  assert({
    given: 'a backtick inside a string value',
    should: 'parse normally',
    actual: extractJson('{"note": "use ``` for code"}'),
    expected: { note: 'use ``` for code' },
  })
  assert({
    given: 'an escaped quote inside a string value',
    should: 'not toggle out of the string',
    actual: extractJson('{"note": "say \\"hi\\" }"}'),
    expected: { note: 'say "hi" }' },
  })
})

test('extractJson preserves extended notebook hours verbatim', () => {
  assert({
    given: 'an extended hour the model was told to pass through',
    should: 'return the string unchanged rather than normalizing it',
    actual: extractJson<{ when: string }>('```json\n{"when": "2026-03-31 25:30"}\n```').when,
    expected: '2026-03-31 25:30',
  })
})

test('extractJson throws when nothing parses', () => {
  let message = ''
  try {
    extractJson('I was unable to produce a result.')
  } catch (err) {
    message = (err as Error).message
  }
  assert({
    given: 'model output containing no JSON',
    should: 'throw an error quoting the offending output',
    actual: message.includes('No JSON found') && message.includes('unable to produce'),
    expected: true,
  })
})
