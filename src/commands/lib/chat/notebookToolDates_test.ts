import { spyOn } from 'bun:test'
import * as path from 'node:path'
import { withDayNotebook } from '#commands/all/day/_testNotebook.ts'
import DayItemsAddTask from '#commands/all/day/items/add.ts'
import { exists, readTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { runToolCommand } from './notebookTools.ts'

test('raw tool dates create correctly dated day files and preserve the schedule boundary', async () => {
  await withDayNotebook(async ({ context, tasks }) => {
    const load = spyOn(tasks, 'get').mockResolvedValue(DayItemsAddTask)
    const entry = { toolName: 'day_items_add', commandName: 'day:items:add' }
    try {
      const result = await runToolCommand(tasks, entry, {
        task: 'Review Atlas',
        list: 'todos',
        when: '2031-03-16',
      })
      const content = await readTextFile(path.join(context.config.DIR_TIME, dayFile('2031-03-16')))
      const day = DayDocument.fromMarkdown(content)
      assert({
        given: 'a JSON date string passed through the tool boundary and real command runner',
        should: 'create an unstarted day with its requested date and task',
        actual: {
          result,
          heading: content.split('\n').find((line) => line.startsWith('# ')),
          date: day.day.ymd,
          started: day.started,
          tasks: day.lists.find((list) => list.title === 'Professional Todos')?.items,
        },
        expected: {
          result: {
            success: true,
            day: '2031-03-16',
            list: 'Professional Todos',
            item: 'Review Atlas',
            filed: 'day',
          },
          heading: '# **2031-03-16 - Sun**',
          date: '2031-03-16',
          started: undefined,
          tasks: ['Review Atlas'],
        },
      })

      const later = await runToolCommand(tasks, entry, {
        task: 'Prepare the Widget demo',
        list: 'todos',
        when: '2031-03-17',
      })
      const scheduled = await readTextFile(context.config.FILE_SCHEDULE_PROFESSIONAL)
      assert({
        given: 'a tool date string beyond the current week',
        should: 'file the task under its schedule date without creating a day file',
        actual: {
          date: later.day,
          filed: later.filed,
          dayCreated: await exists(path.join(context.config.DIR_TIME, dayFile('2031-03-17'))),
          scheduled: scheduled.includes('## 2031-03-17') && scheduled.includes('- Prepare the Widget demo'),
          currentDayUnchanged:
            (await readTextFile(path.join(context.config.DIR_TIME, dayFile('2031-03-16')))) === content,
        },
        expected: {
          date: '2031-03-17',
          filed: 'schedule',
          dayCreated: false,
          scheduled: true,
          currentDayUnchanged: true,
        },
      })
    } finally {
      load.mockRestore()
    }
  })
})
