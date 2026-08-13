import PlainDate from '#shared/universal/dates/nbdt/PlainDate/mod.ts'
import { assert, test } from '#test'
import { matchesPattern, PatternMatcher } from './PatternMatcher.ts'

test('PatternMatcher - EVERY-DAY pattern', () => {
  const matcher = new PatternMatcher('EVERY-DAY')
  const fixtures = [new PlainDate(2025, 1, 15), new PlainDate(2025, 2, 28), new PlainDate(2025, 12, 31)]

  fixtures.forEach((date) => {
    assert({
      given: `EVERY-DAY pattern on ${date.toString()}`,
      should: 'match any date',
      actual: matcher.matches(date),
      expected: true,
    })
  })
})

test('PatternMatcher - EVERY-WEEKDAY pattern', () => {
  const matcher = new PatternMatcher('EVERY-WEEKDAY')
  const fixtures = [
    { date: new PlainDate(2025, 1, 13), day: 'Monday', expected: true },
    { date: new PlainDate(2025, 1, 14), day: 'Tuesday', expected: true },
    { date: new PlainDate(2025, 1, 15), day: 'Wednesday', expected: true },
    { date: new PlainDate(2025, 1, 16), day: 'Thursday', expected: true },
    { date: new PlainDate(2025, 1, 17), day: 'Friday', expected: true },
    { date: new PlainDate(2025, 1, 18), day: 'Saturday', expected: false },
    { date: new PlainDate(2025, 1, 19), day: 'Sunday', expected: false },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `EVERY-WEEKDAY pattern on ${fixture.day}`,
      should: fixture.expected ? 'match weekdays' : 'not match weekends',
      actual: matcher.matches(fixture.date),
      expected: fixture.expected,
    })
  })
})

test('PatternMatcher - EVERY-[DAY] specific day patterns', () => {
  const fixtures = [
    { pattern: 'EVERY-MON', date: new PlainDate(2025, 1, 13), expected: true },
    { pattern: 'EVERY-MON', date: new PlainDate(2025, 1, 14), expected: false },
    { pattern: 'EVERY-TUE', date: new PlainDate(2025, 1, 14), expected: true },
    { pattern: 'EVERY-WED', date: new PlainDate(2025, 1, 15), expected: true },
    { pattern: 'EVERY-THU', date: new PlainDate(2025, 1, 16), expected: true },
    { pattern: 'EVERY-FRI', date: new PlainDate(2025, 1, 17), expected: true },
    { pattern: 'EVERY-SAT', date: new PlainDate(2025, 1, 18), expected: true },
    { pattern: 'EVERY-SUN', date: new PlainDate(2025, 1, 19), expected: true },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `${fixture.pattern} on ${fixture.date.toString()}`,
      should: fixture.expected ? 'match' : 'not match',
      actual: matchesPattern(fixture.date, fixture.pattern),
      expected: fixture.expected,
    })
  })
})

test('PatternMatcher - MONTHLY-N fixed day patterns', () => {
  const fixtures = [
    { pattern: 'MONTHLY-1', date: new PlainDate(2025, 1, 1), expected: true },
    { pattern: 'MONTHLY-1', date: new PlainDate(2025, 2, 1), expected: true },
    { pattern: 'MONTHLY-1', date: new PlainDate(2025, 1, 2), expected: false },
    { pattern: 'MONTHLY-15', date: new PlainDate(2025, 1, 15), expected: true },
    { pattern: 'MONTHLY-15', date: new PlainDate(2025, 2, 15), expected: true },
    { pattern: 'MONTHLY-31', date: new PlainDate(2025, 1, 31), expected: true },
    { pattern: 'MONTHLY-31', date: new PlainDate(2025, 2, 28), expected: false }, // Feb has no 31st
    { pattern: 'MONTHLY-31', date: new PlainDate(2025, 3, 31), expected: true },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `${fixture.pattern} on ${fixture.date.toString()}`,
      should: fixture.expected ? 'match' : 'not match',
      actual: matchesPattern(fixture.date, fixture.pattern),
      expected: fixture.expected,
    })
  })
})

test('PatternMatcher - MONTHLY-LAST patterns', () => {
  const fixtures = [
    { pattern: 'MONTHLY-LAST', date: new PlainDate(2025, 1, 31), expected: true },
    { pattern: 'MONTHLY-LAST', date: new PlainDate(2025, 1, 30), expected: false },
    { pattern: 'MONTHLY-LAST', date: new PlainDate(2025, 2, 28), expected: true }, // Last day of Feb
    { pattern: 'MONTHLY-LAST', date: new PlainDate(2024, 2, 29), expected: true }, // Leap year
    { pattern: 'MONTHLY-LAST-1', date: new PlainDate(2025, 1, 30), expected: true }, // 2nd to last
    { pattern: 'MONTHLY-LAST-1', date: new PlainDate(2025, 1, 31), expected: false },
    { pattern: 'MONTHLY-LAST-2', date: new PlainDate(2025, 1, 29), expected: true }, // 3rd to last
    { pattern: 'MONTHLY-LAST-5', date: new PlainDate(2025, 1, 26), expected: true }, // 5 days before end
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `${fixture.pattern} on ${fixture.date.toString()}`,
      should: fixture.expected ? 'match' : 'not match',
      actual: matchesPattern(fixture.date, fixture.pattern),
      expected: fixture.expected,
    })
  })
})

test('PatternMatcher - MONTHLY ordinal day patterns', () => {
  // January 2025: starts on Wednesday
  // First Monday: Jan 6
  // Second Monday: Jan 13
  // Third Monday: Jan 20
  // Fourth Monday: Jan 27
  // No fifth Monday

  const fixtures = [
    { pattern: 'MONTHLY-FIRST-MON', date: new PlainDate(2025, 1, 6), expected: true },
    { pattern: 'MONTHLY-FIRST-MON', date: new PlainDate(2025, 1, 13), expected: false },
    { pattern: 'MONTHLY-SECOND-MON', date: new PlainDate(2025, 1, 13), expected: true },
    { pattern: 'MONTHLY-THIRD-MON', date: new PlainDate(2025, 1, 20), expected: true },
    { pattern: 'MONTHLY-FOURTH-MON', date: new PlainDate(2025, 1, 27), expected: true },
    { pattern: 'MONTHLY-LAST-MON', date: new PlainDate(2025, 1, 27), expected: true },
    { pattern: 'MONTHLY-FIRST-WED', date: new PlainDate(2025, 1, 1), expected: true },
    { pattern: 'MONTHLY-LAST-FRI', date: new PlainDate(2025, 1, 31), expected: true },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `${fixture.pattern} on ${fixture.date.toString()}`,
      should: fixture.expected ? 'match' : 'not match',
      actual: matchesPattern(fixture.date, fixture.pattern),
      expected: fixture.expected,
    })
  })
})

test('PatternMatcher - MONTHLY-LAST-WEEKEND pattern', () => {
  // January 2025: last weekend is Jan 25-26
  const fixtures = [
    { date: new PlainDate(2025, 1, 25), expected: true }, // Last Saturday
    { date: new PlainDate(2025, 1, 26), expected: true }, // Last Sunday
    { date: new PlainDate(2025, 1, 18), expected: false }, // Not last Saturday
    { date: new PlainDate(2025, 1, 19), expected: false }, // Not last Sunday
    { date: new PlainDate(2025, 1, 24), expected: false }, // Friday (not weekend)
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `MONTHLY-LAST-WEEKEND on ${fixture.date.toString()}`,
      should: fixture.expected ? 'match' : 'not match',
      actual: matchesPattern(fixture.date, 'MONTHLY-LAST-WEEKEND'),
      expected: fixture.expected,
    })
  })
})

test('PatternMatcher - QUARTERLY patterns', () => {
  const fixtures = [
    // Q1 2025: Jan 1 - Mar 31
    { pattern: 'QUARTERLY-1', date: new PlainDate(2025, 1, 1), expected: true },
    { pattern: 'QUARTERLY-1', date: new PlainDate(2025, 4, 1), expected: true }, // Q2
    { pattern: 'QUARTERLY-15', date: new PlainDate(2025, 1, 15), expected: true },
    { pattern: 'QUARTERLY-LAST', date: new PlainDate(2025, 3, 31), expected: true },
    { pattern: 'QUARTERLY-LAST', date: new PlainDate(2025, 6, 30), expected: true }, // Q2 end
    { pattern: 'QUARTERLY-LAST-1', date: new PlainDate(2025, 3, 30), expected: true },
    { pattern: 'QUARTERLY-LAST-5', date: new PlainDate(2025, 3, 26), expected: true },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `${fixture.pattern} on ${fixture.date.toString()}`,
      should: fixture.expected ? 'match' : 'not match',
      actual: matchesPattern(fixture.date, fixture.pattern),
      expected: fixture.expected,
    })
  })
})

test('PatternMatcher - QUARTERLY ordinal day patterns', () => {
  // Q1 2025: First Monday is Jan 6
  // Q1 2025: Last Friday is Mar 28
  const fixtures = [
    { pattern: 'QUARTERLY-FIRST-MON', date: new PlainDate(2025, 1, 6), expected: true },
    { pattern: 'QUARTERLY-FIRST-MON', date: new PlainDate(2025, 1, 13), expected: false },
    { pattern: 'QUARTERLY-LAST-FRI', date: new PlainDate(2025, 3, 28), expected: true },
    { pattern: 'QUARTERLY-LAST-FRI', date: new PlainDate(2025, 3, 21), expected: false },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `${fixture.pattern} on ${fixture.date.toString()}`,
      should: fixture.expected ? 'match' : 'not match',
      actual: matchesPattern(fixture.date, fixture.pattern),
      expected: fixture.expected,
    })
  })
})

test('PatternMatcher - ALTERNATE patterns', () => {
  // 2025: First Monday is Jan 6
  // ALTERNATE-MON occurs on: Jan 6, Jan 20, Feb 3, Feb 17, etc.
  const fixtures = [
    { pattern: 'ALTERNATE-MON', date: new PlainDate(2025, 1, 6), expected: true }, // First Monday
    { pattern: 'ALTERNATE-MON', date: new PlainDate(2025, 1, 13), expected: false }, // Second Monday (skipped)
    { pattern: 'ALTERNATE-MON', date: new PlainDate(2025, 1, 20), expected: true }, // Third Monday
    { pattern: 'ALTERNATE-MON', date: new PlainDate(2025, 1, 27), expected: false }, // Fourth Monday (skipped)
    { pattern: 'ALTERNATE-MON', date: new PlainDate(2025, 2, 3), expected: true }, // Fifth Monday overall
    { pattern: 'ALTERNATE-TUE', date: new PlainDate(2025, 1, 7), expected: true }, // First Tuesday
    { pattern: 'ALTERNATE-TUE', date: new PlainDate(2025, 1, 14), expected: false }, // Second Tuesday (skipped)
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `${fixture.pattern} on ${fixture.date.toString()}`,
      should: fixture.expected ? 'match' : 'not match',
      actual: matchesPattern(fixture.date, fixture.pattern),
      expected: fixture.expected,
    })
  })
})

test('PatternMatcher - EVERY-2-WEEKS-A patterns', () => {
  // 2025: First Monday is Jan 6
  // Week A (even weeks): Jan 6, Jan 20, Feb 3, Feb 17, etc.
  const fixtures = [
    { pattern: 'EVERY-2-WEEKS-A-MON', date: new PlainDate(2025, 1, 6), expected: true }, // First Monday (week 0)
    { pattern: 'EVERY-2-WEEKS-A-MON', date: new PlainDate(2025, 1, 13), expected: false }, // Second Monday (week 1)
    { pattern: 'EVERY-2-WEEKS-A-MON', date: new PlainDate(2025, 1, 20), expected: true }, // Third Monday (week 2)
    { pattern: 'EVERY-2-WEEKS-A-MON', date: new PlainDate(2025, 1, 27), expected: false }, // Fourth Monday (week 3)
    { pattern: 'EVERY-2-WEEKS-A-MON', date: new PlainDate(2025, 2, 3), expected: true }, // Fifth Monday (week 4)
    { pattern: 'EVERY-2-WEEKS-A-TUE', date: new PlainDate(2025, 1, 7), expected: true }, // First Tuesday
    { pattern: 'EVERY-2-WEEKS-A-TUE', date: new PlainDate(2025, 1, 14), expected: false }, // Second Tuesday
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `${fixture.pattern} on ${fixture.date.toString()}`,
      should: fixture.expected ? 'match Week A' : 'not match Week A',
      actual: matchesPattern(fixture.date, fixture.pattern),
      expected: fixture.expected,
    })
  })
})

test('PatternMatcher - EVERY-2-WEEKS-B patterns', () => {
  // 2025: First Monday is Jan 6
  // Week B (odd weeks): Jan 13, Jan 27, Feb 10, Feb 24, etc.
  const fixtures = [
    { pattern: 'EVERY-2-WEEKS-B-MON', date: new PlainDate(2025, 1, 6), expected: false }, // First Monday (week 0)
    { pattern: 'EVERY-2-WEEKS-B-MON', date: new PlainDate(2025, 1, 13), expected: true }, // Second Monday (week 1)
    { pattern: 'EVERY-2-WEEKS-B-MON', date: new PlainDate(2025, 1, 20), expected: false }, // Third Monday (week 2)
    { pattern: 'EVERY-2-WEEKS-B-MON', date: new PlainDate(2025, 1, 27), expected: true }, // Fourth Monday (week 3)
    { pattern: 'EVERY-2-WEEKS-B-MON', date: new PlainDate(2025, 2, 3), expected: false }, // Fifth Monday (week 4)
    { pattern: 'EVERY-2-WEEKS-B-TUE', date: new PlainDate(2025, 1, 7), expected: false }, // First Tuesday
    { pattern: 'EVERY-2-WEEKS-B-TUE', date: new PlainDate(2025, 1, 14), expected: true }, // Second Tuesday
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `${fixture.pattern} on ${fixture.date.toString()}`,
      should: fixture.expected ? 'match Week B' : 'not match Week B',
      actual: matchesPattern(fixture.date, fixture.pattern),
      expected: fixture.expected,
    })
  })
})

test('PatternMatcher - EVERY-2-WEEKS A and B are mutually exclusive', () => {
  // For any given Monday, exactly one of A or B should match
  const mondays = [
    new PlainDate(2025, 1, 6),
    new PlainDate(2025, 1, 13),
    new PlainDate(2025, 1, 20),
    new PlainDate(2025, 1, 27),
    new PlainDate(2025, 2, 3),
    new PlainDate(2025, 2, 10),
  ]

  mondays.forEach((date) => {
    const matchesA = matchesPattern(date, 'EVERY-2-WEEKS-A-MON')
    const matchesB = matchesPattern(date, 'EVERY-2-WEEKS-B-MON')

    assert({
      given: `Monday ${date.toString()}`,
      should: 'match exactly one of A or B (XOR)',
      actual: matchesA !== matchesB, // Exactly one is true
      expected: true,
    })
  })
})

test('PatternMatcher - EVERY-OTHER-DAY-A patterns', () => {
  // Epoch: Jan 1, 2024 = Day A (day 0)
  // Day A = even days from epoch (0, 2, 4...)
  const fixtures = [
    { date: new PlainDate(2024, 1, 1), expected: true }, // Day 0 (epoch)
    { date: new PlainDate(2024, 1, 2), expected: false }, // Day 1
    { date: new PlainDate(2024, 1, 3), expected: true }, // Day 2
    { date: new PlainDate(2024, 1, 4), expected: false }, // Day 3
    { date: new PlainDate(2024, 1, 5), expected: true }, // Day 4
    // 2024 is a leap year (366 days), so Jan 1, 2025 is day 366 (even)
    { date: new PlainDate(2025, 1, 1), expected: true }, // Day 366
    { date: new PlainDate(2025, 1, 2), expected: false }, // Day 367
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `EVERY-OTHER-DAY-A on ${fixture.date.toString()}`,
      should: fixture.expected ? 'match Day A' : 'not match Day A',
      actual: matchesPattern(fixture.date, 'EVERY-OTHER-DAY-A'),
      expected: fixture.expected,
    })
  })
})

test('PatternMatcher - EVERY-OTHER-DAY-B patterns', () => {
  // Epoch: Jan 1, 2024 = Day A (day 0)
  // Day B = odd days from epoch (1, 3, 5...)
  const fixtures = [
    { date: new PlainDate(2024, 1, 1), expected: false }, // Day 0 (epoch)
    { date: new PlainDate(2024, 1, 2), expected: true }, // Day 1
    { date: new PlainDate(2024, 1, 3), expected: false }, // Day 2
    { date: new PlainDate(2024, 1, 4), expected: true }, // Day 3
    { date: new PlainDate(2024, 1, 5), expected: false }, // Day 4
    // 2024 is a leap year (366 days), so Jan 1, 2025 is day 366 (even)
    { date: new PlainDate(2025, 1, 1), expected: false }, // Day 366
    { date: new PlainDate(2025, 1, 2), expected: true }, // Day 367
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `EVERY-OTHER-DAY-B on ${fixture.date.toString()}`,
      should: fixture.expected ? 'match Day B' : 'not match Day B',
      actual: matchesPattern(fixture.date, 'EVERY-OTHER-DAY-B'),
      expected: fixture.expected,
    })
  })
})

test('PatternMatcher - EVERY-OTHER-DAY A and B are mutually exclusive', () => {
  // For any given day, exactly one of A or B should match
  const dates = [
    new PlainDate(2024, 1, 1),
    new PlainDate(2024, 1, 2),
    new PlainDate(2024, 2, 29), // Leap day
    new PlainDate(2025, 1, 1),
    new PlainDate(2025, 6, 15),
    new PlainDate(2025, 12, 31),
  ]

  dates.forEach((date) => {
    const matchesA = matchesPattern(date, 'EVERY-OTHER-DAY-A')
    const matchesB = matchesPattern(date, 'EVERY-OTHER-DAY-B')

    assert({
      given: `date ${date.toString()}`,
      should: 'match exactly one of A or B (XOR)',
      actual: matchesA !== matchesB, // Exactly one is true
      expected: true,
    })
  })
})

test('PatternMatcher - ALTERNATE is equivalent to EVERY-2-WEEKS-A', () => {
  // ALTERNATE-MON should behave identically to EVERY-2-WEEKS-A-MON
  const mondays = [
    new PlainDate(2025, 1, 6),
    new PlainDate(2025, 1, 13),
    new PlainDate(2025, 1, 20),
    new PlainDate(2025, 1, 27),
    new PlainDate(2025, 2, 3),
  ]

  mondays.forEach((date) => {
    const alternateResult = matchesPattern(date, 'ALTERNATE-MON')
    const everyTwoWeeksAResult = matchesPattern(date, 'EVERY-2-WEEKS-A-MON')

    assert({
      given: `Monday ${date.toString()}`,
      should: 'have ALTERNATE-MON equal to EVERY-2-WEEKS-A-MON',
      actual: alternateResult,
      expected: everyTwoWeeksAResult,
    })
  })
})

test('PatternMatcher - Case insensitivity', () => {
  const fixtures = [
    { pattern: 'every-day', date: new PlainDate(2025, 1, 15), expected: true },
    { pattern: 'Every-Day', date: new PlainDate(2025, 1, 15), expected: true },
    { pattern: 'EVERY-DAY', date: new PlainDate(2025, 1, 15), expected: true },
    { pattern: 'monthly-last', date: new PlainDate(2025, 1, 31), expected: true },
    { pattern: 'Monthly-Last', date: new PlainDate(2025, 1, 31), expected: true },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `${fixture.pattern} (mixed case)`,
      should: 'be case insensitive',
      actual: matchesPattern(fixture.date, fixture.pattern),
      expected: fixture.expected,
    })
  })
})

test('PatternMatcher - QUARTERLY-MONTH-BEFORE patterns (pre-quarter months)', () => {
  // Pre-quarter months: Dec (before Q1), Mar (before Q2), Jun (before Q3), Sep (before Q4)
  // These patterns should ONLY match in Dec, Mar, Jun, Sep

  const fixtures = [
    // QUARTERLY-MONTH-BEFORE-1: First day of pre-quarter month
    { pattern: 'QUARTERLY-MONTH-BEFORE-1', date: new PlainDate(2025, 12, 1), expected: true }, // Dec
    { pattern: 'QUARTERLY-MONTH-BEFORE-1', date: new PlainDate(2025, 3, 1), expected: true }, // Mar
    { pattern: 'QUARTERLY-MONTH-BEFORE-1', date: new PlainDate(2025, 6, 1), expected: true }, // Jun
    { pattern: 'QUARTERLY-MONTH-BEFORE-1', date: new PlainDate(2025, 9, 1), expected: true }, // Sep
    { pattern: 'QUARTERLY-MONTH-BEFORE-1', date: new PlainDate(2025, 1, 1), expected: false }, // Jan - not pre-quarter
    { pattern: 'QUARTERLY-MONTH-BEFORE-1', date: new PlainDate(2025, 4, 1), expected: false }, // Apr - not pre-quarter
    { pattern: 'QUARTERLY-MONTH-BEFORE-1', date: new PlainDate(2025, 7, 1), expected: false }, // Jul - not pre-quarter
    { pattern: 'QUARTERLY-MONTH-BEFORE-1', date: new PlainDate(2025, 10, 1), expected: false }, // Oct - not pre-quarter

    // QUARTERLY-MONTH-BEFORE-15: 15th of pre-quarter month
    { pattern: 'QUARTERLY-MONTH-BEFORE-15', date: new PlainDate(2025, 12, 15), expected: true },
    { pattern: 'QUARTERLY-MONTH-BEFORE-15', date: new PlainDate(2025, 3, 15), expected: true },
    { pattern: 'QUARTERLY-MONTH-BEFORE-15', date: new PlainDate(2025, 6, 15), expected: true },
    { pattern: 'QUARTERLY-MONTH-BEFORE-15', date: new PlainDate(2025, 9, 15), expected: true },
    { pattern: 'QUARTERLY-MONTH-BEFORE-15', date: new PlainDate(2025, 1, 15), expected: false }, // Not pre-quarter

    // QUARTERLY-MONTH-BEFORE-LAST: Last day of pre-quarter month
    { pattern: 'QUARTERLY-MONTH-BEFORE-LAST', date: new PlainDate(2025, 12, 31), expected: true }, // Dec 31
    { pattern: 'QUARTERLY-MONTH-BEFORE-LAST', date: new PlainDate(2025, 3, 31), expected: true }, // Mar 31
    { pattern: 'QUARTERLY-MONTH-BEFORE-LAST', date: new PlainDate(2025, 6, 30), expected: true }, // Jun 30
    { pattern: 'QUARTERLY-MONTH-BEFORE-LAST', date: new PlainDate(2025, 9, 30), expected: true }, // Sep 30
    { pattern: 'QUARTERLY-MONTH-BEFORE-LAST', date: new PlainDate(2025, 12, 30), expected: false }, // Not last day
    { pattern: 'QUARTERLY-MONTH-BEFORE-LAST', date: new PlainDate(2025, 1, 31), expected: false }, // Not pre-quarter
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `${fixture.pattern} on ${fixture.date.toString()}`,
      should: fixture.expected ? 'match' : 'not match',
      actual: matchesPattern(fixture.date, fixture.pattern),
      expected: fixture.expected,
    })
  })
})

test('PatternMatcher - QUARTERLY-MONTH-BEFORE ordinal day patterns', () => {
  // December 2025: starts on Monday
  // First Wednesday: Dec 3
  // Third Wednesday: Dec 17
  // Last Friday: Dec 26

  // March 2026: starts on Sunday
  // First Wednesday: Mar 4
  // Third Wednesday: Mar 18
  // Last Friday: Mar 27

  const fixtures = [
    // QUARTERLY-MONTH-BEFORE-FIRST-WED
    { pattern: 'QUARTERLY-MONTH-BEFORE-FIRST-WED', date: new PlainDate(2025, 12, 3), expected: true }, // First Wed of Dec
    { pattern: 'QUARTERLY-MONTH-BEFORE-FIRST-WED', date: new PlainDate(2025, 12, 10), expected: false }, // Second Wed of Dec
    { pattern: 'QUARTERLY-MONTH-BEFORE-FIRST-WED', date: new PlainDate(2025, 1, 1), expected: false }, // Not pre-quarter month

    // QUARTERLY-MONTH-BEFORE-THIRD-WED
    { pattern: 'QUARTERLY-MONTH-BEFORE-THIRD-WED', date: new PlainDate(2025, 12, 17), expected: true }, // Third Wed of Dec
    { pattern: 'QUARTERLY-MONTH-BEFORE-THIRD-WED', date: new PlainDate(2025, 12, 10), expected: false }, // Second Wed of Dec
    { pattern: 'QUARTERLY-MONTH-BEFORE-THIRD-WED', date: new PlainDate(2026, 3, 18), expected: true }, // Third Wed of Mar 2026

    // QUARTERLY-MONTH-BEFORE-LAST-FRI
    { pattern: 'QUARTERLY-MONTH-BEFORE-LAST-FRI', date: new PlainDate(2025, 12, 26), expected: true }, // Last Fri of Dec
    { pattern: 'QUARTERLY-MONTH-BEFORE-LAST-FRI', date: new PlainDate(2025, 12, 19), expected: false }, // Not last Fri
    { pattern: 'QUARTERLY-MONTH-BEFORE-LAST-FRI', date: new PlainDate(2026, 3, 27), expected: true }, // Last Fri of Mar 2026

    // June 2025: First Wed is June 4, Third Wed is June 18, Last Fri is June 27
    { pattern: 'QUARTERLY-MONTH-BEFORE-FIRST-WED', date: new PlainDate(2025, 6, 4), expected: true },
    { pattern: 'QUARTERLY-MONTH-BEFORE-THIRD-WED', date: new PlainDate(2025, 6, 18), expected: true },
    { pattern: 'QUARTERLY-MONTH-BEFORE-LAST-FRI', date: new PlainDate(2025, 6, 27), expected: true },

    // September 2025: First Wed is Sep 3, Third Wed is Sep 17, Last Fri is Sep 26
    { pattern: 'QUARTERLY-MONTH-BEFORE-FIRST-WED', date: new PlainDate(2025, 9, 3), expected: true },
    { pattern: 'QUARTERLY-MONTH-BEFORE-THIRD-WED', date: new PlainDate(2025, 9, 17), expected: true },
    { pattern: 'QUARTERLY-MONTH-BEFORE-LAST-FRI', date: new PlainDate(2025, 9, 26), expected: true },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `${fixture.pattern} on ${fixture.date.toString()}`,
      should: fixture.expected ? 'match' : 'not match',
      actual: matchesPattern(fixture.date, fixture.pattern),
      expected: fixture.expected,
    })
  })
})

test('PatternMatcher - QUARTERLY-MONTH-BEFORE only matches in pre-quarter months', () => {
  // Test that QUARTERLY-MONTH-BEFORE patterns never match outside Dec, Mar, Jun, Sep
  const nonPreQuarterMonths = [1, 2, 4, 5, 7, 8, 10, 11] // Jan, Feb, Apr, May, Jul, Aug, Oct, Nov

  nonPreQuarterMonths.forEach((month) => {
    const date = new PlainDate(2025, month, 15)

    assert({
      given: `QUARTERLY-MONTH-BEFORE-15 on month ${month}`,
      should: 'not match (not a pre-quarter month)',
      actual: matchesPattern(date, 'QUARTERLY-MONTH-BEFORE-15'),
      expected: false,
    })
  })
})

test('PatternMatcher - EVERY-2-WEEKS alternation survives year boundaries', () => {
  // Regression: the anchor used to reset to the first occurrence of the
  // weekday in each calendar year. 2026 holds 53 Thursdays, so the reset made
  // 2026-12-31 and 2027-01-07 — consecutive Thursdays — both Week A.
  const fixtures = [
    { pattern: 'EVERY-2-WEEKS-A-THU', date: new PlainDate(2026, 12, 31), expected: true }, // week 52
    { pattern: 'EVERY-2-WEEKS-A-THU', date: new PlainDate(2027, 1, 7), expected: false }, // week 53
    { pattern: 'EVERY-2-WEEKS-B-THU', date: new PlainDate(2027, 1, 7), expected: true },
    { pattern: 'EVERY-2-WEEKS-A-THU', date: new PlainDate(2027, 1, 14), expected: true }, // week 54
    // ALTERNATE-* aliases share the helper, so they inherit the fix
    { pattern: 'ALTERNATE-THU', date: new PlainDate(2026, 12, 31), expected: true },
    { pattern: 'ALTERNATE-THU', date: new PlainDate(2027, 1, 7), expected: false },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `${fixture.pattern} on ${fixture.date.toString()}`,
      should: fixture.expected ? 'match' : 'not match',
      actual: matchesPattern(fixture.date, fixture.pattern),
      expected: fixture.expected,
    })
  })
})

test('PatternMatcher - EVERY-2-WEEKS never repeats a phase on consecutive weeks', () => {
  // Walk every Thursday for four years across three year boundaries: phase has
  // to alternate on every single step, with no seam at New Year.
  let date = new PlainDate(2026, 1, 1) // a Thursday
  let previous = matchesPattern(date, 'EVERY-2-WEEKS-A-THU')
  let alternates = true

  for (let week = 0; week < 208; week++) {
    date = date.addDays(7)
    const current = matchesPattern(date, 'EVERY-2-WEEKS-A-THU')
    if (current === previous) alternates = false
    previous = current
  }

  assert({
    given: '208 consecutive Thursdays from 2026-01-01',
    should: 'flip Week A on/off every week without a year-boundary seam',
    actual: alternates,
    expected: true,
  })
})

test('PatternMatcher - EVERY-2-WEEKS keeps the phase existing items were calibrated to', () => {
  // The epoch was chosen to preserve the year-relative behavior for 2026, so
  // these are the assignments in use before the anchor was fixed.
  const fixtures = [
    { pattern: 'EVERY-2-WEEKS-A-THU', date: new PlainDate(2026, 1, 1), expected: true }, // first Thu of 2026
    { pattern: 'EVERY-2-WEEKS-A-THU', date: new PlainDate(2026, 1, 8), expected: false },
    { pattern: 'EVERY-2-WEEKS-A-THU', date: new PlainDate(2026, 1, 15), expected: true },
    { pattern: 'EVERY-2-WEEKS-A-WED', date: new PlainDate(2026, 1, 7), expected: true }, // first Wed of 2026
    { pattern: 'EVERY-2-WEEKS-A-WED', date: new PlainDate(2026, 1, 14), expected: false },
    { pattern: 'EVERY-2-WEEKS-A-MON', date: new PlainDate(2026, 1, 5), expected: true }, // first Mon of 2026
    { pattern: 'EVERY-2-WEEKS-A-SUN', date: new PlainDate(2026, 1, 4), expected: true }, // first Sun of 2026
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `${fixture.pattern} on ${fixture.date.toString()}`,
      should: fixture.expected ? 'match' : 'not match',
      actual: matchesPattern(fixture.date, fixture.pattern),
      expected: fixture.expected,
    })
  })
})

test('PatternMatcher - parity patterns are stable across DST transitions', () => {
  // Regression: daysBetween used to floor local-midnight ms diffs, which run
  // an hour short after spring-forward and flipped A/B parity all summer.
  // Force a DST timezone so this stays meaningful on hosts running UTC.
  const originalTz = process.env.TZ
  process.env.TZ = 'America/New_York' // spring-forward 2025-03-09, fall-back 2025-11-02

  try {
    const fixtures = [
      // EVERY-OTHER-DAY: epoch Jan 1 2024, so 2025-03-08 is day 432 (even = A).
      // Midnight on a transition day is still the old offset; the shift bites
      // from the following day, which is where the old floor lost a day.
      { pattern: 'EVERY-OTHER-DAY-A', date: new PlainDate(2025, 3, 8), expected: true },
      { pattern: 'EVERY-OTHER-DAY-B', date: new PlainDate(2025, 3, 9), expected: true }, // transition day, 433
      { pattern: 'EVERY-OTHER-DAY-A', date: new PlainDate(2025, 3, 10), expected: true }, // 434, first DST day
      { pattern: 'EVERY-OTHER-DAY-B', date: new PlainDate(2025, 3, 10), expected: false },
      { pattern: 'EVERY-OTHER-DAY-B', date: new PlainDate(2025, 3, 11), expected: true }, // 435
      // ...and across fall-back
      { pattern: 'EVERY-OTHER-DAY-B', date: new PlainDate(2025, 11, 2), expected: true }, // 671
      { pattern: 'EVERY-OTHER-DAY-A', date: new PlainDate(2025, 11, 3), expected: true }, // 672

      // EVERY-2-WEEKS: 2025 anchor is Mon Jan 6 (week 0 = A); Mar 3 = week 8 (A),
      // Mar 10 = week 9 (B) — the first Monday after the clock change
      { pattern: 'EVERY-2-WEEKS-A-MON', date: new PlainDate(2025, 3, 3), expected: true },
      { pattern: 'EVERY-2-WEEKS-B-MON', date: new PlainDate(2025, 3, 10), expected: true },
      { pattern: 'EVERY-2-WEEKS-A-MON', date: new PlainDate(2025, 3, 10), expected: false },
      { pattern: 'EVERY-2-WEEKS-A-MON', date: new PlainDate(2025, 3, 17), expected: true }, // week 10

      // QUARTERLY-N counts days across the shift: Mar 31 2025 is Q1 day 90
      { pattern: 'QUARTERLY-90', date: new PlainDate(2025, 3, 31), expected: true },
      { pattern: 'QUARTERLY-90', date: new PlainDate(2025, 3, 30), expected: false },
    ]

    fixtures.forEach((fixture) => {
      assert({
        given: `${fixture.pattern} on ${fixture.date.toString()} in a DST timezone`,
        should: fixture.expected ? 'match' : 'not match',
        actual: matchesPattern(fixture.date, fixture.pattern),
        expected: fixture.expected,
      })
    })
  } finally {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  }
})

test('PatternMatcher - in-family typos are rejected up front', () => {
  // Each date is one the correctly-spelled pattern would match, so a pass
  // here proves rejection happens by validation, not by accident.
  const fixtures = [
    { pattern: 'EVERY-MONDAY', date: new PlainDate(2026, 1, 5), expected: false }, // a Monday
    { pattern: 'MONTHLY-FIRST-MONDAY', date: new PlainDate(2026, 1, 5), expected: false }, // first Monday
    { pattern: 'EVERY-WEEKDAYS', date: new PlainDate(2026, 1, 5), expected: false },
    { pattern: 'MONTHLY-45', date: new PlainDate(2026, 1, 15), expected: false },
    // A valid pattern the static list used to omit flows through the gate
    { pattern: 'QUARTERLY-FIRST-SUN', date: new PlainDate(2026, 1, 4), expected: true }, // first Sunday of Q1
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: `${fixture.pattern} on ${fixture.date.toString()}`,
      should: fixture.expected ? 'match' : 'not match',
      actual: matchesPattern(fixture.date, fixture.pattern),
      expected: fixture.expected,
    })
  })
})

test('PatternMatcher - invalid patterns warn once per pattern, not per date', () => {
  const warnings: string[] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(' '))
  }

  try {
    // Unique tokens: the once-per-process dedupe means reusing a pattern from
    // another test would swallow the warning this test is counting.
    let date = new PlainDate(2026, 1, 1)
    for (let d = 0; d < 60; d++) {
      matchesPattern(date, 'EVERY-BOGUS-X')
      matchesPattern(date, 'MONTHLY-BOGUS-Y')
      date = date.addDays(1)
    }

    assert({
      given: '60 checks each of two invalid patterns',
      should: 'warn exactly once per distinct pattern',
      actual: [
        warnings.filter((w) => w.includes('EVERY-BOGUS-X')).length,
        warnings.filter((w) => w.includes('MONTHLY-BOGUS-Y')).length,
      ],
      expected: [1, 1],
    })
  } finally {
    console.warn = originalWarn
  }
})

test('PatternMatcher - Invalid patterns', () => {
  const invalidPatterns = [
    'INVALID',
    'MONTHLY-32',
    'EVERY-INVALID',
    'RANDOM-PATTERN',
    'QUARTERLY-FIFTH-MON', // No FIFTH ordinal
  ]

  const testDate = new PlainDate(2025, 1, 15)

  invalidPatterns.forEach((pattern) => {
    assert({
      given: `invalid pattern "${pattern}"`,
      should: 'return false',
      actual: matchesPattern(testDate, pattern),
      expected: false,
    })
  })
})
