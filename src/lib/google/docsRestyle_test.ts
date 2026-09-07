import { assert, test } from '#test'
import {
  batchesOf,
  checkRestyle,
  describeRestyleSpec,
  planRestyle,
  unknownTabIds,
  validateRestyleSpec,
} from './docsRestyle.ts'
import type { RawRestyleDocument, RestyleSpec } from './docsRestyle.ts'

// ── Fixture: a two-tab handbook with a title, a heading, prose and a table ──

function para(start: number, text: string, style = 'NORMAL_TEXT', textStyle?: Record<string, unknown>) {
  const end = start + text.length
  return {
    startIndex: start,
    endIndex: end,
    paragraph: {
      paragraphStyle: { namedStyleType: style },
      elements: [{ startIndex: start, endIndex: end, textRun: { content: text, ...(textStyle ? { textStyle } : {}) } }],
    },
  }
}

const inter = (size: number) => ({
  weightedFontFamily: { fontFamily: 'Inter' },
  fontSize: { magnitude: size, unit: 'PT' },
})

/** The handbook before (Arial everywhere, inherited) or after the restyle (`styled`). */
function handbook(styled: boolean): RawRestyleDocument {
  const family = styled ? 'Inter' : 'Arial'
  const explicit = (size: number) => (styled ? inter(size) : undefined)
  return {
    title: 'Atlas Handbook',
    tabs: [
      {
        tabProperties: { tabId: 't.0', title: 'Overview' },
        documentTab: {
          namedStyles: {
            styles: [
              {
                namedStyleType: 'NORMAL_TEXT',
                textStyle: { weightedFontFamily: { fontFamily: family }, fontSize: { magnitude: 11 } },
              },
              { namedStyleType: 'TITLE', textStyle: { fontSize: { magnitude: 26 } } },
              { namedStyleType: 'HEADING_1', textStyle: { fontSize: { magnitude: 20 } } },
            ],
          },
          body: {
            content: [
              { endIndex: 1 },
              para(1, 'Atlas Handbook\n', 'TITLE', explicit(24)),
              para(16, 'Welcome\n', 'HEADING_1', explicit(18)),
              para(24, 'Hello team.\n'),
              para(36, 'Read on.\n'),
              {
                startIndex: 45,
                endIndex: 70,
                table: {
                  tableRows: [
                    {
                      tableRowStyle: { tableHeader: true },
                      tableCells: [
                        { content: [para(47, 'Name\n', 'NORMAL_TEXT', explicit(10))] },
                        { content: [para(53, 'Role\n', 'NORMAL_TEXT', explicit(10))] },
                      ],
                    },
                    // One cell keeps a stray 9pt run — the read-back must call it out.
                    {
                      tableCells: [{ content: [para(60, 'Jane Doe\n', 'NORMAL_TEXT', styled ? inter(9) : undefined)] }],
                    },
                  ],
                },
              },
              para(70, 'Bye.\n'),
            ],
          },
        },
      },
      {
        tabProperties: { tabId: 't.1', title: 'Notes' },
        documentTab: {
          namedStyles: {
            styles: [
              {
                namedStyleType: 'NORMAL_TEXT',
                textStyle: { weightedFontFamily: { fontFamily: family }, fontSize: { magnitude: 11 } },
              },
            ],
          },
          body: { content: [{ endIndex: 1 }, para(1, 'Short.\n')] },
        },
      },
    ],
  }
}

const SPEC: RestyleSpec = { fontFamily: 'Inter', sizes: { title: 24, heading1: 18, body: 11, tableHeader: 10 } }

/** A request as `[start, end, tab, what]` — what is the family or the point size. */
function compact(plan: ReturnType<typeof planRestyle>) {
  return plan.requests.map(({ request }) => {
    const { range, textStyle, fields } = request.updateTextStyle as {
      range: { startIndex: number; endIndex: number; tabId?: string }
      textStyle: { weightedFontFamily?: { fontFamily: string }; fontSize?: { magnitude: number } }
      fields: string
    }
    const what = fields === 'fontSize' ? textStyle.fontSize?.magnitude : textStyle.weightedFontFamily?.fontFamily
    return [range.startIndex, range.endIndex, range.tabId, what]
  })
}

test('planRestyle - ranges by role, coalesced, capped before the final newline', () => {
  const plan = planRestyle(handbook(false), SPEC)

  assert({
    given: 'a two-tab handbook and a family plus sizes for title, heading1, body and table headers',
    should:
      'per tab put the family over all text, then sizes: adjacent body paragraphs share a range, the table gets one range at body size, its header row one at header size, and no range reaches the final newline',
    expected: [
      [1, 74, 't.0', 'Inter'],
      [1, 16, 't.0', 24],
      [16, 24, 't.0', 18],
      [24, 45, 't.0', 11],
      [47, 69, 't.0', 11],
      [47, 58, 't.0', 10],
      [70, 74, 't.0', 11],
      [1, 7, 't.1', 'Inter'],
      [1, 7, 't.1', 11],
    ],
    actual: compact(plan),
  })

  assert({
    given: 'the same plan',
    should: 'count every paragraph per tab, cells included, and keep per-paragraph fallbacks only on the table ranges',
    expected: {
      tabs: [
        { tabId: 't.0', title: 'Overview', paragraphs: 8 },
        { tabId: 't.1', title: 'Notes', paragraphs: 1 },
      ],
      expands: [undefined, undefined, undefined, undefined, 3, 2, undefined, undefined, undefined],
    },
    actual: { tabs: plan.tabs, expands: plan.requests.map((p) => p.expand?.length) },
  })
})

test('planRestyle - a family alone, one tab, unknown named styles', () => {
  const plan = planRestyle(handbook(false), { fontFamily: 'Inter', tabIds: ['t.1'] })
  assert({
    given: 'a family-only spec limited to the Notes tab',
    should: 'plan exactly one request, on that tab',
    expected: { requests: [[1, 7, 't.1', 'Inter']], tabs: ['t.1'] },
    actual: { requests: compact(plan), tabs: plan.tabs.map((t) => t.tabId) },
  })

  const odd: RawRestyleDocument = {
    tabs: [
      {
        tabProperties: { tabId: 't.0', title: 'Odd' },
        documentTab: {
          body: { content: [{ endIndex: 1 }, para(1, 'Custom\n', 'SOMETHING_ELSE'), para(8, 'Plain\n')] },
        },
      },
    ],
  }
  assert({
    given: 'a paragraph in a named style this module does not know, followed by normal text',
    should: 'leave the unknown one alone and size only the normal text',
    expected: [[8, 13, 't.0', 11]],
    actual: compact(planRestyle(odd, { sizes: { body: 11 } })),
  })

  assert({
    given: 'unknown tab ids',
    should: 'name the ones the document lacks',
    expected: ['t.9'],
    actual: unknownTabIds(handbook(false), ['t.0', 't.9']),
  })
})

test('batchesOf - one hundred requests per Docs batch', () => {
  assert({
    given: '250 requests',
    should: 'split into 100, 100, 50',
    expected: [100, 100, 50],
    actual: batchesOf(Array.from({ length: 250 }, (_, i) => i)).map((b) => b.length),
  })
})

test('checkRestyle - read-back resolves inheritance and names what still differs', () => {
  const check = checkRestyle(handbook(true), SPEC)
  assert({
    given: 'the restyled handbook, where body text inherits Inter 11 from NORMAL_TEXT and one cell kept a 9pt run',
    should:
      'judge every visible run, count the inherited ones as matching, and report the stray with its tab, text and expectation',
    expected: {
      runs: 9,
      matching: 8,
      skipped: 0,
      off: [
        {
          tab: 'Overview',
          text: 'Jane Doe',
          fontFamily: 'Inter',
          fontSize: 9,
          expected: { fontFamily: 'Inter', fontSize: 11 },
        },
      ],
    },
    actual: check,
  })

  const before = checkRestyle(handbook(false), SPEC)
  assert({
    given: 'the handbook before the restyle',
    should: 'find every run off — Arial, and the title and heading at their named sizes',
    expected: {
      runs: 9,
      matching: 0,
      first: { tab: 'Overview', text: 'Atlas Handbook', fontFamily: 'Arial', fontSize: 26 },
    },
    actual: {
      runs: before.runs,
      matching: before.matching,
      first: {
        tab: before.off[0]?.tab,
        text: before.off[0]?.text,
        fontFamily: before.off[0]?.fontFamily,
        fontSize: before.off[0]?.fontSize,
      },
    },
  })

  const withContents: RawRestyleDocument = {
    tabs: [
      {
        tabProperties: { tabId: 't.0', title: 'Contents' },
        documentTab: {
          body: {
            content: [
              { endIndex: 1 },
              { startIndex: 1, endIndex: 12, tableOfContents: { content: [para(2, 'Welcome 1\n')] } },
              para(12, 'Body\n'),
            ],
          },
        },
      },
    ],
  }
  assert({
    given: 'a table of contents and one body paragraph, judged for a family',
    should: 'skip the contents run and judge the body run only',
    expected: { runs: 1, matching: 0, skipped: 1 },
    actual: (({ runs, matching, skipped }) => ({ runs, matching, skipped }))(
      checkRestyle(withContents, { fontFamily: 'Inter' }),
    ),
  })
})

test('validateRestyleSpec and describeRestyleSpec', () => {
  assert({
    given: 'specs of every shape',
    should: 'accept family, sizes or both, and name each problem',
    expected: [null, null, null, 'nothing', 'unknown role', 'point size', 'font name', 'tab ids'],
    actual: [
      validateRestyleSpec({ fontFamily: 'Inter' }),
      validateRestyleSpec({ sizes: { body: 11 } }),
      validateRestyleSpec({ fontFamily: 'Inter', sizes: { heading2: 14 }, tabIds: ['t.0'] }),
      validateRestyleSpec({}),
      validateRestyleSpec({ sizes: { caption: 9 } }),
      validateRestyleSpec({ sizes: { body: 0 } }),
      validateRestyleSpec({ fontFamily: '  ' }),
      validateRestyleSpec({ fontFamily: 'Inter', tabIds: [''] }),
    ].map((problem) => {
      if (problem === null) return null
      for (const key of ['nothing', 'unknown role', 'point size', 'font name', 'tab ids'])
        if (problem.includes(key)) return key
      return problem
    }),
  })

  assert({
    given: 'a spec with a family and sizes in role order',
    should: 'read as one short line',
    expected: ['Inter; title 24pt, heading1 18pt, body 11pt, tableHeader 10pt', 'body 12pt', 'Inter'],
    actual: [
      describeRestyleSpec(SPEC),
      describeRestyleSpec({ sizes: { body: 12 } }),
      describeRestyleSpec({ fontFamily: 'Inter' }),
    ],
  })
})
