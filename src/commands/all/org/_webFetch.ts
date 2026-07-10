import { generateObject } from 'ai'
import { z } from 'zod'
import { aiModel } from '#shared/ai/models.ts'
import { normalizeUrl } from '#shared/universal/urls/normalize.ts'

// Maximum tokens to send to AI for website content analysis
// Note: This is for the HTML content only. The total prompt (including system
// instructions and analysis prompt) must fit within the API's 200k token limit.
// Setting this to 50k leaves ample room for the rest of the prompt structure.
const MAX_CONTENT_TOKENS = 50000

/**
 * Truncates content if it exceeds the maximum token limit.
 * Uses rough approximation of ~4 characters per token.
 * Can be made more sophisticated in the future if needed.
 *
 * @param content - The content to potentially truncate
 * @returns The content, possibly truncated with a notice appended
 */
function truncateIfExceedsTokenLimit(content: string): string {
  const estimatedTokens = Math.ceil(content.length / 4)

  if (estimatedTokens > MAX_CONTENT_TOKENS) {
    const maxChars = MAX_CONTENT_TOKENS * 4
    return content.slice(0, maxChars) + '\n\n[Content truncated due to size...]'
  }

  return content
}

const WebFetchSchema = z.object({
  name: z.string().describe('Organization name'),
  summary: z.string().describe('Brief 1-2 sentence description of what the organization does'),
})

export interface WebFetchResult {
  name: string
  website: string
  summary: string
}

export async function webFetch(url: string): Promise<WebFetchResult> {
  // Normalize URL
  const normalizedUrl = normalizeUrl(url)

  // Fetch the website content
  const response = await fetch(normalizedUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${normalizedUrl}: ${response.statusText}`)
  }

  const html = await response.text()
  const truncatedHtml = truncateIfExceedsTokenLimit(html)

  const analysisPrompt = `Analyze this organization's website and extract key information.

Website URL: ${url}
Website HTML:
${truncatedHtml}`

  const { object } = await generateObject({
    ...aiModel('balanced'),
    schema: WebFetchSchema,
    prompt: analysisPrompt,
  })

  return {
    ...object,
    website: normalizedUrl,
  }
}
