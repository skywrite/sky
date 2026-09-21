import * as path from 'node:path'
import { Command, CommandResult, dayArg } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { appendTaskBlock } from '#lib/nbfs/fileTaskItems.ts'
import { planSections, planSection, blockRaw } from '#lib/nbfs/listBlocks.ts'
import { withDayWrite, withScheduleWrite } from '#lib/nbfs/mod.ts'
import { moveItemMarkdown } from '#lib/nbfs/moveItemMarkdown.ts'
import { writePlanningChanges, type PlanningChange } from '#lib/nbfs/planningChanges.ts'
import { readScheduledItem } from '#lib/nbfs/scheduledItems.ts'
import { readOptional } from '#lib/outbox/files.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const params = { day: dayArg() }
type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:schedule:update': { params: Params; result: undefined }
  }
}

export default class DayScheduleUpdateTask extends Command {
  static override description: CommandDescription = {
    name: 'day:schedule:update',
    description: 'Extract scheduled tasks into day.',
    params,
  }

  async run({ context, args }: CommandArgs<Params>): Promise<CommandResult> {
    const { config, output } = context
    const day = args.day ?? PlainDate.today()
    const file = path.join(config.DIR_TIME, dayFile(day))
    return withDayWrite(config, day.ymd, () =>
      withScheduleWrite(config, async () => {
        const before = await readOptional(file)
        let after = before ?? DayDocument.createFutureDay(day).toMarkdown()
        const changes: PlanningChange[] = []
        let count = 0
        for (const [schedule, category] of [
          [config.FILE_SCHEDULE_PROFESSIONAL, 'Professional'],
          [config.FILE_SCHEDULE_PERSONAL, 'Personal'],
        ]) {
          const content = await readOptional(schedule)
          if (content === undefined) continue
          const sections = planSections(content)
          for (const section of sections) {
            if (
              /^\d{4}-\d{2}-\d{2}$/.test(section.title) &&
              section.title < day.ymd &&
              section.rows.some((row) => row.raw)
            )
              output.log(`WARN: ${path.basename(schedule)}: ${section.title} has already happened.`)
          }
          const rows = sections
            .filter((section) => section.title === day.ymd)
            .flatMap((section) => section.rows)
            .filter((row) => row.raw)
          if (!rows.length) continue
          for (const row of rows) {
            const item = readScheduledItem(row.block, category)
            const block = moveItemMarkdown(item.block, content, schedule, file)
            // An interrupted prior import may have saved the day but not drained
            // the schedule. Consume only an identical copy; changed notes still
            // conflict rather than silently losing either version.
            const existing = planSection(after, item.list)?.rows.find((row) => row.raw === blockRaw(block))
            const comparable = (text: string) => text.replace(/\r\n/g, '\n').replace(/^\s*[-*+]\s+/, '- ')
            if (!existing || comparable(moveItemMarkdown(existing.block, after, file, file)) !== comparable(block))
              after = appendTaskBlock(after, day, item.list, block, false)
            count++
          }
          let remaining = content
          for (const row of [...rows].reverse()) remaining = remaining.slice(0, row.from) + remaining.slice(row.to)
          changes.push({ file: schedule, before: content, after: remaining })
        }
        if (count) await writePlanningChanges([{ file, before, after }, ...changes])
        return CommandResult.success()
      }),
    )
  }
}
