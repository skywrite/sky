import * as path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import colors from 'picocolors'
import openEditor from 'open-editor'
import { generateText, isStepCount, jsonSchema, streamText } from 'ai'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { PORT_SERVER } from '#shared/config.ts'
import { mkdir, readdir, rename } from 'node:fs/promises'
import { dayDir, fetchNow, readDay, writeDay } from '#shared/nbfs/mod.ts'
import parseDateFromDayPath from '#shared/nbfs/parseDateFromDayPath.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { cachedInstructions, withCacheTail } from '#shared/ai/promptCache.ts'
import truncate from '#shared/strings/truncate.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import ChatDocument, { extractConversationSummary } from '#shared/models/Chat/document/mod.ts'
import {
  type ContextDocRecord,
  type ContextTurnLog,
  serializeContextLog,
  type ToolCallRecord,
  type TurnStats,
} from '#shared/models/Chat/document/ContextLog/mod.ts'
import { reconstructResumeState, type ResumeState, verifyResumeCandidate } from '#shared/models/Chat/document/resume.ts'
import { resolveUniverse } from './resolveUniverse.ts'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'
import ContextAssembler, { estimateTokens } from '#shared/models/AI/ContextAssembler/mod.ts'
import { createRecencyTypeScorer, withPinnedPaths } from '#shared/models/AI/ContextAssembler/scorers.ts'
import * as p from '@clack/prompts'
import { Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { type AIContext, gatherContext } from '../_lib/gatherContext.ts'
import createDayLabeler from '../lib/dayLabel.ts'
import { formatPeopleBlock, gatherPeopleEntities } from '../context/_entityContext.ts'
import { aiModel, getProfile, resolveProfile, ROLES } from '#shared/ai/models.ts'
import { AI_ERROR_LOG_DISPLAY, AI_ERROR_LOG_PATH, logAIError } from '#shared/ai/errorLog.ts'
import { promptWithInk } from './ui/promptWithInk.tsx'
import { createNotebookTools, createToolApprovalConfig, getApprovalFormatter, getApprovalSessionKey } from './_tools.ts'

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
  inspectInitialContext: Flag.boolean('List initial context file paths and exit', {
    default: false,
  }),
  category: Flag.string('Category for the chat (e.g., reflection, planning)', {
    short: 'c',
    optional: true,
  }),
  log: Flag.boolean('Log chat to day file as complete item', {
    default: false,
  }),
  ephemeral: Flag.boolean('Chat without saving conversation to file', {
    short: 'E',
    default: true,
  }),
  noEditor: Flag.boolean('Skip opening editor', { hidden: true }),
  resume: Flag.boolean(
    'Resume a saved chat from the current day: conversation and context restored, same file updated',
    {
      default: false,
    },
  ),
  when: whenNBTime(),
}

type Params = InferParams<typeof params>

import type { ConversationMessage } from '#shared/models/Chat/type.d.ts'

type Message = { role: 'user' | 'assistant'; content: string }

type Result = { saved?: string; turns?: number }

/** Everything the save path needs to write a resumed chat back to its file. */
interface ResumeSession {
  filePath: string
  created: string
  summary: string
  rel: string[]
  tags: string[]
  /** false when yaml turns: swallowed following lines — never overwrite those */
  frontmatterHealthy: boolean
  state: ResumeState
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ai:chat': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const PROMPT_FILE = new URL('./prompts/chat.prompt.md', import.meta.url).pathname

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

function formatDate(dt: PlainDateTime): string {
  return dt.plainDate.ymd
}

/** Short human digest of a tool input for the turn log — never the payload. */
function toolInputDigest(input: unknown): string | undefined {
  if (input == null) return undefined
  if (typeof input === 'object') {
    const o = input as Record<string, unknown>
    for (const key of ['query', 'url', 'message', 'text']) {
      if (typeof o[key] === 'string') return truncate(o[key] as string, 120)
    }
  }
  return truncate(typeof input === 'string' ? input : JSON.stringify(input), 120)
}

function slugify(text: string, maxWords = 7): string {
  // Take first N words, preserve case, replace non-alphanumeric with dashes
  const words = text.trim().split(/\s+/).slice(0, maxWords).join(' ')

  return words
    .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special chars except spaces
    .replace(/\s+/g, '-') // Replace spaces with dashes
    .replace(/-+/g, '-') // Collapse multiple dashes
    .replace(/^-|-$/g, '') // Trim leading/trailing dashes
}

function formatFilename(dt: PlainDateTime, summary: string): string {
  // Format: HH-MM_Slugified-Summary.md
  const timeStr = dt.time.replace(':', '-')
  const slug = slugify(summary)
  return `${timeStr}_${slug}.md`
}

// A service restart unbinds :9999 for up to ~70s — launchd takes 20-45s to
// respawn the process, then the notebook rescan takes ~24s before the port
// binds — and a context fetch in that window used to fail hard: the turn
// then ran without queried context. Spread ~90s of retries across the
// window (mirrors markdown:sel's GraphQL fetch); once one fetch exhausts
// them the service is down rather than restarting, so later fetches in the
// same session fail fast instead of stacking retry waits. Any success
// re-arms.
const CONNECT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 15000, 15000, 15000, 15000]
let connectRetriesExhausted = false

async function fetchWithConnectRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, init)
      connectRetriesExhausted = false
      return response
    } catch (err) {
      if (connectRetriesExhausted || attempt >= CONNECT_RETRY_DELAYS_MS.length) {
        connectRetriesExhausted = true
        throw err
      }
      const delayMs = CONNECT_RETRY_DELAYS_MS[attempt]
      console.warn(`[ai:chat] notebook service unreachable — retrying in ${delayMs / 1000}s...`)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

/**
 * Fetch documents from the running notebook service via POST /context.
 * The server executes the GraphQL query, resolves relationships to the given depth,
 * and returns {path, type, markdown} triples.
 */
async function fetchContextFromServer(query: string, depth = 1): Promise<Array<{ doc: Document; path: string }>> {
  const url = `http://localhost:${PORT_SERVER}/context`
  let resp: Response
  try {
    resp = await fetchWithConnectRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, depth }),
    })
  } catch (err) {
    const message = `notebook service unreachable at ${url}: ${(err as Error).message}`
    console.warn(`[ai:chat] ${message}`)
    await logAIError({ source: 'ai:chat', stage: 'context:server', message, query })
    return []
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    const message = `context fetch failed (${resp.status} ${resp.statusText}): ${body.slice(0, 200)}`
    console.warn(`[ai:chat] ${message}`)
    await logAIError({ source: 'ai:chat', stage: 'context:server', message, query })
    return []
  }

  let json: unknown
  try {
    json = await resp.json()
  } catch (err) {
    const message = `context response not valid JSON: ${(err as Error).message}`
    console.warn(`[ai:chat] ${message}`)
    await logAIError({ source: 'ai:chat', stage: 'context:server', message, query })
    return []
  }
  const documents =
    (json as { data?: { documents?: Array<{ path?: string; markdown?: string }> } })?.data?.documents ?? []
  const docs: Array<{ doc: Document; path: string }> = []
  for (const d of documents) {
    if (d.path && d.markdown) {
      try {
        const doc = Document.fromMarkdown(d.markdown)
          .stripHtmlComments()
          .filterSections((h) => !h.text.toLowerCase().includes('transcript'))
        docs.push({ doc, path: d.path })
      } catch (err) {
        console.warn(`[ai:chat] failed to parse context doc ${d.path}: ${(err as Error).message}`)
      }
    }
  }
  return docs
}

/**
 * Read the given files from disk and merge them into the collection,
 * stripping chat metadata comments and transcript sections. Builds DomainCollection without a local MarkdownStore.
 */
async function mergePathsIntoCollection(
  paths: string[],
  existing: DomainCollection | null,
): Promise<DomainCollection | null> {
  if (paths.length === 0) return existing
  const docs: Array<{ doc: Document; path: string }> = []
  for (const filePath of paths) {
    try {
      const content = await readTextFile(filePath)
      const doc = Document.fromMarkdown(content)
        .stripHtmlComments()
        .filterSections((h) => !h.text.toLowerCase().includes('transcript'))
      docs.push({ doc, path: filePath })
    } catch (err) {
      // Skip unreadable files
      console.warn(`[ai:chat] skipping context file ${filePath}: ${(err as Error).message}`)
    }
  }
  if (docs.length === 0) return existing
  const newCollection = DomainCollection.fromDocuments(docs, null, { depth: 0 })
  return existing ? existing.merge(newCollection) : newCollection
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
      'Chats are ephemeral by default — toggle saving with Ctrl+S (or /save, /log)',
      'to write the conversation to the {day}/actions/ai-chats/ folder.',
      'Saved chats are searchable in later sessions via the chats GraphQL query.',
      '',
      'Resume: --resume lists the saved chats for the day (--when shifts the day,',
      'and Older… reaches previous days). The picked chat continues as if the',
      'session never exited — conversation reseeded, recorded context restored',
      'from the context log — and exiting updates the same file in place. Saving is',
      'on by default when resuming; exiting with no new messages touches nothing.',
    ],
    usage: [
      'sky ai:chat                              # Claude Opus 4.8 (default), Haiku for fast',
      'sky ai:chat -m "What should I focus on?" # Start with initial message',
      'sky ai:chat -r default-local-reasoning   # Use local LM Studio model',
      'sky ai:chat -r default-local-reasoning -f default-local-fast  # Local reasoning + local fast',
      'sky ai:chat -r my-lm-studio              # Use custom config profile',
      'sky ai:chat --days 14                    # Include 14 days of context',
      'sky ai:chat --no-ephemeral               # Save conversation without toggling Ctrl+S',
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
      inspectInitialContext,
      category,
      when,
      noEditor,
      resume,
    } = args
    let { log, ephemeral } = args
    let { message: initialMessage } = args

    const timeDir = <string>config.DIR_TIME
    const dataDir = <string>config.DIR_TRACKING

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
    const dayLabeler = createDayLabeler(today)
    output.log(colors.dim(`[server] fetchNow: ${(performance.now() - t0).toFixed(0)}ms`))

    // --resume: pick one of the day's saved chats (--when shifts the day)
    // and continue it as if the session never exited: conversation reseeded,
    // recorded context universe restored, and the same file updated on exit.
    let resumeSession: ResumeSession | null = null
    if (resume) {
      const chatsDir = path.join(timeDir, dayDir(today), 'actions', 'ai-chats')
      const chats: Array<{ file: string; label: string; hint: string }> = []
      if (await exists(chatsDir)) {
        const names = (await readdir(chatsDir))
          .filter((n) => n.endsWith('.md'))
          .sort()
          .reverse()
        for (const name of names) {
          const doc = ChatDocument.fromMarkdown(await readTextFile(path.join(chatsDir, name)))
          const time = name.slice(0, 5).replace('-', ':')
          const exchanges = Math.floor(doc.conversation.length / 2)
          chats.push({
            file: path.join(chatsDir, name),
            label: `${time}  ${truncate(doc.summary || name, 70)}`,
            hint: `${exchanges} exchange${exchanges === 1 ? '' : 's'}`,
          })
        }
      }

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
            ...chats.map((c) => ({ value: c.file, label: c.label, hint: c.hint })),
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

      const doc = ChatDocument.fromMarkdown(await readTextFile(filePath))
      const state = reconstructResumeState(doc)
      if (state.conversation.length === 0) {
        return CommandResult.fail(`Nothing to resume: no conversation parsed from ${filePath}`)
      }
      resumeSession = {
        filePath,
        created: String(doc.yaml['created'] ?? formatDate(startTime)),
        summary: doc.summary,
        rel: Array.from(doc.rel),
        tags: Array.from(doc.tags),
        frontmatterHealthy: typeof doc.yaml['turns'] === 'number',
        state,
      }
      // Resuming a saved chat: saving back is the default, not ephemeral.
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

    // Build context from the running notebook service: POST /context executes GraphQL +
    // resolves relationships on the server (which already has MarkdownStore built),
    // returning documents with markdown. Skips a local MarkdownStore.build() (~20k files).
    let initialCollection: DomainCollection | null = null
    let allFiles: string[] = []
    let pinnedPaths: ReadonlySet<string> = new Set()
    let peopleEntities: Awaited<ReturnType<typeof gatherPeopleEntities>> = []

    // A session must never retrieve its own transcript into its own context.
    // A resumed chat exists on disk mid-session, so recency/body queries can
    // match it (observed: `chats(recent: "2d")` returning the very chat being
    // continued — thousands of tokens duplicating the conversation the model
    // already has). Fresh sessions only write at exit and cannot self-match.
    const ownChatPath = resumeSession?.filePath ?? null
    const excludeOwnChat = (paths: string[]): string[] => (ownChatPath ? paths.filter((p) => p !== ownChatPath) : paths)

    // A resumed chat with a context log restores its recorded universe exactly —
    // no fresh baseline injection. New documents enter only through the
    // normal evolve path afterward. (Pre-log transcripts fall through to the
    // fresh gather below.)
    const restoring = resumeSession !== null && resumeSession.state.contextLog.length > 0

    if (restoring && resumeSession) {
      output.log(colors.dim('[resume] Resolving recorded context universe...'))
      t0 = performance.now()
      const resolution = await resolveUniverse(resumeSession.state.universePaths, baseDir)
      peopleEntities = await gatherPeopleEntities(config as Record<string, unknown>)
      initialCollection = await mergePathsIntoCollection(
        excludeOwnChat(resolution.resolved.map((r) => path.join(baseDir, r))),
        null,
      )
      // The recorded goals/decisions keep their never-prune pinning on resume.
      pinnedPaths = new Set(
        resolution.resolved
          .filter((r) => r.startsWith('goals/') || r.startsWith('decisions/'))
          .map((r) => path.join(baseDir, r)),
      )
      allFiles = initialCollection?.paths ?? []

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

      const prevStart = today.addDays(-(days - 1))
      const yesterday = today.addDays(-1)

      // Parallel: fetch all four sets of documents from server at once,
      // plus the interaction-ranked people list for system prompt grounding
      t0 = performance.now()
      // pathContains scopes the date sweeps to the time tree: project folder
      // files carry created: dates too, and large project docs in a date
      // sweep cost seconds of serialize for content the query-targeted rel
      // path (ai:context:files) is meant to fetch when relevant.
      const [todayDocs, prevDocsRaw, goalDocs, decisionDocs, people] = await Promise.all([
        fetchContextFromServer(`{ documents(where: { date: "${today}", pathContains: "/time/" }) { path } }`, 1),
        fetchContextFromServer(
          `{ documents(where: { dateGte: "${prevStart}", dateLte: "${yesterday}", pathContains: "/time/" }) { path } }`,
          0,
        ),
        fetchContextFromServer(`{ goals { path } }`, 0),
        fetchContextFromServer(`{ decisions(where: { pending: true }) { path } }`, 0),
        gatherPeopleEntities(config as Record<string, unknown>),
      ])
      peopleEntities = people
      output.log(
        colors.dim(
          `[server] POST /context x4: ${(performance.now() - t0).toFixed(
            0,
          )}ms — today=${todayDocs.length}, prev=${prevDocsRaw.length}, goals=${goalDocs.length}, decisions=${decisionDocs.length}`,
        ),
      )

      // Group previous docs by date and apply per-day strategy
      const byDate = new Map<string, Array<{ doc: Document; path: string }>>()
      for (const d of prevDocsRaw) {
        if (!d.path.includes('/time/')) continue
        const date = parseDateFromDayPath(d.path)?.toString()
        if (!date) continue
        const list = byDate.get(date) ?? []
        list.push(d)
        byDate.set(date, list)
      }

      const prevDocs: Array<{ doc: Document; path: string }> = []
      for (const [, files] of byDate) {
        const hasSummary = files.some((f) => f.path.endsWith('/summary.md'))
        if (hasSummary) {
          // Summary replaces raw activity, but journals and AI chats carry
          // context the summary doesn't (mirrors journal:new's gatherContext)
          prevDocs.push(
            ...files.filter(
              (f) => f.path.endsWith('/summary.md') || f.path.includes('/journal/') || f.path.includes('/ai-chats/'),
            ),
          )
        } else {
          prevDocs.push(...files)
        }
      }

      // Deduplicate all docs by path
      const seen = new Set<string>()
      const allDocs: Array<{ doc: Document; path: string }> = []
      for (const d of [...todayDocs, ...prevDocs, ...goalDocs, ...decisionDocs]) {
        if (!seen.has(d.path)) {
          seen.add(d.path)
          allDocs.push(d)
        }
      }

      // Goals and pending decisions are the strategic spine — never prune them.
      // Unpinned they cap at score 8 (flat recency 3 + type 5) and lose to any
      // query-boosted (+10) document when the token budget forces pruning.
      pinnedPaths = new Set([...goalDocs, ...decisionDocs].map((d) => d.path))

      allFiles = allDocs.map((d) => d.path)

      if (inspectInitialContext) {
        const sorted = allFiles.map((f) => (f.startsWith(baseDir) ? f.slice(baseDir.length + 1) : f)).sort()
        for (const f of sorted) {
          output.log(f)
        }
        return CommandResult.success({ turns: 0 })
      }

      t0 = performance.now()
      initialCollection = allDocs.length > 0 ? DomainCollection.fromDocuments(allDocs, null, { depth: 0 }) : null
      output.log(colors.dim(`[server] DomainCollection: ${(performance.now() - t0).toFixed(0)}ms`))
    }

    output.log(`Found:`)
    output.log(`  - ${allFiles.length} documents (including summaries)`)
    output.log(`  - ${peopleEntities.length} active people`)
    output.log(`  - ${ctx.health.length} days of health data`)
    output.log(`  - ${ctx.prices.length} days of price data`)

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
    }
    const { output: baseSystemPrompt } = renderPromptFile(promptContent, 'chat.prompt.md', renderInput)
    // Kept as a separate segment (not concatenated onto the base prompt) so
    // each gets its own prompt-cache breakpoint: a context change re-writes
    // only this segment while the base prompt stays cached for the session.
    let contextPrompt = ''

    // Conversation state
    const turns: ConversationMessage[] = []
    const messages: Message[] = []
    // "toolName:key" entries the user approved with "don't ask again this
    // session" (e.g. google_agent scoped to one file id). Session-lived only.
    const sessionApprovals = new Set<string>()
    const createdDate = resumeSession?.created ?? formatDate(startTime)
    let isFirstTurn = true
    let hasNewMessages = false
    let contextPaths: string[] = initialCollection?.paths ?? []
    let contextQueries: string[] = []
    let queryRelevantPaths: ReadonlySet<string> = new Set()
    let splitViewEnabled = false
    let contextScrollOffset = 0
    let toolsAnnounced = false

    // Per-turn context log, persisted as a trailing CONTEXT-LOG comment on save
    const contextLog: ContextTurnLog[] = []
    let turnNumber = 0
    // Context failures for the current turn. Reset when a turn starts (both
    // first-turn and evolve paths), recorded into the turn's ContextTurnLog
    // entry by rebuildContext, and surfaced as a warning after gathering —
    // the chat used to swallow these and answer from silently thinner context.
    let turnErrors: string[] = []

    function relPath(p: string): string {
      return p.startsWith(baseDir) ? p.slice(baseDir.length + 1) : p
    }

    // Rebuild system prompt with latest context and record the turn log
    // (record=false for the resume-setup rebuild, which must not append a
    // duplicate entry for an already-recorded turn)
    function rebuildContext(newPaths?: string[], record = true) {
      const prevPaths = new Set(contextPaths)
      contextPaths = initialCollection?.paths ?? []

      let activityMarkdown: string | null = null
      let turnStats: TurnStats | undefined
      // Typed record for every universe path — shipped docs carry a score
      // (or pinned), cut docs additionally say why. One map serves the
      // turn-1 universe list, the diff, and the pruned snapshot.
      const docRecords = new Map<string, ContextDocRecord>()
      const cutRecords: ContextDocRecord[] = []

      if (initialCollection) {
        const assembler = ContextAssembler.from(initialCollection, {
          scorer: withPinnedPaths(createRecencyTypeScorer(today, { priorityPaths: queryRelevantPaths }), pinnedPaths),
          maxTokens: 300_000,
        })
        activityMarkdown = assembler.toMarkdown({ relativeTo: baseDir, delimited: true, label: dayLabeler })
        output.log(
          colors.dim(
            `Context: ${assembler.size} kept, ${assembler.pruned.length} pruned, ${assembler.excluded.length} excluded, ~${assembler.totalTokens} tokens`,
          ),
        )
        for (const s of assembler.kept) {
          docRecords.set(
            s.item.path,
            s.verdict.keep === 'always'
              ? { path: relPath(s.item.path), tokens: s.tokens, pinned: true }
              : { path: relPath(s.item.path), score: s.score, tokens: s.tokens },
          )
        }
        for (const s of assembler.pruned) {
          const rec: ContextDocRecord = { path: relPath(s.item.path), score: s.score, tokens: s.tokens, cut: 'budget' }
          docRecords.set(s.item.path, rec)
          cutRecords.push(rec)
        }
        for (const s of assembler.excluded) {
          const reason = s.verdict.keep === 'never' ? (s.verdict.reason ?? 'excluded') : 'excluded'
          const rec: ContextDocRecord = { path: relPath(s.item.path), tokens: s.tokens, cut: reason }
          docRecords.set(s.item.path, rec)
          cutRecords.push(rec)
        }
        turnStats = {
          kept: assembler.size,
          pruned: assembler.pruned.length,
          excluded: assembler.excluded.length,
          docTokens: assembler.totalTokens,
        }
      }

      // Compute diff: files new to the universe this turn. Query results
      // repeat a path once per alias that matched it — dedupe within the
      // pass so the diff lists each new doc once.
      const turnDiff: ContextDocRecord[] = []
      if (newPaths) {
        const seen = new Set<string>()
        for (const p of newPaths) {
          if (prevPaths.has(p) || seen.has(p)) continue
          seen.add(p)
          turnDiff.push(docRecords.get(p) ?? { path: relPath(p), tokens: 0 })
        }
      }

      if (record) {
        const entry: ContextTurnLog = { turn: turnNumber, queries: [...contextQueries] }
        if (turnStats) entry.stats = turnStats
        if (turnNumber === 1) {
          // The full universe, shipped and cut alike — cut docs carry their
          // reason inline, so turn 1 needs no separate pruned section.
          entry.universe = contextPaths
            .map((p) => docRecords.get(p) ?? { path: relPath(p), tokens: 0 })
            .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        } else {
          if (turnDiff.length > 0) entry.diff = turnDiff
          if (cutRecords.length > 0) entry.pruned = cutRecords
        }
        if (turnErrors.length > 0) entry.errors = [...turnErrors]
        contextLog.push(entry)

        // Changelog UI
        if (turnNumber > 1 && (turnDiff.length > 0 || cutRecords.length > 0)) {
          output.log(colors.dim('Context changed:'))
          for (const d of turnDiff) {
            const note = d.pinned ? 'pinned' : d.score !== undefined ? `score=${d.score}` : 'unscored'
            output.log(colors.dim(`  + ${d.path} (${note}, ~${d.tokens} tokens)`))
          }
          for (const r of cutRecords) {
            const note = r.cut === 'budget' ? `score=${r.score}` : r.cut
            output.log(colors.dim(`  - ${r.path} (${note}, ~${r.tokens} tokens)`))
          }
        }
      }

      contextPrompt = buildContextPrompt({ ctx, days, activityMarkdown })
    }

    // Seed a resumed session: conversation, carried context log, query state,
    // and turn numbering continue exactly where the transcript left off.
    if (resumeSession) {
      const state = resumeSession.state
      turns.push(...state.conversation)
      messages.push(...state.conversation.map((m) => ({ role: m.role, content: m.content })))
      contextLog.push(...state.contextLog)
      contextQueries = [...state.queries]
      turnNumber = state.lastTurn

      if (restoring) {
        // Context restored — new messages continue through the evolve path.
        isFirstTurn = false
        // Recorded diffs are the docs queries added in the original session,
        // so they re-seed the query boost. Turn-1 query hits are mixed into
        // the universe with the baseline and stay unboosted — a best-effort
        // restore, not an exact one.
        queryRelevantPaths = new Set(
          state.contextLog.flatMap((e) => e.diff ?? []).map((r) => path.join(baseDir, r.path)),
        )
        rebuildContext(undefined, false)
      } else {
        output.log(colors.yellow('No context log in this transcript — gathering fresh context for your next message.'))
      }

      output.log('')
      output.log(colors.bold(`Resuming: ${truncate(resumeSession.summary || extractConversationSummary(turns), 80)}`))
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
        const contextFiles = contextPaths.map((p) => (p.startsWith(baseDir) ? p.slice(baseDir.length + 1) : p)).sort()

        const promptResult = await promptWithInk({
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
        initialCollection = null
        contextPaths = []
        contextScrollOffset = 0
        output.log(colors.dim('Context gathering skipped.'))
        continue
      }

      // On first turn, gather targeted context via ai:context:files and merge
      if (isFirstTurn) {
        isFirstTurn = false
        turnNumber = 1
        turnErrors = []

        output.log(colors.dim('Gathering context...'))

        let newPaths: string[] | undefined
        try {
          const filesResult = await tasks.run<{ paths: string[]; query: string }>('ai:context:files', {
            _: ['ai:context:files', userMessage],
            server: true,
          })

          if (filesResult.status === 'success' && filesResult.data?.paths?.length) {
            if (filesResult.data.query) contextQueries.push(filesResult.data.query)
            const fetched = excludeOwnChat(filesResult.data.paths)
            queryRelevantPaths = new Set(fetched)
            newPaths = fetched
            initialCollection = await mergePathsIntoCollection(fetched, initialCollection)
          } else if (filesResult.status !== 'success') {
            // markdown:sel already logged the query + GraphQL errors; record the pipeline impact
            const message = filesResult.message ?? 'ai:context:files failed'
            turnErrors.push(message)
            await logAIError({ source: 'ai:chat', stage: 'context:files', message, question: userMessage })
          }
        } catch (err) {
          const message = (err as Error).message
          turnErrors.push(message)
          await logAIError({ source: 'ai:chat', stage: 'context:files', message, question: userMessage })
        }

        rebuildContext(newPaths)
        output.log(colors.dim(`Context loaded (${initialCollection?.size ?? 0} documents)`))
      } else {
        // Subsequent turns — evolve queries if conversation direction shifted
        turnNumber++
        turnErrors = []
        try {
          const evolveResult = await tasks.run<{ queries: string[]; changed: boolean }>('ai:context:evolve', {
            _: ['ai:context:evolve', userMessage],
            queries: JSON.stringify(contextQueries),
            conversation: JSON.stringify(turns.slice(-6)),
          })

          if (evolveResult.status === 'success' && evolveResult.data?.changed && evolveResult.data.queries.length > 0) {
            output.log(colors.dim('Context shifting...'))
            const prevQuerySet = new Set(contextQueries)
            contextQueries = evolveResult.data.queries

            // Only execute queries that are actually new or modified
            const newQueries = evolveResult.data.queries.filter((q) => !prevQuerySet.has(q))
            if (newQueries.length === 0) {
              output.log(colors.dim('Queries unchanged, skipping re-execution.'))
            }

            const allNewPaths: string[] = []
            for (const query of newQueries) {
              try {
                const execResult = await tasks.run('markdown:sel', {
                  graphql: query,
                  raw: true,
                  server: 'true',
                })
                if (execResult.status === 'success' && execResult.data?.paths?.length) {
                  const fetched = excludeOwnChat(execResult.data.paths)
                  allNewPaths.push(...fetched)
                  initialCollection = await mergePathsIntoCollection(fetched, initialCollection)
                } else if (execResult.status !== 'success') {
                  // markdown:sel already logged the query + GraphQL errors
                  turnErrors.push(execResult.message ?? 'Context query failed')
                }
              } catch (err) {
                const message = (err as Error).message
                turnErrors.push(message)
                await logAIError({
                  source: 'ai:chat',
                  stage: 'context:evolve:query',
                  message,
                  query,
                  question: userMessage,
                })
              }
            }

            // The boost accumulates over what queries actually returned.
            // Seeding it from the whole universe instead hands every document
            // the same +10, which cancels out and lets the recency baseline
            // outrank deliberate retrieval under budget pressure.
            queryRelevantPaths = new Set([...queryRelevantPaths, ...allNewPaths])
            rebuildContext(allNewPaths)
          } else if (evolveResult.status !== 'success') {
            const message = evolveResult.message ?? 'ai:context:evolve failed'
            turnErrors.push(message)
            await logAIError({ source: 'ai:chat', stage: 'context:evolve', message, question: userMessage })
          }
        } catch (err) {
          const message = (err as Error).message
          turnErrors.push(message)
          await logAIError({ source: 'ai:chat', stage: 'context:evolve', message, question: userMessage })
        }
      }

      // Surface context failures instead of silently answering without that context
      if (turnErrors.length > 0) {
        // rebuildContext records this turn's entry (with errors) when it runs;
        // it doesn't run when evolve fails outright or returns no change, so
        // record a minimal entry here to keep the saved-chat context log complete.
        if (contextLog.at(-1)?.turn !== turnNumber) {
          contextLog.push({ turn: turnNumber, queries: [...contextQueries], errors: [...turnErrors] })
        }
        const noun = turnErrors.length === 1 ? 'query' : 'queries'
        output.log(
          colors.yellow(
            `${turnErrors.length} context ${noun} failed — answering with incomplete context (logged to ${AI_ERROR_LOG_DISPLAY})`,
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
        turns.push({ role: 'user', content: userMessage })
      }
      const priorMsg = messages.at(-1)
      if (priorMsg?.role === 'user' && typeof priorMsg.content === 'string') {
        priorMsg.content += '\n\n' + userMessage
      } else {
        messages.push({ role: 'user', content: userMessage })
      }

      // Get AI response
      output.log(colors.dim('Thinking...'))

      try {
        // Every tool call this turn, for the saved log: executed ones are
        // collected from the result steps, denials at the approval prompt.
        const turnTools: ToolCallRecord[] = []
        const deniedCallIds = new Set<string>()
        // deno-lint-ignore no-explicit-any
        const recordDeniedTool = (toolCall: any) => {
          if (toolCall.toolCallId) deniedCallIds.add(toolCall.toolCallId)
          turnTools.push({ tool: toolCall.toolName, input: toolInputDigest(toolCall.input), outcome: 'denied' })
        }

        const webTools = env.PERPLEXITY_API_KEY ? createWebTools() : {}
        const notebookTools = await createNotebookTools(tasks)
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

        const onStepEnd = ({ toolCalls }: { toolCalls?: Array<{ toolName: string; input: unknown }> }) => {
          for (const tc of toolCalls ?? []) {
            if (tc.toolName === 'web_search') {
              const input = tc.input as { query: string }
              output.log(colors.dim(`Searching: "${input.query}"...`))
            } else if (tc.toolName === 'web_fetch') {
              const input = tc.input as { url: string }
              output.log(colors.dim(`Reading: ${input.url}`))
            } else {
              output.log(colors.dim(`Running: ${tc.toolName}...`))
            }
          }
        }

        // Stream the reasoning turn rather than issuing a single blocking
        // request. A non-streaming call holds an idle socket for the entire
        // (potentially many-minute) generation; on flaky networks or past
        // Anthropic's ~10-min non-streaming ceiling that connection gets
        // dropped ("socket connection was closed unexpectedly"). Streaming
        // keeps SSE bytes flowing the whole time. Awaiting the result promises
        // consumes the stream and rejects on a mid-stream error, which the
        // surrounding try/catch handles. Shape mirrors the old generateText
        // result so the approval loop and downstream rendering are unchanged.
        const runTurn = async () => {
          const stream = streamText({
            ...reasoning,
            instructions: cachedInstructions([baseSystemPrompt, contextPrompt]),
            messages: withCacheTail(messages),
            tools: allTools,
            toolApproval,
            stopWhen: isStepCount(5),
            onStepEnd,
          })
          return {
            text: await stream.text,
            content: await stream.content,
            steps: await stream.steps,
            responseMessages: await stream.responseMessages,
          }
        }

        let result = await runTurn()

        // Handle tool approval requests (e.g., slack_cli_post-self with needsApproval)
        const deniedTools = new Set<string>()
        const maxApprovalRounds = 3
        let approvalRound = 0
        // deno-lint-ignore no-explicit-any
        while (result.content?.some((part: any) => part.type === 'tool-approval-request')) {
          if (++approvalRound > maxApprovalRounds) {
            output.log(colors.dim('Too many approval requests, moving on.'))
            break
          }

          // deno-lint-ignore no-explicit-any
          messages.push(...(result.responseMessages as any))

          // deno-lint-ignore no-explicit-any
          const approvalRequests = result.content.filter((part: any) => part.type === 'tool-approval-request')
          const approvals: Array<{
            type: 'tool-approval-response'
            approvalId: string
            approved: boolean
            reason?: string
          }> = []

          for (const request of approvalRequests) {
            // deno-lint-ignore no-explicit-any
            const { approvalId, toolCall } = request as any

            // Auto-deny tools the user already rejected this turn
            if (deniedTools.has(toolCall.toolName)) {
              recordDeniedTool(toolCall)
              approvals.push({
                type: 'tool-approval-response',
                approvalId,
                approved: false,
                reason: `User already denied ${toolCall.toolName}. Do not request it again.`,
              })
              continue
            }

            // A tool may scope approval to a stable key (e.g. the targeted
            // file id); a key the user already blessed skips the prompt.
            const sessionKey = getApprovalSessionKey(toolCall.toolName)?.(toolCall.input as Record<string, unknown>)
            const sessionEntry = sessionKey ? `${toolCall.toolName}:${sessionKey}` : undefined

            // Use task-specific formatter if available, generic fallback otherwise
            const formatter = getApprovalFormatter(toolCall.toolName)
            if (formatter) {
              formatter(toolCall.input as Record<string, unknown>, output)
            } else {
              output.log('')
              output.log(colors.bold(`Approve ${toolCall.toolName}?`))
              const input = toolCall.input as Record<string, unknown>
              for (const [key, value] of Object.entries(input)) {
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
              approvals.push({
                type: 'tool-approval-response',
                approvalId,
                approved: true,
                reason: 'Auto-approved: the user allowed this file for the session',
              })
              continue
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
              deniedTools.add(toolCall.toolName)
              recordDeniedTool(toolCall)
              approvals.push({
                type: 'tool-approval-response',
                approvalId,
                approved: false,
                reason: 'User cancelled. Do not request this tool again.',
              })
            } else if (!approved) {
              deniedTools.add(toolCall.toolName)
              recordDeniedTool(toolCall)
              approvals.push({
                type: 'tool-approval-response',
                approvalId,
                approved: false,
                reason: 'User declined. Do not request this tool again.',
              })
            } else {
              approvals.push({
                type: 'tool-approval-response',
                approvalId,
                approved: true,
                reason: 'User approved',
              })
            }
          }

          // deno-lint-ignore no-explicit-any
          messages.push({ role: 'tool', content: approvals } as any)

          result = await runTurn()
        }

        // Collect source URLs from web search results and record every
        // executed tool call for the turn log (denials were recorded at the
        // approval prompt; their ids are skipped so nothing double-counts).
        const sourceUrls: string[] = []
        for (const step of result.steps ?? []) {
          for (const tr of step.toolResults ?? []) {
            if (tr.toolName === 'web_search' && Array.isArray(tr.output)) {
              for (const r of tr.output as SearchResult[]) {
                if (r.url) sourceUrls.push(r.url)
              }
            }
            // deno-lint-ignore no-explicit-any
            const trc = tr as any
            if (trc.toolCallId && deniedCallIds.has(trc.toolCallId)) continue
            const out = trc.output
            turnTools.push({
              tool: tr.toolName,
              input: toolInputDigest(trc.input),
              outcome: out !== null && typeof out === 'object' && out.success === false ? 'error' : 'ok',
              tokens: estimateTokens(typeof out === 'string' ? out : JSON.stringify(out ?? '')),
            })
          }
        }

        // Attach tool records to this turn's log entry — creating one when
        // the turn changed no context and so recorded nothing else.
        if (turnTools.length > 0) {
          let turnEntry: ContextTurnLog | undefined
          for (let i = contextLog.length - 1; i >= 0; i--) {
            if (contextLog[i].turn === turnNumber) {
              turnEntry = contextLog[i]
              break
            }
          }
          if (turnEntry) turnEntry.tools = turnTools
          else contextLog.push({ turn: turnNumber, queries: [...contextQueries], tools: turnTools })
        }

        // Build assistant content with optional sources
        let assistantContent = result.text
        if (sourceUrls.length > 0) {
          const uniqueUrls = [...new Set(sourceUrls)]
          assistantContent += '\n\nSources:\n' + uniqueUrls.map((u) => `- ${u}`).join('\n')
        }

        turns.push({ role: 'assistant', content: assistantContent })
        // Push all response messages (including tool_use/tool_result pairs) to preserve valid conversation history
        // deno-lint-ignore no-explicit-any
        messages.push(...(result.responseMessages as any))

        output.log('')
        output.log(result.text)
        if (sourceUrls.length > 0) {
          const uniqueUrls = [...new Set(sourceUrls)]
          output.log('')
          output.log(colors.dim('Sources:'))
          for (const url of uniqueUrls) {
            output.log(colors.dim(`  - ${url}`))
          }
        }
        output.log('')
      } catch (err) {
        const message = (err as Error).message
        output.log(colors.red(`Error: ${message}`))
        output.log(colors.dim(`(logged to ${AI_ERROR_LOG_DISPLAY})`))
        await logAIError({ source: 'ai:chat', stage: 'turn', message, question: userMessage })
      }
    }

    // Save conversation if there were any turns (unless --ephemeral). A
    // resumed session with no new messages leaves its file untouched.
    if (turns.length > 0 && !ephemeral && (!resumeSession || hasNewMessages)) {
      const endTime = (await fetchNow()).plainDateTime
      const updatedDate = formatDate(endTime)
      const exchangeCount = Math.floor(turns.length / 2)

      // A resumed chat keeps its original summary unless a new SUMMARY
      // comment supersedes it — never the first-words guess.
      const summary = extractConversationSummary(turns, resumeSession?.summary)
      let savePath: string
      if (resumeSession) {
        // Write back to the original file: filename and created stay stable
        // (day-file links and the chats resolver depend on the filename).
        savePath = resumeSession.filePath
      } else {
        // Create save path: {timeDir}/{dayDir}/actions/ai-chats/{filename}.md
        const aiDir = path.join(timeDir, dayDir(today), 'actions', 'ai-chats')
        if (!(await exists(aiDir))) {
          await mkdir(aiDir, { recursive: true })
        }
        savePath = path.join(aiDir, formatFilename(startTime, summary))
      }

      const chatDoc = ChatDocument.create({
        summary,
        messages: turns,
        created: createdDate,
        updated: updatedDate,
        provider: reasoningProfile.provider,
        model: reasoningProfile.model,
        rel: resumeSession?.rel,
        tags: resumeSession?.tags,
      })
      let markdown = chatDoc.toMarkdown()

      // Append per-turn context log as hidden trailing comments (resume
      // reads this back via splitContextLog — the format is locked by
      // contextLog_test.ts, byte for byte)
      markdown += serializeContextLog(contextLog)

      if (resumeSession) {
        const rs = resumeSession
        const abortOverwrite = async (why: string) => {
          const recoveryDir = path.dirname(AI_ERROR_LOG_PATH)
          await mkdir(recoveryDir, { recursive: true })
          const recoveryPath = path.join(
            recoveryDir,
            `resume-recovery_${endTime.plainDate.ymd}_${endTime.time.replace(':', '-')}.md`,
          )
          await writeTextFile(recoveryPath, markdown)
          output.log('')
          output.log(colors.red(`NOT saved to ${rs.filePath} — ${why}.`))
          output.log(colors.red(`Original left untouched; this session's transcript written to ${recoveryPath}`))
          return CommandResult.success({ saved: recoveryPath, turns: exchangeCount })
        }

        if (!rs.frontmatterHealthy) {
          return await abortOverwrite('its frontmatter is malformed and a rewrite would lose data')
        }
        const check = verifyResumeCandidate(markdown, rs.state)
        if (!check.ok) {
          return await abortOverwrite(`the write-back self-check failed (${check.reason})`)
        }
        // Atomic replace: a crash mid-write must never leave a truncated
        // transcript at the original path.
        const tmpPath = path.join(path.dirname(savePath), `.${path.basename(savePath)}.resume-tmp`)
        await writeTextFile(tmpPath, markdown)
        await rename(tmpPath, savePath)
      } else {
        await writeTextFile(savePath, markdown)
      }

      if (!noEditor) {
        openEditor([{ file: savePath }])
        await delay(500)
      }

      output.log('')
      output.log(colors.green(`Conversation saved to ${savePath}`))
      output.log(colors.dim(`${exchangeCount} turn${exchangeCount !== 1 ? 's' : ''} recorded`))
      if (resumeSession) {
        output.log(colors.dim('(resumed — original file updated in place)'))
      }

      // Optionally log to day file (skipped on resume: the chat was already
      // logged when first saved, and a new time key would duplicate it)
      if (log && !resumeSession) {
        try {
          const relativePath = `actions/ai-chats/${path.basename(savePath)}`
          const key = `${startTime.time} > AI Chat`
          const value = `[${summary}](${relativePath})`
          const cat = category || 'Professional'

          let dayDoc = await readDay(today)
          dayDoc = dayDoc.setCompleteItem(key, value, { time: startTime.time, category: cat })
          await writeDay(dayDoc)

          output.log(colors.dim(`Logged to day file under "${cat} Complete"`))
        } catch (err) {
          output.log(colors.yellow(`Warning: Failed to log to day file: ${(err as Error).message}`))
        }
      } else if (log && resumeSession) {
        output.log(colors.dim('Day-file log skipped on resume.'))
      }

      return CommandResult.success({ saved: savePath, turns: exchangeCount })
    }

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
