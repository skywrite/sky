import Document from '#shared/models/Markdown/Document/mod.ts'
import { assert, test } from '#test'

const FIXTURES: [string, string[]][] = [
  ['Read Alex follow-up [alex-follows-up][]', ['alex-follows-up']],
  ['Check the [documentation][docs]', ['docs']],
  ['No reference here', []],
  ['Multiple [first][first-ref] and [second][second-ref]', ['first-ref', 'second-ref']],
  ['Complex case with [inline][] and [text][ref] and [another-ref][]', ['inline', 'ref', 'another-ref']],
]

test('Document#extractReferenceLabels', function () {
  for (const [input, labels] of FIXTURES) {
    assert({
      given: `Input: ${input}}`,
      should: `Should return [${labels.join(',')}]`,
      expected: labels,
      actual: Document.extractReferenceLabels(input),
    })
  }
})
