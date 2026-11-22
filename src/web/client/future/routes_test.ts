import { assert, test } from '#test'
import { futureRouteOf, goalHref } from './routes.ts'

test('futureRouteOf: the area, a goal inside it, and every other page', () => {
  assert({
    given: 'the area, a goal, a goal with spaces, an unknown page inside the area, a mangled name, and other pages',
    should: 'open the Goals view or the named goal, and leave other pages alone',
    actual: [
      '/future',
      '/future/goals/Run-a-Marathon',
      goalHref('Read 20 books'),
      '/future/decisions',
      '/future/goals/%E0%A4%A',
      '/futures',
      '/tracking',
    ].map(futureRouteOf),
    expected: [
      { goal: null },
      { goal: 'Run-a-Marathon' },
      { goal: 'Read 20 books' },
      { goal: null },
      { goal: null },
      null,
      null,
    ],
  })
})
