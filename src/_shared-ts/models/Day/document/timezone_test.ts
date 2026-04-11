import { assert, test } from '#test'
import readTextFileSync from '#shared/fs/readTextFileSync.ts'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import Day from './mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'markdown', '_fixtures')

test('Day.timezone - returns IANA timezone when set', () => {
  const fixture = readTextFileSync(path.join(FIXTURES_DIR, 'day-with-timezone.md'))
  const day = Day.fromMarkdown(fixture)

  assert({
    given: 'a day with tz set to Asia/Hong_Kong',
    should: 'return Asia/Hong_Kong',
    actual: day.timezone,
    expected: 'Asia/Hong_Kong',
  })
})

test('Day.timezone - returns default when timezone not set', () => {
  const fixture = readTextFileSync(path.join(FIXTURES_DIR, 'day-without-timezone.md'))
  const day = Day.fromMarkdown(fixture)

  assert({
    given: 'a day without tz in YAML',
    should: 'return default timezone America/Chicago',
    actual: day.timezone,
    expected: 'America/Chicago',
  })
})

test('Day.timezone - returns default with empty YAML', () => {
  const fixture = readTextFileSync(path.join(FIXTURES_DIR, 'day-empty-yaml.md'))
  const day = Day.fromMarkdown(fixture)

  assert({
    given: 'a day with empty YAML header',
    should: 'return default timezone America/Chicago',
    actual: day.timezone,
    expected: 'America/Chicago',
  })
})

test('Day.timezone - handles no YAML header', () => {
  const markdown = `# **2024-03-15 - Fri**

## Personal Complete

- Did something`

  const day = Day.fromMarkdown(markdown)

  assert({
    given: 'a day with no YAML header at all',
    should: 'return default timezone America/Chicago',
    actual: day.timezone,
    expected: 'America/Chicago',
  })
})

test('Day.timezone - timezone persists through updates', () => {
  const fixture = readTextFileSync(path.join(FIXTURES_DIR, 'day-with-timezone.md'))
  let day = Day.fromMarkdown(fixture)

  // Make some other update to the day
  day = day.updateYaml({ ended: '8h 30m' })

  assert({
    given: 'a day with timezone that gets other YAML updates',
    should: 'preserve the timezone',
    actual: day.timezone,
    expected: 'Asia/Hong_Kong',
  })
})

test('Day.setTimezone - updates tz field', () => {
  const day = new Day({
    day: PlainDate.from('2024-03-15'),
    yaml: { tz: 'America/Chicago' },
  })

  const updatedDay = day.setTimezone('Europe/London')

  assert({
    given: 'a day with Chicago timezone',
    should: 'update to London timezone',
    actual: updatedDay.timezone,
    expected: 'Europe/London',
  })
})

test('Day.setTimezone - returns new instance', () => {
  const day = new Day({
    day: PlainDate.from('2024-03-15'),
    yaml: { tz: 'America/Chicago' },
  })

  const updatedDay = day.setTimezone('Europe/London')

  assert({
    given: 'setTimezone called on a day',
    should: 'return a different instance',
    actual: day !== updatedDay,
    expected: true,
  })

  assert({
    given: 'original day',
    should: 'remain unchanged',
    actual: day.timezone,
    expected: 'America/Chicago',
  })
})
