/**
 * The service's wiring of a chat session: the same producers, prompt, and
 * filing policy as ai:chat, built from an in-process CommandService. What
 * differs from the terminal is only what a browser cannot do yet — ask for
 * approval — so v1 offers exactly the tools that never ask.
 */

import * as path from 'node:path'
import { gatherContext } from '#commands/all/ai/_lib/gatherContext.ts'
import { createAutoApprovedTools } from '#commands/lib/chat/notebookTools.ts'
import { contextProducers } from '#commands/lib/chat/producers.ts'
import { renderChatSystemPrompt } from '#commands/lib/chat/systemPrompt.ts'
import { createWebTools } from '#commands/lib/chat/webTools.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { getProfile, resolveProfile, ROLES } from '#shared/ai/models.ts'
import type * as ConfigModule from '#shared/config.ts'
import ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import { chatAutosaveFilename } from '#shared/models/Chat/ChatStore/autosave.ts'
import type { ChatRoutesOptions, ChatSessionFactory } from './mod.ts'

/** ai:chat's defaults — one filing convention across hosts. */
const WEB_CHAT = { days: 7, contextTokens: 300_000 }

export function createChatHost(config: typeof ConfigModule, env: Record<string, string>): ChatRoutesOptions {
  const createSession: ChatSessionFactory = async (id, onEvent) => {
    const context = CommandContext.server(config, env)
    const tasks = new CommandService(context)
    const startTime = context.notebookNow.plainDateTime
    const today = startTime.plainDate
    const profile = getProfile(ROLES.reasoning)
    const clock = {
      notebookDate: context.notebookNow.date,
      notebookTime: context.notebookNow.time,
      systemDate: context.systemNow.date,
      systemTime: context.systemNow.time,
      notebookTimezone: context.notebookNow.timezone,
      systemTimezone: context.systemNow.timezone,
    }

    return new ChatSession({
      today,
      startTime,
      days: WEB_CHAT.days,
      baseDir: config.DIR_BASE,
      timeDir: config.DIR_TIME,
      contextTokens: WEB_CHAT.contextTokens,
      resume: null,
      model: resolveProfile(profile),
      profile: { provider: profile.provider, model: profile.model },
      producers: contextProducers(tasks),
      ambient: await gatherContext(today, config.DIR_TIME, config.DIR_DATA, WEB_CHAT.days),
      systemPrompt: async () =>
        (
          await renderChatSystemPrompt({
            config: config as Record<string, unknown>,
            clock,
            memoryDir: config.DIR_AI_MEMORY,
          })
        ).prompt,
      // Only tools that never ask — the browser has no approval surface yet.
      tools: async ({ onExternalFiles }) => ({
        tools: {
          ...(env.PERPLEXITY_API_KEY ? createWebTools() : {}),
          ...(await createAutoApprovedTools(tasks, { onExternalFiles: (_toolName, files) => onExternalFiles(files) })),
        },
        toolApproval: {},
      }),
      // Default-deny behind the filter: nothing above should ask, and anything that does is refused.
      approvalHandler: () =>
        Promise.resolve({
          approved: false,
          reason: 'This tool needs approval, which the web chat cannot ask for yet. Do not request it again.',
        }),
      autosavePath: path.join(config.DIR_STATE_AI_CHATS, chatAutosaveFilename(startTime, id)),
      onEvent,
    })
  }

  return {
    createSession,
    endDefaults: { autoTag: true, autoRel: true, memoryDir: config.DIR_AI_MEMORY, people: true },
    timeDir: config.DIR_TIME,
    aboutMePath: config.FILE_ABOUT_ME,
  }
}
