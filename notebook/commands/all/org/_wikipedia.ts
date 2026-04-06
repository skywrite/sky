import { prompt } from '#shared/ai/llm/claude/mod.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import {
  fetchWikipediaArticle,
  searchWikipedia,
  type WikipediaArticle,
  type WikipediaSearchResult,
} from '#lib/apis/wikipedia.ts'

const SELECT_PROMPT_FILE = new URL('./prompts/org-wikipedia-select.prompt.md', import.meta.url).pathname
const DISAMBIGUATE_PROMPT_FILE = new URL('./prompts/org-wikipedia-disambiguate.prompt.md', import.meta.url).pathname
const VALIDATE_PROMPT_FILE = new URL('./prompts/org-wikipedia-validate.prompt.md', import.meta.url).pathname

export interface WikipediaSelectionOptions {
  orgName?: string
  website?: string
  apiKey?: string
  model?: string
  maxTokens?: number
  fullContent?: boolean // If true, fetch full article content instead of just intro
}

export interface WikipediaSelectionResult {
  article: WikipediaArticle
  confidence: 'high' | 'medium' | 'low'
  reasoning: string
}

/**
 * Get Wikipedia article with AI-assisted selection when multiple results found
 *
 * @param searchTerm - Search query for Wikipedia (can be partial or exact)
 * @param options - Optional context to help AI select correct article
 * @returns Selected Wikipedia article with confidence and reasoning
 */
export async function getWikipediaArticleAI(
  searchTerm: string,
  options: WikipediaSelectionOptions = {},
): Promise<WikipediaSelectionResult> {
  const fullContent = options.fullContent ?? false

  // Try exact match only if we don't have organizational context
  // (orgName or website). With context, we should use AI to disambiguate.
  if (!options.orgName && !options.website) {
    try {
      const article = await fetchWikipediaArticle(searchTerm, fullContent)
      return {
        article,
        confidence: 'high',
        reasoning: 'Exact title match',
      }
    } catch {
      // Not an exact match, continue to search
    }
  }

  // Search for articles
  const results = await searchWikipedia(searchTerm, 10)

  if (results.length === 0) {
    throw new Error(`No Wikipedia articles found for: ${searchTerm}`)
  }

  // If only one result, return it
  if (results.length === 1) {
    const article = await fetchWikipediaArticle(results[0].title, fullContent)
    return {
      article,
      confidence: 'high',
      reasoning: 'Only one search result found',
    }
  }

  // Multiple results - use AI to select best match
  return await selectBestArticleAI(results, searchTerm, options)
}

/**
 * Use AI to select the best matching Wikipedia article from search results
 */
async function selectBestArticleAI(
  results: WikipediaSearchResult[],
  searchTerm: string,
  options: WikipediaSelectionOptions,
): Promise<WikipediaSelectionResult> {
  const fullContent = options.fullContent ?? false

  // Build results text for the prompt
  const resultsText = results
    .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.description}\n    URL: ${r.url}`)
    .join('\n\n')

  // Load and render the prompt template
  const promptContent = await readTextFile(SELECT_PROMPT_FILE)
  const input: RenderInput = {
    search: {
      term: searchTerm,
      results: resultsText,
    },
    org: {
      name: options.orgName,
      website: options.website,
    },
  }

  const { output: selectionPrompt } = renderPromptFile(promptContent, 'org-wikipedia-select.prompt.md', input)

  const responseText = await prompt({
    model: options.model,
    maxTokens: options.maxTokens || 2048,
    apiKey: options.apiKey,
    jsonMode: true,
    prompt: selectionPrompt,
  })

  const parsed = JSON.parse(responseText)

  // Find the selected article by title
  const selectedResult = results.find((r) => r.title === parsed.selected_title)

  if (!selectedResult) {
    // AI selected something not in results - fall back to first result
    const article = await fetchWikipediaArticle(results[0].title, fullContent)
    return {
      article,
      confidence: 'low',
      reasoning: 'AI selection failed, using first result',
    }
  }

  // Fetch the full article
  let article = await fetchWikipediaArticle(selectedResult.title, fullContent)

  // If it's a disambiguation page, use AI to extract the correct link
  if (article.isDisambiguation) {
    const disambiguationResult = await resolveDisambiguationPage(article, searchTerm, options)
    if (disambiguationResult) {
      article = disambiguationResult.article
      // Validate the resolved article matches the organization
      const isValid = await validateArticleMatch(article, searchTerm, options)
      if (!isValid) {
        throw new Error(`No matching Wikipedia article found for: ${searchTerm}`)
      }
      return {
        article,
        confidence: disambiguationResult.confidence,
        reasoning: `Resolved from disambiguation page: ${disambiguationResult.reasoning}`,
      }
    }
    // If we couldn't resolve it, fail - don't return disambiguation pages
    throw new Error(`Could not resolve disambiguation page for: ${searchTerm}`)
  }

  // Validate that the selected article actually matches the organization
  const isValid = await validateArticleMatch(article, searchTerm, options)
  if (!isValid) {
    throw new Error(`No matching Wikipedia article found for: ${searchTerm}`)
  }

  return {
    article,
    confidence: parsed.confidence || 'medium',
    reasoning: parsed.reasoning || 'AI selected this article',
  }
}

/**
 * Resolve a disambiguation page by extracting the correct article link using AI
 */
async function resolveDisambiguationPage(
  disambiguationPage: WikipediaArticle,
  searchTerm: string,
  options: WikipediaSelectionOptions,
): Promise<WikipediaSelectionResult | null> {
  const fullContent = options.fullContent ?? false

  // Extract potential article titles from the disambiguation page text
  // The extract format is like: "YPO may refer to:\n\nYorkshire Purchasing Organisation\nYoung Presidents' Organization..."
  const lines = disambiguationPage.extract.split('\n').filter((line) => line.trim().length > 0)

  // Parse out the disambiguation options (lines that look like article titles)
  const disambiguationOptions: string[] = []
  for (const line of lines) {
    // Skip the header line like "YPO may refer to:"
    if (line.includes('may refer to') || line.includes('refers to')) continue

    // Extract text before commas (e.g., "Young Presidents' Organization, a global network..." -> "Young Presidents' Organization")
    const titleMatch = line.match(/^([^,\.]+)/)
    if (titleMatch) {
      const title = titleMatch[1].trim()
      // Filter out very short matches or ones that are clearly not titles
      if (title.length > 2 && !title.match(/^[a-z\s]+$/)) {
        disambiguationOptions.push(title)
      }
    }
  }

  if (disambiguationOptions.length === 0) {
    return null // Couldn't parse disambiguation options
  }

  // Build options text for the prompt
  const optionsText = disambiguationOptions.map((opt, i) => `[${i + 1}] ${opt}`).join('\n')

  // Load and render the prompt template
  const promptContent = await readTextFile(DISAMBIGUATE_PROMPT_FILE)
  const input: RenderInput = {
    search: {
      term: searchTerm,
    },
    org: {
      name: options.orgName,
      website: options.website,
    },
    disambiguation: {
      options: optionsText,
    },
  }

  const { output: disambiguationPrompt } = renderPromptFile(
    promptContent,
    'org-wikipedia-disambiguate.prompt.md',
    input,
  )

  const responseText = await prompt({
    model: options.model,
    maxTokens: options.maxTokens || 2048,
    apiKey: options.apiKey,
    jsonMode: true,
    prompt: disambiguationPrompt,
  })

  const parsed = JSON.parse(responseText)

  // Fetch the selected article
  try {
    const article = await fetchWikipediaArticle(parsed.selected_title, fullContent)
    return {
      article,
      confidence: parsed.confidence || 'medium',
      reasoning: parsed.reasoning || 'Resolved from disambiguation page',
    }
  } catch {
    return null // Article fetch failed
  }
}

/**
 * Validate that a Wikipedia article actually matches the organization
 * Returns false if the article is about something completely different
 */
async function validateArticleMatch(
  article: WikipediaArticle,
  searchTerm: string,
  options: WikipediaSelectionOptions,
): Promise<boolean> {
  // If we don't have any context (no website, no org name), assume it's valid
  if (!options.website && !options.orgName) {
    return true
  }

  // Load and render the prompt template
  const promptContent = await readTextFile(VALIDATE_PROMPT_FILE)
  const input: RenderInput = {
    search: {
      term: searchTerm,
    },
    org: {
      name: options.orgName,
      website: options.website,
    },
    article: {
      title: article.title,
      url: article.url,
      extract: article.extract.substring(0, 500),
    },
  }

  const { output: validationPrompt } = renderPromptFile(promptContent, 'org-wikipedia-validate.prompt.md', input)

  const responseText = await prompt({
    model: options.model,
    maxTokens: options.maxTokens || 1024,
    apiKey: options.apiKey,
    jsonMode: true,
    prompt: validationPrompt,
  })

  const parsed = JSON.parse(responseText)
  return parsed.is_match === true
}
