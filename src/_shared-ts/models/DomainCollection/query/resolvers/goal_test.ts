import { Document } from '#shared/models/Markdown/mod.ts'
import { assert, test } from '#test'
import { docToGoal, matchesGoalFilter } from './goal.ts'

const ACTIVE = '/nb/goals/active/Launch-Atlas.md'
const ARCHIVED = '/nb/goals/archived/2025/Learn-Spanish.md'
const OLDER = '/nb/goals/professional.md'

test('goal resolver: name and status come from the path, title and category from the file', () => {
  const active = Document.fromMarkdown(
    '---\ntitle: Launch Atlas\ncategory: Professional\n---\n\nThree pilot teams by June.',
  )
  const archived = Document.fromMarkdown('# Learn Spanish\n\nReached in 2025.')
  const older = Document.fromMarkdown('---\ncategory: Professional\nstatus: paused\nname: Something Else\n---\n\nBody.')
  const pick = ({ name, title, status, category }: ReturnType<typeof docToGoal>) => ({ name, title, status, category })

  assert({
    given:
      'a one-goal file, an archived one with only a heading, and an older category file carrying stray name and status fields',
    should: 'name each by its file, read status from the folder, and never trust the stray fields',
    actual: [pick(docToGoal(active, ACTIVE)), pick(docToGoal(archived, ARCHIVED)), pick(docToGoal(older, OLDER))],
    expected: [
      { name: 'Launch-Atlas', title: 'Launch Atlas', status: 'active', category: 'Professional' },
      { name: 'Learn-Spanish', title: 'Learn Spanish', status: 'archived', category: 'Personal' },
      { name: 'professional', title: 'Professional Goals', status: 'active', category: 'Professional' },
    ],
  })
})

test('goal resolver: filters by name, title and status', () => {
  const doc = Document.fromMarkdown('---\ntitle: Launch Atlas\n---\n\nThree pilot teams by June.')

  assert({
    given: 'an active goal named Launch-Atlas',
    should: 'match its name in any case, part of its name or title, and its folder status only',
    actual: [
      matchesGoalFilter(doc, { name: 'launch-atlas' }, ACTIVE),
      matchesGoalFilter(doc, { name: 'launch' }, ACTIVE),
      matchesGoalFilter(doc, { nameContains: 'atlas' }, ACTIVE),
      matchesGoalFilter(doc, { titleContains: 'launch a' }, ACTIVE),
      matchesGoalFilter(doc, { status: 'active' }, ACTIVE),
      matchesGoalFilter(doc, { status: 'archived' }, ACTIVE),
      matchesGoalFilter(doc, { status: 'archived' }, ARCHIVED),
    ],
    expected: [true, false, true, true, true, false, true],
  })
})
