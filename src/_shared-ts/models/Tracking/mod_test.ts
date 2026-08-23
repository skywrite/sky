import TrackingDocument from '#shared/models/Tracking/mod.ts'
import { assert, test } from '#test'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'

function makeTracking(yamlLines: string[]): TrackingDocument {
  return TrackingDocument.fromMarkdown(`---\n${yamlLines.join('\n')}\n---\n\n# Test\n`)
}

// 2026-02-07 is a Saturday, 2026-02-09 a Monday.
const SATURDAY = new PlainDate('2026-02-07')
const MONDAY = new PlainDate('2026-02-09')

test(`TrackingDocument accessors`, () => {
  const doc = makeTracking([
    'name: hydration',
    'title: Hydration',
    'question: How much water today?',
    'ask: morning',
    'schedule: daily',
    'category: health',
    'columns:',
    '  - name: time',
    '    type: time',
    '  - name: oz',
    '    type: number',
    '    unit: oz',
    '    aggregate: sum',
    '  - name: notes',
    '    type: text',
    'start: 2026-01-05',
  ])

  assert({
    given: 'a tracking definition',
    should: 'expose its question',
    expected: 'How much water today?',
    actual: doc.question,
  })
  assert({
    given: 'a tracking definition',
    should: 'expose its ask window',
    expected: 'morning',
    actual: doc.ask,
  })
  assert({
    given: 'a tracking definition',
    should: 'derive the record CSV basename from the slug',
    expected: 'hydration.csv',
    actual: doc.csvBasename,
  })
  assert({
    given: 'a columns list',
    should: 'parse all columns in order',
    expected: 'time,oz,notes',
    actual: doc.columns.map((c) => c.name).join(','),
  })
  assert({
    given: 'a column with unit and aggregate',
    should: 'carry both through',
    expected: 'number|oz|sum',
    actual: `${doc.columns[1].type}|${doc.columns[1].unit}|${doc.columns[1].aggregate}`,
  })
})

test(`TrackingDocument defaults and lenient parsing`, () => {
  const bare = makeTracking(['name: mood'])

  assert({
    given: 'no question field',
    should: 'have undefined question (never prompted)',
    expected: undefined,
    actual: bare.question,
  })
  assert({
    given: 'no ask field',
    should: 'default to anytime',
    expected: 'anytime',
    actual: bare.ask,
  })
  assert({
    given: 'no columns field',
    should: 'have an empty schema',
    expected: 0,
    actual: bare.columns.length,
  })

  const messy = makeTracking([
    'name: messy',
    'columns:',
    '  - name: ok',
    '    type: bogus-type',
    '  - type: number', // nameless — dropped
    '  - name: plain',
  ])
  assert({
    given: 'an unknown column type',
    should: 'normalize to text',
    expected: 'text',
    actual: messy.columns[0].type,
  })
  assert({
    given: 'a nameless column entry',
    should: 'be dropped',
    expected: 'ok,plain',
    actual: messy.columns.map((c) => c.name).join(','),
  })
})

test(`TrackingDocument.isTrackedOn()`, () => {
  const weekdays = makeTracking(['name: work', 'schedule: weekdays', 'start: 2026-01-05'])
  const ended = makeTracking(['name: macros', 'start: 2026-01-05', 'end: 2026-02-01'])

  assert({
    given: 'a weekdays tracking on a Saturday',
    should: 'not be tracked',
    expected: false,
    actual: weekdays.isTrackedOn(SATURDAY),
  })
  assert({
    given: 'a weekdays tracking on a Monday',
    should: 'be tracked',
    expected: true,
    actual: weekdays.isTrackedOn(MONDAY),
  })
  assert({
    given: 'a tracking past its end',
    should: 'not be tracked',
    expected: false,
    actual: ended.isTrackedOn(SATURDAY),
  })
})

test(`TrackingDocument.create() roundtrip`, () => {
  const created = TrackingDocument.create({
    name: 'hydration',
    title: 'Hydration',
    question: 'How much water today?',
    ask: 'morning',
    category: 'health',
    columns: [
      { name: 'oz', type: 'number', unit: 'oz', aggregate: 'sum' },
      { name: 'notes', type: 'text' },
    ],
    start: new PlainDate('2026-01-05'),
    why: 'Dehydration masquerades as fatigue.',
    createdOn: '2026-01-05',
  })

  const reparsed = TrackingDocument.fromMarkdown(created.toMarkdown())

  assert({
    given: 'a created definition reparsed from its markdown',
    should: 'keep the question',
    expected: 'How much water today?',
    actual: reparsed.question,
  })
  assert({
    given: 'a created definition reparsed from its markdown',
    should: 'keep the column schema',
    expected: 'oz:number:oz:sum',
    actual: reparsed.columns
      .slice(0, 1)
      .map((c) => `${c.name}:${c.type}:${c.unit}:${c.aggregate}`)
      .join(''),
  })
  assert({
    given: 'a created definition reparsed from its markdown',
    should: 'keep the why in the body',
    expected: true,
    actual: reparsed.markdown.includes('Dehydration masquerades as fatigue.'),
  })
})

test(`TrackingDocument.archive()`, () => {
  const doc = makeTracking(['name: macros', 'start: 2026-01-05'])
  const archived = doc.archive(new PlainDate('2026-02-01'))

  assert({
    given: 'an archived tracking with no planned end',
    should: 'stamp the end date',
    expected: '2026-02-01',
    actual: archived.end?.ymd,
  })

  const plannedPast = makeTracking(['name: macros', 'start: 2026-01-05', 'end: 2026-01-20'])
  const archivedPast = plannedPast.archive(new PlainDate('2026-02-01'))
  assert({
    given: 'an already-passed planned end',
    should: 'keep the earlier factual end',
    expected: '2026-01-20',
    actual: archivedPast.end?.ymd,
  })
})
