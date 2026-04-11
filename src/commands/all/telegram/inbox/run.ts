import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'telegram:inbox:run': { params: Record<string, never>; result: void }
  }
}

export default class TelegramInboxRunTask extends Command {
  static override description: CommandDescription = {
    name: 'telegram:inbox:run',
    description: 'Fetch and process Telegram inbox messages.',
    descriptionLong: ['Runs the full Telegram inbox pipeline: fetch new messages, then process them.'],
    usage: ['sky telegram:inbox:run'],
  }

  async run({ context, tasks }: CommandArgs): Promise<CommandResult> {
    const { output } = context

    const fetchResult = await tasks.run('telegram:inbox:fetch')
    if (!fetchResult.ok) {
      return fetchResult
    }

    const { photos, texts } = fetchResult.data!
    output.log(`Fetched ${photos} photo(s), ${texts} text(s).`)

    return CommandResult.success()
  }
}
