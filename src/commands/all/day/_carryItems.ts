import * as path from 'node:path'
import type CommandContext from '#commands/lib/core/CommandContext.ts'
import { appendTaskBlock } from '#lib/nbfs/fileTaskItems.ts'
import { insertBlock, planSection, removeBlock } from '#lib/nbfs/listBlocks.ts'
import { withDayWrite, withScheduleWrite } from '#lib/nbfs/mod.ts'
import { moveItemMarkdown } from '#lib/nbfs/moveItemMarkdown.ts'
import { writePlanningChanges } from '#lib/nbfs/planningChanges.ts'
import { emptySchedule } from '#lib/nbfs/scheduledItems.ts'
import { commandPlanningDate, taskDestination } from '#lib/nbfs/taskDestination.ts'
import { readOptional } from '#lib/outbox/files.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

/** Carry whole unfinished blocks; publish the destination before changing the source. */
export async function carryItems(
  context: CommandContext,
  from: PlainDate,
  to: PlainDate,
  list: string,
  options: { copy?: boolean; incomplete?: boolean } = {},
): Promise<number> {
  if (from.ymd === to.ymd) return 0
  const { config } = context
  const sourceFile = path.join(config.DIR_TIME, dayFile(from))
  const destination = taskDestination(config, to, commandPlanningDate(context), list)
  return withDayWrite(config, from.ymd, async () => {
    const source = await readOptional(sourceFile)
    if (source === undefined) throw new Error(`Cannot find ${from.ymd}.`)
    const section = planSection(source, list)
    if (!section && list !== 'Reminders') throw new Error(`Cannot find ${from.ymd} ${list}.`)
    const rows = section?.rows.filter((row) => row.raw && DayDocument.isItemNotDone(row.raw)) ?? []
    if (!rows.length) return 0
    const save = async () => {
      const before = await readOptional(destination.file)
      let target =
        before ?? (destination.filed === 'day' ? DayDocument.createFutureDay(to).toMarkdown() : emptySchedule(list))
      let after = source
      for (const row of rows) {
        const block = moveItemMarkdown(row.block, source, sourceFile, destination.file)
        target = appendTaskBlock(target, to, list, block, destination.filed === 'schedule')
        if (!options.copy) {
          after = removeBlock(after, list, row.raw)
          if (options.incomplete)
            after = insertBlock(after, list.replace(/(?:Todos|Commitments)$/, 'Incomplete'), row.block)
        }
      }
      await writePlanningChanges([
        { file: destination.file, before, after: target },
        { file: sourceFile, before: source, after },
      ])
      return rows.length
    }
    return destination.filed === 'schedule' ? withScheduleWrite(config, save) : withDayWrite(config, to.ymd, save)
  })
}
