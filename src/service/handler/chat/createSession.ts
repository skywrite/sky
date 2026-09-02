/**
 * The service's wiring of a chat session: the same producers, prompt,
 * tools, and filing policy as ai:chat, built from an in-process
 * CommandService. A tool call that needs the person's go is put to the
 * page as a card, through the routes, and the turn waits for the answer —
 * the same protocol the terminal runs with a prompt.
 */

import * as path from 'node:path'
import { gatherContext } from '#commands/all/ai/_lib/gatherContext.ts'
import { createFileTools } from '#commands/lib/chat/fileTools.ts'
import {
  createNotebookTools,
  createToolApprovalConfig,
  getApprovalFormatter,
} from '#commands/lib/chat/notebookTools.ts'
import { contextProducers } from '#commands/lib/chat/producers.ts'
import { renderChatSystemPrompt } from '#commands/lib/chat/systemPrompt.ts'
import { createWebTools } from '#commands/lib/chat/webTools.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { getAllProfiles, getProfile, PROFILES, resolveProfile, ROLES } from '#shared/ai/models.ts'
import type * as ConfigModule from '#shared/config.ts'
import ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import { chatAutosaveFilename } from '#shared/models/Chat/ChatStore/autosave.ts'
import { prettyModel, PROVIDER_LABEL, ROLE_LABEL } from '../settings/mod.ts'
import { approvalCard } from './approvalCard.ts'
import type { ChatRoutesOptions, ChatSessionFactory, ChatSettingsHost, ModelChoice } from './mod.ts'

/** ai:chat's defaults — one filing convention across hosts. */
const WEB_CHAT = { days: 7, contextTokens: 300_000 }

/** Every configuration, yours first, each with the roles it holds — what the picker lists. */
export function modelChoices(): ModelChoice[] {
  const rolesBy = new Map<string, string[]>()
  for (const [role, name] of Object.entries(ROLES)) {
    rolesBy.set(name, [...(rolesBy.get(name) ?? []), ROLE_LABEL[role] ?? role])
  }
  const choices = Object.entries(getAllProfiles()).map(([name, profile]) => ({
    name,
    label: prettyModel(profile.model),
    provider: PROVIDER_LABEL[profile.provider] ?? profile.provider,
    roles: rolesBy.get(name) ?? [],
  }))
  const builtin = (choice: ModelChoice) => Number(choice.name in PROFILES)
  return choices.toSorted((a, b) => builtin(a) - builtin(b))
}

/** The web chat's catalog and defaults: ai:chat's reasoning role and context ceiling. */
export function createChatSettingsHost(): ChatSettingsHost {
  return {
    defaultModel: ROLES.reasoning,
    defaultContextTokens: WEB_CHAT.contextTokens,
    choices: modelChoices,
    resolve: (name) => {
      const profile = getProfile(name)
      return { model: resolveProfile(profile), profile: { provider: profile.provider, model: profile.model } }
    },
  }
}

export function createChatHost(config: typeof ConfigModule, env: Record<string, string>): ChatRoutesOptions {
  const createSession: ChatSessionFactory = async (id, onEvent, prefs, ask) => {
    const context = CommandContext.server(config, env)
    const tasks = new CommandService(context)
    const startTime = context.notebookNow.plainDateTime
    const today = startTime.plainDate
    const profile = getProfile(prefs.profile ?? ROLES.reasoning)
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
      contextTokens: prefs.contextTokens ?? WEB_CHAT.contextTokens,
      resume: null,
      model: resolveProfile(profile),
      profile: { provider: profile.provider, model: profile.model },
      producers: contextProducers(tasks),
      ambient: await gatherContext(today, config.DIR_TIME, config.DIR_DATA, WEB_CHAT.days, {
        secrets: context.secrets,
        now: { date: clock.notebookDate, time: clock.notebookTime },
      }),
      systemPrompt: async () =>
        (
          await renderChatSystemPrompt({
            config: config as Record<string, unknown>,
            clock,
            memoryDir: config.DIR_AI_MEMORY,
          })
        ).prompt,
      // Every tool the terminal offers, gated the same way: the decorator's
      // needsApproval is the source of truth for what asks.
      tools: async ({ onExternalFiles, onAttachments }) => ({
        tools: {
          ...(env.PERPLEXITY_API_KEY ? createWebTools() : {}),
          // A browser has no shell directory, so a relative path resolves from home.
          ...createFileTools({ today, attachmentsRoot: config.DIR_ATTACHMENTS, cwd: config.DIR_HOME, onAttachments }),
          ...(await createNotebookTools(tasks, { onExternalFiles: (_toolName, files) => onExternalFiles(files) })),
        },
        toolApproval: createToolApprovalConfig(),
      }),
      // The card is the tool's own description of the call; the answer is the person's, from the page.
      approvalHandler: ({ toolName, input }) =>
        ask({ toolName, lines: approvalCard(toolName, input, getApprovalFormatter(toolName)) }),
      autosavePath: path.join(config.DIR_STATE_AI_CHATS, chatAutosaveFilename(startTime, id)),
      onEvent,
    })
  }

  return {
    createSession,
    settings: createChatSettingsHost(),
    endDefaults: { autoTag: true, autoRel: true, memoryDir: config.DIR_AI_MEMORY, people: true },
    timeDir: config.DIR_TIME,
    aboutMePath: config.FILE_ABOUT_ME,
  }
}
