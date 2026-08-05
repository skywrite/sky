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
import { cachedInstructions, withCacheTail } from '#shared/ai/promptCache.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { estimateTokens } from '#shared/models/AI/ContextAssembler/mod.ts'
import truncate from '#shared/strings/truncate.ts'
import type { ConversationMessage } from '../type.d.ts'
import type { ToolCallRecord } from '../document/ContextLog/mod.ts'

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

export interface TurnResult {
  text: string
  /** web_search result URLs in call order, duplicates included. */
  sourceUrls: string[]
  /** Executed and denied tool calls, ready for ChatContext.recordTurnTools. */
  toolRecords: ToolCallRecord[]
  /** True when the approval-round cap cut the loop short. */
  approvalRoundsExhausted: boolean
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
}

/** Test seam: one model invocation over the prepared prompt. */
export type ModelInvoker = (args: {
  instructions: SystemModelMessage[]
  messages: Message[]
}) => Promise<ModelInvocation>

// -----------------------------------------------------------------------------
// Options
// -----------------------------------------------------------------------------

export interface RunTurnOptions {
  /** Prompt-cache segments — each gets its own breakpoint (base system prompt, context prompt). */
  instructions: string[]
  /** Tool set for this turn — hosts may rebuild it every turn (the CLI does). */
  tools: Record<string, unknown>
  toolApproval: Record<string, 'user-approval'>
}

export interface ChatEngineOptions {
  /** Resolved model profile, spread into every invocation. */
  model: ResolvedModel
  approvalHandler: ApprovalHandler
  /** Fires as the model starts tool calls, for host progress lines. */
  onToolCall?: (toolCall: { toolName: string; input: unknown }) => void
  maxApprovalRounds?: number
  /** Test seam — production streams via streamText. */
  invokeModel?: ModelInvoker
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// ChatEngine
// -----------------------------------------------------------------------------

export default class ChatEngine {
  private readonly model: ResolvedModel
  private readonly approvalHandler: ApprovalHandler
  private readonly onToolCall?: (toolCall: { toolName: string; input: unknown }) => void
  private readonly maxApprovalRounds: number
  private readonly invokeModel?: ModelInvoker

  /** The model-facing conversation history, tool exchanges included. */
  private messages: Message[] = []

  constructor(opts: ChatEngineOptions) {
    this.model = opts.model
    this.approvalHandler = opts.approvalHandler
    this.onToolCall = opts.onToolCall
    this.maxApprovalRounds = opts.maxApprovalRounds ?? 3
    this.invokeModel = opts.invokeModel
  }

  /** Reseed the history from a saved transcript (resume). */
  seedConversation(conversation: ConversationMessage[]): void {
    this.messages.push(...conversation.map((m) => ({ role: m.role, content: m.content })))
  }

  /**
   * Add the user's message to the history. A resumed transcript can end
   * mid-exchange on a user message; merge into it so roles keep alternating.
   */
  appendUserMessage(userMessage: string): void {
    const priorMsg = this.messages.at(-1)
    if (priorMsg?.role === 'user' && typeof priorMsg.content === 'string') {
      priorMsg.content += '\n\n' + userMessage
    } else {
      this.messages.push({ role: 'user', content: userMessage })
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

    const onStepEnd = ({ toolCalls }: { toolCalls?: Array<{ toolName: string; input: unknown }> }) => {
      for (const tc of toolCalls ?? []) {
        this.onToolCall?.(tc)
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
      (async ({ instructions, messages }) => {
        const stream = streamText({
          ...this.model,
          instructions,
          messages,
          // Discovered notebook tools arrive as untyped records; this SDK
          // boundary is where they become a ToolSet.
          tools: opts.tools as ToolSet,
          toolApproval: opts.toolApproval,
          stopWhen: isStepCount(5),
          onStepEnd,
        })
        return {
          text: await stream.text,
          content: await stream.content,
          steps: await stream.steps,
          responseMessages: await stream.responseMessages,
        }
      })
    const runRound = () =>
      invoke({ instructions: cachedInstructions(opts.instructions), messages: withCacheTail(this.messages) })

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

    let result = await runRound()

    // Handle tool approval requests (e.g., slack_cli_post-self with needsApproval)
    const deniedTools = new Set<string>()
    let approvalRound = 0
    let approvalRoundsExhausted = false
    // deno-lint-ignore no-explicit-any
    while (result.content?.some((part: any) => part.type === 'tool-approval-request')) {
      if (++approvalRound > this.maxApprovalRounds) {
        approvalRoundsExhausted = true
        break
      }

      // deno-lint-ignore no-explicit-any
      this.messages.push(...(result.responseMessages as any))

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

    return { text: result.text, sourceUrls, toolRecords: turnTools, approvalRoundsExhausted }
  }
}
