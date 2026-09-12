import type { FormatApprovalFn, NeedsApprovalForFn } from '#commands/lib/AIChatTool.ts'
import type CommandContext from '#commands/lib/core/CommandContext.ts'
import { calendarDraftIds } from '#lib/calendarScheduler/batch.ts'
import { CalendarSchedulerClient } from '#lib/calendarScheduler/client.ts'

async function savedApprovals(
  input: Record<string, unknown>,
  operation: 'schedule' | 'update',
  context?: CommandContext,
) {
  const ids = calendarDraftIds(input.send)
  if (operation === 'update' && ids.length !== 1) throw new Error('Save one prepared update at a time.')
  if (
    Object.entries(input).some(
      ([key, value]) =>
        key !== 'send' && key !== 'json' && value !== undefined && !(typeof value === 'string' && !value.trim()),
    )
  )
    throw new Error('Use only prepared draft IDs when saving calendar events.')
  if (!context) throw new Error('Calendar approval requires the command context.')
  const client = new CalendarSchedulerClient(`http://localhost:${context.config.PORT_SERVER}`)
  return Promise.all(ids.map((id) => client.approval(id, operation, context.signal)))
}

/** The saved guest lists decide approval; caller-supplied claims cannot exempt invitations. */
export function calendarNeedsApproval(operation: 'schedule' | 'update'): NeedsApprovalForFn {
  return async (input, context) => {
    if (input.send === undefined) return false
    const approvals = await savedApprovals(input, operation, context)
    return approvals.some((approval) => approval.needsApproval !== false)
  }
}

export function calendarApproval(operation: 'schedule' | 'update'): FormatApprovalFn {
  return async (input, output, context) => {
    const approvals = await savedApprovals(input, operation, context)
    if (approvals.length > 1) output.log(`Create these ${approvals.length} calendar events together.`)
    output.log(
      approvals
        .map((approval, index) => `${approvals.length > 1 ? `Event ${index + 1}\n` : ''}${approval.summary}`)
        .join('\n\n'),
    )
  }
}
