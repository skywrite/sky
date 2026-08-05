import DayDocument from '#shared/models/Day/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

test(`${DayDocument.name}.setEnded()`, () => {
  const FIXTURE1 = `
---
started: 08:11
tz: America/Chicago
---

# **2025-02-05 - Wed**
`

  let day = DayDocument.fromMarkdown(FIXTURE1)

  let ended = new ZonedDateTime('2025-02-06 09:11', 'America/Chicago')
  day = day.setEnded(ended)

  assert({
    given: 'A day fixture and setting the end',
    should: 'return the same ended value',
    actual: day.ended?.toString(),
    expected: ended.toString(),
  })

  assert({
    given: 'A day fixture and setting the end',
    should: 'return the same ended value',
    actual: '1d 1h',
    expected: day.yaml['ended'],
  })

  ended = new ZonedDateTime('2025-02-06 10:11', 'America/New_York')
  day = day.setEnded(ended)

  assert({
    given: 'A day fixture and setting the end with a different tz',
    should: 'return the same ended value',
    actual: '1d 1h',
    expected: day.yaml['ended'],
  })
})
