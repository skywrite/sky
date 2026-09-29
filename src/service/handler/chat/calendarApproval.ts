import { z } from 'zod'
import { calendarDraftIds } from '#lib/calendarScheduler/batch.ts'
import type { CalendarSchedulerClient } from '#lib/calendarScheduler/client.ts'
import type { CalendarPreparedDraft } from '#lib/calendarScheduler/types.ts'
import { meetingFieldsSchema } from '#lib/calendarScheduler/validation.ts'
import type { AnsweredApproval, ToolRun } from './mod.ts'

const availabilitySchema = z.object({
  scope: z.literal('first_occurrence').optional(),
  date: z.string(),
  timezone: z.string(),
  reviewKey: z.string(),
  warnings: z.array(z.string()),
  calendars: z.array(z.string()),
  alternatives: z.array(z.string()),
  events: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      start: z.string(),
      end: z.string(),
      allDay: z.boolean(),
      calendar: z.string(),
      busy: z.boolean(),
      conflict: z.boolean(),
      url: z.string().optional(),
    }),
  ),
})

/** Display history only: restoring an answered card never grants another tool execution. */
export function restoreAnsweredApprovals(value: unknown): AnsweredApproval[] | undefined {
  const parsed = z
    .array(
      z.object({
        id: z.string(),
        toolName: z.string(),
        lines: z.array(z.string()),
        sessionKey: z.string().optional(),
        approved: z.boolean(),
        at: z.number().int().nonnegative(),
        revision: z.number().int().nonnegative().optional(),
        calendar: z
          .array(
            z.object({
              id: z.uuid(),
              fields: meetingFieldsSchema,
              assumptions: z.array(z.string()),
              reviewKey: z.string(),
              availability: availabilitySchema.optional(),
            }),
          )
          .optional(),
      }),
    )
    .safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** Older snapshots kept send IDs but lost the cards. A durable job proves execution; a preparation does not. */
export async function recoverCalendarApprovals(
  runs: readonly ToolRun[],
  client: Pick<CalendarSchedulerClient, 'approval'>,
  answered: readonly AnsweredApproval[],
): Promise<AnsweredApproval[]> {
  const known = new Set(answered.flatMap((card) => card.calendar?.map((draft) => draft.id) ?? []))
  const cards: AnsweredApproval[] = []
  for (const run of runs) {
    if (run.tool !== 'calendar_schedule' || !run.input || typeof run.input !== 'object' || !('send' in run.input))
      continue
    let ids: string[]
    try {
      ids = calendarDraftIds(run.input.send).filter((id) => !known.has(id))
    } catch {
      continue
    }
    if (!ids.length) continue
    const results = await Promise.allSettled(ids.map((id) => client.approval(id, 'schedule')))
    const receipts = results.flatMap((result) =>
      result.status === 'fulfilled' && result.value.draft?.job ? [result.value] : [],
    )
    if (!receipts.length) continue
    const calendar = receipts.map((receipt) => receipt.draft!)
    calendar.forEach((draft) => known.add(draft.id))
    cards.push({
      id: `calendar-receipt-${run.callId ?? calendar[0]!.id}`,
      toolName: 'calendar_schedule',
      approved: true,
      at: run.at,
      lines: receipts.map((receipt) => receipt.summary),
      calendar,
    })
  }
  return cards
}

export interface CalendarApprovalRevision {
  calendar: CalendarPreparedDraft[]
  lines: string[]
  input: Record<string, unknown>
}

export type ReviseCalendarApproval = (
  current: CalendarPreparedDraft[],
  edits: unknown,
) => Promise<CalendarApprovalRevision>

/** Read only persisted drafts. The browser never supplies replacement tool arguments. */
export async function calendarApprovalPrompt(input: Record<string, unknown>, client: CalendarSchedulerClient) {
  const load = async (ids: string[]) => {
    const approvals = await Promise.all(ids.map((id) => client.approval(id, 'schedule')))
    const calendar = approvals.map((approval) => {
      if (!approval.draft) throw new Error('Reload the Sky service to review this meeting draft.')
      return approval.draft
    })
    return { calendar, lines: approvals.map((approval) => approval.summary), input: { send: ids.join(',') } }
  }
  const card = await load(calendarDraftIds(input.send))
  const revise: ReviseCalendarApproval = async (current, value) => {
    const edits = z
      .array(
        z
          .object({
            id: z.uuid(),
            fields: z.unknown(),
            reviewKey: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(50)
      .parse(value)
    if (edits.length !== current.length || edits.some((edit, index) => edit.id !== current[index]!.id))
      throw new Error('This meeting draft changed. Reload it before saving your edits.')
    const originals = await load(current.map((draft) => draft.id))
    if (originals.calendar.some((draft) => draft.job))
      throw new Error('An event is already being created. Check its result before making another draft.')
    const ids: string[] = []
    for (const [index, edit] of edits.entries()) {
      const before = current[index]!
      if (JSON.stringify(edit.fields) === JSON.stringify(before.fields) && edit.reviewKey === before.reviewKey) {
        ids.push(before.id)
        continue
      }
      const reviewed = await client.review({
        fields: edit.fields as CalendarPreparedDraft['fields'],
        reviewKey: edit.reviewKey,
      })
      if (!reviewed.draftId) throw new Error('The meeting details need another review.')
      ids.push(reviewed.draftId)
    }
    return load(ids)
  }
  return { ...card, revise }
}
