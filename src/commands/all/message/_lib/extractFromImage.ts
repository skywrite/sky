import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { readTextFile } from '#shared/fs/mod.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { loadImageForAI } from './loadImage.ts'

const MODEL = 'claude-opus-4-6'
const PROMPT_FILE = new URL('../prompts/extract-from-image.prompt.md', import.meta.url).pathname

const ExtractionSchema = z.object({
  platform: z
    .string()
    .nullable()
    .describe(
      'Messaging platform (e.g. WhatsApp, iMessage, Signal, Telegram, Slack, Discord, Teams). Null if unclear.',
    ),
  from: z.string().nullable().describe('Who sent the message(s). Null if unclear.'),
  to: z.string().nullable().describe('Who received the message(s). Null if unclear.'),
  summary: z.string().describe('Brief summary of the conversation in 5-15 words'),
  dialogue: z
    .string()
    .describe('Full dialogue formatted as markdown. Use "**Name:** message" for each line. Preserve message order.'),
})

export type ImageExtraction = z.infer<typeof ExtractionSchema>

export async function extractMessageFromImage(imagePaths: string[], aiContext?: string): Promise<ImageExtraction> {
  const imageBlocks = await Promise.all(
    imagePaths.map(async (p) => {
      const { image, mediaType } = await loadImageForAI(p)
      return { type: 'image' as const, image, mediaType }
    }),
  )

  const promptContent = await readTextFile(PROMPT_FILE)
  let { output: prompt } = renderPromptFile(promptContent, 'extract-from-image.prompt.md', {})
  if (aiContext) {
    prompt += `\n\nAdditional context: ${aiContext}`
  }

  const result = await generateObject({
    model: anthropic(MODEL),
    schema: ExtractionSchema,
    messages: [
      {
        role: 'user',
        content: [
          ...imageBlocks,
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  })

  return result.object
}
