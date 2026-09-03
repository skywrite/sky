import { assert, test } from '#test'
import { resolveTimeField, type TimeFieldInputs } from './timeField.ts'

const EXTRACTED = '2026-01-27 09:30'
const STATED = '2026-01-27 09:00'
const CLOCK = '2026-01-27 14:05'

test('resolveTimeField()', () => {
  const cases: [string, string, TimeFieldInputs, string | null][] = [
    [
      'a fresh extraction and a stated start',
      'take the stated start',
      { time: EXTRACTED, kept: false, stated: STATED, clock: null },
      STATED,
    ],
    [
      'a fresh extraction and only the clock',
      'keep the extraction',
      { time: EXTRACTED, kept: false, stated: null, clock: CLOCK },
      EXTRACTED,
    ],
    [
      'no time found and the clock',
      'fill from the clock',
      { time: null, kept: false, stated: null, clock: CLOCK },
      CLOCK,
    ],
    [
      'a kept record with a time and a stated start',
      'keep the record, settled at a check',
      { time: EXTRACTED, kept: true, stated: STATED, clock: CLOCK },
      EXTRACTED,
    ],
    [
      'a kept record without a time and a stated start',
      'fill from the stated start',
      { time: null, kept: true, stated: STATED, clock: CLOCK },
      STATED,
    ],
    [
      'a kept record without a time and the clock',
      'fill from the clock',
      { time: null, kept: true, stated: null, clock: CLOCK },
      CLOCK,
    ],
    ['nothing at all', 'stay empty', { time: null, kept: false, stated: null, clock: null }, null],
  ]
  for (const [given, should, inputs, expected] of cases) {
    assert({ given, should, actual: resolveTimeField(inputs), expected })
  }
})
