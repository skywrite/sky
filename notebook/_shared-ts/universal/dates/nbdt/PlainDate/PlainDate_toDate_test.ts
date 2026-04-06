import { assert, test } from '#test'
import PlainDate from './mod.ts'

const fixtures = [
  {
    description: 'converts to Date with time at midnight',
    plainDate: new PlainDate('2025-08-27'),
    expected: {
      year: 2025,
      month: 7, // 0-indexed for Date
      day: 27,
      hours: 0,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    },
  },
  {
    description: 'leap year date converts correctly',
    plainDate: new PlainDate('2020-02-29'),
    expected: {
      year: 2020,
      month: 1, // February is 1 in 0-indexed
      day: 29,
      hours: 0,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    },
  },
  {
    description: 'end of year converts correctly',
    plainDate: new PlainDate('2025-12-31'),
    expected: {
      year: 2025,
      month: 11, // December is 11 in 0-indexed
      day: 31,
      hours: 0,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    },
  },
  {
    description: 'beginning of year converts correctly',
    plainDate: new PlainDate('2025-01-01'),
    expected: {
      year: 2025,
      month: 0, // January is 0 in 0-indexed
      day: 1,
      hours: 0,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    },
  },
]

fixtures.forEach((fixture) => {
  test(`PlainDate.toDate() - ${fixture.description}`, () => {
    const date = fixture.plainDate.toDate()

    assert({
      given: fixture.description,
      should: 'have correct year',
      actual: date.getFullYear(),
      expected: fixture.expected.year,
    })

    assert({
      given: fixture.description,
      should: 'have correct month',
      actual: date.getMonth(),
      expected: fixture.expected.month,
    })

    assert({
      given: fixture.description,
      should: 'have correct day',
      actual: date.getDate(),
      expected: fixture.expected.day,
    })

    assert({
      given: fixture.description,
      should: 'have hours set to 0',
      actual: date.getHours(),
      expected: fixture.expected.hours,
    })

    assert({
      given: fixture.description,
      should: 'have minutes set to 0',
      actual: date.getMinutes(),
      expected: fixture.expected.minutes,
    })

    assert({
      given: fixture.description,
      should: 'have seconds set to 0',
      actual: date.getSeconds(),
      expected: fixture.expected.seconds,
    })

    assert({
      given: fixture.description,
      should: 'have milliseconds set to 0',
      actual: date.getMilliseconds(),
      expected: fixture.expected.milliseconds,
    })
  })
})

test('PlainDate.toDate() returns new Date instance each time', () => {
  const plainDate = new PlainDate('2025-08-27')
  const date1 = plainDate.toDate()
  const date2 = plainDate.toDate()

  assert({
    given: 'calling toDate() twice',
    should: 'return different Date instances',
    actual: date1 === date2,
    expected: false,
  })

  assert({
    given: 'calling toDate() twice',
    should: 'return equivalent dates',
    actual: date1.getTime(),
    expected: date2.getTime(),
  })
})
