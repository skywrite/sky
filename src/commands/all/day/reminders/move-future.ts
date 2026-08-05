import { parsePartialDate } from '#commands/lib/args/parsePartialDate.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { type Link, mergeLinkMaps } from '#shared/models/Markdown/Link/mod.ts'
import { readDay, writeDay } from '#shared/nbfs/mod.ts'

const params = {
  old: Flag.plainDate('Old Day (e.g., 27, 8-27, 2025-08-27)', {
    short: 'o',
    required: true,
    parse: (input: string) => parsePartialDate(input, { rejectFuture: true }),
  }),
  new: Flag.plainDate('New Day (e.g., 27, 8-27, 2025-08-27)', {
    short: 'n',
    required: true,
    parse: (input: string) => parsePartialDate(input, { rejectFuture: false }),
  }),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:reminders:move-future': { params: Params; result: undefined }
  }
}

export default class DayReminderMoveFutureTask extends Command {
  static override description: CommandDescription = {
    name: 'day:reminders:move-future',
    description: "Move unfinished reminders to another day's Reminders list",
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { output } = context
    const { old: oldDate, new: newDate } = args

    const dayDoc = await readDay(oldDate)
    const nextDayDoc = await readDay(newDate)

    const listDayReminders = dayDoc.lists.find((list) => list.title === 'Reminders')
    if (!listDayReminders) {
      output.log('No Reminders list found in source day')
      return CommandResult.success()
    }

    const listDayNotDone = listDayReminders.filter(DayDocument.isItemNotDone)
    const listDayDone = listDayReminders.filter(DayDocument.isItemDone)

    if (listDayNotDone.size === 0) {
      output.log('No incomplete reminders to move')
      return CommandResult.success()
    }

    // Extract links referenced by the moved items
    const movedLinks = new Map<string, Link>()
    for (const item of listDayNotDone.items) {
      const labels = Document.extractReferenceLabels(item)
      for (const label of labels) {
        const link = dayDoc.links.get(label)
        if (link) movedLinks.set(label, link)
      }
    }

    // Get or create next day's Reminders list and add links
    const listNextDayReminders = nextDayDoc.lists.find((list) => list.title === 'Reminders')
    let newNextDayDoc: DayDocument

    if (listNextDayReminders) {
      const newNextDayReminders = listNextDayReminders.concat(listDayNotDone)
      newNextDayDoc = nextDayDoc.replaceList('Reminders', newNextDayReminders)
    } else {
      // Add reminders one by one using addReminderItem which handles list creation
      newNextDayDoc = nextDayDoc
      for (const item of listDayNotDone.items) {
        newNextDayDoc = newNextDayDoc.addReminderItem(item)
      }
    }

    // Add moved links to next day
    if (movedLinks.size > 0) {
      newNextDayDoc = newNextDayDoc.updateLinks(mergeLinkMaps([newNextDayDoc.links, movedLinks]))
    }

    // Update source day: keep only done items, or remove Reminders list entirely
    let newDayDoc: DayDocument
    if (listDayDone.size > 0) {
      newDayDoc = dayDoc.replaceList('Reminders', listDayDone)
    } else {
      const remindersIndex = dayDoc.findListIndex((list) => list.title === 'Reminders')
      newDayDoc = dayDoc.removeList(remindersIndex)
    }

    // Remove moved links from source day (only if not used elsewhere in the document)
    if (movedLinks.size > 0) {
      const markdownWithoutLinks = newDayDoc.toMarkdown({ links: false })
      const neededLabels = Document.extractReferenceLabels(markdownWithoutLinks)
      const neededLinks = new Map<string, Link>()
      for (const label of neededLabels) {
        const link = newDayDoc.links.get(label)
        if (link) neededLinks.set(label, link)
      }
      newDayDoc = newDayDoc.updateLinks(neededLinks)
    }

    await writeDay(newDayDoc)
    await writeDay(newNextDayDoc)

    output.log(`\n  Moved ${listDayNotDone.size} reminders.\n`)
    return CommandResult.success()
  }
}
