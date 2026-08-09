import { assert, test } from '#test'
import { READ_LIMIT_CHARS, paginateRead } from './tools.ts'

test('paginateRead - returns short files whole', () => {
  const page = paginateRead('a short contract')

  assert({
    given: 'content under the read limit',
    should: 'return it complete, unmarked',
    expected: { content: 'a short contract', start: 0, end: 16, complete: true },
    actual: page,
  })
})

test('paginateRead - pages through a long file with self-directing markers', () => {
  const full = 'x'.repeat(READ_LIMIT_CHARS * 2 + 100)

  const first = paginateRead(full)
  const second = paginateRead(full, READ_LIMIT_CHARS)
  const last = paginateRead(full, READ_LIMIT_CHARS * 2)

  assert({
    given: 'a file two and a half pages long, read from the top',
    should: 'return one page plus a marker naming the total and the next offset',
    expected: {
      complete: false,
      end: READ_LIMIT_CHARS,
      marker: `\n\n[Truncated — ${full.length} chars total; continue with offset: ${READ_LIMIT_CHARS}]`,
    },
    actual: {
      complete: first?.complete,
      end: first?.end,
      marker: first?.content.slice(READ_LIMIT_CHARS),
    },
  })

  assert({
    given: 'the offset the first marker named',
    should: 'continue with the next full page and point at the tail',
    expected: { start: READ_LIMIT_CHARS, end: READ_LIMIT_CHARS * 2, complete: false },
    actual: { start: second?.start, end: second?.end, complete: second?.complete },
  })

  assert({
    given: 'the offset reaching the final partial page',
    should: 'return the tail complete, without a marker',
    expected: { content: 'x'.repeat(100), complete: true },
    actual: { content: last?.content, complete: last?.complete },
  })
})

test('paginateRead - clamps bad offsets and rejects past-the-end ones', () => {
  assert({
    given: 'a negative, fractional offset',
    should: 'clamp to the start of the file',
    expected: { start: 0, content: 'abc' },
    actual: (({ start, content }) => ({ start, content }))(paginateRead('abc', -7.5)!),
  })

  assert({
    given: 'an offset at or past the end of a non-empty file',
    should: 'return null so the tool can error',
    expected: [null, null],
    actual: [paginateRead('abc', 3), paginateRead('abc', 99)],
  })

  assert({
    given: 'an empty file read from the top',
    should: 'return an empty complete page, not an error',
    expected: { content: '', complete: true },
    actual: (({ content, complete }) => ({ content, complete }))(paginateRead('')!),
  })
})
