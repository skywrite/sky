import { assert, test } from '#test'
import { Week } from '#universal/dates/nbdt/mod.ts'
import { parsePriorities, renderWeekMarkdown } from './weekMarkdown.ts'

const LAST_WEEK = `---
created: 2026-08-05
updated: 2026-08-05
summary: Week plan for 2026-W33
---

# 2026-W33

## Priorities

1. Ship the atlas migration
   - WHY: unblocks everything downstream
2. Health

## Goals

### Professional

- Unfinished thing
  - WHY: because reasons

### Personal

- ~~Weight trend~~
`

test('parsePriorities - stack and why sub-bullets come through verbatim', () => {
  const priorities = parsePriorities(LAST_WEEK)

  assert({
    given: 'a previous week.md',
    should: 'return the priorities in order',
    actual: priorities.map((p) => p.text).join(' | '),
    expected: 'Ship the atlas migration | Health',
  })
  assert({
    given: 'a priority with a why sub-bullet and one without',
    should: 'attach the why only where it exists',
    actual: `${priorities[0].why.join('')} / ${priorities[1].why.length}`,
    expected: '- WHY: unblocks everything downstream / 0',
  })
})

test('parsePriorities - goals and frontmatter never leak into the stack', () => {
  assert({
    given: 'frontmatter above and goals below the Priorities section',
    should: 'not appear',
    actual: parsePriorities(LAST_WEEK).some(
      (p) => p.text.includes('thing') || p.text.includes('Weight') || p.text.includes('Week plan'),
    ),
    expected: false,
  })
})

test('renderWeekMarkdown - the whole file', () => {
  assert({
    given: 'W34-2026 with no prior priorities',
    should: 'be frontmatter, then the goals and priorities with why stubs - nothing else',
    actual: renderWeekMarkdown(Week.from(2026, 34), '2026-08-12'),
    expected: `---
created: 2026-08-12
updated: 2026-08-12
summary: Week plan for 2026-W34
---

# 2026-W34

## Summary

(SUMMARY)

## Priorities

1. (PRIORITY)
   - WHY:

## Goals

### Professional

- (GOAL)
  - WHY:

### Personal

- (GOAL)
  - WHY:
`,
  })
})

test('renderWeekMarkdown - priorities maintained with their whys', () => {
  const md = renderWeekMarkdown(Week.from(2026, 34), '2026-08-12', parsePriorities(LAST_WEEK))

  assert({
    given: 'a draft seeded from last week',
    should: 'carry the stack forward renumbered, why sub-bullets under their items',
    actual: md.includes('1. Ship the atlas migration\n   - WHY: unblocks everything downstream\n2. Health'),
    expected: true,
  })
})
