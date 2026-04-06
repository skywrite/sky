import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import { readDay, writeDay } from '#shared/nbfs/mod.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { exists } from '#shared/fs/mod.ts'
import extractDayItems from '../_extractDayItems.ts'
import PlainDate from '#shared/universal/dates/nbdt/PlainDate/mod.ts'

export default class DayRemindersUpdateTask extends Command {
  static override description: CommandDescription = {
    name: 'day:reminders:update',
    description: 'Extract recurring reminders into day.',
  }

  async run({ context }: CommandArgs): Promise<CommandResult> {
    const { config, output } = context
    const plainDate = PlainDate.today()

    const remindersFile = config.FILE_REMINDERS as string
    if (!remindersFile) {
      return CommandResult.fail('FILE_REMINDERS not configured')
    }

    // Check if reminders file exists
    if (!(await exists(remindersFile))) {
      output.log('No reminders.md file found, skipping')
      return CommandResult.success()
    }

    const remindersMarkdown = await readTextFile(remindersFile)
    const remindersDoc = ListDocument.fromMarkdown(remindersMarkdown)

    // Extract reminders matching today's patterns
    const reminderItems = extractDayItems(remindersDoc, plainDate)

    if (reminderItems.length === 0) {
      output.log('No reminders match today')
      return CommandResult.success()
    }

    // Read today's day file
    let dayObj = await readDay(plainDate)

    // Get existing reminders to avoid duplicates
    const existingReminders = dayObj.lists.find((l) => l.title === 'Reminders')?.items ?? []

    // Add each reminder (addReminderItem handles list creation)
    for (const item of reminderItems) {
      if (!existingReminders.includes(item)) {
        dayObj = dayObj.addReminderItem(item)
      }
    }

    await writeDay(dayObj)

    output.log(`Added ${reminderItems.length} reminders`)
    return CommandResult.success()
  }
}
