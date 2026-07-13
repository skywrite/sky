import * as path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import colors from 'picocolors'
import openEditor from 'open-editor'
import { generateText, isStepCount, jsonSchema, streamText } from 'ai'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { PORT_SERVER } from '#shared/config.ts'
import { mkdir } from 'node:fs/promises'
import { dayDir, fetchNow, readDay, writeDay } from '#shared/nbfs/mod.ts'
import parseDateFromDayPath from '#shared/nbfs/parseDateFromDayPath.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { cachedInstructions, withCacheTail } from '#shared/ai/promptCache.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import ChatDocument from '#shared/models/Chat/document/mod.ts'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'
import ContextAssembler from '#shared/models/AI/ContextAssembler/mod.ts'
import { createRecencyTypeScorer, withPinnedPaths } from '#shared/models/AI/ContextAssembler/scorers.ts'
import * as p from '@clack/prompts'
import { Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { type AIContext, gatherContext } from '../_lib/gatherContext.ts'
import { formatPeopleBlock, gatherPeopleEntities } from '../context/_entityContext.ts'
import { aiModel, getProfile, resolveProfile } from '#shared/ai/models.ts'
import { AI_ERROR_LOG_DISPLAY, logAIError } from '#shared/ai/errorLog.ts'
import { promptWithInk } from './ui/promptWithInk.tsx'
import { createNotebookTools, createToolApprovalConfig, getApprovalFormatter } from './_tools.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  message: Flag.string('Initial message to start the conversation', {
    short: 'm',
    optional: true,
  }),
  reasoning: Flag.string('Reasoning model profile for chat turns (e.g. default-opus-4.8, default-local-reasoning)', {
    short: 'r',
    default: () => 'default-opus-4.8',
  }),
  fast: Flag.string('Fast model profile for summaries and quick tasks (e.g. default-haiku-4.5, default-local-fast)', {
    short: 'f',
    default: () => 'default-haiku-4.5',
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
  when: whenNBTime(),
}

type Params = InferParams<typeof params>

import type { ConversationMessage } from '#shared/models/Chat/type.d.ts'

type Message = { role: 'user' | 'assistant'; content: string }

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

const SUMMARY_PATTERN = /<!--\s*SUMMARY:\s*(.+?)\s*-->/

/**
 * Extract the running summary from the last assistant response.
 * Falls back to first 10 words of the first user message.
 */
function extractSummary(turns: ConversationMessage[]): string {
  // Walk backwards through assistant turns to find the latest summary
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'assistant') {
      const match = turns[i].content.match(SUMMARY_PATTERN)
      if (match) return match[1].trim()
    }
  }
  // Fallback: first 10 words of first user message
  const first = turns.find((t) => t.role === 'user')?.content ?? ''
  return first.trim().split(/\s+/).slice(0, 10).join(' ')
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
          if (text.length > MAX_FETCH_CHARS) {
            return text.slice(0, MAX_FETCH_CHARS) + '\n\n[Content truncated...]'
          }
          return text
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
    ],
    usage: [
      'sky ai:chat                              # Claude Opus 4.8 (default), Haiku for fast',
      'sky ai:chat -m "What should I focus on?" # Start with initial message',
      'sky ai:chat -r default-local-reasoning   # Use local LM Studio model',
      'sky ai:chat -r default-local-reasoning -f default-local-fast  # Local reasoning + local fast',
      'sky ai:chat -r my-lm-studio              # Use custom config profile',
      'sky ai:chat --days 14                    # Include 14 days of context',
      'sky ai:chat --no-ephemeral               # Save conversation without toggling Ctrl+S',
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
    output.log(colors.dim(`[server] fetchNow: ${(performance.now() - t0).toFixed(0)}ms`))

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

    output.log(colors.dim(`[server] Fetching context from server...`))

    const prevStart = today.addDays(-(days - 1))
    const yesterday = today.addDays(-1)

    // Parallel: fetch all four sets of documents from server at once,
    // plus the interaction-ranked people list for system prompt grounding
    t0 = performance.now()
    const [todayDocs, prevDocsRaw, goalDocs, decisionDocs, peopleEntities] = await Promise.all([
      fetchContextFromServer(`{ documents(where: { date: "${today}" }) { path } }`, 1),
      fetchContextFromServer(`{ documents(where: { dateGte: "${prevStart}", dateLte: "${yesterday}" }) { path } }`, 0),
      fetchContextFromServer(`{ goals { path } }`, 0),
      fetchContextFromServer(`{ decisions(where: { pending: true }) { path } }`, 0),
      gatherPeopleEntities(config as Record<string, unknown>),
    ])
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
    const pinnedPaths: ReadonlySet<string> = new Set([...goalDocs, ...decisionDocs].map((d) => d.path))

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
    const createdDate = formatDate(startTime)
    let isFirstTurn = true
    let contextPaths: string[] = initialCollection?.paths ?? []
    let contextQueries: string[] = []
    let queryRelevantPaths: ReadonlySet<string> = new Set()
    let splitViewEnabled = false
    let contextScrollOffset = 0

    // Per-turn context log
    interface ContextTurnLog {
      turn: number
      queries: string[]
      context?: string[] // full context list (turn 1 only)
      diff?: string[] // files added to universe
      pruned: string[] // eligible files cut by the token budget
      excluded?: string[] // files excluded by scorer verdict (with reasons)
      errors?: string[] // context queries that failed this turn (also in ai-errors.jsonl)
    }
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
    function rebuildContext(newPaths?: string[]) {
      const prevPaths = new Set(contextPaths)
      contextPaths = initialCollection?.paths ?? []

      let activityMarkdown: string | null = null
      const turnPruned: string[] = []
      const turnExcluded: string[] = []

      if (initialCollection) {
        const assembler = ContextAssembler.from(initialCollection, {
          scorer: withPinnedPaths(createRecencyTypeScorer(today, { priorityPaths: queryRelevantPaths }), pinnedPaths),
          maxTokens: 300_000,
        })
        activityMarkdown = assembler.toMarkdown({ relativeTo: baseDir, delimited: true })
        output.log(
          colors.dim(
            `Context: ${assembler.size} kept, ${assembler.pruned.length} pruned, ${assembler.excluded.length} excluded, ~${assembler.totalTokens} tokens`,
          ),
        )
        for (const s of assembler.pruned) {
          turnPruned.push(`${relPath(s.item.path)} (score=${s.score}, ~${s.tokens} tokens)`)
        }
        for (const s of assembler.excluded) {
          const reason = s.verdict.keep === 'never' ? (s.verdict.reason ?? 'excluded') : 'excluded'
          turnExcluded.push(`${relPath(s.item.path)} (${reason}, ~${s.tokens} tokens)`)
        }
      }

      // Compute diff: files new to the universe this turn
      const turnDiff: string[] = []
      if (newPaths) {
        for (const p of newPaths) {
          if (!prevPaths.has(p)) turnDiff.push(relPath(p))
        }
      }

      // Record turn log
      const entry: ContextTurnLog = {
        turn: turnNumber,
        queries: [...contextQueries],
        pruned: turnPruned,
      }
      if (turnErrors.length > 0) {
        entry.errors = [...turnErrors]
      }
      if (turnNumber === 1) {
        entry.context = contextPaths.map(relPath).sort()
      }
      if (turnDiff.length > 0) {
        entry.diff = turnDiff
      }
      if (turnExcluded.length > 0) {
        entry.excluded = turnExcluded
      }
      contextLog.push(entry)

      // Changelog UI
      if (turnNumber > 1 && (turnDiff.length > 0 || turnPruned.length > 0)) {
        output.log(colors.dim('Context changed:'))
        for (const d of turnDiff) {
          output.log(colors.dim(`  + ${d}`))
        }
        for (const p of turnPruned) {
          output.log(colors.dim(`  - ${p}`))
        }
      }

      contextPrompt = buildContextPrompt({ ctx, days, activityMarkdown })
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
            queryRelevantPaths = new Set(filesResult.data.paths)
            newPaths = filesResult.data.paths
            initialCollection = await mergePathsIntoCollection(filesResult.data.paths, initialCollection)
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
                  allNewPaths.push(...execResult.data.paths)
                  initialCollection = await mergePathsIntoCollection(execResult.data.paths, initialCollection)
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

            // Update priority paths to latest query results
            queryRelevantPaths = new Set(initialCollection?.paths ?? [])
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
        // record a minimal entry here to keep the saved-chat TURN log complete.
        if (contextLog.at(-1)?.turn !== turnNumber) {
          contextLog.push({ turn: turnNumber, queries: [...contextQueries], pruned: [], errors: [...turnErrors] })
        }
        const noun = turnErrors.length === 1 ? 'query' : 'queries'
        output.log(
          colors.yellow(
            `${turnErrors.length} context ${noun} failed — answering with incomplete context (logged to ${AI_ERROR_LOG_DISPLAY})`,
          ),
        )
      }

      // Every turn — add the user's actual message
      messages.push({ role: 'user', content: userMessage })

      // Record user turn (always just the user's actual message, not context)
      turns.push({ role: 'user', content: userMessage })

      // Get AI response
      output.log(colors.dim('Thinking...'))

      try {
        const webTools = env.PERPLEXITY_API_KEY ? createWebTools() : {}
        const notebookTools = await createNotebookTools(tasks)
        const allTools = { ...webTools, ...notebookTools }
        const toolApproval = createToolApprovalConfig()

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
              approvals.push({
                type: 'tool-approval-response',
                approvalId,
                approved: false,
                reason: `User already denied ${toolCall.toolName}. Do not request it again.`,
              })
              continue
            }

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

            const approved = await p.confirm({ message: 'Approve?' })
            if (p.isCancel(approved)) {
              deniedTools.add(toolCall.toolName)
              approvals.push({
                type: 'tool-approval-response',
                approvalId,
                approved: false,
                reason: 'User cancelled. Do not request this tool again.',
              })
            } else if (!approved) {
              deniedTools.add(toolCall.toolName)
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

        // Collect source URLs from web search tool results
        const sourceUrls: string[] = []
        for (const step of result.steps ?? []) {
          for (const tr of step.toolResults ?? []) {
            if (tr.toolName === 'web_search' && Array.isArray(tr.output)) {
              for (const r of tr.output as SearchResult[]) {
                if (r.url) sourceUrls.push(r.url)
              }
            }
          }
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

    // Save conversation if there were any turns (unless --ephemeral)
    if (turns.length > 0 && !ephemeral) {
      const endTime = (await fetchNow()).plainDateTime
      const updatedDate = formatDate(endTime)

      // Create save path: {timeDir}/{dayDir}/actions/ai-chats/{filename}.md
      const aiDir = path.join(timeDir, dayDir(today), 'actions', 'ai-chats')
      if (!(await exists(aiDir))) {
        await mkdir(aiDir, { recursive: true })
      }

      const summary = extractSummary(turns)
      const filename = formatFilename(startTime, summary)
      const savePath = path.join(aiDir, filename)

      const chatDoc = ChatDocument.create({
        summary,
        messages: turns,
        created: createdDate,
        updated: updatedDate,
        provider: reasoningProfile.provider,
        model: reasoningProfile.model,
      })
      let markdown = chatDoc.toMarkdown()

      // Append per-turn context log as hidden comment
      if (contextLog.length > 0) {
        let comment = '\n\n\n\n\n\n\n\n'
        for (const entry of contextLog) {
          comment += `<!-- TURN ${entry.turn}\n`
          if (entry.queries.length > 0) {
            comment += 'QUERIES:\n' + entry.queries.map((q) => ` - ${q}`).join('\n') + '\n'
          }
          if (entry.context) {
            comment += 'CONTEXT:\n' + entry.context.map((p) => ` - ${p}`).join('\n') + '\n'
          }
          if (entry.diff && entry.diff.length > 0) {
            comment += 'DIFF:\n' + entry.diff.map((p) => ` + ${p}`).join('\n') + '\n'
          }
          if (entry.pruned.length > 0) {
            comment += 'PRUNED:\n' + entry.pruned.map((p) => ` - ${p}`).join('\n') + '\n'
          }
          if (entry.excluded && entry.excluded.length > 0) {
            comment += 'EXCLUDED:\n' + entry.excluded.map((p) => ` - ${p}`).join('\n') + '\n'
          }
          if (entry.errors && entry.errors.length > 0) {
            comment += 'ERRORS:\n' + entry.errors.map((e) => ` ! ${e}`).join('\n') + '\n'
          }
          comment += '-->\n\n'
        }
        markdown += comment
      }

      await writeTextFile(savePath, markdown)

      if (!noEditor) {
        openEditor([{ file: savePath }])
        await delay(500)
      }

      output.log('')
      output.log(colors.green(`Conversation saved to ${savePath}`))
      const exchangeCount = Math.floor(turns.length / 2)
      output.log(colors.dim(`${exchangeCount} turn${exchangeCount !== 1 ? 's' : ''} recorded`))

      // Optionally log to day file
      if (log) {
        try {
          const relativePath = `actions/ai-chats/${filename}`
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
      }

      return CommandResult.success({ saved: savePath, turns: exchangeCount })
    }

    output.log('')
    if (ephemeral && turns.length > 0) {
      output.log(colors.dim(`${Math.floor(turns.length / 2)} turns (not saved)`))
    } else {
      output.log(colors.dim('No conversation to save.'))
    }
    return CommandResult.success({ turns: Math.floor(turns.length / 2) })
  }
}
