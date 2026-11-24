import { assert, test } from '#test'
import { type FutureRoute, futureRouteOf, goalHref, wizardHref } from './routes.ts'

test('futureRouteOf: the area, a goal inside it, its decisions, and every other page', () => {
  const goals: FutureRoute = { tab: 'goals', goal: null, adding: false, run: null }
  assert({
    given:
      'the area, a goal, a goal with spaces, the decisions, the wizard at its start and one run of it, an unknown page inside the area, a mangled name, and other pages',
    should: 'open the list, the named goal, the wizard or its run, and leave other pages alone',
    actual: [
      '/future',
      '/future/goals/Run-a-Marathon',
      goalHref('Read 20 books'),
      '/future/decisions',
      '/future/decisions/new',
      wizardHref('0f0e0d0c-1111-2222-3333-444455556666'),
      '/future/problems',
      '/future/goals/%E0%A4%A',
      '/futures',
      '/tracking',
    ].map(futureRouteOf),
    expected: [
      goals,
      { ...goals, goal: 'Run-a-Marathon' },
      { ...goals, goal: 'Read 20 books' },
      { tab: 'decisions', goal: null, adding: false, run: null },
      { tab: 'decisions', goal: null, adding: true, run: null },
      { tab: 'decisions', goal: null, adding: true, run: '0f0e0d0c-1111-2222-3333-444455556666' },
      goals,
      goals,
      null,
      null,
    ],
  })
})
