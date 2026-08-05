import DayDocument from '#shared/models/Day/mod.ts'
import { assert, test } from '#test'

test(`${DayDocument.name}.started`, () => {
  const FIXTURE1 = `
---
started: 08:11
---

# **2025-02-05 - Wed**
`

  const day = DayDocument.fromMarkdown(FIXTURE1)

  assert({
    given: 'A day fixture',
    should: 'return the started value',
    actual: day.started?.date,
    expected: '2025-02-05',
  })

  assert({
    given: 'A day fixture',
    should: 'return the started value',
    actual: day.started?.time,
    expected: '08:11',
  })
})

test(`${DayDocument.name}.started`, () => {
  const FIXTURE1 = `
---
---

# **2025-02-05 - Wed**
`

  const day = DayDocument.fromMarkdown(FIXTURE1)

  assert({
    given: 'A day fixture without started',
    should: 'return undefined',
    actual: day.started,
    expected: undefined,
  })
})

test(`${DayDocument.name}.started`, () => {
  const FIXTURE1 = `
---
started: 11:20
---

# **2025-02-05 - Wed**
`

  const day = DayDocument.fromMarkdown(FIXTURE1)

  assert({
    // yaml 1.1 would make 11:20 be the time in minutes
    given: 'A day fixture with a number old yaml parsers will fuckup to a number',
    should: 'return the started value',
    actual: day.started?.time,
    expected: '11:20',
  })
})
