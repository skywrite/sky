import { prompt } from '#shared/ai/llm/claude/mod.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import type { WebFetchResult } from './_webFetch.ts'
import type { WikipediaSelectionResult } from './_wikipedia.ts'

const CATEGORIZE_PROMPT_FILE = new URL('./prompts/org-categorize.prompt.md', import.meta.url).pathname

export interface OrgCategorizationResult {
  sector: string
  subcategory: string
  confidence: 'high' | 'medium' | 'low'
  kind: 'company' | 'government' | 'nonprofit' | 'unknown'
  isNewCategory?: boolean
  categoryReasoning?: string
  ticker?: string
  website?: string
  description?: string
}

export interface CategorizeOptions {
  model?: string
  maxTokens?: number
  apiKey?: string
}

export interface CategorizationSources {
  webFetch?: WebFetchResult
  wikipedia?: WikipediaSelectionResult
}

/**
 * Categorize an organization using AI based on multiple enrichment sources and taxonomy
 */
export async function categorizeOrganization(
  taxonomyInfo: string,
  sources: CategorizationSources,
  options?: CategorizeOptions,
): Promise<OrgCategorizationResult> {
  // Load and render the prompt template
  const promptContent = await readTextFile(CATEGORIZE_PROMPT_FILE)

  const input: RenderInput = {
    taxonomy: {
      content: taxonomyInfo,
    },
    source: {
      webFetch: sources.webFetch
        ? {
            website: sources.webFetch.website,
            name: sources.webFetch.name,
            summary: sources.webFetch.summary,
          }
        : undefined,
      wikipedia: sources.wikipedia
        ? {
            title: sources.wikipedia.article.title,
            url: sources.wikipedia.article.url,
            extract: sources.wikipedia.article.extract,
            confidence: sources.wikipedia.confidence,
            reasoning: sources.wikipedia.reasoning,
          }
        : undefined,
    },
  }

  const { output: categorizationPrompt } = renderPromptFile(promptContent, 'org-categorize.prompt.md', input)

  // Call Claude API (jsonMode automatically handles JSON extraction)
  const responseText = await prompt({
    model: options?.model,
    maxTokens: options?.maxTokens || 4096,
    apiKey: options?.apiKey,
    jsonMode: true,
    prompt: categorizationPrompt,
  })

  // Parse the cleaned JSON response
  const parsed = JSON.parse(responseText)

  const result: OrgCategorizationResult = {
    sector: parsed.primary_sector,
    subcategory: parsed.primary_subcategory,
    confidence: parsed.confidence || 'medium',
    kind: parsed.kind || 'unknown',
    isNewCategory: parsed.is_new_category || false,
    categoryReasoning: parsed.category_reasoning,
    ticker: parsed.ticker,
    website: parsed.website,
    description: parsed.description,
  }

  return result
}
