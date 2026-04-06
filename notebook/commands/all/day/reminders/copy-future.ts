import DayDocument from '#shared/models/Day/mod.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { Link, mergeLinkMaps } from '#shared/models/Markdown/Link/mod.ts'
import { readDay, writeDay } from '#shared/nbfs/mod.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { parsePartialDate } from '#commands/lib/args/parsePartialDate.ts'

const params = {
  old: Flag.plainDate('Old Day (e.g., 27, 8-27, 2025-08-27)', {
    short: 'o',
    required: true,
    parse: (input) => parsePartialDate(input, { rejectFuture: true }),
  }),
  new: Flag.plainDate('New Day (e.g., 27, 8-27, 2025-08-27)', {
    short: 'n',
    required: true,
    parse: (input) => parsePartialDate(input, { rejectFuture: false }),
  }),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:reminders:copy-future': { params: Params; result: undefined }
  }
}

export default class DayRemindersCopyFutureTask extends Command {
  static override description: CommandDescription = {
    name: 'day:reminders:copy-future',
    description: "Copy unfinished reminders to another day's Reminders list (without removing from source)",
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

    if (listDayNotDone.size === 0) {
      output.log('No incomplete reminders to copy')
      return CommandResult.success()
    }

    // Extract links referenced by the copied items
    const copiedLinks = new Map<string, Link>()
    for (const item of listDayNotDone.items) {
      const labels = Document.extractReferenceLabels(item)
      for (const label of labels) {
        const link = dayDoc.links.get(label)
        if (link) copiedLinks.set(label, link)
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

    // Add copied links to next day
    if (copiedLinks.size > 0) {
      newNextDayDoc = newNextDayDoc.updateLinks(mergeLinkMaps([newNextDayDoc.links, copiedLinks]))
    }

    // Only write the destination day (source day remains unchanged)
    await writeDay(newNextDayDoc)

    output.log(`\n  Copied ${listDayNotDone.size} reminders.\n`)
    return CommandResult.success()
  }
}
