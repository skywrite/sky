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
import { harvestFileRefs, SessionBlessings } from '#commands/all/ai/chat/lib/approvals.ts'
import { createFileTools } from '#commands/lib/chat/fileTools.ts'
import {
  createNotebookTools,
  createToolApprovalConfig,
  getApprovalFormatter,
  getApprovalSessionKey,
  sessionKeyToolNames,
  withoutBlankStrings,
} from '#commands/lib/chat/notebookTools.ts'
import { contextProducers } from '#commands/lib/chat/producers.ts'
import { renderChatSystemPrompt } from '#commands/lib/chat/systemPrompt.ts'
import { createWebTools } from '#commands/lib/chat/webTools.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { commandNameToToolName } from '#commands/lib/jsonSchema.ts'
import { EventOutput, type OutputEvent } from '#commands/lib/output/EventOutput.ts'
import { legalReviewBrief, legalReviewContext } from '#lib/legalReview/chat.ts'
import { createLegalReviewer } from '#lib/legalReview/runtime.ts'
import { summarizeTranscript } from '#lib/notebook/enrich/summarize.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { writingDraftBrief, writingDraftTools } from '#lib/writingVoice/draftChat.ts'
import { createWritingDrafts } from '#lib/writingVoice/runtime.ts'
import { createWritingVoiceTools } from '#lib/writingVoice/tools.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import {
  aiModel,
  getAllProfiles,
  getProfile,
  getRoles,
  PROFILES,
  resolveProfile,
  roleProfile,
} from '#shared/ai/models.ts'
import { createTypeSafeClient } from '#shared/ai/typesafe/client.ts'
import type * as ConfigModule from '#shared/config.ts'
import { readSkyConfigFile } from '#shared/config/loader.ts'
import { exists } from '#shared/fs/mod.ts'
import { logger } from '#shared/log.ts'
import { contextPreflight, type Preflight } from '#shared/models/Chat/ChatContext/preflight.ts'
import ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import { chatAutosaveFilename, isThreadSnapshot, listChatAutosaves } from '#shared/models/Chat/ChatStore/autosave.ts'
import type { ResumeSession } from '#shared/models/Chat/ChatStore/mod.ts'
import { buildChatTranscript, CHAT_ENRICH } from '#shared/models/Chat/enrich.ts'
import { isAIChatPath, parseTimePath } from '#shared/nbfs/mod.ts'
import truncate from '#shared/strings/truncate.ts'
import { effortLevels, isEffortOverride, presetEffort } from '#universal/ai/effort.ts'
import { fitBudget } from '#universal/ai/readingBudget.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { prettyModel, PROVIDER_LABEL, ROLE_LABEL } from '../settings/mod.ts'
import { approvalCard } from './approvalCard.ts'
import { chatFileContext } from './files.ts'
import { prepareChatImageResult } from './images.ts'
import { interruptedOf } from './interrupted.ts'
import type {
  ChatRoutesOptions,
  ChatSessionFactory,
  ChatSettingsHost,
  ModelChoice,
  ThreadPrefs,
  ThreadRestore,
  ToolOutputEvent,
} from './mod.ts'
import { readSession } from './readSession.ts'
import { restoreToolRuns } from './toolRuns.ts'

/** ai:chat's defaults — one filing convention across hosts. */
const WEB_CHAT = { days: 7, contextTokens: 300_000 }

/**
 * The experimental preflight, when the switch is on: Jev judges whether a
 * message needs the notebook before the turn reads it. The switch is read
 * fresh per message, so flipping it on the Experimental page applies to
 * the next one; the client is built once per thread, keyed from the
 * keychain on its first request.
 */
function contextPreflightFor(secrets: SecretsProvider): Preflight {
  let judge: Preflight | undefined
  return (message, recent) => {
    if (readSkyConfigFile()?.parsed.experimental?.contextPreflight !== true) return Promise.resolve(null)
    judge ??= contextPreflight(createTypeSafeClient({ secrets }))
    return judge(message, recent)
  }
}
const logRecovery = logger('chat.recovery')

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
  for (const [role, name] of Object.entries(getRoles())) {
    rolesBy.set(name, [...(rolesBy.get(name) ?? []), ROLE_LABEL[role] ?? role])
  }
  const all = getAllProfiles()
  const choices = Object.entries(all).map(([name, profile]) => ({
    name,
    label: prettyModel(profile.model),
    provider: PROVIDER_LABEL[profile.provider] ?? profile.provider,
    roles: rolesBy.get(name) ?? [],
    contextWindow: profile.contextWindow,
    effort: { default: presetEffort(profile), levels: effortLevels(profile) },
    builtin: name in PROFILES,
    group: JSON.stringify([
      profile.provider,
      profile.model,
      profile.baseUrl,
      profile.contextWindow,
      Object.entries(profile.options ?? {})
        .filter(([key]) => key !== 'effort' && key !== 'reasoningEffort')
        .sort(([a], [b]) => a.localeCompare(b)),
    ]),
  }))
  const builtin = (choice: ModelChoice) => Number(choice.name in PROFILES)
  return choices.toSorted((a, b) => builtin(a) - builtin(b))
}

/** The web chat's catalog and defaults: ai:chat's reasoning role and context ceiling. */
export function createChatSettingsHost(): ChatSettingsHost {
  return {
    get defaultModel() {
      return roleProfile('reasoning')
    },
    defaultContextTokens: WEB_CHAT.contextTokens,
    choices: modelChoices,
    // A logged model id back to a profile name: the thread's own when it is that model, else the first that is.
    profileFor: (model, current) => {
      const all = getAllProfiles()
      if (all[current]?.model === model) return current
      return Object.entries(all).find(([, profile]) => profile.model === model)?.[0]
    },
    resolve: (name, effort = 'default') => {
      const profile = getProfile(name)
      return {
        model: resolveProfile(profile, { effort }),
        profile: {
          model: profile.model,
          preset: name,
          effort: effort === 'default' ? (presetEffort(profile) ?? undefined) : effort,
        },
        contextWindow: profile.contextWindow,
      }
    },
  }
}

export function createChatHost(config: typeof ConfigModule, env: Record<string, string>): ChatRoutesOptions {
  const writingDrafts = createWritingDrafts(config)
  /** A thread's crash copy: the service's own snapshot, named by the thread id. */
  const snapshotPath = (id: string, startTime: PlainDateTime) =>
    path.join(config.DIR_STATE_AI_CHATS, chatAutosaveFilename(startTime, id))

  // Which (tool, file) pairs a thread may run without asking — the same
  // ledger the terminal keeps: a pasted file reference for the process, a
  // file the thread created or an "allow for this file" answer for good.
  const blessings = new Map<string, SessionBlessings>()
  const blessingsFor = (id: string): SessionBlessings => {
    let held = blessings.get(id)
    if (!held) blessings.set(id, (held = new SessionBlessings()))
    return held
  }

  const createSession: ChatSessionFactory = async (id, onEvent, prefs, ask, restore) => {
    const context = CommandContext.server(config, env)
    const blessed = blessingsFor(id)
    if (restore?.approvals) blessed.restoreDurable(restore.approvals)
    const tasks = new CommandService(context)
    // The tools' own command service hears its output: every line a tool
    // prints in the terminal goes to the page instead of a buffer nobody
    // reads. The producers keep the quiet one — a gather is not a tool.
    const toolTasks = new CommandService(
      context.fork({ output: new EventOutput(toolOutputSink(onEvent, summarizeToolRun)) }),
    )
    // A restored thread keeps the start it had: its day, and the snapshot it writes.
    const startTime = restore?.startTime ?? context.notebookNow.plainDateTime
    const today = startTime.plainDate
    const profileName = prefs.profile ?? roleProfile('reasoning')
    const profile = getProfile(profileName)
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
      contextTokens: fitBudget(prefs.contextTokens ?? WEB_CHAT.contextTokens, profile.contextWindow),
      preflight: contextPreflightFor(context.secrets),
      resume: restore?.resume ?? null,
      // A continued chat seeds from its resume; a snapshot or a branch from the state it was given.
      restore: restore?.resume ? undefined : restore?.state,
      attachments: restore?.attachments,
      parent: restore?.resume ? null : (restore?.parent ?? null),
      model: resolveProfile(profile, { effort: prefs.effort }),
      profile: {
        model: profile.model,
        preset: profileName,
        effort: prefs.effort && prefs.effort !== 'default' ? prefs.effort : (presetEffort(profile) ?? undefined),
      },
      producers: contextProducers(tasks),
      ambient: await gatherContext(today, config.DIR_TIME, config.DIR_DATA, WEB_CHAT.days, {
        secrets: context.secrets,
        now: { date: clock.notebookDate, time: clock.notebookTime },
      }),
      systemPrompt: async () => {
        const { prompt } = await renderChatSystemPrompt({
          config: config as Record<string, unknown>,
          clock,
          memoryDir: config.DIR_AI_MEMORY,
        })
        const files = chatFileContext(restore?.state.conversation ?? [], config.DIR_ATTACHMENTS)
        const parent = restore?.parent ?? restore?.resume?.parent
        const thread =
          parent?.kind === 'thread'
            ? 'You are continuing a reply thread attached to an earlier response. The inherited conversation is context for this work. Answer the user and run all needed specialist tools here, in this same thread. Continue refining existing drafts and documents using the earlier review and tool results. Do not create nested conversations or send messages into the parent chat. Keep the current result easy to identify.'
            : ''
        return [prompt, files, thread].filter(Boolean).join('\n\n')
      },
      // Every tool the terminal offers, gated the same way: the decorator's
      // needsApproval is the source of truth for what asks.
      tools: async (hooks) => {
        const { onExternalFiles, onAttachments, onImages } = hooks
        return {
          instructions: [await legalReviewBrief(hooks, config), await writingDraftBrief(hooks, writingDrafts)]
            .filter(Boolean)
            .join('\n\n'),
          tools: {
            ...createWritingVoiceTools(writingDrafts.voice, {
              source: `chat:${id}`,
              drafts: writingDraftTools(hooks, writingDrafts, `chat:${id}`),
            }),
            ...(env.PERPLEXITY_API_KEY ? createWebTools() : {}),
            // A browser has no shell directory, so a relative path resolves from home.
            ...createFileTools({ today, attachmentsRoot: config.DIR_ATTACHMENTS, cwd: config.DIR_HOME, onAttachments }),
            ...(await createNotebookTools(toolTasks, {
              researchContext: hooks.researchContext,
              legalReviewContext: legalReviewContext(hooks, config.DIR_ATTACHMENTS, `chat:${id}`),
              prepareResult: prepareChatImageResult({
                today,
                attachmentsRoot: config.DIR_ATTACHMENTS,
                onAttachments,
                onImages,
              }),
              onExternalFiles: (_toolName, files) => {
                // A file this thread created is blessed: editing it again is
                // the same intent that created it.
                for (const file of files) {
                  if (file.action !== 'created' || !file.id) continue
                  for (const tool of sessionKeyToolNames()) blessed.blessDurably(tool, file.id)
                }
                onExternalFiles(files)
              },
            })),
          },
          toolApproval: createToolApprovalConfig({
            context: tasks.context,
            isBlessed: (toolName, key) => blessed.has(toolName, key),
          }),
        }
      },
      // The card is the tool's own description of the call; the answer is the
      // person's, from the page. A card scoped to a file offers "allow for
      // this file"; that answer blesses the file for the thread.
      approvalHandler: async ({ toolName, input: raw, abortSignal }) => {
        // The card and the key read the call as the command will: blanks dropped.
        const input = withoutBlankStrings(raw as Record<string, unknown>)
        const sessionKey = getApprovalSessionKey(toolName)?.(input)
        const lines = await approvalCard(toolName, input, getApprovalFormatter(toolName), context)
        abortSignal?.throwIfAborted()
        const decision = await ask({
          toolName,
          lines,
          sessionKey,
        })
        if (decision.approved && decision.always && sessionKey) blessed.blessDurably(toolName, sessionKey)
        return decision
      },
      approvals: () => blessed.serializeDurable(),
      autosavePath: snapshotPath(id, startTime),
      onEvent,
    })
  }

  // The threads the last run left behind: the service's own snapshots (a
  // thread id, never a terminal's pid), read back as the state each held.
  const snapshots = async (): Promise<ThreadRestore[]> => {
    const refs = (await listChatAutosaves(config.DIR_STATE_AI_CHATS)).filter(isThreadSnapshot)
    const restores: ThreadRestore[] = []
    for (const ref of refs) {
      try {
        // A snapshot holds the whole thread, parent turns included; the key says which are inherited.
        const loaded = await readSession(ref.path, { baseDir: config.DIR_BASE, snapshot: true })
        // A snapshot ending on the person's message is a thread the service went down answering.
        const { state, interrupted } = interruptedOf(loaded.state)
        if (state.conversation.length > 0 || interrupted) {
          const { approvals, parent } = loaded
          const recovery = loaded.recovery
          const host = recovery?.host
          // The budget the last turn ran under; for a log older than turn settings, the last assembly's ceiling.
          const budget =
            recovery?.contextTokens ??
            state.contextLog.findLast((entry) => entry.settings?.contextTokens !== undefined)?.settings
              ?.contextTokens ??
            state.contextLog.findLast((entry) => entry.stats?.budget !== undefined)?.stats?.budget
          const priorModel = state.contextLog.findLast((entry) => entry.settings)?.settings?.model
          const profile =
            typeof host?.profile === 'string'
              ? host.profile
              : Object.entries(getAllProfiles()).find(([, candidate]) => candidate.model === priorModel)?.[0]
          const prefs: ThreadPrefs = {
            effort: isEffortOverride(host?.effort) ? host.effort : 'default',
            saves: typeof host?.saves === 'boolean' ? host.saves : true,
            ...(profile ? { profile } : {}),
            ...(budget !== undefined ? { contextTokens: budget } : {}),
          }
          const saved = typeof host?.saved === 'string' ? await openSaved(host.saved) : null
          restores.push({
            id: ref.session,
            runs: restoreToolRuns(host?.runs),
            startTime: ref.startTime,
            state,
            approvals,
            attachments: loaded.attachments,
            parent,
            interrupted,
            prefs,
            title: typeof host?.title === 'string' ? host.title : null,
            parentId: typeof host?.parentId === 'string' ? host.parentId : null,
            ...(saved
              ? { resume: { ...saved.resume, state, rel: loaded.rel, attachments: loaded.attachments, approvals } }
              : {}),
          })
        }
      } catch (error) {
        // An unreadable snapshot stays for the sweep; it must not stop the others.
        logRecovery.warn('Could not restore chat snapshot {file}: {error}', {
          file: ref.path,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return restores
  }

  // A saved chat by its notebook-relative path, as a thread to continue. The
  // path must be a chat under the time tree; its start is the file's day and
  // the time key its name leads with.
  const openSaved = async (chat: string): Promise<{ resume: ResumeSession; startTime: PlainDateTime } | null> => {
    const abs = path.resolve(config.DIR_BASE, chat)
    const timeRoot = path.resolve(config.DIR_TIME)
    if (!abs.startsWith(`${timeRoot}${path.sep}`) || !isAIChatPath(abs) || !abs.endsWith('.md')) return null
    if (!(await exists(abs))) return null
    const resume = await readSession(abs, { baseDir: config.DIR_BASE })
    const info = parseTimePath(abs)
    const time = path.basename(abs).match(/^(\d{1,3})-(\d{2})_/)
    const day = info?.kind === 'day' ? info.date.ymd : resume.created
    if (!day) return null
    const startTime = new PlainDateTime(`${day} ${time ? `${time[1]}:${time[2]}` : '00:00'}`)
    return { resume, startTime }
  }

  return {
    createSession,
    selectionStarts: { dir: path.join(config.DIR_STATE_AI_CHATS, 'selection-starts') },
    writingDrafts,
    legalReviews: createLegalReviewer(config).store,
    attachmentsRoot: config.DIR_ATTACHMENTS,
    // A pasted Google file reference is permission to work on that file —
    // for this process; a paste is not a standing grant.
    onMessage: (id, message) => {
      for (const fileId of harvestFileRefs(message)) blessingsFor(id).blessMention(fileId)
    },
    snapshotPath,
    snapshots,
    openSaved,
    // The shared fast titler can name the opening question before its reply arrives.
    title: (turns) => summarizeTranscript(buildChatTranscript(turns), { kind: CHAT_ENRICH.kind }),
    settings: createChatSettingsHost(),
    endDefaults: {
      autoTag: true,
      autoRel: true,
      memoryDir: config.DIR_AI_MEMORY,
      people: true,
      logToDay: { category: config.DEFAULT_CATEGORY },
    },
    timeDir: config.DIR_TIME,
    aboutMePath: config.FILE_ABOUT_ME,
  }
}
