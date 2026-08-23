import { mkdir, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import TrackingDocument from '#shared/models/Tracking/mod.ts'
import { assert, test } from '#test'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'
import { appendRecord, dayLetter, formatHeader, formatRow, hasEntryForDate, recordFilePath } from './records.ts'

const TEST_DIR = '/tmp/track-records-test'

// 2026-08-17 is a Monday; the week runs through Sunday 2026-08-23.
const MONDAY = new PlainDate('2026-08-17')
const THURSDAY = new PlainDate('2026-08-20')
const SATURDAY = new PlainDate('2026-08-22')
const SUNDAY = new PlainDate('2026-08-23')

const WEIGHT = TrackingDocument.fromMarkdown(
  [
    '---',
    'name: weight',
    'category: health',
    'columns:',
    '  - name: time',
    '    type: time',
    '  - name: lbs',
    '    type: number',
    '    unit: lbs',
    '  - name: notes',
    '    type: text',
    '---',
    '',
    '# Weight',
  ].join('\n'),
)

test('dayLetter: Monday-first letters with R for Thursday', () => {
  assert({
    given: 'Monday, Thursday, Saturday, Sunday',
    should: 'map to M, R, SA, SU',
    expected: 'M,R,SA,SU',
    actual: [MONDAY, THURSDAY, SATURDAY, SUNDAY].map(dayLetter).join(','),
  })
})

test('formatHeader: quoted cells with units in parens', () => {
  assert({
    given: 'a definition with a unit-bearing column',
    should: 'render the hand-kept header style',
    expected: '"day", "time", "lbs (lbs)", "notes"',
    actual: formatHeader(WEIGHT),
  })
})

test('formatRow: bare numbers/times, quoted text, ragged tail', () => {
  assert({
    given: 'a full row with a note',
    should: 'quote only the text field',
    expected: 'M, 6:05, 180, "post travel"',
    actual: formatRow(WEIGHT, MONDAY, { time: '6:05', lbs: '180', notes: 'post travel' }),
  })
  assert({
    given: 'a row with no note',
    should: 'drop the trailing empty field like a hand row',
    expected: 'SU, 6:10, 181.4',
    actual: formatRow(WEIGHT, SUNDAY, { time: '6:10', lbs: '181.4', notes: '' }),
  })
  assert({
    given: 'an inner empty between filled fields',
    should: 'keep the empty slot so columns stay aligned',
    expected: 'R, , 268',
    actual: formatRow(WEIGHT, THURSDAY, { time: '', lbs: '268', notes: '' }),
  })
  assert({
    given: 'a quote inside a text value',
    should: 'escape it CSV-style',
    expected: 'M, 6:05, 180, "felt ""off"" today"',
    actual: formatRow(WEIGHT, MONDAY, { time: '6:05', lbs: '180', notes: 'felt "off" today' }),
  })
})

test('hasEntryForDate: both quoting eras, no header false-positive', () => {
  const unquoted = '"day", "time", "lbs (lbs)", "notes"\nM, 6:05, 180\nSA, 6:15, 181\n'
  const quoted = '"day","time","lbs (lbs)","notes"\n"M","6:05",180\n"SU","6:10",181\n'

  assert({
    given: 'an unquoted M row',
    should: 'find Monday',
    expected: true,
    actual: hasEntryForDate(WEIGHT, unquoted, MONDAY),
  })
  assert({
    given: 'an SA row only',
    should: 'not match Sunday',
    expected: false,
    actual: hasEntryForDate(WEIGHT, unquoted, SUNDAY),
  })
  assert({
    given: 'a quoted-era "SU" row',
    should: 'find Sunday',
    expected: true,
    actual: hasEntryForDate(WEIGHT, quoted, SUNDAY),
  })
  assert({
    given: 'a header-only file',
    should: 'match nothing',
    expected: false,
    actual: hasEntryForDate(WEIGHT, '"day", "time", "lbs (lbs)", "notes"\n', MONDAY),
  })
})

const WAIST = TrackingDocument.fromMarkdown(
  [
    '---',
    'name: waist',
    'storage: yearly',
    'schedule: manual',
    'columns:',
    '  - name: time',
    '    type: time',
    '  - name: inches',
    '    type: number',
    '    unit: in',
    '  - name: notes',
    '    type: text',
    '---',
    '',
    '# Waist',
  ].join('\n'),
)

test('yearly storage: date-keyed rows, date header, year-file path', () => {
  assert({
    given: 'a yearly definition',
    should: 'use "date" as the first header cell',
    expected: '"date", "time", "inches (in)", "notes"',
    actual: formatHeader(WAIST),
  })
  assert({
    given: 'a yearly row',
    should: 'key on the full date, ragged tail dropped',
    expected: '2026-08-23, 5:25, 38.5',
    actual: formatRow(WAIST, SUNDAY, { time: '5:25', inches: '38.5', notes: '' }),
  })
  assert({
    given: 'a yearly definition and a date',
    should: 'resolve to data/tracking/{year}/{slug}.csv',
    expected: '/data/tracking/2026/waist.csv',
    actual: recordFilePath({ timeDir: '/time', dataTrackingDir: '/data/tracking' }, WAIST, SUNDAY),
  })
  const contents = '"date", "time", "inches (in)", "notes"\n2026-08-16, 5:00, 39\n2026-08-23, 5:25, 38.5\n'
  assert({
    given: 'a yearly file with a row for the date',
    should: 'detect the entry',
    expected: true,
    actual: hasEntryForDate(WAIST, contents, SUNDAY),
  })
  assert({
    given: 'a yearly file without a row for the date',
    should: 'not detect one',
    expected: false,
    actual: hasEntryForDate(WAIST, contents, MONDAY),
  })
})

test('appendRecord: creates with header, then appends; repairs missing final newline', async () => {
  await rm(TEST_DIR, { recursive: true }).catch(() => {})
  await mkdir(TEST_DIR, { recursive: true })

  try {
    const filePath = path.join(TEST_DIR, 'weight.csv')

    const first = await appendRecord(filePath, WEIGHT, MONDAY, { time: '6:05', lbs: '180' })
    assert({
      given: 'a missing week file',
      should: 'create it with the header',
      expected: true,
      actual: first.created,
    })
    assert({
      given: 'the created file',
      should: 'hold header plus the row',
      expected: '"day", "time", "lbs (lbs)", "notes"\nM, 6:05, 180\n',
      actual: await readTextFile(filePath),
    })

    const second = await appendRecord(filePath, WEIGHT, THURSDAY, { time: '6:20', lbs: '179' })
    assert({
      given: 'an existing file',
      should: 'append without recreating',
      expected: false,
      actual: second.created,
    })
    assert({
      given: 'the appended file',
      should: 'end with both rows',
      expected: '"day", "time", "lbs (lbs)", "notes"\nM, 6:05, 180\nR, 6:20, 179\n',
      actual: await readTextFile(filePath),
    })
  } finally {
    await rm(TEST_DIR, { recursive: true }).catch(() => {})
  }
})
