import * as path from 'node:path'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_ATTACHMENTS, DIR_STATE, DIR_TIME } from '#config'
import { BeeperClient, BeeperError, grantExpired, loadBeeperGrant, syncBeeper } from '#lib/beeper/mod.ts'
import type { BeeperSyncResult } from '#lib/beeper/mod.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import { Instant, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

const params = {
  days: Flag.number('How far back the first run reaches, in days', { default: 30 }),
  limit: Flag.number('Chats per run; the rest wait for the next run', { default: 100 }),
  dryRun: Flag.bool('Show what would be saved without writing', { short: 'n', default: false }),
}

type Params = InferParams<typeof params>

/** The sync's outcome; `unavailable` names why nothing could run, which is not an error. */
export type BeeperSyncOutcome = BeeperSyncResult | { unavailable: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'beeper:inbox:sync': { params: Params; result: BeeperSyncOutcome }
  }
}

export const BEEPER_SYNC_STATE = path.join(DIR_STATE, 'beeper', 'sync.json')

export default class BeeperInboxSyncTask extends Command {
  static override description: CommandDescription = {
    name: 'beeper:inbox:sync',
    description: 'Save new Beeper messages into the day’s messages folder.',
    descriptionLong: [
      'Asks Beeper Desktop which chats in the primary inbox moved since the',
      'last run and saves their new messages, one file per chat per day, in',
      'the shape Slack and Gmail captures use. Your own messages are saved too,',
      'so Outbox can tell when you answered. Only networks switched on under',
      'Settings → Connections → Beeper are saved; a network seen for the first',
      'time waits, off, and groups stay out until chosen. Muted, archived,',
      'low-priority and read-only chats stay out; Slack accounts stay out',
      'because agent-slack already captures them.',
      'Designed to run on the heartbeat. Idempotent and non-interactive.',
    ],
    usage: ['sky beeper:inbox:sync', 'sky beeper:inbox:sync --days 7', 'sky beeper:inbox:sync --dry-run'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<BeeperSyncOutcome>> {
    const { output, secrets } = context
    const grant = await loadBeeperGrant(secrets)
    const unavailable = (reason: string) => {
      output.log(reason)
      return CommandResult.success<BeeperSyncOutcome>({ unavailable: reason })
    }
    if (!grant) return unavailable('Beeper is not connected. Run: sky beeper:auth')
    if (grantExpired(grant)) return unavailable('The Beeper grant expired. Run: sky beeper:auth')
    const now = new ZonedDateTime()
    try {
      const result = await syncBeeper({
        client: new BeeperClient(grant.token),
        timeDir: DIR_TIME,
        attachmentsDir: DIR_ATTACHMENTS,
        stateFile: BEEPER_SYNC_STATE,
        now: Instant.fromEpochMilliseconds(now.epochMilliseconds).toString(),
        timezone: (await fetchNow()).timezone,
        backfillDays: args.days,
        chatLimit: args.limit,
        dryRun: args.dryRun,
        log: (line) => output.log(line),
      })
      if (result.accountsSkipped.length) output.log(`Left to agent-slack: ${result.accountsSkipped.join(', ')}`)
      if (result.accountsOff.length) output.log(`Switched off in Settings: ${result.accountsOff.join(', ')}`)
      for (const held of result.held) output.log(`Held for a look: ${held.chat} (${held.network})`)
      for (const skipped of result.skipped) output.log(`Skipped ${skipped.chat}: ${skipped.reason}`)
      for (const note of result.notes) output.log(note)
      output.log(
        `${result.messages} message(s) in ${result.chats} chat(s)${result.files.length ? `, ${result.files.length} file(s)` : ''}${result.complete ? '' : ' — more chats wait for the next run'}${args.dryRun ? ' (dry run)' : ''}.`,
      )
      return CommandResult.success(result)
    } catch (error) {
      if (error instanceof BeeperError && error.kind === 'unavailable') return unavailable(error.message)
      if (error instanceof BeeperError) return CommandResult.fail(error.message)
      throw error
    }
  }
}
