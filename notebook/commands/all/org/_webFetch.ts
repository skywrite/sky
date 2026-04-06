import { prompt } from '#shared/ai/llm/claude/mod.ts'
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

export interface WebFetchResult {
  name: string
  website: string
  summary: string
}

export interface WebFetchOptions {
  model?: string
  maxTokens?: number
  apiKey?: string
}

export async function webFetch(url: string, options?: WebFetchOptions): Promise<WebFetchResult> {
  // Normalize URL
  const normalizedUrl = normalizeUrl(url)

  // Fetch the website content
  const response = await fetch(normalizedUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${normalizedUrl}: ${response.statusText}`)
  }

  const html = await response.text()
  const truncatedHtml = truncateIfExceedsTokenLimit(html)

  // Prompt for analyzing organizations
  const analysisPrompt = `Analyze this organization's website and extract key information.

Website URL: ${url}
Website HTML:
${truncatedHtml}

Return a JSON object with:
{
  "name": "Organization name",
  "summary": "Brief 1-2 sentence description of what the organization does"
}

Return only valid JSON, no markdown formatting.`

  const responseText = await prompt({
    model: options?.model,
    maxTokens: options?.maxTokens,
    apiKey: options?.apiKey,
    jsonMode: true,
    prompt: analysisPrompt,
  })

  const result = JSON.parse(responseText) as Omit<WebFetchResult, 'website'>
  return {
    ...result,
    website: normalizedUrl,
  }
}
