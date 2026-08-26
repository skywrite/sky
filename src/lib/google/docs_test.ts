import { assert, test } from '#test'
import {
  collectSuggestionIds,
  extractBaseText,
  summarizeDocSuggestions,
  summarizeDocument,
  validateDocsRequests,
} from './docs.ts'

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
    given: 'a tab-management batch',
    should: 'pass',
    expected: null,
    actual: validateDocsRequests([
      { addDocumentTab: { tabProperties: { title: 'Appendix', index: 1 } } },
      { updateDocumentTabProperties: { tabProperties: { tabId: 't.abc123', title: 'Overview' }, fields: 'title' } },
      { deleteTab: { tabId: 't.def456' } },
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

test('summarizeDocument with tabs', () => {
  const heading = (text: string, endIndex: number, headingId?: string) => ({
    startIndex: 1,
    endIndex,
    paragraph: {
      paragraphStyle: { namedStyleType: 'HEADING_1', headingId },
      elements: [{ textRun: { content: `${text}\n` } }],
    },
  })

  assert({
    given: 'a document whose single tab arrives via tabs',
    should: 'compact to the flat single-tab shape',
    expected: {
      title: 'Atlas Notes',
      headings: [{ style: 'HEADING_1', text: 'Overview', startIndex: 1, endIndex: 10, headingId: undefined }],
      paragraphCount: 1,
      endIndex: 10,
    },
    actual: summarizeDocument({
      title: 'Atlas Notes',
      tabs: [
        {
          tabProperties: { tabId: 't.0', title: 'Tab 1', nestingLevel: 0 },
          documentTab: { body: { content: [heading('Overview', 10)] } },
        },
      ],
    }),
  })

  assert({
    given: 'a document with nested tabs',
    should: 'compact to one outline per tab, parents before children',
    expected: {
      title: 'Atlas Handbook',
      tabs: [
        {
          tabId: 't.0',
          tabTitle: 'Overview',
          nestingLevel: 0,
          headings: [{ style: 'HEADING_1', text: 'Welcome', startIndex: 1, endIndex: 9, headingId: 'h.one' }],
          paragraphCount: 1,
          endIndex: 9,
        },
        {
          tabId: 't.child',
          tabTitle: 'Details',
          nestingLevel: 1,
          headings: [{ style: 'HEADING_1', text: 'Depth', startIndex: 1, endIndex: 7, headingId: undefined }],
          paragraphCount: 1,
          endIndex: 7,
        },
        {
          tabId: 't.1',
          tabTitle: 'Roadmap',
          nestingLevel: 0,
          headings: [{ style: 'HEADING_1', text: 'Q3 Goals', startIndex: 1, endIndex: 10, headingId: undefined }],
          paragraphCount: 1,
          endIndex: 10,
        },
      ],
    },
    actual: summarizeDocument({
      title: 'Atlas Handbook',
      tabs: [
        {
          tabProperties: { tabId: 't.0', title: 'Overview', nestingLevel: 0 },
          documentTab: { body: { content: [heading('Welcome', 9, 'h.one')] } },
          childTabs: [
            {
              tabProperties: { tabId: 't.child', title: 'Details', nestingLevel: 1 },
              documentTab: { body: { content: [heading('Depth', 7)] } },
            },
          ],
        },
        {
          tabProperties: { tabId: 't.1', title: 'Roadmap', nestingLevel: 0 },
          documentTab: { body: { content: [heading('Q3 Goals', 10)] } },
        },
      ],
    }),
  })
})

test('collectSuggestionIds', () => {
  const doc = {
    body: {
      content: [
        {
          paragraph: {
            elements: [
              { textRun: { content: 'kept ', suggestedInsertionIds: ['suggest.a1'] } },
              { textRun: { content: 'cut ', suggestedDeletionIds: ['suggest.a1'] } },
            ],
          },
        },
        {
          table: {
            tableRows: [
              {
                tableCells: [
                  {
                    content: [
                      {
                        paragraph: {
                          elements: [{ textRun: { content: 'cell', suggestedInsertionIds: ['suggest.b2'] } }],
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  }

  assert({
    given: 'a documents.get tree with suggestion ids at several depths',
    should: 'collect each id once',
    expected: ['suggest.a1', 'suggest.b2'],
    actual: collectSuggestionIds(doc),
  })

  assert({
    given: 'a document without pending suggestions',
    should: 'return no ids',
    expected: [],
    actual: collectSuggestionIds({
      body: { content: [{ paragraph: { elements: [{ textRun: { content: 'hi' } }] } }] },
    }),
  })

  assert({
    given: 'ids nested under document tabs',
    should: 'find them wherever they sit',
    expected: ['suggest.t1'],
    actual: collectSuggestionIds({
      tabs: [
        {
          tabProperties: { tabId: 't.0' },
          documentTab: {
            body: {
              content: [
                { paragraph: { elements: [{ textRun: { content: 'x', suggestedInsertionIds: ['suggest.t1'] } }] } },
              ],
            },
          },
        },
      ],
    }),
  })
})

test('summarizeDocSuggestions', () => {
  const doc = {
    body: {
      content: [
        {
          paragraph: {
            elements: [
              { textRun: { content: 'The launch is ' } },
              { textRun: { content: 'delayed', suggestedDeletionIds: ['suggest.r1'] } },
              { textRun: { content: 'on track', suggestedInsertionIds: ['suggest.r1'] } },
              { textRun: { content: ' for spring.\n' } },
            ],
          },
        },
        {
          table: {
            tableRows: [
              {
                tableCells: [
                  {
                    content: [
                      {
                        paragraph: {
                          elements: [
                            { textRun: { content: 'Owner: ' } },
                            { textRun: { content: 'Jane Doe', suggestedInsertionIds: ['suggest.i2'] } },
                          ],
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  }

  assert({
    given: 'a replacement suggestion and a table-cell insertion',
    should: 'aggregate deletes/inserts per id with preceding base text as context',
    expected: [
      { id: 'suggest.r1', deletes: 'delayed', inserts: 'on track', context: 'The launch is' },
      { id: 'suggest.i2', deletes: '', inserts: 'Jane Doe', context: 'The launch is delayed for spring.\nOwner:' },
    ],
    actual: summarizeDocSuggestions(doc),
  })

  assert({
    given: 'a document without pending suggestions',
    should: 'return an empty list',
    expected: [],
    actual: summarizeDocSuggestions({
      body: { content: [{ paragraph: { elements: [{ textRun: { content: 'hi' } }] } }] },
    }),
  })
})

test('summarizeDocSuggestions across tabs', () => {
  assert({
    given: 'suggestions in two different tabs',
    should: 'label each with its tab and keep context within the tab',
    expected: [
      {
        id: 'suggest.r1',
        deletes: 'delayed',
        inserts: 'on track',
        context: 'The launch is',
        tabId: 't.0',
        tabTitle: 'Draft',
      },
      { id: 'suggest.i2', deletes: '', inserts: 'Jane Doe', context: 'Owner:', tabId: 't.1', tabTitle: 'Notes' },
    ],
    actual: summarizeDocSuggestions({
      tabs: [
        {
          tabProperties: { tabId: 't.0', title: 'Draft', nestingLevel: 0 },
          documentTab: {
            body: {
              content: [
                {
                  paragraph: {
                    elements: [
                      { textRun: { content: 'The launch is ' } },
                      { textRun: { content: 'delayed', suggestedDeletionIds: ['suggest.r1'] } },
                      { textRun: { content: 'on track', suggestedInsertionIds: ['suggest.r1'] } },
                    ],
                  },
                },
              ],
            },
          },
        },
        {
          tabProperties: { tabId: 't.1', title: 'Notes', nestingLevel: 0 },
          documentTab: {
            body: {
              content: [
                {
                  paragraph: {
                    elements: [
                      { textRun: { content: 'Owner: ' } },
                      { textRun: { content: 'Jane Doe', suggestedInsertionIds: ['suggest.i2'] } },
                    ],
                  },
                },
              ],
            },
          },
        },
      ],
    }),
  })

  assert({
    given: 'a single-tab document arriving via tabs',
    should: 'omit the tab labels',
    expected: [{ id: 'suggest.s1', deletes: '', inserts: 'new', context: 'base' }],
    actual: summarizeDocSuggestions({
      tabs: [
        {
          tabProperties: { tabId: 't.0', title: 'Main', nestingLevel: 0 },
          documentTab: {
            body: {
              content: [
                {
                  paragraph: {
                    elements: [
                      { textRun: { content: 'base ' } },
                      { textRun: { content: 'new', suggestedInsertionIds: ['suggest.s1'] } },
                    ],
                  },
                },
              ],
            },
          },
        },
      ],
    }),
  })
})

test('extractBaseText', () => {
  assert({
    given: 'runs with pending insertions, deletions, and table cells',
    should: 'keep base and struck-out text, drop inserted text',
    expected: 'The launch is delayed for spring.\ncell text\n',
    actual: extractBaseText([
      {
        paragraph: {
          elements: [
            { textRun: { content: 'The launch is ' } },
            { textRun: { content: 'delayed', suggestedDeletionIds: ['suggest.r1'] } },
            { textRun: { content: 'on track', suggestedInsertionIds: ['suggest.r1'] } },
            { textRun: { content: ' for spring.\n' } },
          ],
        },
      },
      {
        table: {
          tableRows: [
            { tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: 'cell text\n' } }] } }] }] },
          ],
        },
      },
    ]),
  })
})
