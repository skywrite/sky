/**
 * Decorator to mark a task as an AI Chat tool.
 *
 * Tasks decorated with @AIChatTool() are automatically discovered and
 * exposed as tools in the ai:chat conversation. The tool's input schema
 * is derived from the task's params definition - no manual duplication.
 *
 * Usage:
 *   @AIChatTool({ needsApproval: true })
 *   export default class SlackPostTask extends Command { ... }
 */

import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'

const AI_CHAT_TOOL_KEY = Symbol('ai-chat-tool')

export interface AIChatToolOptions {
  /** Require human approval before executing (default: true) */
  needsApproval?: boolean
}

/**
 * Mark a task class as exposed in ai:chat.
 *
 * The task can optionally define a static `formatApproval` method to
 * customize the approval prompt shown to the user:
 *
 *   static formatApproval(input: Record<string, unknown>, output: OutputHandler): void
 */
export function AIChatTool(options: AIChatToolOptions = {}) {
  // deno-lint-ignore no-explicit-any
  return function (target: any) {
    target[AI_CHAT_TOOL_KEY] = options
    return target
  }
}

/** Check if a class is decorated with @AIChatTool */
// deno-lint-ignore no-explicit-any
export function isAIChatTool(target: any): boolean {
  return AI_CHAT_TOOL_KEY in target
}

/** Get options from a decorated class */
// deno-lint-ignore no-explicit-any
export function getAIChatToolOptions(target: any): AIChatToolOptions | undefined {
  return target[AI_CHAT_TOOL_KEY]
}

/** Type for the optional static formatApproval method on task classes */
export type FormatApprovalFn = (input: Record<string, unknown>, output: OutputHandler) => void

/**
 * Type for the optional static approvalSessionKey method on task classes.
 * When a call's input maps to a stable key (e.g. the targeted file id), the
 * approval prompt offers "don't ask again for this one this session" and
 * later calls with the same key are auto-approved. Return undefined for
 * inputs that should always prompt.
 */
export type ApprovalSessionKeyFn = (input: Record<string, unknown>) => string | undefined
