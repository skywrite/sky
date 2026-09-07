import type { CommandResult } from '#commands/mod.ts'
import type { RunOutcome } from '#shared/models/Automation/state.ts'

/** Commands may report a quiet pass explicitly; old commands retain success => acted. */
export function commandOutcome(result: CommandResult): { outcome: RunOutcome; message?: string } {
  const data = result.data
  const declared = data && typeof data === 'object' && 'outcome' in data ? data.outcome : undefined
  const outcome =
    result.status !== 'success'
      ? 'failed'
      : declared === 'nothing'
        ? 'nothing'
        : declared === 'failed'
          ? 'failed'
          : 'acted'
  return { outcome, ...(result.message ? { message: result.message } : {}) }
}
