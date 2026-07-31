import { assert, test } from '#test'
import { summarizeDocument, validateDocsRequests } from './docs.ts'

test('validateDocsRequests', () => {
  assert({
    given: 'a valid batch',
    should: 'pass',
    expected: null,
    actual: validateDocsRequests([
      { replaceAllText: { containsText: { text: 'a', matchCase: true }, replaceText: 'b' } },
      { updateDocumentStyle: { documentStyle: {}, fields: '*' } },
      { insertInlineImage: { location: { index: 1 }, uri: 'https://example.com/img.png' } },
    ]),
  })

  assert({
    given: 'a non-array',
    should: 'name the shape problem',
    expected: true,
    actual: (validateDocsRequests({}) ?? '').includes('array'),
  })

  assert({
    given: 'an empty batch',
    should: 'reject',
    expected: 'requests is empty',
    actual: validateDocsRequests([]),
  })

  assert({
    given: 'a request with two keys',
    should: 'reject naming the keys',
    expected: true,
    actual: (validateDocsRequests([{ insertText: {}, deleteContentRange: {} }]) ?? '').includes('exactly one key'),
  })

  assert({
    given: 'an unknown request kind',
    should: 'reject listing the allowlist',
    expected: [true, true],
    actual: [
      (validateDocsRequests([{ deleteNamedRange: {} }]) ?? '').includes('deleteNamedRange'),
      (validateDocsRequests([{ deleteNamedRange: {} }]) ?? '').includes('replaceAllText'),
    ],
  })

  assert({
    given: 'an oversized batch',
    should: 'reject on count',
    expected: true,
    actual: (validateDocsRequests(Array.from({ length: 101 }, () => ({ insertText: {} }))) ?? '').includes('too many'),
  })
})

test('summarizeDocument', () => {
  const doc = {
    title: 'Atlas Q3 Plan',
    body: {
      content: [
        { endIndex: 1 },
        {
          startIndex: 1,
          endIndex: 15,
          paragraph: {
            paragraphStyle: { namedStyleType: 'TITLE' },
            elements: [{ textRun: { content: 'Atlas Q3 Plan\n' } }],
          },
        },
        {
          startIndex: 15,
          endIndex: 40,
          paragraph: {
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
            elements: [{ textRun: { content: 'An intro paragraph.\n' } }],
          },
        },
        {
          startIndex: 40,
          endIndex: 49,
          paragraph: {
            paragraphStyle: { namedStyleType: 'HEADING_1', headingId: 'h.abc123' },
            elements: [{ textRun: { content: 'Outlook\n' } }],
          },
        },
        {
          startIndex: 49,
          endIndex: 90,
          paragraph: {
            elements: [{ textRun: { content: 'Body text.\n' } }],
          },
        },
      ],
    },
  }

  assert({
    given: 'a documents.get response',
    should: 'compact to headings with indexes plus coarse size',
    expected: {
      title: 'Atlas Q3 Plan',
      headings: [
        { style: 'TITLE', text: 'Atlas Q3 Plan', startIndex: 1, endIndex: 15, headingId: undefined },
        { style: 'HEADING_1', text: 'Outlook', startIndex: 40, endIndex: 49, headingId: 'h.abc123' },
      ],
      paragraphCount: 4,
      endIndex: 90,
    },
    actual: summarizeDocument(doc),
  })
})
