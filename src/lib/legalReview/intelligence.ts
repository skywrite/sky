import { streamObject, type UserContent } from 'ai'
import type { LoadedDocument } from '#lib/documents/loadDocument.ts'
import { aiModelByProfile, ROLES, type ResolvedModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { AnalysisSchema, type Analysis, type LegalReview, type ReviewContext, type ReviewDocument } from './types.ts'

export type ReadableAgreement = { record: ReviewDocument; document: LoadedDocument }
export type ReviewIntelligence = (input: {
  review: LegalReview
  context: ReviewContext
  documents: ReadableAgreement[]
  progress?: (line: string) => void
}) => Promise<Analysis>

const PROMPT = new URL('../../commands/all/legal/prompts/review.prompt.md', import.meta.url).pathname
const ANALYSIS_TIMEOUT_MS = 15 * 60_000

export async function analyzeAgreements(
  { review, context, documents, progress }: Parameters<ReviewIntelligence>[0],
  options: { model?: ResolvedModel; timeoutMs?: number } = {},
): Promise<Analysis> {
  const content: UserContent = [
    {
      type: 'text',
      text: JSON.stringify({
        context,
        review: {
          focus: review.focus,
          expectedDocuments: review.expectedDocuments,
          documents: review.documents,
          priorFindings: review.findings,
          userDecisions: review.decisions,
        },
      }),
    },
  ]
  for (const { record, document } of documents) {
    content.push({ type: 'text', text: `Agreement ${record.id}: ${record.name}. Read its entire contents.` })
    if (document.kind === 'text') content.push({ type: 'text', text: document.text })
    else if (document.kind === 'pdf')
      content.push({ type: 'file', data: document.data, mediaType: document.mediaType, filename: record.name })
  }
  const instructions = renderPromptFile(await readPromptFile(PROMPT), PROMPT, {}).output
  const timeoutMs = options.timeoutMs ?? ANALYSIS_TIMEOUT_MS
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    // Streaming uses the provider's idle guard; a working review can outlive the old four-minute cutoff.
    // No tools: analysis cannot upload, comment, or edit. A failure returns to the caller without SDK retries.
    const result = streamObject({
      ...(options.model ?? aiModelByProfile(ROLES.reasoning)),
      schema: AnalysisSchema,
      instructions,
      messages: [{ role: 'user', content }],
      abortSignal: signal,
      maxRetries: 0,
      onError: () => {}, // The stream error below is reported through the command and saved review.
    })
    let receiving = false
    for await (const part of result.fullStream) {
      if (part.type === 'error') throw part.error
      if (!receiving && part.type === 'object') {
        receiving = true
        progress?.('Receiving the analysis; findings will be saved after validation')
      }
    }
    return await result.object
  } catch (error) {
    if (signal.aborted) {
      const limit = timeoutMs % 60_000 === 0 ? `${timeoutMs / 60_000} minutes` : `${timeoutMs / 1000} seconds`
      throw new Error(
        `Agreement analysis timed out after ${limit} before completing. No new findings were saved. Do not repeat the analysis in this turn; read the saved review with action=status.`,
      )
    }
    throw error
  }
}
