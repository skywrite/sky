import { generateObject } from 'ai'
import sharp from 'sharp'
import { aiModelByProfile } from '#shared/ai/models.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { parsePromptFile } from '#shared/prompts/parse.ts'
import type { ImageReference } from './references.ts'
import { imageReviewSchema } from './review.ts'
import type { ImageEditAssessment } from './review.ts'
import { imageVisualFacts } from './visualFacts.ts'

const PROMPT_FILE = new URL('../prompts/review.prompt.md', import.meta.url).pathname

/** Creations, full-image edits and mixed designs receive the same request-based review as masked edits. */
export async function assessImage(
  request: {
    prompt: string
    brief?: string
    data: Uint8Array
    refs: readonly ImageReference[]
    complexity?: 'simple' | 'complex'
    previous?: { data: Uint8Array; assessment?: ImageEditAssessment }
    signal?: AbortSignal
  },
  options: { model?: ResolvedModel; instructions?: string } = {},
): Promise<ImageEditAssessment> {
  const timeout = AbortSignal.timeout(120_000)
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout
  signal.throwIfAborted()
  const inputs = [
    ...request.refs.map((ref) => ref.data),
    request.data,
    ...(request.previous ? [request.previous.data] : []),
  ]
  const previews = await Promise.all(
    inputs.map((data) =>
      sharp(data)
        .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
        .png()
        .timeout({ seconds: 30 })
        .toBuffer(),
    ),
  )
  signal.throwIfAborted()
  const finalImageFacts = await imageVisualFacts(request.data)
  const instructions = options.instructions ?? parsePromptFile(await readPromptFile(PROMPT_FILE), PROMPT_FILE).body
  const { object } = await generateObject({
    ...(options.model ??
      aiModelByProfile(request.complexity === 'simple' ? 'default-gpt-6-astra-low' : 'default-gpt-6-astra-high')),
    instructions,
    schema: imageReviewSchema,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              prompt: request.prompt,
              brief: request.brief,
              allowMaskRevision: false,
              finalImageFacts,
              previousAssessment: request.previous?.assessment,
              imageOrder: [
                ...request.refs.map((_, i) => `original reference ${i + 1}`),
                'final candidate to review',
                ...(request.previous ? ['previous best candidate'] : []),
              ],
            }),
          },
          ...previews.map((data) => ({
            type: 'file' as const,
            mediaType: 'image',
            data: { type: 'data' as const, data },
            providerOptions: { openai: { imageDetail: 'high' } },
          })),
        ],
      },
    ],
    maxOutputTokens: 12_000,
    maxRetries: 1,
    abortSignal: signal,
  })
  signal.throwIfAborted()
  return object
}
