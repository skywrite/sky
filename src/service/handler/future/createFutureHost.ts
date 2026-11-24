import * as path from 'node:path'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { addRel, createDecisionChat, decisionThreadId } from '#lib/decisionWizard/chat.ts'
import { createDecisionThinking } from '#lib/decisionWizard/think.ts'
import type { TrackingStore } from '#lib/tracking/store.ts'
import type * as ConfigModule from '#shared/config.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { chatSourceLinks } from '../chat/sourceLinks.ts'
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
  // Runs are Sky's working state: they stay out of the notebook.
  const dir = path.join(config.DIR_USER_DATA, 'future', 'decisions')
  const decisionChat = createDecisionChat(dir)
  const filedChats = chatSourceLinks(path.join(config.DIR_STATE_AI_CHATS, 'source-links'))
  const wizard = new DecisionWizard({
    dir,
    thinking: createDecisionThinking(() => new CommandService(CommandContext.server(config, env))),
    commands: createDecisionCommands(config, env),
    notebook,
    today,
    async chatFiledAt(run) {
      const known = await decisionChat.filedAt(run)
      if (known) return known
      // A chat filed before the run kept its place: the chat's own index still has it, and the run learns it now.
      const thread = decisionThreadId(run)
      const at = await filedChats.get(thread)
      if (at) await decisionChat.filed(thread, at)
      return at
    },
    async filed(run, name) {
      // A chat still open learns the name from here when it is saved.
      await decisionChat.saved(run, name)
      // A chat filed before its decision was gets the decision added to its rel now.
      const chat = await filedChats.get(decisionThreadId(run))
      if (chat) await addRel(path.join(config.DIR_BASE, chat), `decisions/${name}`)
    },
  })
  return {
    store: new FutureStore({ root: config.DIR_BASE, goalsDir: config.DIR_GOALS }, notebook, tracking, today, () =>
      wizard.list(),
    ),
    wizard,
  }
}
