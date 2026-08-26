import * as path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import * as p from '@clack/prompts'
import { generateText, jsonSchema } from 'ai'
import openEditor from 'open-editor'
import colors from 'picocolors'
import { Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { summarizeTranscript } from '#lib/notebook/enrich/summarize.ts'
import { AI_ERROR_LOG_DISPLAY, logAIError } from '#shared/ai/errorLog.ts'
import { aiModel, getProfile, resolveProfile, ROLES } from '#shared/ai/models.ts'
import { DIR_AI_MEMORY, DIR_STATE_AI_CHATS, PORT_SERVER } from '#shared/config.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { recordExternalFiles } from '#shared/models/Chat/artifactRel.ts'
import { fetchWithConnectRetry } from '#shared/models/Chat/ChatContext/fetchContext.ts'
import ChatContext, { type RebuildReport, type TurnContextReport } from '#shared/models/Chat/ChatContext/mod.ts'
import ChatEngine, { TurnError } from '#shared/models/Chat/ChatEngine/mod.ts'
import {
  chatAutosaveFilename,
  clearChatAutosave,
  sweepChatAutosaves,
  writeChatAutosave,
} from '#shared/models/Chat/ChatStore/autosave.ts'
import { listDayChats, loadResumeSession, type ResumeSession } from '#shared/models/Chat/ChatStore/mod.ts'
import { saveChat } from '#shared/models/Chat/ChatStore/save.ts'
import { firstWordsSummary } from '#shared/models/Chat/document/mod.ts'
import { buildChatTranscript, CHAT_ENRICH } from '#shared/models/Chat/enrich.ts'
import { loadMemories, renderPreferenceBlock } from '#shared/models/Memory/mod.ts'
import { dayDir, fetchNow } from '#shared/nbfs/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import truncate from '#shared/strings/truncate.ts'
import { type AIContext, gatherContext } from '../_lib/gatherContext.ts'
import { formatPeopleBlock, gatherPeopleEntities } from '../context/_entityContext.ts'
import { createNotebookTools, createToolApprovalConfig, getApprovalFormatter, getApprovalSessionKey } from './_tools.ts'
import { clearTerminalTitle, setTerminalTitle } from './lib/terminalTitle.ts'
import { promptWithInk } from './ui/promptWithInk.tsx'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  message: Flag.string('Initial message to start the conversation', {
    short: 'm',
    optional: true,
  }),
  reasoning: Flag.string('Reasoning model profile for chat turns (e.g. default-opus-5, default-local-reasoning)', {
    short: 'r',
    default: () => ROLES.reasoning,
  }),
  fast: Flag.string('Fast model profile for summaries and quick tasks (e.g. default-haiku-4.5, default-local-fast)', {
    short: 'f',
    default: () => ROLES.fast,
  }),
  days: Flag.number('Number of days to look back for context', {
    short: 'd',
    default: () => 7,
  }),
  contextTokens: Flag.number('Token budget ceiling for the assembled document context', {
    default: () => 300_000,
  }),
  summaryBaseline: Flag.bool(
    'Seed days before yesterday from summary.md (else day.md alone) instead of every raw file',
    { default: true },
  ),
  inspectInitialContext: Flag.bool('List initial context file paths and exit', {
    default: false,
  }),
  category: Flag.string('Category for the chat (e.g., reflection, planning)', {
    short: 'c',
    optional: true,
  }),
  log: Flag.bool('Log chat to day file as complete item', {
    default: false,
  }),
  ephemeral: Flag.bool('Chat without saving conversation to file', {
    short: 'E',
    default: false,
  }),
  noEditor: Flag.bool('Skip opening editor', { hidden: true }),
  noAutoTag: Flag.bool('Skip automatic tagging from the archived-chat tag corpus', { default: false }),
  noAutoRel: Flag.bool('Skip automatic rel suggestion from the entity graph', { default: false }),
  resume: Flag.bool('Resume a saved chat from the current day: conversation and context restored, same file updated', {
    default: false,
  }),
  when: whenNBTime(),
}

type Params = InferParams<typeof params>

import type { ConversationMessage } from '#shared/models/Chat/type.d.ts'

type Result = { saved?: string; turns?: number }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ai:chat': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const PROMPT_FILE = new URL('./prompts/chat.prompt.md', import.meta.url).pathname

/** Verb per memory op for the exit summary's 🧠 lines. */
const MEMORY_VERBS: Record<string, string> = {
  create: 'remembered',
  confirm: 'reinforced',
  update: 'revised',
  delete: 'forgot',
  propose: 'proposed',
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function formatHealthSection(health: AIContext['health']): string {
  if (health.length === 0) return '(No health data available)'

  const lines: string[] = []
  for (const { date, data } of health) {
    const parts: string[] = []
    if (data.sleep) parts.push(`Sleep: ${data.sleep.range} (${data.sleep.duration} hrs)`)
    if (data.weight) parts.push(`Weight: ${data.weight} lbs`)
    if (data.strength) {
      const sessions = data.strength.map((s) => `${s.lbs} lbs${s.duration ? `, ${s.duration} mins` : ''}`).join('; ')
      parts.push(`Strength: ${sessions}`)
    }
    if (data.work) parts.push(`Work: ${data.work.duration} hrs`)
    if (parts.length > 0) lines.push(`- **${date}**: ${parts.join(' | ')}`)
  }
  return lines.join('\n')
}

function formatPriceSection(prices: AIContext['prices']): string {
  if (prices.length === 0) return '(No price data available)'

  const lines: string[] = []
  for (const { date, data } of prices) {
    const parts = data.prices.map((p) => {
      const formatted =
        p.value >= 1000 ? p.value.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p.value.toFixed(2)
      return `${p.symbol}: $${formatted}`
    })
    if (parts.length > 0) lines.push(`- **${date}**: ${parts.join(' | ')}`)
  }
  return lines.join('\n')
}

interface ContextInput {
  ctx: AIContext
  days: number
  activityMarkdown: string | null
}

function buildContextPrompt({ ctx, days, activityMarkdown }: ContextInput): string {
  const parts: string[] = []

  parts.push(`# Context for ${ctx.today.date} (${ctx.today.dayOfWeek})`)
  parts.push('')

  // 1. Prices
  parts.push('## Prices')
  parts.push('')
  parts.push(formatPriceSection(ctx.prices))
  parts.push('')

  // 2. Health
  parts.push('## Health')
  parts.push('')
  parts.push(formatHealthSection(ctx.health))
  parts.push('')

  // 3. Activity (goals, summaries, today's docs, previous days' journals via DomainCollection)
  parts.push('## Activity')
  parts.push('')
  if (activityMarkdown) {
    parts.push(activityMarkdown)
  } else {
    parts.push('(No activity recorded)')
  }

  return parts.join('\n')
}

/**
 * Notebook datetime for a turn stamp (`YYYY-MM-DD HH:MM`, extended hours
 * kept). Undefined when now can't be computed — the turn proceeds
 * unstamped rather than failing.
 */
async function fetchWhen(): Promise<string | undefined> {
  try {
    return (await fetchNow()).plainDateTime.toString()
  } catch {
    return undefined
  }
}

interface OlderChatRow {
  path: string
  date: string
  when: string | null
  summary: string | null
  turns: number
}

/**
 * Second-level resume picker reaching chats from previous days via the
 * service's chats query (listing fields only — no markdown fetched).
 * Returns the picked absolute path, or null on cancel/none/unreachable.
 */
async function pickOlderChat(
  todayYmd: string,
  baseDir: string,
  output: { log: (msg: string) => void },
): Promise<string | null> {
  let rows: OlderChatRow[]
  try {
    const resp = await fetchWithConnectRetry(`http://localhost:${PORT_SERVER}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ chats(limit: 500) { path date when summary turns } }' }),
    })
    const json = (await resp.json()) as { data?: { chats?: OlderChatRow[] }; errors?: Array<{ message: string }> }
    if (!json.data?.chats) {
      output.log(colors.yellow(`Older chats unavailable: ${json.errors?.[0]?.message ?? 'empty response'}`))
      return null
    }
    rows = json.data.chats
  } catch (err) {
    output.log(colors.yellow(`Older chats unavailable — notebook service unreachable (${(err as Error).message})`))
    return null
  }

  const older = rows
    .filter((c) => c.date !== todayYmd)
    .sort((a, b) => (b.date + (b.when ?? '')).localeCompare(a.date + (a.when ?? '')))
    .slice(0, 100)
  if (older.length === 0) {
    output.log(colors.yellow('No older chats found.'))
    return null
  }

  const picked = await p.select({
    message: 'Resume which chat?',
    options: older.map((c) => ({
      value: path.isAbsolute(c.path) ? c.path : path.join(baseDir, c.path),
      label: `${c.date} ${c.when ?? ''}  ${truncate(c.summary || path.basename(c.path), 60)}`,
      hint: `${c.turns} turn${c.turns === 1 ? '' : 's'}`,
    })),
  })
  if (p.isCancel(picked)) {
    output.log(colors.dim('Cancelled.'))
    return null
  }
  return <string>picked
}

// -----------------------------------------------------------------------------
// Web Search Tool (Perplexity Search API)
// -----------------------------------------------------------------------------

interface SearchResult {
  title: string
  url: string
  snippet: string
}

/** Strip HTML tags and collapse whitespace to get readable text. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

const MAX_FETCH_CHARS = 20000

function createWebTools() {
  return {
    web_search: {
      description:
        'Search the web for current information. Use this when the user asks about recent events, news, facts you are unsure about, or anything that requires up-to-date information beyond the notebook context.',
      inputSchema: jsonSchema<{ query: string }>({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      }),
      execute: async ({ query }: { query: string }): Promise<SearchResult[]> => {
        const apiKey = globalThis.process?.env?.PERPLEXITY_API_KEY
        if (!apiKey) return []

        const resp = await fetch('https://api.perplexity.ai/search', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query, max_results: 5 }),
        })

        if (!resp.ok) return []

        const data = await resp.json()
        const results: SearchResult[] = (data.results ?? []).map(
          (r: { title?: string; url?: string; snippet?: string }) => ({
            title: r.title ?? '',
            url: r.url ?? '',
            snippet: r.snippet ?? '',
          }),
        )
        return results
      },
    },
    web_fetch: {
      description:
        'Fetch the full content of a web page by URL. Use this after web_search to read the full text of a promising result.',
      inputSchema: jsonSchema<{ url: string }>({
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch' },
        },
        required: ['url'],
      }),
      execute: async ({ url }: { url: string }): Promise<string> => {
        try {
          const resp = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NotebookBot/1.0)' },
            signal: AbortSignal.timeout(10000),
          })
          if (!resp.ok) return `Error: ${resp.status} ${resp.statusText}`

          const contentType = resp.headers.get('content-type') ?? ''
          const raw = await resp.text()

          const text = contentType.includes('html') ? htmlToText(raw) : raw
          return truncate(text, MAX_FETCH_CHARS, '\n\n[Content truncated...]')
        } catch (err) {
          return `Error fetching URL: ${(err as Error).message}`
        }
      },
    },
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class AiChatTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:chat',
    description: 'Start a conversational AI session with full Notebook context.',
    descriptionLong: [
      'Starts an interactive conversation with Claude, loaded with context from your Notebook:',
      '- Last N days of summaries and journals',
      '- Personal and professional goals',
      '- Health data (sleep, weight, strength, work)',
      '- Price data (BTC, SPY, EXOD)',
      '',
      'The conversation continues until you press Ctrl+C or submit empty input.',
      'Chats are saved by default to the {day}/actions/ai-chats/ folder —',
      'toggle saving off with Ctrl+S (or /nosave), or start ephemeral with -E.',
      'Day-file logging stays opt-in (Ctrl+L or /log).',
      'Crash insurance: every completed turn also snapshots the session under',
      'the state dir (state/ai/chats); every clean exit removes the snapshot,',
      'so a file left there is a session that died mid-conversation.',
      'Saved chats are searchable in later sessions via the chats GraphQL query.',
      'On save, missing tags: and rel: are chosen automatically from how past chats',
      'were filed (--no-auto-tag / --no-auto-rel to skip); hand-written and resumed',
      'values always win.',
      '',
      'Resume: --resume lists the saved chats for the day (--when shifts the day,',
      'and Older… reaches previous days). The picked chat continues as if the',
      'session never exited — conversation reseeded, recorded context restored',
      'from the context log — and exiting updates the same file in place. Resuming',
      'always saves back; exiting with no new messages touches nothing.',
    ],
    usage: [
      'sky ai:chat                              # Claude Opus 4.8 (default), Haiku for fast',
      'sky ai:chat -m "What should I focus on?" # Start with initial message',
      'sky ai:chat -r default-local-reasoning   # Use local LM Studio model',
      'sky ai:chat -r default-local-reasoning -f default-local-fast  # Local reasoning + local fast',
      'sky ai:chat -r my-lm-studio              # Use custom config profile',
      'sky ai:chat --days 14                    # Include 14 days of context',
      'sky ai:chat --no-summary-baseline        # Every raw file for all days (old flood)',
      'sky ai:chat -E                           # Ephemeral: exit without saving',
      'sky ai:chat --resume                     # Pick a chat from today and continue it',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, config, env } = context
    const {
      reasoning: reasoningProfileName,
      fast: fastProfileName,
      days,
      contextTokens,
      summaryBaseline,
      inspectInitialContext,
      category,
      when,
      noEditor,
      noAutoTag,
      noAutoRel,
      resume,
    } = args
    let { log, ephemeral } = args
    let { message: initialMessage } = args

    const timeDir = <string>config.DIR_TIME
    const dataDir = <string>config.DIR_DATA

    // Resolve the chosen reasoning profile (--reasoning) for turns; a fast model for summaries.
    const reasoningProfile = getProfile(reasoningProfileName)
    const reasoning = resolveProfile(reasoningProfile)
    const fastProfile = getProfile(fastProfileName)
    const fast = resolveProfile(fastProfile)

    output.log(`Gathering context from last ${days} days...`)

    // Get current notebook time
    let t0 = performance.now()
    const now = await fetchNow()
    const today = when?.plainDate ?? now.plainDateTime.plainDate
    const startTime = now.plainDateTime
    output.log(colors.dim(`[server] fetchNow: ${(performance.now() - t0).toFixed(0)}ms`))

    // Crash insurance: every completed turn snapshots this session here and
    // every clean exit clears it, so a leftover file is a session that died
    // mid-conversation (see ChatStore/autosave.ts). Old leftovers sweep in
    // the background.
    const autosavePath = path.join(DIR_STATE_AI_CHATS, chatAutosaveFilename(startTime, process.pid))
    sweepChatAutosaves(DIR_STATE_AI_CHATS, startTime.plainDate).catch(() => {})

    // --resume: pick one of the day's saved chats (--when shifts the day)
    // and continue it as if the session never exited: conversation reseeded,
    // recorded context universe restored, and the same file updated on exit.
    let resumeSession: ResumeSession | null = null
    if (resume) {
      const chats = await listDayChats(path.join(timeDir, dayDir(today), 'actions', 'ai-chats'))

      const OLDER = '__older__'
      let filePath: string
      if (chats.length === 0) {
        output.log(colors.dim(`No saved chats for ${today} — showing older chats.`))
        const older = await pickOlderChat(String(today), <string>config.DIR_BASE, output)
        if (!older) return CommandResult.success({ turns: 0 })
        filePath = older
      } else {
        const picked = await p.select({
          message: `Resume which chat from ${today}?`,
          options: [
            ...chats.map((c) => ({
              value: c.path,
              label: `${c.time}  ${truncate(c.summary || path.basename(c.path), 70)}`,
              hint: `${c.exchanges} exchange${c.exchanges === 1 ? '' : 's'}`,
            })),
            { value: OLDER, label: 'Older…', hint: 'previous days' },
          ],
        })
        if (p.isCancel(picked)) {
          output.log(colors.dim('Cancelled.'))
          return CommandResult.success({ turns: 0 })
        }
        if (picked === OLDER) {
          const older = await pickOlderChat(String(today), <string>config.DIR_BASE, output)
          if (!older) return CommandResult.success({ turns: 0 })
          filePath = older
        } else {
          filePath = <string>picked
        }
      }

      resumeSession = await loadResumeSession(filePath)
      if (resumeSession.state.conversation.length === 0) {
        return CommandResult.fail(`Nothing to resume: no conversation parsed from ${filePath}`)
      }
      // Resuming a saved chat always writes back — overrides an explicit -E.
      ephemeral = false
      if (!resumeSession.frontmatterHealthy) {
        output.log(
          colors.yellow(
            'Warning: malformed frontmatter (turns: swallowed following lines) — this session will NOT overwrite the file; a recovery copy will be written on exit.',
          ),
        )
      }
    }

    // Gather all context (summaries, health, prices)
    t0 = performance.now()
    const ctx = await gatherContext(today, timeDir, dataDir, days)
    output.log(colors.dim(`[server] gatherContext: ${(performance.now() - t0).toFixed(0)}ms`))

    const baseDir = <string>config.DIR_BASE

    // The chat's document context lives in ChatContext: the baseline
    // universe, query-driven growth across turns, boost/pinning state, and
    // the per-turn context log. The command wires the producers to the
    // command pipeline and renders the reports the class returns.
    const chatContext = new ChatContext({
      today,
      days,
      baseDir,
      maxTokens: contextTokens,
      summaryBaseline,
      ownChatPath: resumeSession?.filePath ?? null,
      producers: {
        produceInitialQuery: async (userMessage) => {
          const r = await tasks.run('ai:context:files', {
            _: ['ai:context:files', userMessage],
            server: true,
          })
          return r.status === 'success'
            ? {
                ok: true,
                value: {
                  paths: r.data?.paths ?? [],
                  query: r.data?.query,
                  truncations: r.data?.truncations,
                  since: r.data?.since,
                  until: r.data?.until,
                  start: r.data?.start,
                },
              }
            : { ok: false, message: r.message ?? 'ai:context:files failed' }
        },
        evolveQueries: async (userMessage, queries, recentConversation) => {
          const r = await tasks.run<{ queries: string[]; changed: boolean }>('ai:context:evolve', {
            _: ['ai:context:evolve', userMessage],
            queries: JSON.stringify(queries),
            conversation: JSON.stringify(recentConversation),
          })
          return r.status === 'success'
            ? { ok: true, value: { queries: r.data?.queries ?? [], changed: r.data?.changed ?? false } }
            : { ok: false, message: r.message ?? 'ai:context:evolve failed' }
        },
        executeQuery: async (query) => {
          const r = await tasks.run('markdown:sel', { graphql: query, raw: true, server: 'true' })
          return r.status === 'success'
            ? { ok: true, value: { paths: r.data?.paths ?? [], truncations: r.data?.truncations } }
            : { ok: false, message: r.message ?? 'Context query failed' }
        },
      },
      onProgress: (event) => {
        if (event.type === 'queries-changed') output.log(colors.dim('Context shifting...'))
        else if (event.type === 'no-new-queries') output.log(colors.dim('Queries unchanged, skipping re-execution.'))
        else if (event.type === 'truncated') {
          for (const t of event.items) {
            const cap = t.defaulted ? `default cap ${t.limit}` : `limit ${t.limit}`
            output.log(
              colors.yellow(`⚠ ${t.field}: ${t.matched} matched, ${t.returned} returned — ${cap} hit, rest dropped`),
            )
          }
        }
      },
    })

    let peopleEntities: Awaited<ReturnType<typeof gatherPeopleEntities>> = []

    // A resumed chat with a context log restores its recorded universe exactly —
    // no fresh baseline injection. New documents enter only through the
    // normal evolve path afterward. (Pre-log transcripts fall through to the
    // fresh gather below.)
    const restoring = resumeSession !== null && resumeSession.state.contextLog.length > 0
    let restored: Awaited<ReturnType<ChatContext['restore']>> | null = null

    if (restoring && resumeSession) {
      output.log(colors.dim('[resume] Resolving recorded context universe...'))
      t0 = performance.now()
      restored = await chatContext.restore(resumeSession.state)
      peopleEntities = await gatherPeopleEntities(config as Record<string, unknown>)

      const { resolution } = restored
      const parts = [`${resolution.resolved.length} of ${resumeSession.state.universePaths.length} restored`]
      if (resolution.remapped > 0) parts.push(`${resolution.remapped} via day-dir remap`)
      if (resolution.suffixMatched > 0) parts.push(`${resolution.suffixMatched} via basename match`)
      output.log(colors.dim(`[resume] Universe: ${parts.join(', ')} (${(performance.now() - t0).toFixed(0)}ms)`))
      if (resolution.unresolved.length > 0) {
        output.log(colors.yellow(`[resume] ${resolution.unresolved.length} recorded paths could not be resolved:`))
        for (const u of resolution.unresolved.slice(0, 10)) {
          output.log(colors.yellow(`  - ${u}`))
        }
        if (resolution.unresolved.length > 10) {
          output.log(colors.yellow(`  … and ${resolution.unresolved.length - 10} more`))
        }
      }
    } else {
      output.log(colors.dim(`[server] Fetching context from server...`))

      // Parallel: the baseline gather and the interaction-ranked people
      // list for system prompt grounding
      const [seed, people] = await Promise.all([
        chatContext.seedBaseline(),
        gatherPeopleEntities(config as Record<string, unknown>),
      ])
      peopleEntities = people
      output.log(
        colors.dim(
          `[server] POST /context x5: ${seed.fetchMs.toFixed(
            0,
          )}ms — today=${seed.counts.today}, prev=${seed.counts.prev}, goals=${seed.counts.goals}, decisions=${seed.counts.decisions}, memory=${seed.counts.memory}`,
        ),
      )

      if (inspectInitialContext) {
        const sorted = chatContext.paths.map((f) => (f.startsWith(baseDir) ? f.slice(baseDir.length + 1) : f)).sort()
        for (const f of sorted) {
          output.log(f)
        }
        return CommandResult.success({ turns: 0 })
      }

      output.log(colors.dim(`[server] DomainCollection: ${seed.collectionMs.toFixed(0)}ms`))
    }

    output.log(`Found:`)
    output.log(`  - ${chatContext.paths.length} documents (including summaries)`)
    output.log(`  - ${peopleEntities.length} active people`)
    output.log(`  - ${ctx.health.length} days of health data`)
    output.log(`  - ${ctx.prices.length} days of price data`)

    // The AI's standing memory: preference-kind memories render into a
    // system-prompt block, frozen here for the whole session so the base
    // prompt stays byte-identical and prompt-cached. Loaded straight from
    // disk (not the service) — resumed sessions get it too, and a service
    // outage costs context documents, never the standing preferences.
    const memoryBlock = renderPreferenceBlock(await loadMemories(DIR_AI_MEMORY))

    // Load system prompt
    const promptContent = await readTextFile(PROMPT_FILE)
    const renderInput: RenderInput = {
      context: {
        notebookDate: context.notebookNow.date,
        notebookTime: context.notebookNow.time,
        systemDate: context.systemNow.date,
        systemTime: context.systemNow.time,
        notebookTimezone: context.notebookNow.timezone,
        systemTimezone: context.systemNow.timezone,
      },
      entities: { block: formatPeopleBlock(peopleEntities) },
      memory: { block: memoryBlock },
    }
    const { output: baseSystemPrompt } = renderPromptFile(promptContent, 'chat.prompt.md', renderInput)
    // Kept as a separate segment (not concatenated onto the base prompt) so
    // each gets its own prompt-cache breakpoint: a context change re-writes
    // only this segment while the base prompt stays cached for the session.
    let contextPrompt = ''

    // Conversation state
    const turns: ConversationMessage[] = []
    // "toolName:key" entries the user approved with "don't ask again this
    // session" (e.g. google_agent scoped to one file id). Session-lived only.
    const sessionApprovals = new Set<string>()
    // External files the session's tools touched (title by URL) — saved as
    // "[Title](url)" rel entries so the transcript points at its artifacts.
    const externalFiles = new Map<string, string>()
    let isFirstTurn = true
    let hasNewMessages = false
    let splitViewEnabled = false
    let contextScrollOffset = 0
    let toolsAnnounced = false

    // The model turn-runner. Everything interactive about approvals lives
    // in this handler — the engine drives the protocol around it and owns
    // the model-facing message history.
    const chatEngine = new ChatEngine({
      model: reasoning,
      approvalHandler: async ({ toolName, input }) => {
        // A tool may scope approval to a stable key (e.g. the targeted
        // file id); a key the user already blessed skips the prompt.
        const sessionKey = getApprovalSessionKey(toolName)?.(input as Record<string, unknown>)
        const sessionEntry = sessionKey ? `${toolName}:${sessionKey}` : undefined

        // Use task-specific formatter if available, generic fallback otherwise
        const formatter = getApprovalFormatter(toolName)
        if (formatter) {
          formatter(input as Record<string, unknown>, output)
        } else {
          output.log('')
          output.log(colors.bold(`Approve ${toolName}?`))
          for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
            if (typeof value === 'string' && value.includes('\n')) {
              output.log(colors.dim(`${key}:`))
              output.log(value)
            } else {
              output.log(colors.dim(`${key}: `) + String(value))
            }
          }
        }

        if (sessionEntry && sessionApprovals.has(sessionEntry)) {
          output.log(colors.dim('Auto-approved — you allowed this file for the rest of the session.'))
          return { approved: true, reason: 'Auto-approved: the user allowed this file for the session' }
        }

        let approved: boolean | symbol
        if (sessionEntry) {
          const choice = await p.select({
            message: 'Approve?',
            options: [
              { value: 'yes', label: 'Yes' },
              { value: 'always', label: "Yes — don't ask again for this file this session" },
              { value: 'no', label: 'No' },
            ],
          })
          if (!p.isCancel(choice) && choice === 'always') sessionApprovals.add(sessionEntry)
          approved = p.isCancel(choice) ? choice : choice !== 'no'
        } else {
          approved = await p.confirm({ message: 'Approve?' })
        }

        if (p.isCancel(approved)) {
          return { approved: false, reason: 'User cancelled. Do not request this tool again.' }
        }
        if (!approved) {
          return { approved: false, reason: 'User declined. Do not request this tool again.' }
        }
        return { approved: true, reason: 'User approved' }
      },
      onToolCall: (tc) => {
        if (tc.toolName === 'web_search') {
          const input = tc.input as { query: string }
          output.log(colors.dim(`Searching: "${input.query}"...`))
        } else if (tc.toolName === 'web_fetch') {
          const input = tc.input as { url: string }
          output.log(colors.dim(`Reading: ${input.url}`))
        } else {
          output.log(colors.dim(`Running: ${tc.toolName}...`))
        }
      },
    })

    // Render one ChatContext rebuild: the stats line, the changelog (for
    // recorded turns past the first), and the refreshed context prompt.
    const renderContextReport = (report: RebuildReport) => {
      if (report.stats) {
        const floored = report.stats.floored !== undefined ? `, ${report.stats.floored} floored` : ''
        output.log(
          colors.dim(
            `Context: ${report.stats.kept} kept, ${report.stats.pruned} pruned${floored}, ${report.stats.excluded} excluded, ~${report.stats.docTokens} tokens`,
          ),
        )
      }
      if (report.recorded && report.turn > 1 && (report.added.length > 0 || report.cut.length > 0)) {
        output.log(colors.dim('Context changed:'))
        for (const d of report.added) {
          const note = d.pinned ? 'pinned' : d.score !== undefined ? `score=${d.score}` : 'unscored'
          output.log(colors.dim(`  + ${d.path} (${note}, ~${d.tokens} tokens)`))
        }
        for (const r of report.cut) {
          const note = r.cut === 'budget' ? `score=${r.score}` : r.cut
          output.log(colors.dim(`  - ${r.path} (${note}, ~${r.tokens} tokens)`))
        }
      }
      contextPrompt = buildContextPrompt({ ctx, days, activityMarkdown: report.activityMarkdown })
    }

    // Seed a resumed session: conversation, carried context log, query state,
    // and turn numbering continue exactly where the transcript left off
    // (the context side happened in chatContext.restore above).
    if (resumeSession) {
      const state = resumeSession.state
      turns.push(...state.conversation)
      chatEngine.seedConversation(state.conversation)

      if (restoring && restored) {
        // Context restored — new messages continue through the evolve path.
        isFirstTurn = false
        renderContextReport(restored.rebuild)
      } else {
        output.log(colors.yellow('No context log in this transcript — gathering fresh context for your next message.'))
      }

      output.log('')
      output.log(colors.bold(`Resuming: ${truncate(resumeSession.summary || firstWordsSummary(turns), 80)}`))
      output.log(colors.dim(resumeSession.filePath))
      const replay = turns.slice(-4)
      if (turns.length > replay.length) {
        output.log(colors.dim(`  … ${turns.length - replay.length} earlier messages (Ctrl+B for full history)`))
      }
      output.log('')
      for (const m of replay) {
        if (m.role === 'user') {
          output.log(colors.cyan('You: ') + truncate(m.content, 600))
        } else {
          output.log(truncate(m.content, 600))
        }
        output.log('')
      }
    }

    output.log('')
    output.log(colors.bold('Ready.'))
    output.log(
      colors.dim(
        '(Enter adds newline. Empty line + Enter sends. Ctrl+S save. Ctrl+L log. Ctrl+B split. Arrows scroll context.)',
      ),
    )
    output.log('')

    // Format user message with gray background for visual distinction
    const BG_GRAY = '\x1b[48;5;237m'
    const RESET = '\x1b[0m'
    const cols = process.stdout.columns || 120
    const formatUserMsg = (msg: string): string => {
      const lines = msg.split('\n')
      return lines
        .map((line, i) => {
          const prefix = i === 0 ? 'You: ' : '      '
          const content = ` ${prefix}${line}`
          const pad = Math.max(0, cols - content.length)
          const coloredPrefix = i === 0 ? ` ${colors.cyan('You: ')}` : '       '
          return `${BG_GRAY}${coloredPrefix}${line}${' '.repeat(pad)}${RESET}`
        })
        .join('\n')
    }

    // The topic label pinned above the input and mirrored to the tab title:
    // a resumed chat's saved summary, else first words of the opening message
    // until the one-shot titler lands. Display only — the saved summary is
    // chosen independently at save time.
    let topic = resumeSession?.summary || ''
    let topicTitlerFired = false
    const updateTopic = (next: string) => {
      topic = next
      setTerminalTitle(next)
    }
    if (topic) setTerminalTitle(topic)

    // Conversation loop
    while (true) {
      // Get user input
      let userMessage: string

      if (initialMessage) {
        userMessage = initialMessage
        initialMessage = undefined // Only use once
        output.log(formatUserMsg(userMessage))
        output.log('')
      } else {
        const contextFiles = chatContext.paths
          .map((p) => (p.startsWith(baseDir) ? p.slice(baseDir.length + 1) : p))
          .sort()

        const promptResult = await promptWithInk({
          topic: topic || undefined,
          saveOnExit: !ephemeral,
          logToDay: log,
          splitViewEnabled,
          contextScrollOffset,
          conversation: turns,
          contextFiles,
          summarizePaste: async (text) => {
            const { text: summary } = await generateText({
              ...fast,
              prompt: `Summarize this pasted text in 5-7 words. Reply with ONLY the summary, no quotes or punctuation:\n\n${text.slice(
                0,
                2000,
              )}`,
            })
            return summary.trim()
          },
        })
        ephemeral = !promptResult.saveOnExit
        log = promptResult.logToDay
        splitViewEnabled = promptResult.splitViewEnabled
        contextScrollOffset = promptResult.contextScrollOffset
        const response = promptResult.message
        if (!response || response.trim() === '') {
          break
        }
        output.log(formatUserMsg(response))
        output.log('')
        userMessage = response.trim()
      }

      // Handle slash commands
      if (userMessage === '/save') {
        ephemeral = false
        log = false
        output.log(colors.green('Mode: [SAVE ON] [LOG OFF]'))
        continue
      }
      if (userMessage === '/nosave') {
        ephemeral = true
        log = false
        output.log(colors.yellow('Mode: [SAVE OFF] [LOG OFF]'))
        continue
      }
      if (userMessage === '/log') {
        log = true
        ephemeral = false
        output.log(colors.green('Mode: [SAVE ON] [LOG ON]'))
        continue
      }
      if (userMessage === '/no-context') {
        isFirstTurn = false
        chatContext.clear()
        contextScrollOffset = 0
        output.log(colors.dim('Context gathering skipped.'))
        continue
      }

      // The first real message names the tab right away; the titler refines
      // the label once the first exchange exists.
      if (!topic) updateTopic(firstWordsSummary([{ role: 'user', content: userMessage }]))

      // Stamp the turn at submit time — the context gather below can take a
      // while, and the stamp should say when the message was sent, not when
      // the model was finally invoked.
      const turnWhen = await fetchWhen()

      // On first turn, gather targeted context via ai:context:files and merge;
      // subsequent turns evolve the queries if the conversation direction shifted
      let turnContext: TurnContextReport
      if (isFirstTurn) {
        isFirstTurn = false
        output.log(colors.dim('Gathering context...'))
        turnContext = await chatContext.firstTurn(userMessage)
        if (turnContext.rebuilt) renderContextReport(turnContext.rebuilt)
        output.log(colors.dim(`Context loaded (${turnContext.rebuilt?.collectionSize ?? 0} documents)`))
      } else {
        turnContext = await chatContext.evolveTurn(userMessage, turns.slice(-6))
        if (turnContext.rebuilt) renderContextReport(turnContext.rebuilt)
      }

      // Surface context failures instead of silently answering without that
      // context (chatContext already recorded them in the turn log)
      if (turnContext.errors.length > 0) {
        const noun = turnContext.errors.length === 1 ? 'query' : 'queries'
        output.log(
          colors.yellow(
            `${turnContext.errors.length} context ${noun} failed — answering with incomplete context (logged to ${AI_ERROR_LOG_DISPLAY})`,
          ),
        )
      }

      // Every turn — add the user's actual message (never the context). A
      // resumed transcript can end mid-exchange on a user message; merge into
      // it so roles keep alternating.
      hasNewMessages = true
      const priorTurn = turns.at(-1)
      if (priorTurn?.role === 'user') {
        priorTurn.content += '\n\n' + userMessage
      } else {
        const turn: ConversationMessage = { role: 'user', content: userMessage }
        if (turnWhen) turn.when = turnWhen
        turns.push(turn)
      }
      chatEngine.appendUserMessage(userMessage, turnWhen)

      // Get AI response
      output.log(colors.dim('Thinking...'))

      try {
        const webTools = env.PERPLEXITY_API_KEY ? createWebTools() : {}
        const notebookTools = await createNotebookTools(tasks, {
          // Native question breakout: settle a tool's openQuestions in-place —
          // Enter accepts the proposed answer, typing overrides, ESC accepts
          // all remaining. No chat turns, no context pipeline.
          onOpenQuestions: async (_toolName, questions) => {
            output.log('')
            output.log(
              colors.bold(`${questions.length} question${questions.length === 1 ? '' : 's'} to settle`) +
                colors.dim(' — Enter keeps the proposed answer, ESC keeps the rest'),
            )

            const answers: { question: string; answer: string }[] = []
            for (let i = 0; i < questions.length; i++) {
              const q = questions[i]
              const message = `${q.question}${q.why ? `\n  ${colors.dim(q.why)}` : ''}\n`
              const res = await p.text({ message, initialValue: q.proposed })

              if (p.isCancel(res)) {
                for (const rest of questions.slice(i)) {
                  answers.push({ question: rest.question, answer: rest.proposed })
                }
                break
              }

              answers.push({ question: q.question, answer: (res as string).trim() || q.proposed })
            }

            return answers
          },
          onExternalFiles: (_toolName, files) => recordExternalFiles(externalFiles, files),
        })
        const allTools = { ...webTools, ...notebookTools }
        const toolApproval = createToolApprovalConfig()

        // Name the tools once per session: an empty or short list is the only
        // visible symptom of a tool that failed to load (createNotebookTools
        // warns, but that scrolls past under a long context gather).
        if (!toolsAnnounced) {
          toolsAnnounced = true
          const names = Object.keys(allTools)
          output.log(colors.dim(names.length > 0 ? `Tools: ${names.join(', ')}` : 'Tools: none available'))
        }

        const result = await chatEngine.runTurn({
          instructions: [baseSystemPrompt, contextPrompt],
          tools: allTools,
          toolApproval,
        })
        if (result.approvalRoundsExhausted) {
          output.log(colors.dim('Too many approval requests, moving on.'))
        }

        // Attach tool records to this turn's log entry — creating one when
        // the turn changed no context and so recorded nothing else.
        chatContext.recordTurnTools(result.toolRecords)

        // Build assistant content with optional sources
        let assistantContent = result.text
        const uniqueUrls = [...new Set(result.sourceUrls)]
        if (uniqueUrls.length > 0) {
          assistantContent += '\n\nSources:\n' + uniqueUrls.map((u) => `- ${u}`).join('\n')
        }

        const assistantTurn: ConversationMessage = { role: 'assistant', content: assistantContent }
        const assistantWhen = await fetchWhen()
        if (assistantWhen) assistantTurn.when = assistantWhen
        turns.push(assistantTurn)

        // One shot over the first exchange: the pinned line and tab title
        // update when the label lands (save-time titling is independent).
        if (!resumeSession && !topicTitlerFired && turns.length >= 2) {
          topicTitlerFired = true
          summarizeTranscript(buildChatTranscript(turns.slice(0, 2)), { kind: CHAT_ENRICH.kind }).then((t) => {
            if (t) updateTopic(t)
          })
        }

        output.log('')
        output.log(result.text)
        if (uniqueUrls.length > 0) {
          output.log('')
          output.log(colors.dim('Sources:'))
          for (const url of uniqueUrls) {
            output.log(colors.dim(`  - ${url}`))
          }
        }
        output.log('')
      } catch (err) {
        // A failed turn keeps its tool trail — an executed side-effectful
        // call (a sent post, a created doc) must not vanish from the
        // transcript because the turn later died.
        if (err instanceof TurnError && err.toolRecords.length > 0) {
          chatContext.recordTurnTools(err.toolRecords)
        }
        // TurnError arrives pre-clamped; foreign errors get the same cap —
        // a validation failure embeds the whole message array in .message.
        const message = truncate((err as Error).message ?? String(err), 2000)
        output.log(colors.red(`Error: ${message}`))
        output.log(colors.dim(`(logged to ${AI_ERROR_LOG_DISPLAY})`))
        await logAIError({ source: 'ai:chat', stage: 'turn', message, question: userMessage })
      }

      // Crash insurance: snapshot the session as it now stands — every
      // session, ephemeral included: -E decides what a clean exit keeps,
      // not what a crash may lose. Must never break the conversation, so
      // failures log and move on.
      try {
        if (turns.length > 0) {
          await writeChatAutosave(autosavePath, {
            turns,
            contextLog: chatContext.log,
            resume: resumeSession,
            startTime,
            provider: reasoningProfile.provider,
            model: reasoningProfile.model,
            externalFiles,
          })
        }
      } catch (err) {
        const message = (err as Error).message
        output.log(colors.dim(`Autosave failed: ${message} (logged to ${AI_ERROR_LOG_DISPLAY})`))
        await logAIError({ source: 'ai:chat', stage: 'autosave', message })
      }
    }

    clearTerminalTitle()

    // Save conversation if there were any turns (unless --ephemeral). A
    // resumed session with no new messages leaves its file untouched.
    if (turns.length > 0 && !ephemeral && (!resumeSession || hasNewMessages)) {
      const saved = await saveChat({
        turns,
        contextLog: chatContext.log,
        resume: resumeSession,
        timeDir,
        day: today,
        startTime,
        endTime: (await fetchNow()).plainDateTime,
        provider: reasoningProfile.provider,
        model: reasoningProfile.model,
        externalFiles,
        autoTag: !noAutoTag,
        autoRel: !noAutoRel,
        memoryDir: DIR_AI_MEMORY,
        logToDay: log ? { category: category || 'Professional' } : null,
        onProgress: (event) => {
          output.log('')
          output.log(colors.dim(`Choosing ${event.choosing.join(' and ')} from the archived-chat corpus…`))
        },
      })

      // The transcript is durably on disk (saved, or parked as a recovery
      // copy) — the crash snapshot is superseded.
      await clearChatAutosave(autosavePath)

      if (saved.autoTags) output.log(colors.dim(`Auto-tags: ${saved.autoTags}`))
      if (saved.autoRel) output.log(colors.dim(`Auto-rel: ${saved.autoRel.join('; ')}`))

      // What the session taught the standing memory store (ai/memory/).
      // Loud on purpose: every write to the machine-owned store is shown,
      // and silence means nothing was written. Rendered before the aborted
      // check — memory files land even when a resume write-back is refused.
      if (saved.memoryOps && saved.memoryOps.length > 0) {
        output.log('')
        for (const m of saved.memoryOps) {
          const verb = (MEMORY_VERBS[m.op] ?? m.op).padEnd(10)
          const detail =
            m.op === 'confirm' && m.uses !== undefined ? ` (uses: ${m.uses})` : m.kind ? ` (${m.kind})` : ''
          const line = `🧠 ${verb} ${m.summary}${detail}`
          output.log(m.outcome === 'skipped' ? colors.dim(`${line} — skipped: ${m.reason}`) : line)
        }
      }

      // The write-back gate refused: the original still holds the earlier
      // session, and this one's transcript is parked where it can be recovered.
      if (saved.aborted) {
        output.log('')
        output.log(colors.red(`NOT saved to ${saved.aborted.originalPath} — ${saved.aborted.reason}.`))
        output.log(colors.red(`Original left untouched; this session's transcript written to ${saved.path}`))
        return CommandResult.success({ saved: saved.path, turns: saved.exchanges })
      }

      if (!noEditor) {
        openEditor([{ file: saved.path }])
        await delay(500)
      }

      output.log('')
      output.log(colors.green(`Conversation saved to ${saved.path}`))
      output.log(colors.dim(`${saved.exchanges} turn${saved.exchanges !== 1 ? 's' : ''} recorded`))
      if (saved.resumed) {
        output.log(colors.dim('(resumed — original file updated in place)'))
      }

      if (saved.dayLog?.logged) {
        output.log(colors.dim(`Logged to day file under "${saved.dayLog.category} Complete"`))
      } else if (saved.dayLog?.reason === 'resume') {
        output.log(colors.dim('Day-file log skipped on resume.'))
      } else if (saved.dayLog) {
        output.log(colors.yellow(`Warning: Failed to log to day file: ${saved.dayLog.message}`))
      }

      return CommandResult.success({ saved: saved.path, turns: saved.exchanges })
    }

    // No save wanted — drop the crash snapshot too: an ephemeral exit means
    // leave nothing behind.
    await clearChatAutosave(autosavePath)

    output.log('')
    if (resumeSession && !hasNewMessages) {
      output.log(colors.dim('No new messages — file left untouched.'))
    } else if (ephemeral && turns.length > 0) {
      output.log(colors.dim(`${Math.floor(turns.length / 2)} turns (not saved)`))
    } else {
      output.log(colors.dim('No conversation to save.'))
    }
    return CommandResult.success({ turns: Math.floor(turns.length / 2) })
  }
}
