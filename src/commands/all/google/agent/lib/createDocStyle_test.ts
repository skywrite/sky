import type { RawRestyleDocument } from '#lib/google/docsRestyle.ts'
import { assert, test } from '#test'
import { planCreationStyle } from './createDocStyle.ts'

function paragraph(startIndex: number, text: string, namedStyleType = 'NORMAL_TEXT') {
  const endIndex = startIndex + text.length
  return {
    startIndex,
    endIndex,
    paragraph: {
      paragraphStyle: { namedStyleType },
      elements: [
        {
          startIndex,
          endIndex,
          textRun: { content: text, textStyle: { bold: true, fontSize: { magnitude: 11, unit: 'PT' } } },
        },
      ],
    },
  }
}

test('the creation preset styles headings and table text without rewriting content or emphasis', () => {
  const doc: RawRestyleDocument = {
    tabs: [
      {
        tabProperties: { tabId: 't.main' },
        documentTab: {
          body: {
            content: [
              paragraph(1, 'Atlas\n', 'HEADING_1'),
              paragraph(7, 'Overview\n', 'HEADING_2'),
              {
                startIndex: 16,
                endIndex: 34,
                table: {
                  tableRows: [
                    { tableCells: [{ content: [paragraph(18, 'Name\n')] }, { content: [paragraph(25, 'Role\n')] }] },
                  ],
                },
              },
              paragraph(34, '\n'),
            ],
          },
        },
        childTabs: [
          {
            tabProperties: { tabId: 't.notes' },
            documentTab: { body: { content: [paragraph(1, 'Notes\n', 'HEADING_1')] } },
          },
        ],
      },
    ],
  }
  const before = JSON.stringify(doc)
  const requests = planCreationStyle(doc)
  const headings = requests.flatMap((request) =>
    request.updateParagraphStyle ? [request.updateParagraphStyle] : [],
  ) as Array<{
    range: { tabId: string; startIndex: number; endIndex: number }
    paragraphStyle: { keepWithNext: boolean }
  }>
  const sizes = requests.flatMap((request) => (request.updateTextStyle ? [request.updateTextStyle] : [])) as Array<{
    range: { tabId: string; startIndex: number; endIndex: number }
    textStyle: { fontSize?: { magnitude: number } }
    fields: string
  }>
  assert({
    given: 'a new document with nested tabs, two heading levels, and a table',
    should:
      'preserve content and emphasis, keep headings with text, and use tab-local ranges without crossing table cells',
    actual: {
      unchanged: JSON.stringify(doc) === before,
      kinds: [...new Set(requests.flatMap(Object.keys))],
      fields: [...new Set(sizes.map((request) => request.fields))],
      headings: headings.map((request) => [
        request.range.tabId,
        request.range.startIndex,
        request.range.endIndex,
        request.paragraphStyle.keepWithNext,
      ]),
      sizes: sizes
        .filter((request) => request.textStyle.fontSize)
        .map((request) => [
          request.range.tabId,
          request.range.startIndex,
          request.range.endIndex,
          request.textStyle.fontSize?.magnitude,
        ]),
    },
    expected: {
      unchanged: true,
      kinds: ['updateDocumentStyle', 'updateTextStyle', 'updateParagraphStyle'],
      fields: ['weightedFontFamily', 'fontSize'],
      headings: [
        ['t.main', 1, 7, true],
        ['t.main', 7, 16, true],
        ['t.notes', 1, 6, true],
      ],
      sizes: [
        ['t.main', 1, 7, 20],
        ['t.main', 7, 16, 14],
        ['t.main', 18, 23, 11],
        ['t.main', 25, 30, 11],
        ['t.notes', 1, 6, 20],
      ],
    },
  })
})

test('empty documents get margins without invalid text ranges', () => {
  const requests = planCreationStyle({
    tabs: [{ tabProperties: { tabId: 't.main' }, documentTab: { body: { content: [paragraph(1, '\n')] } } }],
  })
  assert({
    given: 'an empty imported body containing only its final newline',
    should: 'style the page without constructing an empty or out-of-bounds text range',
    actual: requests.map((request) => Object.keys(request)),
    expected: [['updateDocumentStyle']],
  })
})
