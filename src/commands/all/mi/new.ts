import * as path from 'node:path'
import colors from 'picocolors'
import { ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DayDirFileWriter } from '#lib/nbfs/mod.ts'
import openEditor from '#lib/shell/openEditor.ts'
import readDir from '#shared/fs/readDir.ts'
import MostImportant from '#shared/models/MostImportant/mod.ts'
import { dayDir, fetchNowSync, readDay, writeDay } from '#shared/nbfs/mod.ts'
import { suggestMostImportant } from './_lib/suggestMostImportant.ts'

const params = {
  summary: ArgOrFlag.string('Summary of the most important task', { short: 's' }),
  ai: Flag.bool('Use AI to suggest the most important thing', {
    default: false,
  }),
  dryRun: Flag.bool('Show AI suggestion without creating file', {
    default: false,
  }),
  inspect: Flag.bool('Open the AI prompt in VSCode without calling AI', {
    default: false,
  }),
  depend: Flag.bool('Add questions about depending upon others', {
    short: 'd',
    default: false,
  }),
  when: Flag.plainDateTime('When to create the MI for', {
    short: 'w',
    default: () => fetchNowSync().plainDateTime,
  }),
}

type Params = InferParams<typeof params>
type Result = { file: string; count: number }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'mi:new': {
      params: Params
      result: Result
    }
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class MiNewTask extends Command {
  static override description: CommandDescription = {
    name: 'mi:new',
    description: 'Create Most Important file.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { when, depend, summary: providedSummary, ai, dryRun, inspect } = args

    const whenDay = when.plainDate

    // Get summary from AI if --ai flag is set and no summary provided
    let summary = providedSummary
    let aiMarkdown = ''
    let aiDueBy: string | undefined
    if (ai && !summary) {
      const aiResult = await suggestMostImportant({
        context,
        today: whenDay,
        time: when.time,
        dryRun,
        inspect,
        depend,
      })

      summary = aiResult.summary
      aiMarkdown = aiResult.markdown
      aiDueBy = aiResult.dueBy

      if (inspect) {
        return CommandResult.success({ file: '', count: 0 })
      }

      if (dryRun) {
        output.log(`\n${colors.dim('(dry-run: no file created)')}`)
        return CommandResult.success({ file: '', count: 0 })
      }

      // User cancelled selection
      if (!summary) {
        return CommandResult.success({ file: '', count: 0 })
      }

      output.log(`\nMI: "${summary}"`)
    }

    const miDir = path.join(<string>config.DIR_TIME, dayDir(whenDay), 'most-important')

    let count = 1
    try {
      const iter = readDir(miDir)
      const files = await Array.fromAsync(iter)
      count = files.length + 1
    } catch (_e) {
      // dir doesn't exist - intentionally ignored
    }

    const ddfw = new DayDirFileWriter(whenDay)
    let filePath: string
    if (aiMarkdown) {
      filePath = await ddfw.write(`most-important/MI${count}.md`, aiMarkdown)
    } else {
      const mi = MostImportant.create(whenDay, { count, dependQuestions: depend, summary })
      filePath = await ddfw.write(`most-important/MI${count}.md`, mi.toMarkdown())
    }

    if (summary) {
      const entryTime = aiDueBy || when.time
      const dayItem = `${entryTime} > MI/${count} -> [${summary}](most-important/${path.basename(filePath)})`
      let dayObj = await readDay(whenDay)
      dayObj = dayObj.addMostImportantItem(dayItem)
      await writeDay(dayObj)
    }

    openEditor([{ file: path.join(ddfw.fullDir, filePath), line: 13 }])

    output.log(`\n  Successfully created ${filePath}.\n`)

    return CommandResult.success({ file: filePath, count })
  }
}
