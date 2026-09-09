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
      'a meeting time extracted from a later voice memo, with only the day chosen',
      'keep the meeting time instead of replacing it with the dictation time',
      { time: EXTRACTED, kept: false, stated: null, day: '2026-01-27', clock: CLOCK },
      EXTRACTED,
    ],
    [
      'a chosen meeting day different from the recording date',
      'combine the chosen day with the extracted meeting time',
      { time: EXTRACTED, kept: false, stated: null, day: '2026-01-26', clock: CLOCK },
      '2026-01-26 09:30',
    ],
    [
      'no time found, a chosen day, and the recording clock',
      'fall back to the clock time on the chosen day',
      { time: null, kept: false, stated: null, day: '2026-01-26', clock: CLOCK },
      '2026-01-26 14:05',
    ],
    [
      'an extended-hour meeting time and a chosen day',
      'preserve the extended hour without rolling into another day',
      { time: '2026-01-27 25:30', kept: false, stated: null, day: '2026-01-26', clock: CLOCK },
      '2026-01-26 25:30',
    ],
    [
      'a full time stated after choosing a day',
      'keep the full stated time',
      { time: EXTRACTED, kept: false, stated: STATED, day: '2026-01-26', clock: CLOCK },
      STATED,
    ],
    [
      'a kept time corrected at an earlier check and a chosen day',
      'keep the correction',
      { time: EXTRACTED, kept: true, stated: null, day: '2026-01-26', clock: CLOCK },
      EXTRACTED,
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
