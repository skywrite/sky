import { AsyncLocalStorage } from 'node:async_hooks'
import * as path from 'node:path'
import type { ToolHooks } from '#shared/models/Chat/ChatSession/mod.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { splitChatFiles } from '#universal/ai/chatFiles.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { AGREEMENT_EXTENSIONS } from './agent.ts'
import { createLegalReviewer } from './runtime.ts'
import type { ReviewContext, ReviewSource } from './types.ts'

export interface LegalReviewChatContext {
  id: () => string | undefined
  link: (id: string) => Promise<void>
  sources: () => ReviewSource[]
  context: ReviewContext
}
export const legalReviewChat = new AsyncLocalStorage<LegalReviewChatContext>()

export async function legalReviewBrief(
  hooks: ToolHooks,
  config: Parameters<typeof createLegalReviewer>[0],
): Promise<string> {
  const id = hooks.legalReview.id()
  if (!id) return ''
  try {
    const review = await createLegalReviewer(config).store.read(id)
    return review
      ? `Current saved agreement review (reference data; user decisions are explicitly labeled):\n${JSON.stringify(review)}`
      : `The linked legal review ${id} is missing. Do not assume earlier findings are current.`
  } catch (error) {
    return `The linked legal review could not be loaded: ${(error as Error).message}. Do not claim to have checked its current state.`
  }
}

/** The host supplies actual context and source copies; the model cannot forge this envelope. */
export function legalReviewContext(hooks: ToolHooks, attachmentsRoot: string, source: string): LegalReviewChatContext {
  const names = new Map<string, string>()
  for (const turn of hooks.context.conversation) {
    if (turn.role !== 'user') continue
    for (const file of splitChatFiles(turn.content).files) {
      try {
        names.set(decodeURIComponent(file.url.split('/').at(-1)!), file.name)
      } catch {
        /* Invalid hand-edited clip. */
      }
    }
  }
  return {
    id: hooks.legalReview.id,
    link: hooks.legalReview.link,
    context: { source, instructions: hooks.context.instructions, conversation: hooks.context.conversation },
    sources: () =>
      hooks.attachments().flatMap(({ file }) => {
        if (
          !/^\d{4}-\d{2}-\d{2}_/.test(file) ||
          /[/\\]/.test(file) ||
          !AGREEMENT_EXTENSIONS.has(path.extname(file).toLowerCase())
        )
          return []
        return [
          {
            name: names.get(file) ?? file,
            path: path.join(attachmentsRoot, dayAttachmentsDir(new PlainDate(file.slice(0, 10))), file),
          },
        ]
      }),
  }
}

export const LEGAL_REVIEW_CHAT_INSTRUCTIONS = `## Related agreement reviews
Use legal_review for analyzing legal agreements. It reads original attachments and returns findings in this conversation. It automatically receives your profile, relationship and notebook context, and this conversation. Use the side and priorities already established there; ask only about a material ambiguity, never restart a generic intake questionnaire.
For related agreements, keep one review: add each new file to it, track the expected document count when the user states it, and compare the whole current set. The tool can register files without analysis (action=add) or return saved findings (action=status). For a revision, pass the previous document ID as replaces only when the user identifies it as a replacement; preserve amendments as separate agreements. Use document/documents to select agreements when the chat also contains unrelated attachments.
After a new agreement or material context arrives, call legal_review again before claiming the set is up to date. Surface glaring issues, material uncertainties, missing documents and consequential interactions, with the source clause/page and practical impact. Avoid exhaustive recitals and cosmetic drafting nits. Read the entire set even when the reply is brief.
If analysis fails or times out, stop analysis for this turn. Use action=status to report which originals and earlier findings are saved, and explain that this attempt did not finish. Do not automatically restart, reword focus, split the same set into repeated reviews, switch review IDs, or present your own fallback as a completed tool review. A later user request can start another attempt with the saved originals.
The review result separates AI assessments and recommendations from user decisions. Never treat your recommendation, a proposed response, silence, or a hypothetical as a decision the user made. The review summary lets the user record decisions explicitly.
Keep the review and shared questions in the conversation where they were asked. A reply thread is the user's explicit place to draft and refine the team response; use its inherited review context and the writing voice tool there. Never route a main-chat message to a thread automatically.
legal_annotate is optional and only for an explicit request to upload to Google Docs, add comments or make suggested edits. Ordinary review does not authorize annotation or a Google upload.`
