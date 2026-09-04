/**
 * The service's wiring of a chat session: the same producers, prompt,
 * tools, and filing policy as ai:chat, built from an in-process
 * CommandService. A tool call that needs the person's go is put to the
 * page as a card, through the routes, and the turn waits for the answer —
 * the same protocol the terminal runs with a prompt. What a tool prints
 * as it works goes to the page too, line by line, where the terminal
 * would print it.
 */

import * as path from 'node:path'
import { generateText } from 'ai'
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
import { commandNameToToolName } from '#commands/lib/jsonSchema.ts'
import { EventOutput, type OutputEvent } from '#commands/lib/output/EventOutput.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { aiModel, getAllProfiles, getProfile, PROFILES, resolveProfile, ROLES } from '#shared/ai/models.ts'
import type * as ConfigModule from '#shared/config.ts'
import ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import { chatAutosaveFilename } from '#shared/models/Chat/ChatStore/autosave.ts'
import truncate from '#shared/strings/truncate.ts'
import type { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { prettyModel, PROVIDER_LABEL, ROLE_LABEL } from '../settings/mod.ts'
import { approvalCard } from './approvalCard.ts'
import type { ChatRoutesOptions, ChatSessionFactory, ChatSettingsHost, ModelChoice, ToolOutputEvent } from './mod.ts'

/** ai:chat's defaults — one filing convention across hosts. */
const WEB_CHAT = { days: 7, contextTokens: 300_000 }

/** The terminal's bullet on a progress line; the page draws its own marks. */
const BULLET = /^[◦•]\s+/

/** The newest lines a run's summary is drawn from — the end of a long run is what it did. */
const SUMMARY_LINES = 120
/** A summary is a label, not a paragraph. */
const SUMMARY_CHARS = 120
/** A label that takes longer than this is not worth waiting for. */
const SUMMARY_TIMEOUT_MS = 20_000

/** One line on what an ended run did, or null when there is nothing to say. */
export type RunSummarizer = (
  tool: string,
  lines: string[],
  status: 'success' | 'fail' | 'error',
) => Promise<string | null>

/**
 * A small model's one line on a finished run — the label its output folds
 * under on the page. A failure logs and yields nothing; the page shows the
 * run's last line instead.
 */
export async function summarizeToolRun(
  tool: string,
  lines: string[],
  status: 'success' | 'fail' | 'error',
): Promise<string | null> {
  try {
    const result = await generateText({
      ...aiModel('fast', { maxOutputTokens: 64 }),
      abortSignal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
      prompt: `A tool called "${tool.replaceAll('_', ' ')}" just ran inside a chat and ${status === 'success' ? 'finished' : 'failed'}. These are the lines it printed while working, oldest first:

"""
${lines.join('\n')}
"""

Write the one line a person wants in place of all of that, at a glance: what the tool did or found, with the numbers that matter, and how it ended only if it did not end cleanly. At most twelve plain words. No quotes, no trailing period, no preamble, no words like "output" or "summary".`,
    })
    const text = (result.text.trim().split('\n')[0] ?? '').replace(/^["'“”]+|["'“”.]+$/g, '').trim()
    return text ? truncate(text, SUMMARY_CHARS) : null
  } catch (err) {
    await logAIError({
      source: 'chat',
      stage: 'tool-summary',
      message: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * Command output as tool events. A chat tool is a command run one level
 * under the session's context; whatever it composes runs deeper and
 * speaks for the tool that ran it. Boundaries come from the command
 * service; lines carry the terminal's words minus their colors and
 * bullets. Streamed pieces gather until a line ends, or the run does.
 * When a run ends with more than one line, the summarizer is asked for
 * its one line, reported once it answers; a single line is its own label.
 */
export function toolOutputSink(
  report: (event: ToolOutputEvent) => void,
  summarize?: RunSummarizer,
): (event: OutputEvent) => void {
  let current: string | null = null
  let partial = ''
  let said: string[] = []
  const line = (tool: string, text: string, level: 'log' | 'error' = 'log') => {
    const clean = text.replace(BULLET, '').trimEnd()
    if (!clean.trim()) return
    report({ type: 'tool-line', tool, text: clean, level })
    said.push(clean)
    if (said.length > SUMMARY_LINES) said.shift()
  }
  const flush = (tool: string) => {
    if (partial) line(tool, partial)
    partial = ''
  }
  return (event) => {
    if (event.type === 'command-start') {
      if (event.depth === 1) {
        current = commandNameToToolName(event.command)
        partial = ''
        said = []
        report({ type: 'tool-started', tool: current })
      }
      return
    }
    if (event.type === 'command-end') {
      if (event.depth === 1) {
        const tool = commandNameToToolName(event.command)
        flush(tool)
        report({ type: 'tool-finished', tool, status: event.status })
        current = null
        if (summarize && said.length > 1) {
          void summarize(tool, said, event.status).then((text) => {
            if (text) report({ type: 'tool-summary', tool, text })
          })
        }
        said = []
      }
      return
    }
    // Output before any tool runs is the session's own, not a tool's.
    const tool = event.depth === 1 && event.command ? commandNameToToolName(event.command) : current
    if (!tool) return
    switch (event.type) {
      case 'line':
        line(tool, partial + event.text, event.level)
        partial = ''
        break
      case 'text': {
        partial += event.text
        const pieces = partial.split('\n')
        partial = pieces.pop() ?? ''
        for (const piece of pieces) line(tool, piece)
        break
      }
      case 'stage':
        line(tool, event.detail ? `${event.label} · ${event.detail}` : event.label)
        break
      case 'tick':
        // In-place counts are the terminal's; the page hears the closing one.
        if (event.total === null || event.done >= event.total) {
          line(
            tool,
            `${event.total === null ? event.done : `${event.done} of ${event.total}`}${event.unit ? ` ${event.unit}` : ''}`,
          )
        }
        break
      default:
        break
    }
  }
}

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
  /** A thread's crash copy: the service's own snapshot, named by the thread id. */
  const snapshotPath = (id: string, startTime: PlainDateTime) =>
    path.join(config.DIR_STATE_AI_CHATS, chatAutosaveFilename(startTime, id))

  const createSession: ChatSessionFactory = async (id, onEvent, prefs, ask) => {
    const context = CommandContext.server(config, env)
    const tasks = new CommandService(context)
    // The tools' own command service hears its output: every line a tool
    // prints in the terminal goes to the page instead of a buffer nobody
    // reads. The producers keep the quiet one — a gather is not a tool.
    const toolTasks = new CommandService(
      context.fork({ output: new EventOutput(toolOutputSink(onEvent, summarizeToolRun)) }),
    )
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
          ...(await createNotebookTools(toolTasks, { onExternalFiles: (_toolName, files) => onExternalFiles(files) })),
        },
        toolApproval: createToolApprovalConfig(),
      }),
      // The card is the tool's own description of the call; the answer is the person's, from the page.
      approvalHandler: ({ toolName, input }) =>
        ask({ toolName, lines: approvalCard(toolName, input, getApprovalFormatter(toolName)) }),
      autosavePath: snapshotPath(id, startTime),
      onEvent,
    })
  }

  return {
    createSession,
    snapshotPath,
    settings: createChatSettingsHost(),
    endDefaults: { autoTag: true, autoRel: true, memoryDir: config.DIR_AI_MEMORY, people: true },
    timeDir: config.DIR_TIME,
    aboutMePath: config.FILE_ABOUT_ME,
  }
}
