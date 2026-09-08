import TrackingDocument from '#shared/models/Tracking/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { isBareScalar, parseEntryDate, parseEntryResponse, sanitizeParsedValues, valueColumns } from './parse.ts'

const WEIGHT = TrackingDocument.fromMarkdown(
  [
    '---',
    'name: weight',
    'columns:',
    '  - name: time',
    '    type: time',
    '  - name: lbs',
    '    type: number',
    '    unit: lbs',
    '  - name: notes',
    '    type: text',
    '---',
    '# Weight',
  ].join('\n'),
)

const SLEEP = TrackingDocument.fromMarkdown(
  [
    '---',
    'name: sleep',
    'columns:',
    '  - name: range',
    '    type: range',
    '  - name: duration',
    '    type: number',
    '    unit: hrs',
    '  - name: notes',
    '    type: text',
    '---',
    '# Sleep',
  ].join('\n'),
)

const VITAMINS = TrackingDocument.fromMarkdown(
  [
    '---',
    'name: vitamins',
    'columns:',
    '  - name: time',
    '    type: time',
    '  - name: vitamins',
    '    type: word',
    '  - name: notes',
    '    type: text',
    '---',
    '# Vitamins',
  ].join('\n'),
)

test('valueColumns: excludes time and notes', () => {
  assert({
    given: 'weight (time, lbs, notes)',
    should: 'leave only lbs',
    expected: 'lbs',
    actual: valueColumns(WEIGHT)
      .map((c) => c.name)
      .join(','),
  })
  assert({
    given: 'sleep (range, duration, notes)',
    should: 'leave range and duration',
    expected: 'range,duration',
    actual: valueColumns(SLEEP)
      .map((c) => c.name)
      .join(','),
  })
})

test('isBareScalar: single-value fast path', () => {
  assert({
    given: 'a bare number for weight',
    should: 'take the fast path',
    expected: true,
    actual: isBareScalar(WEIGHT, '180'),
  })
  assert({
    given: 'a sentence for weight',
    should: 'not take the fast path',
    expected: false,
    actual: isBareScalar(WEIGHT, '180 after travel'),
  })
  assert({
    given: 'a non-numeric token for a number column',
    should: 'not take the fast path',
    expected: false,
    actual: isBareScalar(WEIGHT, 'heavy'),
  })
  assert({
    given: 'a word token for vitamins (word column)',
    should: 'take the fast path',
    expected: true,
    actual: isBareScalar(VITAMINS, 'B12'),
  })
  assert({
    given: 'a bare number for sleep (two value columns)',
    should: 'not take the fast path',
    expected: false,
    actual: isBareScalar(SLEEP, '5.5'),
  })
})

test('sanitizeParsedValues: clamps to declared columns, stringifies, drops empties', () => {
  const raw = {
    lbs: 180,
    notes: '  post travel  ',
    time: '',
    invented: 'nope',
  }

  assert({
    given: 'model output with an undeclared column, a number, and an empty',
    should: 'keep only declared non-empty values as trimmed strings',
    expected: JSON.stringify({ lbs: '180', notes: 'post travel' }),
    actual: JSON.stringify(sanitizeParsedValues(WEIGHT, raw)),
  })
})

test('parseEntryResponse: entry dates survive independently of declared columns', () => {
  const today = new PlainDate('2031-03-13')
  const parsed = parseEntryResponse(
    WEIGHT,
    { date: '2031-03-12', values: { time: '18:45', lbs: 182, invented: 'nope' } },
    today,
  )
  assert({
    given: 'a parsed entry for the previous calendar day',
    should: 'keep its date outside the column filter and preserve the stated time',
    actual: { date: parsed?.date?.toString(), values: parsed?.values },
    expected: { date: '2031-03-12', values: { time: '18:45', lbs: '182' } },
  })
  assert({
    given: 'an entry explicitly reporting no stated date',
    should: 'use the supplied notebook calendar day',
    actual: parseEntryResponse(WEIGHT, { date: null, values: { lbs: 182 } }, today)?.date?.toString(),
    expected: '2031-03-13',
  })
})

test('parseEntryResponse: unresolved dates never default to today', () => {
  const today = new PlainDate('2031-03-13')
  for (const date of [undefined, '', 'unclear', '2031-02-29', '2031-04-31', '2031-13-01', '03-12']) {
    const parsed = parseEntryResponse(WEIGHT, { date, values: { lbs: 182, time: '18:45' } }, today)
    assert({
      given: `an unresolved model date (${String(date)}) with usable values`,
      should: 'require date clarification while keeping the measurement and time',
      actual: { date: parsed?.date, values: parsed?.values },
      expected: { date: null, values: { lbs: '182', time: '18:45' } },
    })
  }
})

test('parseEntryDate: validates full dates without calendar rollover or partial expansion', () => {
  assert({
    given: 'a valid leap day with surrounding whitespace',
    should: 'return its exact calendar date',
    actual: parseEntryDate(' 2032-02-29 ')?.toString(),
    expected: '2032-02-29',
  })
  assert({
    given: 'a date-only entry with no declared column values',
    should: 'leave the entry to the manual fallback',
    actual: parseEntryResponse(WEIGHT, { date: '2031-03-12', values: {} }, new PlainDate('2031-03-13')),
    expected: null,
  })
})
