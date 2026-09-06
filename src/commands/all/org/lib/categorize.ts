import { generateObject } from 'ai'
import { z } from 'zod'
import { aiModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import type { WebFetchResult } from './webFetch.ts'
import type { WikipediaSelectionResult } from './wikipedia.ts'

const CATEGORIZE_PROMPT_FILE = new URL('../prompts/org-categorize.prompt.md', import.meta.url).pathname

/**
 * Hard ceiling on the categorization call. Nothing else bounds it: the Anthropic provider
 * disables Bun's 300s fetch cap (see anthropicProvider.ts), and `generateObject` — unlike
 * generateText — accepts no `timeout` option, only `abortSignal`. Without this, a stalled
 * socket hangs org:new forever with no output and no error. The call itself runs in a few
 * seconds, so anything approaching this is a dead connection, not slow work.
 */
const AI_TIMEOUT_MS = 2 * 60 * 1000

/**
 * Wikipedia articles are fetched as full content (the disambiguation flow needs the
 * whole entry list), but large-org articles run 15-30k+ chars while categorization
 * only needs the lead and early history — what the org does, founding, ticker. Cap
 * what enters the prompt, not what gets fetched.
 */
const MAX_WIKIPEDIA_EXTRACT_CHARS = 8_000

function capExtract(extract: string): string {
  if (extract.length <= MAX_WIKIPEDIA_EXTRACT_CHARS) return extract
  return extract.slice(0, MAX_WIKIPEDIA_EXTRACT_CHARS) + '\n\n[Extract truncated...]'
}

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

export interface TaxonomyContext {
  /** The checked-in descriptive taxonomy guide (sectors, triggers, examples). */
  guide: string
  /** Sector/subcategory pairs that exist in the notebook right now — ground truth. */
  inUse: string
}

/**
 * Categorize an organization using AI based on multiple enrichment sources and taxonomy
 */
export async function categorizeOrganization(
  taxonomy: TaxonomyContext,
  orgName: string,
  sources: CategorizationSources,
): Promise<OrgCategorizationResult> {
  // Load and render the prompt template
  const promptContent = await readPromptFile(CATEGORIZE_PROMPT_FILE)

  const input: RenderInput = {
    taxonomy: {
      content: taxonomy.guide,
      inUse: taxonomy.inUse,
    },
    org: {
      name: orgName,
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
            extract: capExtract(sources.wikipedia.article.extract),
            confidence: sources.wikipedia.confidence,
            reasoning: sources.wikipedia.reasoning,
          }
        : undefined,
    },
  }

  const { output: categorizationPrompt } = renderPromptFile(promptContent, 'org-categorize.prompt.md', input)

  const { object: parsed } = await generateObject({
    ...aiModel('balanced'),
    abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
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
