import TrackingDocument from '#shared/models/Tracking/mod.ts'
import { assert, test } from '#test'
import { isBareScalar, sanitizeParsedValues, valueColumns } from './parse.ts'

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
