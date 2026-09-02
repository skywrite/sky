import * as path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import * as p from '@clack/prompts'
import { generateText } from 'ai'
import openEditor from 'open-editor'
import colors from 'picocolors'
import { createFileTools, READ_FILE_TOOL } from '#commands/lib/chat/fileTools.ts'
import {
  createNotebookTools,
  createToolApprovalConfig,
  getApprovalFormatter,
  getApprovalSessionKey,
  sessionKeyToolNames,
} from '#commands/lib/chat/notebookTools.ts'
import { contextProducers } from '#commands/lib/chat/producers.ts'
import { renderChatSystemPrompt } from '#commands/lib/chat/systemPrompt.ts'
import { createWebTools } from '#commands/lib/chat/webTools.ts'
import { Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { summarizeTranscript } from '#lib/notebook/enrich/summarize.ts'
import { AI_ERROR_LOG_DISPLAY } from '#shared/ai/errorLog.ts'
import { getProfile, resolveProfile, ROLES } from '#shared/ai/models.ts'
import { DIR_AI_MEMORY, DIR_ATTACHMENTS, DIR_STATE_AI_CHATS, PORT_SERVER } from '#shared/config.ts'
import { fetchWithConnectRetry } from '#shared/models/Chat/ChatContext/fetchContext.ts'
import type { RebuildReport } from '#shared/models/Chat/ChatContext/mod.ts'
import ChatSession, { type ChatSessionEvent } from '#shared/models/Chat/ChatSession/mod.ts'
import { chatAutosaveFilename, sweepChatAutosaves } from '#shared/models/Chat/ChatStore/autosave.ts'
import { listDayChats, loadResumeSession, type ResumeSession } from '#shared/models/Chat/ChatStore/mod.ts'
import { firstWordsSummary } from '#shared/models/Chat/document/mod.ts'
import { buildChatTranscript, CHAT_ENRICH } from '#shared/models/Chat/enrich.ts'
import { formatPersonOpLine } from '#shared/models/Person/write.ts'
import { dayDir, fetchNow } from '#shared/nbfs/mod.ts'
import truncate from '#shared/strings/truncate.ts'
import { gatherContext } from '../_lib/gatherContext.ts'
import { SessionBlessings, harvestFileRefs } from './lib/approvals.ts'
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
  maxContext: Flag.number(
    'Token ceiling for the assembled document context — commas allowed (e.g. 150,000); 0 keeps the notebook closed',
    {
      default: () => 300_000,
      parse: (raw) => {
        const n = Number(String(raw).replace(/,/g, ''))
        if (!Number.isInteger(n) || n < 0) {
          throw new Error(`--max-context needs a whole token count, zero or more, got "${raw}"`)
        }
        return n
      },
    },
  ),
  noContext: Flag.bool(
    'Keep the notebook closed: no documents read or queried, only the conversation and tools (same as --max-context 0)',
    { default: false },
  ),
  summaryBaseline: Flag.bool(
    'Lean baseline: days before yesterday seed from summary.md (else day.md alone); message bodies stay out of today+yesterday',
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

type Result = { saved?: string; turns?: number }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ai:chat': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

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
      'sky ai:chat --max-context 150,000        # Cap assembled context (commas ok)',
      'sky ai:chat --no-context                 # Notebook closed: no documents read',
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
      maxContext,
      noContext,
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
    const baseDir = <string>config.DIR_BASE

    // Resolve the chosen reasoning profile (--reasoning) for turns; a fast model for summaries.
    const reasoningProfile = getProfile(reasoningProfileName)
    const reasoning = resolveProfile(reasoningProfile)
    const fast = resolveProfile(getProfile(fastProfileName))

    // A closed notebook: the flag or a zero ceiling. Documents are neither
    // read nor queried; the ambient day (summaries, health, prices, calendar)
    // still frames the conversation, as it does on the web page.
    const contextBudget = noContext ? 0 : maxContext
    const closed = contextBudget === 0

    output.log(closed ? 'Notebook closed: reading no documents.' : `Gathering context from last ${days} days...`)

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
        const older = await pickOlderChat(String(today), baseDir, output)
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
          const older = await pickOlderChat(String(today), baseDir, output)
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

    // The ambient day: summaries, health, prices, the calendar checked against the notebook
    t0 = performance.now()
    const ctx = await gatherContext(today, timeDir, dataDir, days, {
      secrets: context.secrets,
      now: { date: now.date, time: now.time },
    })
    output.log(colors.dim(`[server] gatherContext: ${(performance.now() - t0).toFixed(0)}ms`))

    // Which (tool, file) pairs run without asking: "always" answers and
    // files this session creates persist with the transcript (and return
    // on --resume); pasted file refs bless for this process only. The
    // toolApproval config consults this per call — a blessed call
    // executes inline with no prompt and no approval round.
    const blessings = new SessionBlessings()
    if (resumeSession) blessings.restoreDurable(resumeSession.approvals)
    // The streamed reply leaves the line open between deltas; anything
    // else printing closes it first.
    let midLine = false
    const closeStreamedLine = () => {
      if (!midLine) return
      output.write('\n')
      midLine = false
    }
    let peopleCount = 0

    // Render one context rebuild: the stats line and the changelog (for
    // recorded turns past the first).
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
    }

    // The terminal renders the session's event stream — the same stream a
    // web client will render — and nothing else.
    const render = (event: ChatSessionEvent) => {
      switch (event.type) {
        case 'text-delta': {
          // A paragraph break landing at a line start (after a tool line)
          // is one blank line, not two.
          const text = midLine ? event.text : event.text.replace(/^\n+/, '\n')
          output.write(text)
          midLine = !text.endsWith('\n')
          return
        }
        case 'turn-complete':
          closeStreamedLine()
          return
        case 'tool-call':
          // A tool line mid-sentence would land inside the streamed text.
          closeStreamedLine()
          if (event.toolName === 'web_search') {
            const input = event.input as { query: string }
            output.log(colors.dim(`Searching: "${input.query}"...`))
          } else if (event.toolName === 'web_fetch') {
            const input = event.input as { url: string }
            output.log(colors.dim(`Reading: ${input.url}`))
          } else if (event.toolName === READ_FILE_TOOL) {
            const input = event.input as { path: string }
            output.log(colors.dim(`Reading file: ${input.path}`))
          } else {
            output.log(colors.dim(`Running: ${event.toolName}...`))
          }
          return
        case 'context-gathering':
          output.log(colors.dim('Gathering context...'))
          return
        case 'context-rebuilt':
          renderContextReport(event.report)
          if (event.report.turn === 1 && event.report.recorded) {
            output.log(colors.dim(`Context loaded (${event.report.collectionSize} documents)`))
          }
          return
        case 'context-errors': {
          // Surfaced rather than silently answering without that context
          // (the session already recorded them in the turn log).
          const noun = event.errors.length === 1 ? 'query' : 'queries'
          output.log(
            colors.yellow(
              `${event.errors.length} context ${noun} failed — answering with incomplete context (logged to ${AI_ERROR_LOG_DISPLAY})`,
            ),
          )
          return
        }
        case 'queries-changed':
          output.log(colors.dim('Context shifting...'))
          return
        case 'no-new-queries':
          output.log(colors.dim('Queries unchanged, skipping re-execution.'))
          return
        case 'truncated':
          for (const t of event.items) {
            const cap = t.defaulted ? `default cap ${t.limit}` : `limit ${t.limit}`
            output.log(
              colors.yellow(`⚠ ${t.field}: ${t.matched} matched, ${t.returned} returned — ${cap} hit, rest dropped`),
            )
          }
          return
        case 'tools':
          // An empty or short list is the only visible symptom of a tool
          // that failed to load (createNotebookTools warns, but that
          // scrolls past under a long context gather).
          output.log(colors.dim(event.names.length > 0 ? `Tools: ${event.names.join(', ')}` : 'Tools: none available'))
          return
        case 'model-start':
          output.log(colors.dim('Thinking...'))
          output.log('')
          return
        case 'autosave-failed':
          output.log(colors.dim(`Autosave failed: ${event.message} (logged to ${AI_ERROR_LOG_DISPLAY})`))
          return
        case 'enriching':
          output.log('')
          output.log(colors.dim(`Choosing ${event.choosing.join(' and ')} from the archived-chat corpus…`))
          return
      }
    }

    const session = new ChatSession({
      today,
      startTime,
      days,
      baseDir,
      timeDir,
      contextTokens: contextBudget,
      summaryBaseline,
      resume: resumeSession,
      model: reasoning,
      profile: { provider: reasoningProfile.provider, model: reasoningProfile.model },
      producers: contextProducers(tasks),
      ambient: ctx,
      systemPrompt: async () => {
        const rendered = await renderChatSystemPrompt({
          config: config as Record<string, unknown>,
          clock: {
            notebookDate: context.notebookNow.date,
            notebookTime: context.notebookNow.time,
            systemDate: context.systemNow.date,
            systemTime: context.systemNow.time,
            notebookTimezone: context.notebookNow.timezone,
            systemTimezone: context.systemNow.timezone,
          },
          memoryDir: DIR_AI_MEMORY,
        })
        peopleCount = rendered.peopleCount
        return rendered.prompt
      },
      tools: async ({ onExternalFiles, onAttachments }) => {
        const webTools = env.PERPLEXITY_API_KEY ? createWebTools() : {}
        // A file the user points at: read into the conversation, copied
        // into the chat's day attachments, recorded on the transcript.
        const fileTools = createFileTools({
          today,
          attachmentsRoot: DIR_ATTACHMENTS,
          cwd: env.SKY_USER_CWD || process.cwd(),
          onAttachments,
        })
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
          onExternalFiles: (_toolName, files) => {
            // A file this session created is durably blessed: editing it
            // again is the same intent that created it.
            for (const file of files) {
              if (file.action !== 'created' || !file.id) continue
              for (const tool of sessionKeyToolNames()) blessings.blessDurably(tool, file.id)
            }
            onExternalFiles(files)
          },
        })
        return {
          tools: { ...webTools, ...fileTools, ...notebookTools },
          toolApproval: createToolApprovalConfig({
            isBlessed: (toolName, key) => blessings.has(toolName, key),
            onAutoApproved: (toolName, key) => {
              closeStreamedLine()
              output.log(colors.dim(`◦ ${toolName} auto-approved — blessed file ${key}`))
            },
          }),
        }
      },
      // Everything interactive about approvals lives here — the engine
      // drives the protocol around it.
      approvalHandler: async ({ toolName, input }) => {
        // A tool may scope approval to a stable key (e.g. the targeted
        // file id); a key the user already blessed skips the prompt.
        // Blessed keys normally never reach here — the toolApproval config
        // auto-approves them inline — so this check is a belt for hosts or
        // paths that still route through the handler.
        const sessionKey = getApprovalSessionKey(toolName)?.(input as Record<string, unknown>)

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

        if (sessionKey && blessings.has(toolName, sessionKey)) {
          output.log(colors.dim('Auto-approved — you allowed this file already.'))
          return { approved: true, reason: 'Auto-approved: the user allowed this file' }
        }

        let approved: boolean | symbol
        if (sessionKey) {
          const choice = await p.select({
            message: 'Approve?',
            options: [
              { value: 'yes', label: 'Yes' },
              { value: 'always', label: "Yes — don't ask again for this file (kept with this chat)" },
              { value: 'no', label: 'No' },
            ],
          })
          if (!p.isCancel(choice) && choice === 'always') blessings.blessDurably(toolName, sessionKey)
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
      approvals: () => blessings.serializeDurable(),
      autosavePath,
      onEvent: render,
    })

    // A resumed chat with a context log restores its recorded universe
    // exactly; anything else gathers a fresh baseline (the session decides).
    const restoring = resumeSession !== null && resumeSession.state.contextLog.length > 0
    if (restoring) {
      output.log(colors.dim('[resume] Resolving recorded context universe...'))
    } else if (!closed) {
      output.log(colors.dim('[server] Fetching context from server...'))
    }
    t0 = performance.now()
    const started = await session.start()

    if (started.restored && resumeSession) {
      const { resolution } = started.restored
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
    } else if (started.seeded) {
      const seed = started.seeded
      output.log(
        colors.dim(
          `[server] POST /context x5: ${seed.fetchMs.toFixed(
            0,
          )}ms — today=${seed.counts.today}, prev=${seed.counts.prev}, goals=${seed.counts.goals}, decisions=${seed.counts.decisions}, memory=${seed.counts.memory}`,
        ),
      )

      if (inspectInitialContext) {
        const sorted = session.paths.map((f) => (f.startsWith(baseDir) ? f.slice(baseDir.length + 1) : f)).sort()
        for (const f of sorted) {
          output.log(f)
        }
        return CommandResult.success({ turns: 0 })
      }

      output.log(colors.dim(`[server] DomainCollection: ${seed.collectionMs.toFixed(0)}ms`))
    } else if (started.closed) {
      if (inspectInitialContext) return CommandResult.success({ turns: 0 })
      output.log(colors.dim('[server] Notebook closed — no context fetched.'))
    }

    output.log(`Found:`)
    if (!started.closed) output.log(`  - ${session.paths.length} documents (including summaries)`)
    output.log(`  - ${peopleCount} active people`)
    output.log(`  - ${ctx.health.length} days of health data`)
    output.log(`  - ${ctx.prices.length} days of price data`)

    if (resumeSession) {
      if (started.restored) {
        renderContextReport(started.restored.rebuild)
      } else {
        output.log(colors.yellow('No context log in this transcript — gathering fresh context for your next message.'))
      }

      output.log('')
      output.log(colors.bold(`Resuming: ${truncate(resumeSession.summary || firstWordsSummary(session.turns), 80)}`))
      output.log(colors.dim(resumeSession.filePath))
      const replay = session.turns.slice(-4)
      if (session.turns.length > replay.length) {
        output.log(colors.dim(`  … ${session.turns.length - replay.length} earlier messages (Ctrl+B for full history)`))
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

    let splitViewEnabled = false
    let contextScrollOffset = 0

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
        const contextFiles = session.paths.map((f) => (f.startsWith(baseDir) ? f.slice(baseDir.length + 1) : f)).sort()

        const promptResult = await promptWithInk({
          topic: topic || undefined,
          saveOnExit: !ephemeral,
          logToDay: log,
          splitViewEnabled,
          contextScrollOffset,
          conversation: session.turns,
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
        session.clearContext()
        contextScrollOffset = 0
        output.log(colors.dim('Context gathering skipped.'))
        continue
      }

      // The first real message names the tab right away; the titler refines
      // the label once the first exchange exists.
      if (!topic) updateTopic(firstWordsSummary([{ role: 'user', content: userMessage }]))

      // A pasted Google file ref is permission to work on that file —
      // bless it for this process (a paste is not a standing grant).
      for (const fileId of harvestFileRefs(userMessage)) blessings.blessMention(fileId)

      const turn = await session.send(userMessage)
      if (turn.error) {
        output.log(colors.red(`Error: ${turn.error}`))
        output.log(colors.dim(`(logged to ${AI_ERROR_LOG_DISPLAY})`))
        continue
      }
      if (turn.approvalRoundsExhausted) {
        output.log(colors.dim('Too many approval requests, moving on.'))
      }

      // One shot over the first exchange: the pinned line and tab title
      // update when the label lands (save-time titling is independent).
      if (!resumeSession && !topicTitlerFired && session.turns.length >= 2) {
        topicTitlerFired = true
        summarizeTranscript(buildChatTranscript(session.turns.slice(0, 2)), { kind: CHAT_ENRICH.kind }).then((t) => {
          if (t) updateTopic(t)
        })
      }

      if (turn.sourceUrls.length > 0) {
        output.log('')
        output.log(colors.dim('Sources:'))
        for (const url of turn.sourceUrls) {
          output.log(colors.dim(`  - ${url}`))
        }
      }
      output.log('')
    }

    clearTerminalTitle()

    // Save unless --ephemeral. The session knows the other two rules: no
    // turns means nothing to save, and a resumed chat with no new messages
    // leaves its file untouched.
    const saved = await session.end({
      save: !ephemeral,
      autoTag: !noAutoTag,
      autoRel: !noAutoRel,
      memoryDir: DIR_AI_MEMORY,
      people: true,
      logToDay: log ? { category: category || 'Professional' } : null,
    })

    if (saved) {
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

      // What the session taught the CRM (people/ profiles). Same law as the
      // 🧠 block: every autonomous profile edit is shown, and the dim skips
      // include the person:new hint for someone who has no profile yet.
      if (saved.personOps && saved.personOps.length > 0) {
        output.log('')
        for (const op of saved.personOps) {
          const line = formatPersonOpLine(op)
          output.log(line.dim ? colors.dim(line.text) : line.text)
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

    output.log('')
    if (resumeSession && !session.hasNewMessages) {
      output.log(colors.dim('No new messages — file left untouched.'))
    } else if (ephemeral && session.turns.length > 0) {
      output.log(colors.dim(`${Math.floor(session.turns.length / 2)} turns (not saved)`))
    } else {
      output.log(colors.dim('No conversation to save.'))
    }
    return CommandResult.success({ turns: Math.floor(session.turns.length / 2) })
  }
}
