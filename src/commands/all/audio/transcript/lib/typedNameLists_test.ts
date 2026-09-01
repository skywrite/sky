import { assert, test } from '#test'
import { extractTypedNameLists } from './typedNameLists.ts'

test('extractTypedNameLists - labelled lists lift verbatim, freeform and empty labels fall through', () => {
  assert({
    given: 'a rel: list of full names',
    should: 'lift the names exactly as typed',
    actual: extractTypedNameLists('rel: Sam Rivera, Jordan'),
    expected: { rel: ['Sam Rivera', 'Jordan'] },
  })

  assert({
    given: 'who and rel in one line, separated by a semicolon, labels capitalized',
    should: 'lift both lists, each ending at the separator',
    actual: extractTypedNameLists('Who: Taylor Quinn; Related: Sam Rivera'),
    expected: { who: ['Taylor Quinn'], rel: ['Sam Rivera'] },
  })

  assert({
    given: 'freeform prose containing a mid-sentence colon, and a bare empty label',
    should: 'lift nothing — that text belongs to the AI parse',
    actual: {
      prose: extractTypedNameLists('make it clearer who: attended and why'),
      empty: extractTypedNameLists('rel:'),
    },
    expected: { prose: {}, empty: {} },
  })
})

test('extractTypedNameLists - a list ends before the next chained field and none clears', () => {
  assert({
    given: 'a rel: list chained with further field corrections, comma-separated',
    should: 'keep the names and stop before the next label',
    actual: extractTypedNameLists('time: 2026-01-20 14:30, rel: Sam Rivera, Jordan, duration: 13 mins'),
    expected: { rel: ['Sam Rivera', 'Jordan'] },
  })

  assert({
    given: 'a lone "none" as the list',
    should: 'read an explicit clear',
    actual: extractTypedNameLists('rel: none'),
    expected: { rel: [] },
  })
})
