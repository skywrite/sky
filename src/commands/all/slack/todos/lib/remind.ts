import * as path from 'node:path'
import { oneLine } from '#commands/all/slack/lib/mod.ts'
import type { LaterCaptureRow } from '#commands/all/slack/saved/lib/capture.ts'
import type CommandContext from '#commands/lib/core/CommandContext.ts'
import { appendTaskBlock } from '#lib/nbfs/fileTaskItems.ts'
import { planSections } from '#lib/nbfs/listBlocks.ts'
import { writePlanningChanges } from '#lib/nbfs/planningChanges.ts'
import { commandPlanningDate } from '#lib/nbfs/taskDestination.ts'
import withDayWrite from '#lib/nbfs/withDayWrite.ts'
import { readOptional } from '#lib/outbox/files.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'

function hasSource(contents: string | undefined, link: string): boolean {
  if (!contents) return false
  const links = DayDocument.fromMarkdown(contents).links
  // The source link survives edits, completion and moves between today's lists.
  return planSections(contents).some((section) =>
    section.rows.some(
      (item) =>
        item.block.includes(`](${link})`) ||
        DayDocument.extractReferenceLabels(item.block).some((label) => links.get(label.toLowerCase())?.href === link),
    ),
  )
}

/** Save the action on today's plan even when its conversation belongs to an earlier day. */
export async function addTodoReminder(
  row: LaterCaptureRow,
  context: Pick<CommandContext, 'config' | 'notebookNow' | 'systemNow' | 'signal'>,
  describe?: () => Promise<string | undefined>,
): Promise<boolean> {
  context.signal?.throwIfAborted()
  const today = commandPlanningDate(context)
  const file = path.join(context.config.DIR_TIME, dayFile(today))
  if (hasSource(await readOptional(file), row.link)) return false
  // Fetching context and asking the model must not hold up other writers to this day.
  const text =
    (await describe?.()) ||
    oneLine(row.item.message?.content ?? '', 200) ||
    `Slack to-do in ${row.item.channel_name ?? row.item.channel_id}`
  context.signal?.throwIfAborted()
  return withDayWrite(context.config, today.ymd, async () => {
    context.signal?.throwIfAborted()
    const before = await readOptional(file)
    const contents = before ?? DayDocument.createFutureDay(today).toMarkdown()
    if (hasSource(contents, row.link)) return false
    const label = text.replace(/[\\`*_[\]<>~]/g, '\\$&')
    const after = appendTaskBlock(contents, today, 'Reminders', `- [${label}](${row.link})`, false)
    await writePlanningChanges([{ file, before, after }])
    return true
  })
}
