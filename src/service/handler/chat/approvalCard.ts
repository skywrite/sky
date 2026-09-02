/**
 * A tool call as the person sees it before saying yes — the same card
 * the terminal prints, captured as lines for the page.
 *
 * A tool may describe its own call (a static `formatApproval` on the
 * command); otherwise the input's fields are listed, a multi-line value
 * on its own lines. Formatters write for a terminal, so any color codes
 * are stripped: the page sets its own type.
 */

import type { FormatApprovalFn } from '#commands/lib/AIChatTool.ts'
import { BufferedOutput } from '#commands/lib/output/BufferedOutput.ts'

const ESC = String.fromCharCode(27)
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')

export function approvalCard(toolName: string, input: unknown, formatter?: FormatApprovalFn): string[] {
  const fields = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const output = new BufferedOutput()
  if (formatter) {
    formatter(fields, output)
  } else {
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === 'string' && value.includes('\n')) {
        output.log(`${key}:`)
        output.log(value)
      } else {
        output.log(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
      }
    }
  }
  const lines = output.getLogs().map((line) => line.replace(ANSI, ''))
  while (lines.length > 0 && lines[0].trim() === '') lines.shift()
  while (lines.length > 0 && lines.at(-1)!.trim() === '') lines.pop()
  return lines.length > 0 ? lines : [toolName]
}
