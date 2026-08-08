import { assert, test } from '#test'
import {
  parseSummaryContext,
  serializeSummaryContext,
  SUMMARY_CONTEXT_VERSION,
  type SummaryContextRecord,
} from './contextRecord.ts'

const BODY = '# Daily Summary: Jan 15, 2026\n\nAtlas draft shipped.\n'

const RECORD: Omit<SummaryContextRecord, 'version'> = {
  scope: 'day',
  budget: 300_000,
  kept: [
    { path: 'people/Jane-Doe.md', tokens: 890, kind: 'background' },
    { path: 'time/2026/01/12-18/01-15/day.md', tokens: 1416, kind: 'day' },
  ],
  skipped: [{ path: 'time/2026/01/12-18/01-15/actions/notes/broken.md', reason: 'yamlError' }],
}

test('contextRecord round-trips through serialize and parse', () => {
  const markdown = BODY + serializeSummaryContext(RECORD)
  const { body, record } = parseSummaryContext(markdown)

  assert({
    given: 'a body with an appended SUMMARY-CONTEXT record',
    should: 'recover the body and the record exactly',
    actual: JSON.stringify({ body, record }),
    expected: JSON.stringify({ body: BODY, record: { version: SUMMARY_CONTEXT_VERSION, ...RECORD } }),
  })
})

test('contextRecord escapes arrow sequences inside values', () => {
  const markdown =
    BODY +
    serializeSummaryContext({
      ...RECORD,
      kept: [{ path: 'time/2026/01/12-18/01-15/actions/notes/a-->b.md', tokens: 12, kind: 'action' }],
    })
  const { record } = parseSummaryContext(markdown)

  assert({
    given: 'a kept path containing --> inside the JSON',
    should: 'not truncate the comment and restore the original path on parse',
    actual: record?.kept[0]?.path,
    expected: 'time/2026/01/12-18/01-15/actions/notes/a-->b.md',
  })
})

test('contextRecord treats old-style CONTEXT comments as no record', () => {
  const markdown = BODY + '\n<!--\nCONTEXT:\n\n - some/path.md\n\nEND\n-->\n'
  const { body, record } = parseSummaryContext(markdown)

  assert({
    given: 'a pre-JSON CONTEXT path-list comment',
    should: 'return null record and leave the markdown untouched',
    actual: JSON.stringify({ body, record }),
    expected: JSON.stringify({ body: markdown, record: null }),
  })
})

test('contextRecord rejects unknown versions and quoted markers', () => {
  const wrongVersion =
    BODY + '\n<!-- SUMMARY-CONTEXT\n{"version": 99, "scope": "day", "budget": 1, "kept": [], "skipped": []}\n-->\n'
  const quotedMarker = 'The text `<!-- SUMMARY-CONTEXT` is discussed here.\n'

  assert({
    given: 'an unsupported version and a body that merely quotes the marker',
    should: 'parse both to no record',
    actual: [parseSummaryContext(wrongVersion).record, parseSummaryContext(quotedMarker).record].join(','),
    expected: ',',
  })
})

test('contextRecord serializes empty arrays inline and parses them back', () => {
  const markdown = BODY + serializeSummaryContext({ scope: 'week', budget: 300_000, kept: [], skipped: [] })
  const { record } = parseSummaryContext(markdown)

  assert({
    given: 'a record with no kept or skipped entries',
    should: 'round-trip with empty arrays and keep the scope',
    actual: JSON.stringify([record?.scope, record?.kept, record?.skipped]),
    expected: JSON.stringify(['week', [], []]),
  })
})
