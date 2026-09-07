import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'
import { createProposer } from '#lib/outbox/ai.ts'
import { describeOutboxScan } from '#lib/outbox/describeScan.ts'
import { readOptional } from '#lib/outbox/files.ts'
import { createOutboxRuntime } from '#lib/outbox/runtime.ts'
import { scanOutbox } from '#lib/outbox/scan.ts'
import { OutboxError, type ScanReport } from '#lib/outbox/types.ts'

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'outbox:scan': { params: Record<string, never>; result: ScanReport }
  }
}

export default class OutboxScan extends Command {
  static override description: CommandDescription = {
    name: 'outbox:scan',
    description:
      'Prepare Outbox decisions from new or changed saved Slack and email conversations. Creates no native drafts.',
    usage: ['sky outbox:scan'],
  }

  async run({ context }: CommandArgs): Promise<CommandResult<ScanReport>> {
    const { store, sources } = createOutboxRuntime(context.config)
    const now = context.systemNow.toUTC().normalize().plainDateTime.toString()
    try {
      const result = await scanOutbox({
        store,
        sources,
        today: context.systemNow.date,
        now,
        propose: createProposer(((await readOptional(context.config.FILE_ABOUT_ME)) ?? '').slice(0, 16_000)),
      })
      const message = describeOutboxScan(result)
      context.output.log(message)
      return result.failed ? CommandResult.fail(message, result) : CommandResult.success(result, message)
    } catch (error) {
      if (error instanceof OutboxError && error.status === 409) {
        return CommandResult.success(
          { outcome: 'nothing', considered: 0, prepared: 0, ignored: 0, stale: 0, failed: 0, pending: 0 },
          'Outbox is already processing saved messages.',
        )
      }
      throw error
    }
  }
}
