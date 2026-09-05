import { assert, test } from '#test'
import { callSubject } from './callSubject.ts'

test({ name: 'callSubject - a call is about the field its tool acts on' }, async () => {
  assert({
    given: 'a search, a fetch, a read, and a mission whose file id comes first',
    should: 'name the query, the address without its scheme, the path, and the mission',
    actual: [
      callSubject({ query: 'Atlas roadmap reviews' }),
      callSubject({ url: 'https://www.example.com/atlas/roadmap?ref=notes' }),
      callSubject({ path: 'projects/Atlas/Roadmap.md' }),
      callSubject({ file: 'doc-42', mission: 'Fix the fonts across every tab' }),
    ],
    expected: [
      'Atlas roadmap reviews',
      'example.com/atlas/roadmap?ref=notes',
      'projects/Atlas/Roadmap.md',
      'Fix the fonts across every tab',
    ],
  })
})

test({ name: 'callSubject - a call without a named field is about its first string' }, async () => {
  assert({
    given: 'fields none of the names cover, a bare string, and a number and a blank ahead of a title',
    should: 'take the first string that says something',
    actual: [
      callSubject({ title: 'Atlas notes', body: 'Three parts' }),
      callSubject('plain words'),
      callSubject({ count: 3, name: '  ', title: 'Atlas notes' }),
    ],
    expected: ['Atlas notes', 'plain words', 'Atlas notes'],
  })
})

test({ name: "callSubject - one line, at a chip's width" }, async () => {
  const long = callSubject({ query: 'a'.repeat(100) })
  assert({
    given: 'a mission of several lines with runs of spaces, and one long line',
    should: 'keep the first line with single spaces, and cut the long one with an ellipsis',
    actual: [
      callSubject({ mission: '\n  Create a plan   with three\tparts\nEach part a page' }),
      long?.length,
      long?.at(-1),
    ],
    expected: ['Create a plan with three parts', 81, '…'],
  })
})

test({ name: 'callSubject - a call with nothing to show has no subject' }, async () => {
  assert({
    given: 'no input, no fields, no strings, and blank strings',
    should: 'say nothing',
    actual: [
      callSubject(undefined),
      callSubject(null),
      callSubject({}),
      callSubject({ count: 3 }),
      callSubject({ query: '  \n ' }),
      callSubject(''),
    ],
    expected: [undefined, undefined, undefined, undefined, undefined, undefined],
  })
})
