import { refForNotebookPath } from '#commands/lib/interview.ts'
import { assert, test } from '#test'

test('refForNotebookPath - people and orgs resolve by bare name (file stem)', () => {
  assert({ actual: refForNotebookPath('people/Jane-Doe.md'), expected: 'Jane-Doe' })
  assert({ actual: refForNotebookPath('people-old/Jane-Doe.md'), expected: 'Jane-Doe' })
  assert({ actual: refForNotebookPath('people/acme/Jane-Doe.md'), expected: 'Jane-Doe' })
  assert({ actual: refForNotebookPath('orgs/Atlas.md'), expected: 'Atlas' })
})

test('refForNotebookPath - any file inside a project maps to the project ref', () => {
  assert({
    actual: refForNotebookPath('projects/open/Atlas-Launch/_project/overview.md'),
    expected: 'projects/Atlas-Launch',
  })
  assert({
    actual: refForNotebookPath('projects/open/Atlas-Launch/notes/scratch.md'),
    expected: 'projects/Atlas-Launch',
  })
  assert({ actual: refForNotebookPath('projects/open/Stray.md'), expected: 'projects/Stray' })
  assert({ actual: refForNotebookPath('projects/open'), expected: undefined })
})

test('refForNotebookPath - decisions, ideas, streaks use family/slug', () => {
  assert({
    actual: refForNotebookPath('decisions/2026/pending/08/Choose-Vendor.md'),
    expected: 'decisions/Choose-Vendor',
  })
  assert({ actual: refForNotebookPath('ideas/2026/draft/08/AI-Coach.md'), expected: 'ideas/AI-Coach' })
  assert({ actual: refForNotebookPath('streaks/active/eat-clean.md'), expected: 'streaks/eat-clean' })
})

test('refForNotebookPath - goals map to the two categories only', () => {
  assert({ actual: refForNotebookPath('goals/personal.md'), expected: 'goals/personal' })
  assert({ actual: refForNotebookPath('goals/professional.md'), expected: 'goals/professional' })
  assert({ actual: refForNotebookPath('goals/quarterly.md'), expected: undefined })
})

test('refForNotebookPath - places drop the locations/ prefix and .md', () => {
  assert({
    actual: refForNotebookPath('places/locations/US/NY/New-York/drink/Ty-Bar.md'),
    expected: 'places/US/NY/New-York/drink/Ty-Bar',
  })
  assert({
    actual: refForNotebookPath('places/US/TX/Austin/eat/Taco-Spot.md'),
    expected: 'places/US/TX/Austin/eat/Taco-Spot',
  })
})

test('refForNotebookPath - time documents become YYYY-MM-DD/subpath refs', () => {
  assert({
    actual: refForNotebookPath('time/2026/08/03-09/08-05/actions/meetings/Standup.md'),
    expected: '2026-08-05/actions/meetings/Standup',
  })
  assert({ actual: refForNotebookPath('time/2026/08/03-09/08-05/day.md'), expected: '2026-08-05/day' })
  assert({ actual: refForNotebookPath('time/2026/08/malformed.md'), expected: undefined })
})

test('refForNotebookPath - families without a reference form return undefined', () => {
  assert({ actual: refForNotebookPath('notes/scratch.md'), expected: undefined })
  assert({ actual: refForNotebookPath('journal/about-me.md'), expected: undefined })
  assert({ actual: refForNotebookPath('data/export.md'), expected: undefined })
})
