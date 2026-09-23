import { spyOn } from 'bun:test'
import * as path from 'node:path'
import mri from 'mri'
import type CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import transformTypedParamsArgs from '#commands/lib/transformTypedParamsArgs/mod.ts'
import { planSections } from '#lib/nbfs/listBlocks.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { withDayNotebook } from '../_testNotebook.ts'
import DayTodoAddTask from './add.ts'

const TODAY = new PlainDate('2031-03-16')
const TASK = 'Review the Atlas draft'
type TodoArgs = Parameters<DayTodoAddTask['run']>[0]['args']

async function assertFiled(context: CommandContext, when: PlainDate, category: string) {
  const scheduled = when.ymd > TODAY.ymd
  const file = scheduled
    ? category === 'Personal'
      ? context.config.FILE_SCHEDULE_PERSONAL
      : context.config.FILE_SCHEDULE_PROFESSIONAL
    : path.join(context.config.DIR_TIME, dayFile(when))
  const sections = planSections(await readTextFile(file))
  assert({
    given: `a ${category} todo assigned to ${when.ymd}`,
    should: 'write the task once in the intended list or category schedule',
    actual: sections.flatMap((section) => section.rows.filter((row) => row.raw === TASK).map(() => section.title)),
    expected: [scheduled ? when.ymd : `${category} Todos`],
  })
}

const composedCases: {
  name: string
  parent: Partial<TodoArgs>
  overrides: Partial<TodoArgs>
  category: string
}[] = [
  {
    name: 'explicit Personal overrides inherited Professional',
    parent: { category: 'Professional' },
    overrides: { category: 'Personal' },
    category: 'Personal',
  },
  {
    name: 'explicit Professional overrides inherited Personal',
    parent: { category: 'Personal' },
    overrides: { category: 'Professional' },
    category: 'Professional',
  },
  {
    name: 'omitted category inherits Personal',
    parent: { category: 'Personal' },
    overrides: {},
    category: 'Personal',
  },
  {
    name: 'omitted category defaults to Professional without inheritance',
    parent: {},
    overrides: {},
    category: 'Professional',
  },
]

for (const when of [TODAY, TODAY.addDays(1)]) {
  for (const scenario of composedCases) {
    test(`day:todo:add through run(): ${scenario.name} on ${when.ymd}`, async () => {
      await withDayNotebook(async ({ context }) => {
        const tasks = new CommandService(context, scenario.parent)
        const load = spyOn(tasks, 'get').mockResolvedValue(DayTodoAddTask)
        try {
          const result = await tasks.run('day:todo:add', { task: TASK, when, ...scenario.overrides })
          assert({
            given: scenario.name,
            should: 'add the todo successfully',
            actual: result.ok,
            expected: true,
          })
          await assertFiled(context, when, scenario.category)
        } finally {
          load.mockRestore()
        }
      })
    })
  }

  for (const [flags, category] of [
    [['--category', 'Personal'], 'Personal'],
    [['-c', 'Professional'], 'Professional'],
    [[], 'Professional'],
  ] as const) {
    test(`day:todo:add through CLI parsing: ${flags.join(' ') || 'default category'} on ${when.ymd}`, async () => {
      await withDayNotebook(async (notebook) => {
        const rawArgs = mri(['day:todo:add', TASK, '--when', when.ymd, ...flags])
        const args = (await transformTypedParamsArgs(DayTodoAddTask.description.params!, rawArgs)) as TodoArgs
        const result = await new DayTodoAddTask().run({ ...notebook, args, rawArgs })
        assert({
          given: `CLI arguments ${flags.join(' ') || 'without a category'}`,
          should: 'add the todo successfully',
          actual: result.ok,
          expected: true,
        })
        await assertFiled(notebook.context, when, category)
      })
    })
  }
}
