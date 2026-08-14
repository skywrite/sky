import { assert, test } from '#test'
import { Week } from '#universal/dates/nbdt/mod.ts'
import { assembleWeekFile, isValidDraft, stripCodeFence } from './draftWeek.ts'

const WEEK = Week.from(2026, 34)

const GOOD_DRAFT = `# 2026-W34

## Summary

A focused week.

## Priorities

1. Ship the atlas migration
   - WHY: unblocks everything downstream

## Goals

### Professional

- Migration executed
  - WHY: the year goal depends on it

### Personal

- Three treadmill sessions
  - WHY: weight trend
`

test('isValidDraft - accepts the contract shape', () => {
  assert({
    given: 'a well-formed draft',
    should: 'validate',
    actual: isValidDraft(GOOD_DRAFT, WEEK),
    expected: true,
  })
})

test('isValidDraft - rejects wrong week, missing sections, leftover placeholders', () => {
  const fixtures = [
    { draft: GOOD_DRAFT.replace('2026-W34', '2026-W35'), description: 'wrong week id' },
    { draft: GOOD_DRAFT.replace('## Summary', '## Sumary'), description: 'missing Summary' },
    { draft: GOOD_DRAFT.replace('### Personal', '### Persnl'), description: 'missing Personal' },
    { draft: GOOD_DRAFT.replace('Ship the atlas migration', '(PRIORITY)'), description: 'placeholder left in' },
  ]

  for (const { draft, description } of fixtures) {
    assert({
      given: description,
      should: 'reject',
      actual: isValidDraft(draft, WEEK),
      expected: false,
    })
  }
})

test('assembleWeekFile - lifts the summary line into code-built frontmatter', () => {
  const assembled = assembleWeekFile(`summary: The pivot week\n\n${GOOD_DRAFT}`, WEEK, '2026-08-12')

  assert({
    given: 'model output with a summary first line and a valid body',
    should: 'start with frontmatter carrying dates and the lifted summary',
    actual: assembled?.file.startsWith(
      '---\ncreated: 2026-08-12\nupdated: 2026-08-12\nsummary: The pivot week\n---\n\n# 2026-W34',
    ),
    expected: true,
  })
})

test('assembleWeekFile - splits the WEEK-NEXT block off for the queues', () => {
  const output =
    `summary: The pivot week\n\n${GOOD_DRAFT}\n` +
    '== WEEK-NEXT ==\nprofessional: Vendor keep/drop decision\npersonal: Family trip call\nprofessional: Second thing\n'
  const assembled = assembleWeekFile(output, WEEK, '2026-08-12')

  assert({
    given: 'a draft with a trailing deferral block',
    should: 'route items by prefix and keep the block out of week.md',
    actual:
      `${assembled?.later.professional.join(' | ')} / ${assembled?.later.personal.join(' | ')} / ` +
      `${assembled?.file.includes('WEEK-NEXT')}`,
    expected: 'Vendor keep/drop decision | Second thing / Family trip call / false',
  })
})

test('assembleWeekFile - degrades gracefully', () => {
  assert({
    given: 'a valid body with no summary line',
    should: 'fall back to the generic summary rather than discarding the draft',
    actual: assembleWeekFile(GOOD_DRAFT, WEEK, '2026-08-12')?.file.includes('summary: Week plan for 2026-W34'),
    expected: true,
  })
  assert({
    given: 'a summary containing a colon',
    should: 'quote the YAML value',
    actual: assembleWeekFile(`summary: Ship it: the plan\n\n${GOOD_DRAFT}`, WEEK, '2026-08-12')?.file.includes(
      'summary: "Ship it: the plan"',
    ),
    expected: true,
  })
  assert({
    given: 'an invalid body',
    should: 'return undefined so the caller falls back',
    actual: assembleWeekFile(`summary: fine\n\nnot a week file`, WEEK, '2026-08-12'),
    expected: undefined,
  })
})

test('stripCodeFence - unwraps fenced output, passes clean output through', () => {
  assert({
    given: 'a draft wrapped in a markdown fence',
    should: 'unwrap to the inner file',
    actual: isValidDraft(stripCodeFence('```markdown\n' + GOOD_DRAFT.trim() + '\n```'), WEEK),
    expected: true,
  })
  assert({
    given: 'clean output',
    should: 'pass through trimmed',
    actual: stripCodeFence(GOOD_DRAFT) === GOOD_DRAFT.trim(),
    expected: true,
  })
})
