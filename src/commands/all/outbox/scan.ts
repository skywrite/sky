import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'
import { createConversationScreen } from '#lib/outbox/conversationScreen.ts'
import { describeOutboxScan } from '#lib/outbox/describeScan.ts'
import { readOptional } from '#lib/outbox/files.ts'
import { OUTBOX_MODEL_PROFILE, outboxModelId } from '#lib/outbox/model.ts'
import { loadOwnerInitiatives } from '#lib/outbox/ownerInitiatives.ts'
import { createRequestAnalyzer } from '#lib/outbox/requestAnalysis.ts'
import { createOutboxRuntime } from '#lib/outbox/runtime.ts'
import { scanOutbox } from '#lib/outbox/scan.ts'
import { createTriage } from '#lib/outbox/triage.ts'
import { OutboxError, type ScanReport } from '#lib/outbox/types.ts'
import { createWritingVoice } from '#lib/writingVoice/runtime.ts'
import { createTypeSafeClient } from '#shared/ai/typesafe/client.ts'

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'outbox:scan': { params: Record<string, never>; result: ScanReport }
  }
}

export default class OutboxScan extends Command {
  static override description: CommandDescription = {
    name: 'outbox:scan',
    description:
      'Check the saved Outbox date/time range in Slack and email captures and prepare replies for review in Sky.',
    usage: ['sky outbox:scan'],
  }

  async run({ context }: CommandArgs): Promise<CommandResult<ScanReport>> {
    const { store, sources } = createOutboxRuntime(context.config)
    const voice = createWritingVoice(context.config)
    const now = context.systemNow.toUTC().normalize().plainDateTime.toString()
    const { value: range } = await store.scanRange(context.systemNow.date)
    const ownerContext = ((await readOptional(context.config.FILE_ABOUT_ME)) ?? '').slice(0, 16_000)
    const initiatives = await loadOwnerInitiatives(context.config)
    try {
      const result = await scanOutbox({
        store,
        sources,
        today: context.systemNow.date,
        range,
        now,
        analyze: createRequestAnalyzer({
          stateDir: store.stateDir,
          ownerContext,
          initiatives,
          today: context.systemNow.date,
          screen: createConversationScreen(createTypeSafeClient({ secrets: context.secrets }), {
            ownerContext,
            initiatives,
            today: context.systemNow.date,
          }),
        }),
        propose: createTriage(ownerContext, undefined, (input) => voice.draft(input)),
        model: outboxModelId(),
        modelProfile: OUTBOX_MODEL_PROFILE,
      })
      const message = describeOutboxScan(result)
      context.output.log(message)
      return result.outcome === 'failed' ? CommandResult.fail(message, result) : CommandResult.success(result, message)
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
