import * as path from 'node:path'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { createDecisionThinking } from '#lib/decisionWizard/think.ts'
import type { TrackingStore } from '#lib/tracking/store.ts'
import type * as ConfigModule from '#shared/config.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createDecisionCommands } from './decisionCommands.ts'
import type { FutureRoutesOptions } from './mod.ts'
import { FutureStore } from './store.ts'
import { DecisionWizard } from './wizard.ts'

export function createFutureHost(
  config: typeof ConfigModule,
  env: Record<string, string>,
  notebook: () => MarkdownStore | null,
  tracking: TrackingStore,
): FutureRoutesOptions {
  const timeDir = config.DIR_TIME
  const today = async () => {
    try {
      return (await fetchNow({ timeDir })).plainDateTime.plainDate
    } catch {
      // A fresh notebook can set its first goal before it has a started day.
      return PlainDate.today()
    }
  }
  const wizard = new DecisionWizard({
    // Runs are Sky's working state: they stay out of the notebook.
    dir: path.join(config.DIR_USER_DATA, 'future', 'decisions'),
    thinking: createDecisionThinking(() => new CommandService(CommandContext.server(config, env))),
    commands: createDecisionCommands(config, env),
    notebook,
    today,
  })
  return {
    store: new FutureStore({ root: config.DIR_BASE, goalsDir: config.DIR_GOALS }, notebook, tracking, today, () =>
      wizard.list(),
    ),
    wizard,
  }
}
