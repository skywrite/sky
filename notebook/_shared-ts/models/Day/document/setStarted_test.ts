import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'

test(`${DayDocument.name}.setStarted()`, () => {
  const FIXTURE1 = `
---
started: 08:11
---

# **2025-02-05 - Wed**
`

  let day = DayDocument.fromMarkdown(FIXTURE1)

  assert({
    given: 'A day fixture',
    should: 'return the started value',
    actual: day.started?.time,
    expected: '08:11',
  })

  day = day.setStarted(new PlainDateTime('10:10', day.YMD))

  assert({
    given: 'A day fixture',
    should: 'return the started value',
    actual: day.started?.time,
    expected: '10:10',
  })
})

test(`${DayDocument.name}.setStarted()`, () => {
  const FIXTURE1 = `
---
---

# **2025-02-05 - Wed**
`

  let day = DayDocument.fromMarkdown(FIXTURE1)

  day = day.setStarted()

  const now = new PlainDateTime()

  assert({
    given: 'A day fixture',
    should: 'return the started value',
    actual: day.started?.time,
    expected: now.time,
  })
})
