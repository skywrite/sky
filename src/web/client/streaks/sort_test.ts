import { assert, test } from '#test'
import type { StreakView } from '../../../service/handler/streaks/types.ts'
import { sortStreaks } from './sort.ts'

function habit(values: Partial<StreakView> & { name: string; title: string }): StreakView {
  return {
    category: null,
    schedule: 'daily',
    start: '2028-02-01',
    end: null,
    status: 'active',
    relativePath: `streaks/active/${values.name}.md`,
    revision: 'fixture',
    why: '',
    rule: '',
    bodyHtml: '',
    done: [],
    current: 0,
    best: 0,
    ...values,
  }
}

test('sortStreaks places streaks done on the given date first, then orders by consecutive days descending', () => {
  const today = '2028-02-20'
  const input = [
    habit({ name: 'alpha', title: 'Alpha', current: 10, done: ['2028-02-19'] }),
    habit({ name: 'bravo', title: 'Bravo', current: 1, done: [today] }),
    habit({ name: 'charlie', title: 'Charlie', current: 0, done: [] }),
    habit({ name: 'delta', title: 'Delta', current: 5, done: ['2028-02-19', today] }),
    habit({ name: 'echo', title: 'Echo', current: 3, done: ['2028-02-19'] }),
  ]

  const ordered = sortStreaks(input, today)

  assert({
    given: 'a mix of done and undone streaks with different current runs',
    should: 'put done streaks at the top and sort each group by longest current run',
    actual: ordered.map((streak) => streak.name),
    expected: ['delta', 'bravo', 'alpha', 'echo', 'charlie'],
  })

  assert({
    given: 'an input array passed to sortStreaks',
    should: 'not mutate the original order',
    actual: input.map((streak) => streak.name),
    expected: ['alpha', 'bravo', 'charlie', 'delta', 'echo'],
  })
})

test('sortStreaks preserves input order for ties and checks completion against the requested date', () => {
  const input = [
    habit({ name: 'atlas', title: 'Atlas', current: 1, done: ['2028-02-19'] }),
    habit({ name: 'beacon', title: 'Beacon', current: 1, done: [] }),
    habit({ name: 'cedar', title: 'Cedar', current: 1, done: ['2028-02-20'] }),
    habit({ name: 'dune', title: 'Dune', current: 1, done: ['2028-02-19'] }),
  ]

  assert({
    given: 'streaks tied on one day in a row on 2028-02-20',
    should: 'move the completed streak to the top and keep tied items in their existing order',
    actual: sortStreaks(input, '2028-02-20').map((streak) => streak.name),
    expected: ['cedar', 'atlas', 'beacon', 'dune'],
  })

  assert({
    given: 'a past date with different completions',
    should: 'sort by completion on that past date rather than another day',
    actual: sortStreaks(input, '2028-02-19').map((streak) => streak.name),
    expected: ['atlas', 'dune', 'beacon', 'cedar'],
  })
})
