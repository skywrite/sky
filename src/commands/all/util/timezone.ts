import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { currentTimezoneIANA } from '#universal/dates/timezones/mod.ts'
import { readSystemTimezone } from '#lib/sys/mod.ts'
import delay from '#universal/async/delay.ts'

const RETRY_DELAY_MS = 250

export interface UtilTimezoneResult {
  iana: string
  source: 'system' | 'intl'
  system: string | null
  intl: string
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'util:timezone': { params: Record<string, never>; result: UtilTimezoneResult }
  }
}

export default class UtilTimezoneTask extends Command {
  static override description: CommandDescription = {
    name: 'util:timezone',
    description: 'Detect the current IANA timezone (system symlink first, Intl fallback).',
  }

  async run({ context }: CommandArgs): Promise<CommandResult<UtilTimezoneResult>> {
    const { output } = context

    // The symlink read can fail for a moment while macOS re-links
    // /etc/localtime (auto-timezone re-applying on wake) — the same window
    // where Intl silently reports UTC. One short retry outlasts it.
    let system = await readSystemTimezone()
    if (!system) {
      await delay(RETRY_DELAY_MS)
      system = await readSystemTimezone()
    }

    const intl = currentTimezoneIANA()
    const iana = system ?? intl
    const source: UtilTimezoneResult['source'] = system ? 'system' : 'intl'

    output.log(`\n  Timezone: ${iana} (${source})\n`)
    if (!system) {
      output.log(`  Warning: could not read the system timezone symlink; fell back to Intl (${intl}).\n`)
    } else if (system !== intl) {
      output.log(`  Warning: runtime Intl reports ${intl}; using system value ${system}.\n`)
    }

    return CommandResult.success({ iana, source, system, intl })
  }
}
