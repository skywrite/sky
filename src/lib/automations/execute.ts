import type { AutomationCommandStep } from '#shared/models/Automation/mod.ts'
import type { RunOutcome } from '#shared/models/Automation/state.ts'

type Outcome = { outcome: RunOutcome; message?: string }

/** One automation, one outcome. Independent commands continue after a failure. */
export async function executeAutomationCommands(
  commands: readonly AutomationCommandStep[],
  invoke: (command: AutomationCommandStep) => Promise<Outcome>,
): Promise<Outcome> {
  const results: (Outcome & { run: string })[] = []
  for (const command of commands) {
    let result: Outcome
    try {
      result = await invoke(command)
    } catch (error) {
      result = { outcome: 'failed', message: error instanceof Error ? error.message : String(error) }
    }
    results.push({ run: command.run, ...result })
  }
  if (commands.length === 1 && results[0]) {
    const { run: _run, ...result } = results[0]
    return result
  }
  return {
    outcome: results.some((result) => result.outcome === 'failed')
      ? 'failed'
      : results.some((result) => result.outcome === 'acted')
        ? 'acted'
        : 'nothing',
    message: results
      .map(({ run, outcome, message }) => `${run}: ${outcome}${message ? ` — ${message}` : ''}`)
      .join('\n'),
  }
}
