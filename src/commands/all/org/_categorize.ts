import { generateObject } from 'ai'
import { z } from 'zod'
import { aiModel } from '#shared/ai/models.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import type { WebFetchResult } from './_webFetch.ts'
import type { WikipediaSelectionResult } from './_wikipedia.ts'

const CATEGORIZE_PROMPT_FILE = new URL('./prompts/org-categorize.prompt.md', import.meta.url).pathname

const CategorizationSchema = z.object({
  primary_sector: z.string(),
  primary_subcategory: z.string(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  kind: z.enum(['company', 'government', 'nonprofit', 'unknown']).optional(),
  is_new_category: z.boolean().optional(),
  category_reasoning: z.string().optional(),
  ticker: z.string().optional(),
  website: z.string().optional(),
  description: z.string().optional(),
})

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

  const { object: parsed } = await generateObject({
    ...aiModel('balanced'),
    schema: CategorizationSchema,
    prompt: categorizationPrompt,
  })

  return {
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
}
