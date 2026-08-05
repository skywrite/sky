import DayDocument from '#shared/models/Day/mod.ts'
import { assert, test } from '#test'

test(`${DayDocument.name}.ended`, () => {
  const FIXTURE1 = `
---
started: 08:11
ended: 23h
tz: America/Chicago
---

# **2025-02-05 - Wed**
`

  const day = DayDocument.fromMarkdown(FIXTURE1)

  assert({
    given: 'A day fixture',
    should: 'return the ended value',
    actual: day.ended?.toString(),
    expected: '2025-02-06 07:11 America/Chicago',
  })
})

test(`${DayDocument.name}.ended`, () => {
  const FIXTURE1 = `
---
started: 08:11
---

# **2025-02-05 - Wed**
`

  const day = DayDocument.fromMarkdown(FIXTURE1)

  assert({
    given: 'A day fixture without ended field',
    should: 'return undefined',
    actual: day.ended,
    expected: undefined,
  })
})

test(`${DayDocument.name}.ended`, () => {
  const FIXTURE1 = `
---
ended: 25h
---

# **2025-02-05 - Wed**
`

  const day = DayDocument.fromMarkdown(FIXTURE1)

  assert({
    given: 'A day fixture without started field',
    should: 'return undefined',
    actual: day.ended,
    expected: undefined,
  })
})
