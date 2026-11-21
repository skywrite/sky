import { z } from 'zod'
import { hash } from '#lib/outbox/files.ts'
import { WritingDraftId } from '#lib/writingVoice/draftId.ts'
import { ChatDraftInputSchema, type WritingDraftView } from '#lib/writingVoice/draftTypes.ts'
import type { ToolRun } from './mod.ts'

const Revision = z.object({
  draftId: WritingDraftId,
  draftRevision: z.number().int().positive(),
  instruction: z.string().min(1).max(4000),
  inputRevision: z.string().optional(),
})
const Request = ChatDraftInputSchema.extend({ action: z.literal('draft') })
const MissingMeaning = z.tuple([
  z.object({ code: z.literal('invalid_type'), expected: z.literal('string'), path: z.tuple([z.literal('meaning')]) }),
])

/** These older failures predate retry metadata. Their tool input still identifies the exact edit. */
function legacyFailure(error: string): string | undefined {
  if (error === 'The operation timed out.') return error
  if (!error.startsWith('[')) return
  try {
    if (MissingMeaning.safeParse(JSON.parse(error)).success) return 'Ghostwriter could not load the draft text.'
  } catch {
    // Other failures did not identify a recoverable edit.
  }
}

/** Retry only a recorded writer failure against the version and context it read. */
export function pendingDraftEdit(runs: readonly ToolRun[], draft: WritingDraftView) {
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]!
    if (run.tool !== 'me_voice' || !run.output || typeof run.output !== 'object') continue
    const output = run.output as Record<string, unknown>
    if (run.status === 'success' && output.draftId === draft.id) return
    if (run.status !== 'error' || !run.callId || typeof output.error !== 'string') continue
    const error = output.retry ? output.error : legacyFailure(output.error)
    if (!error) continue
    const target = Revision.safeParse(output.retry ?? run.input)
    if (!target.success || target.data.draftId !== draft.id) continue
    if (run.editRetried || target.data.draftRevision !== draft.revision) return
    if (target.data.inputRevision && target.data.inputRevision !== hash(JSON.stringify(draft.input))) return
    const input = Request.safeParse(run.input)
    if (!input.success) return
    const { draftId, draftRevision, instruction } = target.data
    return {
      run,
      input: { ...input.data, draftId, draftRevision, instruction, newDraft: false },
      offer: { callId: run.callId, instruction, error },
    }
  }
}
