import { assert, test } from '#test'
import { futureRouteOf, goalHref } from './routes.ts'

test('futureRouteOf: the area, a goal inside it, its decisions, and every other page', () => {
  const goals = { tab: 'goals', goal: null, adding: false }
  assert({
    given:
      'the area, a goal, a goal with spaces, the decisions, the page that adds one, an unknown page inside the area, a mangled name, and other pages',
    should: 'open the list, the named goal or the page that adds a decision, and leave other pages alone',
    actual: [
      '/future',
      '/future/goals/Run-a-Marathon',
      goalHref('Read 20 books'),
      '/future/decisions',
      '/future/decisions/new',
      '/future/problems',
      '/future/goals/%E0%A4%A',
      '/futures',
      '/tracking',
    ].map(futureRouteOf),
    expected: [
      goals,
      { ...goals, goal: 'Run-a-Marathon' },
      { ...goals, goal: 'Read 20 books' },
      { tab: 'decisions', goal: null, adding: false },
      { tab: 'decisions', goal: null, adding: true },
      goals,
      goals,
      null,
      null,
    ],
  })
})
