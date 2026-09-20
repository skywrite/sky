import { spyOn } from 'bun:test'
import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import * as prompts from '@clack/prompts'
import * as editor from 'open-editor'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { outputFile, readTextFile } from '#shared/fs/mod.ts'
import { weekDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { Week } from '#universal/dates/nbdt/mod.ts'
import { withDayNotebook } from '../day/_testNotebook.ts'
import * as draft from './lib/draftWeek.ts'
import * as planContext from './lib/planContext.ts'
import * as refine from './lib/refineQuestions.ts'
import WeekPlan from './plan.ts'

test('week:plan works before the first day starts and preserves an existing plan', async () => {
  await withDayNotebook(async ({ context: original, rawArgs }) => {
    // With no started notebook day, accessing notebookNow throws, as on a fresh install.
    const context = new CommandContext({
      platform: original.platform,
      config: original.config,
      env: original.env,
      output: original.output,
      systemNow: original.systemNow,
      secrets: original.secrets,
    })
    const week = Week.of(context.systemNow).next()
    const timeDir = context.config.DIR_TIME
    const file = path.join(timeDir, weekDir(week.startInYear), 'week.md')
    const interview = spyOn(prompts, 'text').mockResolvedValue('')
    const intro = spyOn(prompts, 'intro').mockImplementation(() => {})
    const gather = spyOn(planContext, 'gatherPlanContext').mockResolvedValue({ sections: [], manifest: [] })
    const questions = spyOn(refine, 'generateRefineQuestions').mockResolvedValue([])
    const drafting = spyOn(draft, 'draftWeekMarkdown').mockResolvedValue(undefined)
    const open = spyOn(editor, 'default').mockResolvedValue(undefined)
    const tasks = new CommandService(context)
    const command = spyOn(tasks, 'run').mockImplementation(async (name) => {
      throw new Error(`Unexpected command: ${name}`)
    })
    const input = { context, tasks, rawArgs, args: { week: week.toString() } }
    try {
      const result = await new WeekPlan().run(input)
      assert({
        given: 'a fresh notebook with no week directories and an unavailable AI draft',
        should: 'save and open the fallback plan without creating any day files or running another command',
        actual: {
          ok: result.ok,
          files: (await readdir(timeDir, { recursive: true })).filter((entry) => entry.endsWith('.md')),
          plan: (await readTextFile(file)).includes(`# ${week.toString()}: Week Plan`),
          opened: open.mock.calls.map(([files]) => files),
          commands: command.mock.calls.length,
        },
        expected: {
          ok: true,
          files: [path.relative(timeDir, file)],
          plan: true,
          opened: [[{ file }]],
          commands: 0,
        },
      })

      const edited = '# My weekly plan\n\n- Finish Atlas\n'
      await outputFile(file, edited)
      await new WeekPlan().run(input)
      assert({
        given: 'a manually edited weekly plan and a second planning invocation',
        should: 'open the existing plan without redrafting it',
        actual: [await readTextFile(file), drafting.mock.calls.length, open.mock.calls.length],
        expected: [edited, 1, 2],
      })
    } finally {
      for (const mock of [interview, intro, gather, questions, drafting, open, command]) mock.mockRestore()
    }
  })
})
