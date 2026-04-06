import { assert, test } from '#test'
import differenceInCalendarDays from './differenceInCalendarDays.ts'

// Helper types and constants
type PartialInterval = {
  start: Date | undefined
  end: Date | undefined
}

const MINUTE = 1000 * 60

// Helper functions for DST testing
function isValidDate(date: unknown): date is Date {
  return date instanceof Date && !isNaN(date.getTime())
}

function firstTickInLocalDay(date: Date): Date {
  const dateNumber = date.getDate()
  let prev = date
  let d = date
  do {
    prev = d
    d = new Date(d.getTime() - MINUTE)
  } while (dateNumber === d.getDate())
  return prev
}

function fiveMinutesLater(date: Date): Date {
  return new Date(date.getTime() + 5 * MINUTE)
}

function oneDayLater(date: Date): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + 1)
  return firstTickInLocalDay(d)
}

function previousTickTimezoneOffset(date: Date): number {
  const d = new Date(date.getTime() - 1)
  return d.getTimezoneOffset()
}

type _Transition = {
  date: Date
  type: string
  before: number
  after: number
}

export function getTzOffsetTransitions(year: number) {
  // start at the end of the previous day
  let date = firstTickInLocalDay(new Date(year, 0, 1))
  if (!isValidDate(date)) {
    throw new Error('Invalid Date')
  }
  let baseTzOffset = previousTickTimezoneOffset(date)
  const transitions: _Transition[] = []
  do {
    let tzOffset = date.getTimezoneOffset()
    if (baseTzOffset !== tzOffset) {
      if (tzOffset !== previousTickTimezoneOffset(date)) {
        // Transition is the first tick of a local day.
        transitions.push({
          date: date,
          type: tzOffset < baseTzOffset ? 'forward' : 'back',
          before: -baseTzOffset,
          after: -tzOffset,
        })
        baseTzOffset = tzOffset
      } else {
        // transition was not at the start of the day, so it must have happened
        // yesterday. Back up one day and find the minute where it happened.
        let transitionDate = new Date(date.getTime())
        transitionDate.setDate(transitionDate.getDate() - 1)

        // Iterate through each 5 mins of the day until we find a transition.
        const dayNumber = transitionDate.getDate()
        while (isValidDate(transitionDate) && transitionDate.getDate() === dayNumber) {
          tzOffset = transitionDate.getTimezoneOffset()
          if (baseTzOffset !== tzOffset) {
            transitions.push({
              date: transitionDate,
              type: tzOffset < baseTzOffset ? 'forward' : 'back',
              before: -baseTzOffset,
              after: -tzOffset,
            })
            baseTzOffset = tzOffset
            break // assuming only 1 transition per day
          }
          transitionDate = fiveMinutesLater(transitionDate)
        }
        if (!isValidDate(transitionDate)) {
          throw new Error('Invalid Date')
        }
        baseTzOffset = tzOffset
      }
    }
    date = oneDayLater(date)
  } while (date.getFullYear() === year)
  return transitions
}

export function getDstTransitions(year: number): PartialInterval {
  const result: PartialInterval = {
    start: undefined,
    end: undefined,
  }
  const transitions = getTzOffsetTransitions(year)
  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i]
    const month = t.date.getMonth()
    if (month > 0 && month < 11) {
      if (t.type === 'forward') result.start = t.date
      if (t.type === 'back' && !result.end) result.end = t.date
    }
  }
  return result
}

// Tests

test('differenceInCalendarDays - returns the number of calendar days between the given dates', { ignore: true }, () => {
  assert({
    actual: differenceInCalendarDays(new Date(2012, 6, /* Jul */ 2, 18, 0), new Date(2011, 6, /* Jul */ 2, 6, 0)),
    expected: 366,
  })
})

test(
  'differenceInCalendarDays - returns a negative number if the time value of the first date is smaller',
  {
    ignore: true,
  },
  () => {
    assert({
      actual: differenceInCalendarDays(new Date(2011, 6, /* Jul */ 2, 6, 0), new Date(2012, 6, /* Jul */ 2, 18, 0)),
      expected: -366,
    })
  },
)

test(
  'differenceInCalendarDays - edge cases - the difference is less than a day, but the given dates are in different calendar days',
  { ignore: true },
  () => {
    assert({
      actual: differenceInCalendarDays(new Date(2014, 8, /* Sep */ 5, 0, 0), new Date(2014, 8, /* Sep */ 4, 23, 59)),
      expected: 1,
    })
  },
)

test('differenceInCalendarDays - edge cases - the same for the swapped dates', { ignore: true }, () => {
  assert({
    actual: differenceInCalendarDays(new Date(2014, 8, /* Sep */ 4, 23, 59), new Date(2014, 8, /* Sep */ 5, 0, 0)),
    expected: -1,
  })
})

test(
  'differenceInCalendarDays - edge cases - the time values of the given the given dates are the same',
  {
    ignore: true,
  },
  () => {
    assert({
      actual: differenceInCalendarDays(new Date(2014, 8, /* Sep */ 6, 0, 0), new Date(2014, 8, /* Sep */ 5, 0, 0)),
      expected: 1,
    })
  },
)

test('differenceInCalendarDays - edge cases - the given the given dates are the same', { ignore: true }, () => {
  assert({
    actual: differenceInCalendarDays(new Date(2014, 8, /* Sep */ 5, 0, 0), new Date(2014, 8, /* Sep */ 5, 0, 0)),
    expected: 0,
  })
})

test(
  'differenceInCalendarDays - edge cases - does not return -0 when the given dates are the same',
  { ignore: true },
  () => {
    function isNegativeZero(x: number): boolean {
      return x === 0 && 1 / x < 0
    }

    const result = differenceInCalendarDays(new Date(2014, 8, /* Sep */ 5, 0, 0), new Date(2014, 8, /* Sep */ 5, 0, 0))

    assert({ actual: isNegativeZero(result), expected: false })
  },
)

test('differenceInCalendarDays - returns NaN if the first date is `Invalid Date`', { ignore: true }, () => {
  assert({
    actual: isNaN(differenceInCalendarDays(new Date(NaN), new Date(2017, 0, /* Jan */ 1))),
    expected: true,
  })
})

test('differenceInCalendarDays - returns NaN if the second date is `Invalid Date`', { ignore: true }, () => {
  assert({
    actual: isNaN(differenceInCalendarDays(new Date(2017, 0, /* Jan */ 1), new Date(NaN))),
    expected: true,
  })
})

test('differenceInCalendarDays - returns NaN if the both dates are `Invalid Date`', { ignore: true }, () => {
  assert({
    actual: isNaN(differenceInCalendarDays(new Date(NaN), new Date(NaN))),
    expected: true,
  })
})

// These tests were copy-pasted almost unchanged from DST tests for
// `differenceInDays`
const dstTransitions = getDstTransitions(2017)
const dstOnly = dstTransitions.start && dstTransitions.end ? test : test
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone /*|| process.env.tz*/

test(
  `differenceInCalendarDays - works across DST start & end in local timezone: ${tz || '(unknown)'}`,
  { ignore: true },
  () => {
    const { start, end } = dstTransitions
    const HOUR = 1000 * 60 * 60
    const MINUTE = 1000 * 60
    function sameTime(t1: Date, t2: Date): boolean {
      return (
        t1.getHours() === t2.getHours() &&
        t1.getMinutes() === t2.getMinutes() &&
        t1.getSeconds() === t2.getSeconds() &&
        t1.getMilliseconds() === t2.getMilliseconds()
      )
    }

    assert({ actual: start !== undefined, expected: true })
    assert({ actual: end !== undefined, expected: true })

    if (start === undefined || end === undefined) {
      return
    }

    // It's usually 1 hour, but for some timezones, e.g. Australia/Lord_Howe, it is 30 minutes
    const dstOffset = (end.getTimezoneOffset() - start.getTimezoneOffset()) * MINUTE

    // TEST DST START (SPRING)

    // anchor to one hour before the boundary
    {
      const a = new Date(start.getTime() - HOUR) // 1 hour before DST
      const b = new Date(a.getTime() + 24 * HOUR - dstOffset) // 1 day later, same local time
      const c = new Date(a.getTime() + 48 * HOUR - dstOffset) // 2 days later, same local time

      assert({ actual: sameTime(a, b), expected: true })
      assert({ actual: sameTime(a, c), expected: true })
      assert({ actual: sameTime(b, c), expected: true })
      assert({ actual: differenceInCalendarDays(c, b), expected: 1 }) // normal 24-hour day
      assert({ actual: differenceInCalendarDays(b, a), expected: 1 }) // 23 hours -> 1 day
      assert({ actual: differenceInCalendarDays(c, a), expected: 2 }) // 47 hours -> 2 days
    }
    // anchor exactly at the boundary
    {
      const a = start // exactly when DST starts
      const b = new Date(a.getTime() + 24 * HOUR) // 1 day later, same local time
      const c = new Date(a.getTime() + 48 * HOUR) // 2 days later, same local time

      assert({ actual: sameTime(a, b), expected: true })
      assert({ actual: sameTime(a, c), expected: true })
      assert({ actual: sameTime(b, c), expected: true })
      assert({ actual: differenceInCalendarDays(c, b), expected: 1 }) // normal 24-hour day
      assert({ actual: differenceInCalendarDays(b, a), expected: 1 }) // normal 24-hour day
      assert({ actual: differenceInCalendarDays(c, a), expected: 2 }) // 2 normal 24-hour days
    }

    // TEST DST END (FALL)

    // make sure that diffs across a "fall back" DST boundary won't report a full day
    // until 25 hours have elapsed.
    {
      const a = new Date(end.getTime() - HOUR / 2) // 1 hour before Standard Time starts
      const b = new Date(a.getTime() + 24 * HOUR + dstOffset - 15 * MINUTE) // 1 day later, 15 mins earlier local time
      const c = new Date(a.getTime() + 48 * HOUR + dstOffset - 15 * MINUTE) // 2 days later, 15 mins earlier local time

      assert({ actual: differenceInCalendarDays(c, b), expected: 1 }) // normal 24-hour day
      assert({ actual: differenceInCalendarDays(b, a), expected: 1 }) // 24.75 hours but 1 calendar days
      assert({ actual: differenceInCalendarDays(c, a), expected: 2 }) // 49.75 hours but 2 calendar days
    }
    // anchor to one hour before the boundary
    {
      const a = new Date(end.getTime() - HOUR) // 1 hour before Standard Time starts
      const b = new Date(a.getTime() + 24 * HOUR + dstOffset) // 1 day later, same local time
      const c = new Date(a.getTime() + 48 * HOUR + dstOffset) // 2 days later, same local time

      assert({ actual: sameTime(a, b), expected: true })
      assert({ actual: sameTime(a, c), expected: true })
      assert({ actual: sameTime(b, c), expected: true })
      assert({ actual: differenceInCalendarDays(c, b), expected: 1 }) // normal 24-hour day
      assert({ actual: differenceInCalendarDays(b, a), expected: 1 }) // 25 hours -> 1 day
      assert({ actual: differenceInCalendarDays(c, a), expected: 2 }) // 49 hours -> 2 days
    }
    // anchor to one hour after the boundary
    {
      const a = new Date(end.getTime() + HOUR) // 1 hour after Standard Time starts
      const b = new Date(a.getTime() + 24 * HOUR) // 1 day later, same local time
      const c = new Date(a.getTime() + 48 * HOUR) // 2 days later, same local time

      assert({ actual: sameTime(a, b), expected: true })
      assert({ actual: sameTime(a, c), expected: true })
      assert({ actual: sameTime(b, c), expected: true })
      assert({ actual: differenceInCalendarDays(c, b), expected: 1 }) // normal 24-hour day
      assert({ actual: differenceInCalendarDays(b, a), expected: 1 }) // normal 24-hour day
      assert({ actual: differenceInCalendarDays(c, a), expected: 2 }) // 2 normal 24-hour days
    }
    // anchor exactly at the boundary
    {
      const a = end // exactly when Standard Time starts
      const b = new Date(a.getTime() + 24 * HOUR) // 1 day later, same local time
      const c = new Date(a.getTime() + 48 * HOUR) // 2 days later, same local time
      assert({ actual: differenceInCalendarDays(b, a), expected: 1 }) // normal 24-hour day
      assert({ actual: differenceInCalendarDays(c, a), expected: 2 }) // 2 normal 24-hour days
    }
  },
)
