import { assert, test } from '#test'
import { validateCharterDraft } from './draft.ts'

const OPTIONS = {
  commandNames: new Set(['prices:atlas:fetch', 'day:start']),
  existingNames: new Set(['atlas-prices']),
  revising: false,
}

const GOOD = `---
run: prices:atlas:fetch
at: [06:00, 16:00]
status: active
created: 2026-08-31
---

Keep the day priced.
`

test('validateCharterDraft - a sound draft passes', () => {
  assert({
    given: 'a valid charter with a real command and a fresh name',
    should: 'return no complaint',
    actual: validateCharterDraft('price-watch', GOOD, OPTIONS),
    expected: null,
  })
})

test('validateCharterDraft - each rejection names its problem', () => {
  const cases: { label: string; name: string; contents: string; want: string }[] = [
    { label: 'bad name', name: 'Price Watch!', contents: GOOD, want: 'kebab-case' },
    { label: 'name collision', name: 'atlas-prices', contents: GOOD, want: 'already exists' },
    {
      label: 'invented command',
      name: 'price-watch',
      contents: GOOD.replace('prices:atlas:fetch', 'prices:magic:fetch'),
      want: 'not a command',
    },
    {
      label: 'unread key',
      name: 'price-watch',
      contents: GOOD.replace('status: active', 'status: active\ntimezone: UTC'),
      want: 'nothing reads',
    },
    {
      label: 'broken trigger',
      name: 'price-watch',
      contents: GOOD.replace('at: [06:00, 16:00]', 'at: [06:00]\nevery: 5m'),
      want: 'not both',
    },
    { label: 'no frontmatter', name: 'price-watch', contents: 'Just prose.\n', want: 'frontmatter' },
  ]

  assert({
    given: 'drafts broken in each guarded way',
    should: 'reject each with the reason in the message',
    actual: cases.map((c) => {
      const problem = validateCharterDraft(c.name, c.contents, OPTIONS)
      return [c.label, problem !== null && problem.includes(c.want)]
    }),
    expected: cases.map((c) => [c.label, true]),
  })
})

test('validateCharterDraft - a revision keeps its name without collision checks', () => {
  assert({
    given: 'a revision of an existing charter, same name',
    should: 'pass — the name is fixed, not colliding',
    actual: validateCharterDraft('atlas-prices', GOOD, { ...OPTIONS, revising: true }),
    expected: null,
  })
})
