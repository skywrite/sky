/**
 * The turn-runner behind ai:chat — the other half of the engine beside
 * ChatContext. ChatContext decides what documents the model sees;
 * ChatEngine runs the model over them: the conversation history, one
 * streaming invocation per approval round, the tool-approval protocol,
 * and the per-turn tool activity record that feeds the context log.
 *
 * The class is host-neutral: it never prints and never prompts. A host
 * injects an ApprovalHandler (the CLI: clack prompts + session-approval
 * memory; a web session later: an HTTP round-trip) and renders the
 * returned TurnResult. The model call sits behind an injectable seam so
 * the approval protocol is unit-testable with scripted results.
 */

import { isStepCount, streamText, type SystemModelMessage, type ToolSet } from 'ai'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { cachedInstructions, withCacheTail } from '#shared/ai/promptCache.ts'
import { estimateTokens } from '#shared/models/AI/ContextAssembler/mod.ts'
import truncate from '#shared/strings/truncate.ts'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { ToolCallRecord } from '../document/ContextLog/mod.ts'
import type { ConversationMessage } from '../type.d.ts'

type Message = { role: 'user' | 'assistant'; content: string }

// -----------------------------------------------------------------------------
// Approvals — the interaction a host injects
// -----------------------------------------------------------------------------

export interface ApprovalRequest {
  toolName: string
  input: unknown
}

export interface ApprovalDecision {
  approved: boolean
  /** Travels back to the model with the response — it reads this. */
  reason: string
}

/**
 * Decides one tool-approval request. The handler owns everything
 * interactive — rendering the call, session-scoped auto-approvals, the
 * actual ask. The engine owns the protocol around it: repeated requests
 * for a tool already denied this turn are auto-denied without consulting
 * the handler again.
 */
export type ApprovalHandler = (toolCall: ApprovalRequest) => Promise<ApprovalDecision>

// -----------------------------------------------------------------------------
// Results
// -----------------------------------------------------------------------------

/**
 * Everything a host renders while a turn runs, as one stream rather than
 * a callback per concern. A terminal writes the deltas as they land, an
 * SSE endpoint forwards them to a browser, a headless run ignores the
 * lot. The SDK exposes finer tool lifecycle callbacks (execution start
 * and end) — they get events when something renders them.
 */
export type ChatEngineEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; toolName: string; input: unknown }
  | { type: 'turn-complete'; toolRecords: ToolCallRecord[] }

export interface TurnResult {
  /** The reply exactly as it streamed: every text delta in order, step and round boundaries as paragraph breaks. */
  text: string
  /** web_search result URLs in call order, duplicates included. */
  sourceUrls: string[]
  /** Executed and denied tool calls, ready for ChatContext.recordTurnTools. */
  toolRecords: ToolCallRecord[]
  /** True when the approval-round cap cut the loop short. */
  approvalRoundsExhausted: boolean
}

/**
 * Turn-error messages are clamped before they travel: a message-validation
 * failure embeds the entire offending message array in its message, and
 * hosts print and log this string.
 */
const MAX_TURN_ERROR_CHARS = 2000

/**
 * A turn that died mid-stream. The engine has already rolled its history
 * back to the turn's start; toolRecords carries what executed or was denied
 * before the failure so the host can still record the tool trail — a
 * side-effectful call (a sent post, a created doc) must not vanish from the
 * transcript because the turn later died.
 */
export class TurnError extends Error {
  readonly toolRecords: ToolCallRecord[]
  constructor(message: string, toolRecords: ToolCallRecord[]) {
    super(message)
    this.name = 'TurnError'
    this.toolRecords = toolRecords
  }
}

/**
 * One model invocation's result surfaces. Shapes vary by SDK path, so the
 * scanning stays untyped — see collectToolActivity.
 */
export interface ModelInvocation {
  text: string
  // deno-lint-ignore no-explicit-any
  content: any[]
  // deno-lint-ignore no-explicit-any
  steps: any[]
  // deno-lint-ignore no-explicit-any
  responseMessages: any[]
  /**
   * First error the stream surfaced mid-flight. Once a step has completed,
   * the SDK resolves every result promise with partials and reports a later
   * step's failure only through onError — so it rides here, never as a
   * rejection.
   */
  error?: unknown
}

/**
 * Where an invocation's reply text goes as it arrives. The engine owns the
 * sink: every piece written becomes a text-delta event AND part of the
 * returned text, so what a host rendered and what gets saved are the same
 * string by construction. A step boundary becomes a paragraph break
 * between the pieces it separates.
 */
export interface TextSink {
  write(text: string): void
  /** A model step ended — text that follows starts a new paragraph. */
  stepEnd(): void
}

/**
 * Test seam: one model invocation over the prepared prompt. Production
 * wires the SDK's streaming callbacks to the sink; a scripted invoker
 * writes pieces to it, so the streaming path runs without a model.
 */
export type ModelInvoker = (args: {
  instructions: SystemModelMessage[]
  messages: Message[]
  sink: TextSink
}) => Promise<ModelInvocation>

// -----------------------------------------------------------------------------
// Options
// -----------------------------------------------------------------------------

/**
 * Per-tool approval policy: the static gate, or a per-call decision.
 * A function returning 'approved' executes the call inline in the same
 * generation — no prompt, no approval round — so hosts use it to skip
 * asking for inputs the user already blessed this session.
 */
export type ToolApprovalPolicy = 'user-approval' | ((input: Record<string, unknown>) => 'approved' | 'user-approval')

export type ToolApprovalConfig = Record<string, ToolApprovalPolicy>

export interface RunTurnOptions {
  /** Prompt-cache segments — each gets its own breakpoint (base system prompt, context prompt). */
  instructions: string[]
  /** Tool set for this turn — hosts may rebuild it every turn (the CLI does). */
  tools: Record<string, unknown>
  toolApproval: ToolApprovalConfig
}

export interface ChatEngineOptions {
  /** Resolved model profile, spread into every invocation. */
  model: ResolvedModel
  approvalHandler: ApprovalHandler
  /** The turn's event stream — progress lines, SSE frames, or nothing. */
  onEvent?: (event: ChatEngineEvent) => void
  maxApprovalRounds?: number
  /** Model steps (text + tool calls) per invocation round. Default 5; research-style tool loops raise it. */
  maxSteps?: number
  /** Test seam — production streams via streamText. */
  invokeModel?: ModelInvoker
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * The model-facing time prefix for a user message. `when` is a notebook
 * datetime (`YYYY-MM-DD HH:MM`). The weekday rides along because models
 * cannot reliably derive one from a bare date, and during extended hours
 * (24:00 and beyond) the wall-clock equivalent is appended so the model
 * never has to de-extend late-night dates itself.
 */
export function timeStampLine(when: string): string {
  const stamped = withWeekday(when)
  const hours = Number(when.split(' ')[1]?.split(':')[0])
  if (!(hours >= 24)) return `[Time: ${stamped}]`
  return `[Time: ${stamped} notebook - wall clock ${new PlainDateTime(when).normalize().toString()}]`
}

/** "2026-08-20 07:58" -> "2026-08-20 Thu 07:58"; anything unparseable passes through untouched. */
function withWeekday(when: string): string {
  const match = when.match(/^(\d{4}-\d{2}-\d{2}) /)
  if (!match) return when
  try {
    return `${match[1]} ${new PlainDate(match[1]).dayShort} ${when.slice(match[0].length)}`
  } catch {
    return when
  }
}

/** Short human digest of a tool input for the turn log — never the payload. */
function toolInputDigest(input: unknown): string | undefined {
  if (input == null) return undefined
  if (typeof input === 'object') {
    const o = input as Record<string, unknown>
    for (const key of ['query', 'url', 'path', 'message', 'text']) {
      if (typeof o[key] === 'string') return truncate(o[key] as string, 120)
    }
  }
  return truncate(typeof input === 'string' ? input : JSON.stringify(input), 120)
}

// -----------------------------------------------------------------------------
// ChatEngine
// -----------------------------------------------------------------------------

export default class ChatEngine {
  private model: ResolvedModel
  private readonly approvalHandler: ApprovalHandler
  private readonly onEvent?: (event: ChatEngineEvent) => void
  private readonly maxApprovalRounds: number
  private readonly maxSteps: number
  private readonly invokeModel?: ModelInvoker

  /** The model-facing conversation history, tool exchanges included. */
  private messages: Message[] = []

  constructor(opts: ChatEngineOptions) {
    this.model = opts.model
    this.approvalHandler = opts.approvalHandler
    this.onEvent = opts.onEvent
    this.maxApprovalRounds = opts.maxApprovalRounds ?? 3
    this.maxSteps = opts.maxSteps ?? 5
    this.invokeModel = opts.invokeModel
  }

  /** Think with another model from the next invocation on — a host's per-thread choice. */
  setModel(model: ResolvedModel): void {
    this.model = model
  }

  /**
   * Reseed the history from a saved transcript (resume). Stamped user
   * messages regain their model-facing time prefix so the model can read
   * how old the prior exchanges are. Assistant stamps stay file-only —
   * prefixing the model's own past replies would teach it to emit stamps.
   */
  seedConversation(conversation: ConversationMessage[]): void {
    this.messages.push(
      ...conversation.map((m) => ({
        role: m.role,
        content: m.role === 'user' && m.when ? `${timeStampLine(m.when)}\n${m.content}` : m.content,
      })),
    )
  }

  /**
   * Add the user's message to the history, prefixed with its time stamp
   * when one is given. A resumed transcript can end mid-exchange on a user
   * message; merge into it so roles keep alternating — each merged chunk
   * keeps its own stamp.
   */
  appendUserMessage(userMessage: string, when?: string): void {
    const content = when ? `${timeStampLine(when)}\n${userMessage}` : userMessage
    const priorMsg = this.messages.at(-1)
    if (priorMsg?.role === 'user' && typeof priorMsg.content === 'string') {
      priorMsg.content += '\n\n' + content
    } else {
      this.messages.push({ role: 'user', content })
    }
  }

  /**
   * Run one conversation turn: invoke the model, walk the tool-approval
   * rounds through the injected handler, and record every tool call. The
   * user message must already be appended (appendUserMessage).
   */
  async runTurn(opts: RunTurnOptions): Promise<TurnResult> {
    // Every tool call this turn, for the saved log: executed ones are
    // collected from the result surfaces, denials at the approval protocol.
    const turnTools: ToolCallRecord[] = []
    const deniedCallIds = new Set<string>()
    // deno-lint-ignore no-explicit-any
    const recordDeniedTool = (toolCall: any) => {
      if (toolCall.toolCallId) deniedCallIds.add(toolCall.toolCallId)
      turnTools.push({ tool: toolCall.toolName, input: toolInputDigest(toolCall.input), outcome: 'denied' })
    }

    const emit = (event: ChatEngineEvent) => this.onEvent?.(event)

    // The reply, accumulated from exactly what was emitted. A boundary
    // defers its paragraph break until text actually follows, so a turn
    // never ends on a dangling separator.
    let reply = ''
    let roundPieces = 0
    let breakPending = false
    const sink: TextSink = {
      write: (piece) => {
        if (!piece) return
        if (breakPending) {
          breakPending = false
          if (!reply.endsWith('\n') && !piece.startsWith('\n')) sink.write('\n\n')
        }
        reply += piece
        roundPieces++
        emit({ type: 'text-delta', text: piece })
      },
      stepEnd: () => {
        breakPending = reply.length > 0
      },
    }

    const onStepEnd = ({ toolCalls }: { toolCalls?: Array<{ toolName: string; input: unknown }> }) => {
      for (const tc of toolCalls ?? []) {
        emit({ type: 'tool-call', toolName: tc.toolName, input: tc.input })
      }
    }

    // Stream the reasoning turn rather than issuing a single blocking
    // request. A non-streaming call holds an idle socket for the entire
    // (potentially many-minute) generation; on flaky networks or past
    // Anthropic's ~10-min non-streaming ceiling that connection gets
    // dropped ("socket connection was closed unexpectedly"). Streaming
    // keeps SSE bytes flowing the whole time. Awaiting the result promises
    // consumes the stream and rejects on a mid-stream error, which the
    // caller's try/catch handles. Shape mirrors the old generateText
    // result so the approval loop and downstream rendering are unchanged.
    const invoke: ModelInvoker =
      this.invokeModel ??
      (async ({ instructions, messages, sink }) => {
        // The SDK's default onError is console.error — for a message-
        // validation failure that dump embeds the entire message array.
        // Capture instead: once a step has completed, the result promises
        // resolve with partials and this callback is the only surface where
        // a later step's error is observable at all. Tool failures are not
        // errors here — they flow as tool-error parts and never fire this.
        let streamError: unknown
        const stream = streamText({
          ...this.model,
          instructions,
          messages,
          // Discovered notebook tools arrive as untyped records; this SDK
          // boundary is where they become a ToolSet.
          tools: opts.tools as ToolSet,
          toolApproval: opts.toolApproval,
          stopWhen: isStepCount(this.maxSteps),
          onStepEnd,
          // Deltas ride a callback rather than a consumed stream: awaiting
          // the result promises below is what drives this stream, and
          // iterating it here as well would leave two consumers racing the
          // same source.
          onChunk: ({ chunk }) => {
            if (chunk.type === 'text-delta') sink.write(chunk.text)
            else if (chunk.type === 'finish-step') sink.stepEnd()
          },
          onError: ({ error }) => {
            streamError ??= error
          },
        })
        try {
          return {
            text: await stream.text,
            content: await stream.content,
            steps: await stream.steps,
            responseMessages: await stream.responseMessages,
            error: streamError,
          }
        } catch (err) {
          // When zero steps completed (e.g. every retry of the first request
          // failed), the SDK rejects all result promises with a generic
          // NoOutputGeneratedError — the real cause (an overloaded 529, an
          // exhausted retry) was only ever surfaced through onError. Prefer
          // the captured error so logs name what actually happened.
          throw streamError ?? err
        }
      })
    const runRound = async () => {
      roundPieces = 0
      const result = await invoke({
        instructions: cachedInstructions(opts.instructions),
        messages: withCacheTail(this.messages),
        sink,
      })
      if (result.error !== undefined) {
        // The partial result still names what executed before the stream
        // died — scan it so the failed turn keeps its tool trail.
        collectToolActivity(result)
        throw result.error
      }
      // A round that streamed nothing (a provider without chunk callbacks,
      // a scripted invoker) still delivers its text through the sink, so
      // no host needs a whole-text fallback of its own.
      if (roundPieces === 0) sink.write(result.text)
      sink.stepEnd()
      return result
    }

    // Record executed tool calls and web-search source URLs from one
    // invocation's result. Approval rounds re-invoke the model, so every
    // result must be scanned — not just the last, which loses whatever
    // ran in earlier rounds. An approved call executes at the start of
    // the continuation and can surface in steps, content parts, or tool
    // response messages depending on the SDK path; the seen set guards
    // the overlap.
    const seenToolCallIds = new Set<string>()
    const sourceUrls: string[] = []
    // deno-lint-ignore no-explicit-any
    const recordExecutedTool = (toolName: string, trc: any) => {
      if (trc?.toolCallId) {
        if (deniedCallIds.has(trc.toolCallId) || seenToolCallIds.has(trc.toolCallId)) return
        seenToolCallIds.add(trc.toolCallId)
      }
      const out = trc?.output
      turnTools.push({
        tool: toolName,
        input: toolInputDigest(trc?.input),
        outcome: out !== null && typeof out === 'object' && out.success === false ? 'error' : 'ok',
        tokens: estimateTokens(typeof out === 'string' ? out : JSON.stringify(out ?? '')),
      })
    }
    // deno-lint-ignore no-explicit-any
    const collectToolActivity = (r: any) => {
      for (const step of r.steps ?? []) {
        for (const tr of step.toolResults ?? []) {
          if (tr.toolName === 'web_search' && Array.isArray(tr.output)) {
            for (const res of tr.output as Array<{ url?: string }>) {
              if (res.url) sourceUrls.push(res.url)
            }
          }
          recordExecutedTool(tr.toolName, tr)
        }
      }
      for (const part of r.content ?? []) {
        if (part.type === 'tool-result') recordExecutedTool(part.toolName, part)
      }
      for (const message of r.responseMessages ?? []) {
        if (message.role !== 'tool') continue
        for (const part of Array.isArray(message.content) ? message.content : []) {
          if (part.type === 'tool-result') recordExecutedTool(part.toolName, part)
        }
      }
    }

    // The rollback point: a failed turn must leave the model-facing history
    // exactly as it stood after the user's message. The approval loop pushes
    // mid-turn (assistant tool_use + approval responses); leaving that tail
    // without the continuation's tool results would fail every later call —
    // a permanently dead session.
    const historyMark = this.messages.length

    try {
      let result = await runRound()

      // Handle tool approval requests (e.g., slack_cli_post-self with needsApproval).
      // A policy function that answered 'approved' leaves a request+response PAIR
      // inline and the call already executed — only requests without a response
      // are pending and pause the turn.
      // deno-lint-ignore no-explicit-any
      const pendingApprovals = (content: any[] | undefined) => {
        // deno-lint-ignore no-explicit-any
        const answered = new Set(
          (content ?? [])
            .filter((part: any) => part.type === 'tool-approval-response')
            .map((part: any) => part.approvalId),
        )
        // deno-lint-ignore no-explicit-any
        return (content ?? []).filter(
          (part: any) => part.type === 'tool-approval-request' && !answered.has(part.approvalId),
        )
      }
      const deniedTools = new Set<string>()
      let approvalRound = 0
      let approvalRoundsExhausted = false
      while (pendingApprovals(result.content).length > 0) {
        if (++approvalRound > this.maxApprovalRounds) {
          approvalRoundsExhausted = true
          break
        }

        // deno-lint-ignore no-explicit-any
        this.messages.push(...(result.responseMessages as any))

        const approvalRequests = pendingApprovals(result.content)
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

          const decision = await this.approvalHandler({ toolName: toolCall.toolName, input: toolCall.input })
          if (!decision.approved) {
            deniedTools.add(toolCall.toolName)
            recordDeniedTool(toolCall)
          }
          approvals.push({
            type: 'tool-approval-response',
            approvalId,
            approved: decision.approved,
            reason: decision.reason,
          })
        }

        // deno-lint-ignore no-explicit-any
        this.messages.push({ role: 'tool', content: approvals } as any)

        // Scan this round's result before the continuation replaces it —
        // denials were recorded at the approval prompt; their ids are
        // skipped so nothing double-counts.
        collectToolActivity(result)

        result = await runRound()
      }

      collectToolActivity(result)

      // Push all response messages (including tool_use/tool_result pairs) to
      // preserve valid conversation history
      // deno-lint-ignore no-explicit-any
      this.messages.push(...(result.responseMessages as any))

      // Terminal event as well as a return value — a host consuming only
      // the stream can close its rendering on this without a second code
      // path for the turn ending.
      emit({ type: 'turn-complete', toolRecords: turnTools })

      return { text: reply, sourceUrls, toolRecords: turnTools, approvalRoundsExhausted }
    } catch (err) {
      // Roll back to the turn's start and rethrow clamped — the raw SDK
      // error can embed the entire message array, and hosts print and log
      // the message. The tool trail rides along for the host's records.
      this.messages.length = historyMark
      const message = err instanceof Error ? err.message : String(err)
      throw new TurnError(truncate(message, MAX_TURN_ERROR_CHARS), turnTools)
    }
  }
}
