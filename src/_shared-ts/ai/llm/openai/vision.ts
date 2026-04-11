import { readFile } from 'node:fs/promises'
import OpenAI from 'openai'
import { env } from '#shared/sys/mod.ts'
import { encodeBase64 } from '#universal/encoding/base64.ts'

export interface OpenAIVisionOptions {
  prompt: string
  model?: string
  maxTokens?: number
  apiKey?: string
}

/**
 * Analyze an image using OpenAI's vision API from raw bytes
 * @param imageBytes - Image data as Uint8Array
 * @param options - Vision API options including prompt and model
 * @returns The response text from the vision model
 */
export async function visionFromBytes(imageBytes: Uint8Array, options: OpenAIVisionOptions): Promise<string> {
  const apiKey = options.apiKey || env.get('OPENAI_API_KEY')
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable not set')
  }

  const client = new OpenAI({ apiKey })

  // Convert to base64
  const base64Image = encodeBase64(imageBytes)

  const response = await client.chat.completions.create({
    model: options.model || 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: options.prompt,
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${base64Image}`,
            },
          },
        ],
      },
    ],
    max_tokens: options.maxTokens || 300,
  })

  const content = response.choices[0]?.message?.content?.trim()
  if (content) {
    return content
  }

  throw new Error('Unexpected response from OpenAI vision API')
}

/**
 * Analyze an image using OpenAI's vision API from a file path
 * @param filePath - Path to the image file
 * @param options - Vision API options including prompt and model
 * @returns The response text from the vision model
 */
export async function visionFromFile(filePath: string, options: OpenAIVisionOptions): Promise<string> {
  const imageData = await readFile(filePath)
  return visionFromBytes(imageData, options)
}
