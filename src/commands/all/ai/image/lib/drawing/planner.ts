import { generateObject } from 'ai'
import sharp from 'sharp'
import { aiModelByProfile } from '#shared/ai/models.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { parsePromptFile } from '#shared/prompts/parse.ts'
import { MAX_REF_IMAGES } from '../options.ts'
import type { ImageReference } from '../references.ts'
import { drawingCanvasSchema, drawingSceneSchema } from './schema.ts'
import type { DrawingScene } from './schema.ts'

const PROMPT_FILE = new URL('../../prompts/drawing.prompt.md', import.meta.url).pathname

export interface DrawingRequest {
  prompt: string
  brief?: string
  width: number
  height: number
  refs?: ImageReference[]
  mode: 'create' | 'edit' | 'overlay'
  complexity?: 'simple' | 'complex'
  constraints?: string
  feedback?: string
  previousScene?: DrawingScene
  signal?: AbortSignal
}

export async function planDrawing(
  request: DrawingRequest,
  options: { model?: ResolvedModel; instructions?: string } = {},
): Promise<DrawingScene> {
  drawingCanvasSchema.parse(request)
  const previousScene = request.previousScene ? drawingSceneSchema.parse(request.previousScene) : undefined
  const timeout = AbortSignal.timeout(180_000)
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout
  signal.throwIfAborted()
  if ((request.refs?.length ?? 0) > MAX_REF_IMAGES)
    throw new Error(`Drawing planning supports at most ${MAX_REF_IMAGES} reference images.`)
  const previews = await Promise.all(
    (request.refs ?? []).map(async (reference) => {
      const data = await sharp(reference.data)
        .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
        .png()
        .timeout({ seconds: 30 })
        .toBuffer()
      return { name: reference.name, data }
    }),
  )
  signal.throwIfAborted()
  const instructions = options.instructions ?? parsePromptFile(await readPromptFile(PROMPT_FILE), PROMPT_FILE).body
  const { object } = await generateObject({
    ...(options.model ??
      aiModelByProfile(request.complexity === 'complex' ? 'default-gpt-6-astra-high' : 'default-gpt-6-astra-low')),
    instructions,
    schema: drawingSceneSchema,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              prompt: request.prompt,
              brief: request.brief,
              width: request.width,
              height: request.height,
              mode: request.mode,
              constraints: request.constraints,
              feedback: request.feedback,
              previousScene,
              imageOrder: previews.map((reference) => reference.name),
            }),
          },
          ...previews.map(({ data }) => ({
            type: 'file' as const,
            mediaType: 'image',
            data: { type: 'data' as const, data },
            providerOptions: { openai: { imageDetail: 'high' } },
          })),
        ],
      },
    ],
    maxOutputTokens: 24_000,
    maxRetries: 1,
    abortSignal: signal,
  })
  signal.throwIfAborted()
  const scene = drawingSceneSchema.parse(object)
  if (scene.width !== request.width || scene.height !== request.height) {
    throw new Error('Drawing planner changed the requested canvas dimensions.')
  }
  if (request.mode !== 'create' && scene.background !== null) {
    throw new Error('Drawing edits and overlays must retain the supplied base, without a canvas background.')
  }
  if (request.mode === 'overlay' && scene.eraseRegions.length > 0) {
    throw new Error('Drawing overlays may add artwork but cannot erase the supplied base.')
  }
  return scene
}
