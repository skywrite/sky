import DayTodoAddTask from '#commands/all/day/todo/add.ts'
import NextAddTask from '#commands/all/next/add.ts'
import { resolveCommandArgs } from '#commands/lib/core/resolveCommandArgs.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import {
  countWaitingIn,
  executeActionItemRoute,
  lastCreatedDay,
  planActionItemRoute,
  proposedWhen,
} from './actionItemRoutes.ts'

// A fictional week: Wednesday 11 March 2026, day files made through Sunday.
const TODAY = '2026-03-11'
const created = (day: PlainDate) => Promise.resolve(day.ymd <= '2026-03-15')
const fallback = { date: '2026-03-12', time: null }

test('actionItemRoutes: the when an item arrives with', () => {
  const item = { text: 'Send the sheet', mine: true }
  assert({
    given: 'a dated item ahead, a dated item behind, and an undated one',
    should: 'keep the day and time named ahead, and fall back for the rest',
    actual: [
      proposedWhen({ ...item, date: '2026-03-13', time: '09:30' }, TODAY, fallback),
      proposedWhen({ ...item, date: '2026-03-02', time: '09:30' }, TODAY, fallback),
      proposedWhen({ ...item, date: null, time: null }, TODAY, fallback),
    ],
    expected: [{ date: '2026-03-13', time: '09:30' }, fallback, fallback],
  })
})

test('actionItemRoutes: where each placement goes', async () => {
  const text = 'Send the sheet'
  const routes = await Promise.all([
    planActionItemRoute({ text, when: { date: '2026-03-12', time: '9:30' } }, TODAY, created),
    planActionItemRoute({ text, when: { date: '2026-03-12', time: null } }, TODAY, created),
    planActionItemRoute({ text, when: { date: '2026-03-16', time: '10:00' } }, TODAY, created),
    planActionItemRoute({ text, when: { date: '2026-03-16', time: null } }, TODAY, created),
    planActionItemRoute({ text, when: { date: null, time: null } }, TODAY, created),
    planActionItemRoute({ text, when: { date: '2026-03-02', time: '09:00' } }, TODAY, created),
  ])
  assert({
    given: 'timed and untimed items on a made day, on a day whose week is not made, on no day, and in the past',
    should: 'commit, todo, park in the schedule with the time kept, or go to Next — and say so in words',
    actual: routes.map((r) => [r.kind, r.task, r.destination]),
    expected: [
      ['commitments', '09:30 > Send the sheet', 'Tomorrow · Commitments'],
      ['todo', 'Send the sheet', 'Tomorrow · Todos'],
      ['todo', '10:00 > Send the sheet', 'Mon 16 Mar · schedule'],
      ['todo', 'Send the sheet', 'Mon 16 Mar · schedule'],
      ['next', 'Send the sheet', 'Next'],
      ['next', 'Send the sheet', 'Next'],
    ],
  })
})

test('actionItemRoutes: the list commands are told their list', async () => {
  const calls: [string, Record<string, unknown> | undefined][] = []
  const tasks = {
    run: (name: string, args?: Record<string, unknown>) => {
      calls.push([name, args])
      return Promise.resolve({ ok: name !== 'day:todo:add' || args?.category === 'Professional Todos' })
    },
  }
  const when = new PlainDate('2026-03-12')
  await executeActionItemRoute({ kind: 'next', task: 'Send the sheet', destination: 'Next' }, tasks)
  await executeActionItemRoute({ kind: 'todo', task: 'Call back', when, destination: 'Tomorrow · Todos' }, tasks)
  assert({
    given: 'a Next route and a Todo route',
    should: 'name the list on each call instead of leaving it to inheritance',
    actual: calls,
    expected: [
      ['next:add', { task: 'Send the sheet', category: 'Next' }],
      ['day:todo:add', { task: 'Call back', when, category: 'Professional Todos' }],
    ],
  })
  let failed: string | null = null
  try {
    await executeActionItemRoute(
      { kind: 'next', task: 'x', destination: 'Next' },
      {
        run: () => Promise.resolve({ ok: false, message: 'Cannot find list Next.' }),
      },
    )
  } catch (err) {
    failed = (err as Error).message
  }
  assert({
    given: 'a list command that fails',
    should: 'throw its message so the ledger can show it',
    actual: failed,
    expected: 'Cannot find list Next.',
  })
})

test('actionItemRoutes: a composed run would otherwise inherit the meeting category', async () => {
  // What meeting:new's scope carries into a nested run: its own parsed arguments.
  const callerArgs = { category: 'Professional Complete', medium: 'Zoom', summary: '' }
  const inherited = await resolveCommandArgs({
    description: NextAddTask.description,
    callerArgs,
    overrides: { task: 'x' },
    callerDepth: 0,
  })
  const next = await resolveCommandArgs({
    description: NextAddTask.description,
    callerArgs,
    overrides: { task: 'x', category: 'Next' },
    callerDepth: 0,
  })
  const todo = await resolveCommandArgs({
    description: DayTodoAddTask.description,
    callerArgs,
    overrides: { task: 'x', when: new PlainDate('2026-03-12'), category: 'Professional Todos' },
    callerDepth: 0,
  })
  assert({
    given: "next:add and day:todo:add resolved inside meeting:new's scope",
    should: 'take the meeting category unless told their own list — which the routes now do',
    actual: [inherited.category, next.category, todo.category],
    expected: ['Professional Complete', 'Next', 'Professional Todos'],
  })
})

test('actionItemRoutes: what is created, and what waits', async () => {
  const today = new PlainDate(TODAY)
  assert({
    given: 'day files through Sunday, and none at all',
    should: 'name the last created day, or null',
    actual: [await lastCreatedDay(today, created), await lastCreatedDay(today, () => Promise.resolve(false))],
    expected: ['2026-03-15', null],
  })
  const next = ['# Next Actions', '', '## Week-Next', '- One', '', '## Next', '- Two', '- Three', ''].join('\n')
  assert({
    given: 'a next file with two lists',
    should: 'count only the Next list',
    actual: [countWaitingIn(next), countWaitingIn('# Empty\n')],
    expected: [2, 0],
  })
})
