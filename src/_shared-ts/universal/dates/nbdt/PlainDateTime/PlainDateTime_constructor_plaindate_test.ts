import { assert, test } from '#test'
import PlainDate from '../PlainDate/mod.ts'
import PlainDateTime from './mod.ts'

test('PlainDateTime constructor with PlainDate only', () => {
  const plainDate = new PlainDate('2025-08-27')
  const dt = new PlainDateTime(plainDate)

  assert({
    given: 'PlainDate only',
    should: 'use midnight as time',
    actual: dt.time,
    expected: '00:00',
  })

  assert({
    given: 'PlainDate only',
    should: 'use the provided PlainDate',
    actual: dt.date,
    expected: '2025-08-27',
  })

  assert({
    given: 'PlainDate only',
    should: 'expose plainDate property',
    actual: dt.plainDate === plainDate,
    expected: true,
  })
})

test('PlainDateTime constructor with time string and PlainDate', () => {
  const plainDate = new PlainDate('2025-08-27')
  const dt = new PlainDateTime('14:30', plainDate)

  assert({
    given: 'time string and PlainDate',
    should: 'use provided time',
    actual: dt.time,
    expected: '14:30',
  })

  assert({
    given: 'time string and PlainDate',
    should: 'use the provided PlainDate',
    actual: dt.date,
    expected: '2025-08-27',
  })

  assert({
    given: 'time string and PlainDate',
    should: 'expose plainDate property',
    actual: dt.plainDate === plainDate,
    expected: true,
  })
})

test('PlainDateTime plainDate property provides access to PlainDate methods', () => {
  const dt = new PlainDateTime('2025-09-01 14:30')

  assert({
    given: 'PlainDateTime with date',
    should: 'provide access to dayShort',
    actual: dt.plainDate.dayShort,
    expected: 'Mon',
  })

  assert({
    given: 'PlainDateTime with date',
    should: 'provide access to dayLong',
    actual: dt.plainDate.dayLong,
    expected: 'Monday',
  })

  assert({
    given: 'PlainDateTime with date',
    should: 'provide access to year',
    actual: dt.plainDate.year,
    expected: 2025,
  })

  assert({
    given: 'PlainDateTime with date',
    should: 'provide access to month',
    actual: dt.plainDate.month,
    expected: 9,
  })

  assert({
    given: 'PlainDateTime with date',
    should: 'provide access to day',
    actual: dt.plainDate.day,
    expected: 1,
  })
})
