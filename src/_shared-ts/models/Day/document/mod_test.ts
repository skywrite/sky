import { assert, test } from '#test'
import DayDocument from '#shared/models/Day/mod.ts'
import { PlainDate, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'

test('DayDocument.fromMarkdown - parses YAML with day data', () => {
  const markdown = `---
started: 09:00
ended: 5h 30m
tags: work; productive
perfect: true
---

# **2025-07-31 - Thu**

## Tasks Complete
- [x] Write tests
- [x] Review code`

  const day = DayDocument.fromMarkdown(markdown)

  assert({ actual: typeof day.yaml.started, expected: 'string' })
  assert({ actual: day.yaml.started, expected: '09:00' })
  assert({ actual: day.yaml.ended, expected: '5h 30m' })
  assert({ actual: day.yaml.tags, expected: 'work; productive' })
  assert({ actual: day.yaml.perfect, expected: true })
})

test('Day - extracts day from markdown title', () => {
  const markdown = `---
started: 08:30
---

# **2025-07-15 - Mon**

Daily notes here.`

  const day = DayDocument.fromMarkdown(markdown)

  assert({
    given: 'a day document',
    should: 'have a PlainDate day property',
    actual: day.day instanceof PlainDate,
    expected: true,
  })
  assert({ actual: day.YMD, expected: '2025-07-15' })
  // July 15, 2025 is actually a Tuesday
  assert({ actual: day.dayWordShort, expected: 'Tue' })
})

test('Day - started property returns DateTime', () => {
  const markdown = `---
started: 09:30
---

# **2025-07-31 - Thu**`

  const day = DayDocument.fromMarkdown(markdown)
  const started = day.started

  assert({
    given: 'a day with started time',
    should: 'return a ZonedDateTime',
    actual: started instanceof ZonedDateTime,
    expected: true,
  })
  assert({ actual: started?.time, expected: '09:30' })
})

test('Day - ended property calculates from duration', () => {
  const markdown = `---
started: 09:00
ended: 8h
---

# **2025-07-31 - Thu**`

  const day = DayDocument.fromMarkdown(markdown)
  const ended = day.ended

  assert({
    given: 'a day with ended duration',
    should: 'return a ZonedDateTime',
    actual: ended instanceof ZonedDateTime,
    expected: true,
  })
  // Started at 09:00, worked 8 hours, should end at 17:00
  assert({ actual: ended?.time, expected: '17:00' })
})

test('DayDocument.constructor - creates from PlainDate', () => {
  const day = new DayDocument({ day: PlainDate.from('2025-07-31') })

  assert({ actual: day.YMD, expected: '2025-07-31' })
  assert({ actual: day.markdown.includes('# **2025-07-31 - Thu**'), expected: true })
})

test('DayDocument.constructor - creates from YAML object', () => {
  const yamlObj = {
    started: '10:00',
    tags: 'meeting; planning',
    notes: 'Important day',
  }

  const day = new DayDocument({ yaml: yamlObj, day: PlainDate.from('2025-07-31') })

  assert({ actual: day.yaml.started, expected: '10:00' })
  assert({ actual: day.yaml.tags, expected: 'meeting; planning' })
  assert({ actual: day.yaml.notes, expected: 'Important day' })
})

test('DayDocument.setStarted - updates YAML', () => {
  const day = new DayDocument({ day: PlainDate.from('2025-07-31') })
  const when = new PlainDateTime('09:15', '2025-07-31')

  const updated = day.setStarted(when)

  assert({ actual: updated.yaml.started, expected: '09:15' })
})

test('DayDocument.setEnded - calculates duration', () => {
  const markdown = `---
started: 09:00
tz: America/Chicago
---

# **2025-07-31 - Thu**`

  const day = DayDocument.fromMarkdown(markdown)
  const endTime = new ZonedDateTime(new PlainDateTime('17:30', '2025-07-31'), 'America/Chicago')

  const updated = day.setEnded(endTime)

  // Check the actual format returned by hoursToDurationString
  assert({ actual: updated.yaml.ended, expected: '8.5h' })
})

test('Day - tags property returns TagSet', () => {
  const markdown = `---
tags: work; coding; testing
---

# **2025-07-31 - Thu**`

  const day = DayDocument.fromMarkdown(markdown)
  const tags = day.tags

  assert({
    given: 'a day with tags',
    should: 'return a TagSet instance',
    actual: tags instanceof TagSet,
    expected: true,
  })
  assert({ actual: tags.has('work'), expected: true })
  assert({ actual: tags.has('coding'), expected: true })
  assert({ actual: tags.has('testing'), expected: true })
})

// Skipping perfect property test as requested
