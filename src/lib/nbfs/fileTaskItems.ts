import { readOptional } from '#lib/outbox/files.ts'
import type { WorkstreamStorageConfig } from '#lib/workstreams/storagePaths.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import type { Link } from '#shared/models/Markdown/Link/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { insertBlock } from './listBlocks.ts'
import { writePlanningChanges } from './planningChanges.ts'
import { orderPlanList } from './planOrder.ts'
import { appendScheduledBlock, emptySchedule, scheduledBlock } from './scheduledItems.ts'
import { taskDestination, type TaskPaths } from './taskDestination.ts'
import withDayWrite from './withDayWrite.ts'
import withScheduleWrite from './withScheduleWrite.ts'

export function appendTaskBlock(content: string, date: PlainDate, list: string, block: string, scheduled: boolean) {
  return scheduled
    ? appendScheduledBlock(content, date.ymd, scheduledBlock(block, list))
    : orderPlanList(insertBlock(content, list, block), list)
}

/** The same date rule and locks for direct CLI adds and composed/AI commands. */
export async function fileTaskItems(
  config: WorkstreamStorageConfig & TaskPaths,
  today: PlainDate,
  day: PlainDate,
  list: string,
  items: string[],
  links?: Map<string, Link>,
) {
  const destination = taskDestination(config, day, today, list)
  const save = async () => {
    const before = await readOptional(destination.file)
    let after =
      before ?? (destination.filed === 'day' ? DayDocument.createFutureDay(day).toMarkdown() : emptySchedule(list))
    for (const item of items) after = appendTaskBlock(after, day, list, `- ${item}`, destination.filed === 'schedule')
    if (links?.size) {
      const doc = DayDocument.fromMarkdown(after)
      after = doc.updateLinks(new Map([...doc.links, ...links])).toMarkdown()
    }
    await writePlanningChanges([{ file: destination.file, before, after }])
    return destination.filed
  }
  return destination.filed === 'schedule' ? withScheduleWrite(config, save) : withDayWrite(config, day.ymd, save)
}
