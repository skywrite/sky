import { z } from 'zod'
import type { FormatApprovalFn, NeedsApprovalForFn } from '#commands/lib/AIChatTool.ts'
import { CalendarSchedulerClient } from '#lib/calendarScheduler/client.ts'

/** Preparation and status reads are free; only saving an exact draft asks for approval. */
export const calendarNeedsApproval: NeedsApprovalForFn = (input) => input.send !== undefined

export function calendarApproval(operation: 'schedule' | 'update'): FormatApprovalFn {
  return async (input, output, context) => {
    const id = z.string().trim().pipe(z.uuid()).parse(input.send)
    if (
      Object.entries(input).some(
        ([key, value]) =>
          key !== 'send' && key !== 'json' && value !== undefined && !(typeof value === 'string' && !value.trim()),
      )
    )
      throw new Error('Use only the prepared draft ID when saving a calendar event.')
    if (!context) throw new Error('Calendar approval requires the command context.')
    const client = new CalendarSchedulerClient(`http://localhost:${context.config.PORT_SERVER}`)
    const { summary } = await client.approval(id, operation, context.signal)
    output.log(summary)
  }
}
