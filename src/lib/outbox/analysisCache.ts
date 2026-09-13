import * as path from 'node:path'
import { generateObject, NoObjectGeneratedError } from 'ai'
import type { z } from 'zod'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { atomicWrite, hash, readOptional } from './files.ts'
import { OUTBOX_MODEL_TIMEOUT_MS } from './model.ts'

// Bump when schemas, selection, or interpretation change beyond the versioned prompts and settings.
export const REQUEST_ANALYSIS_POLICY = 'requests-v1'
export const MAX_ANALYSIS_INPUT_CHARS = 120_000

export function modelVersion(resolved: ResolvedModel): string {
  const { model, ...settings } = resolved
  return hash(JSON.stringify({ model: typeof model === 'string' ? model : [model.provider, model.modelId], settings }))
}

/** Immutable, validated model receipts. No range, scan clock, or whole-file hash belongs in a reading input. */
export class AnalysisCache {
  readonly dir: string
  constructor(stateDir: string, conversationKey: string) {
    this.dir = path.join(stateDir, 'analysis', hash(conversationKey).slice(0, 32))
  }

  async run<T>(options: {
    kind: string
    prefix?: string
    input: unknown
    instructions: string
    schema: z.ZodType<T>
    model: ResolvedModel
    validate: (value: T) => void
    onOutputLimit?: () => T
    repairValidation?: boolean
  }): Promise<T> {
    const { kind, prefix, input, instructions, schema, model, validate } = options
    const prompt = JSON.stringify(input)
    if (prompt.length > MAX_ANALYSIS_INPUT_CHARS)
      throw new Error('The request analysis input exceeds its reading budget. Earlier checkpoints are saved.')
    const key = hash(
      JSON.stringify({
        policy: REQUEST_ANALYSIS_POLICY,
        model: modelVersion(model),
        kind,
        prefix,
        instructions,
        prompt,
      }),
    )
    const file = path.join(this.dir, 'passes', `${key}.json`)
    const text = await readOptional(file)
    if (text !== undefined) {
      const saved = JSON.parse(text)
      if (saved.key !== key || saved.kind !== kind)
        throw new Error('The saved Outbox analysis checkpoint does not match its input.')
      const value = schema.parse(saved.value)
      validate(value)
      return value
    }
    let attemptPrompt = prompt
    for (let attempt = 0; ; attempt++) {
      let value: T
      try {
        const result = await generateObject({
          ...model,
          schema,
          instructions,
          prompt: attemptPrompt,
          abortSignal: AbortSignal.timeout(OUTBOX_MODEL_TIMEOUT_MS),
        })
        value = result.finishReason === 'length' && options.onOutputLimit ? options.onOutputLimit() : result.object
      } catch (error) {
        if (!options.onOutputLimit || !NoObjectGeneratedError.isInstance(error) || error.finishReason !== 'length')
          throw error
        value = options.onOutputLimit()
      }
      value = schema.parse(value)
      try {
        validate(value)
      } catch (error) {
        if (!options.repairValidation || attempt !== 0) throw error
        // Keep the same receipt key and original evidence; only a verified correction may be cached.
        attemptPrompt = JSON.stringify({
          ...(input as Record<string, unknown>),
          correction: {
            instruction:
              'The previous result failed validation. Correct it using only the original supplied evidence. Copy short exact source spans, preserving Markdown link syntax. The rejected result is not evidence.',
            error: error instanceof Error ? error.message : String(error),
            rejected: value,
          },
        })
        if (attemptPrompt.length > MAX_ANALYSIS_INPUT_CHARS) throw error
        continue
      }
      await atomicWrite(file, JSON.stringify({ key, kind, value }))
      return value
    }
  }
}
