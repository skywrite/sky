/**
 * Wikipedia API client for searching and fetching article content
 * Uses the MediaWiki API: https://www.mediawiki.org/wiki/API:Main_page
 */

export interface WikipediaSearchResult {
  title: string
  description: string
  url: string
}

export interface WikipediaArticle {
  title: string
  extract: string // Plain text summary (intro or full content)
  url: string
  fullContent?: boolean // True if extract contains full article, not just intro
  isDisambiguation?: boolean // True if this is a disambiguation page
}

const WIKIPEDIA_API_BASE = 'https://en.wikipedia.org/w/api.php'

/**
 * Search Wikipedia for articles matching a query
 * Returns up to 'limit' results with titles, descriptions, and URLs
 */
export async function searchWikipedia(query: string, limit = 5): Promise<WikipediaSearchResult[]> {
  const url = new URL(WIKIPEDIA_API_BASE)
  url.searchParams.set('action', 'opensearch')
  url.searchParams.set('search', query)
  url.searchParams.set('limit', limit.toString())
  url.searchParams.set('format', 'json')
  url.searchParams.set('origin', '*') // Enable CORS

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(`Wikipedia search failed: ${response.statusText}`)
  }

  // OpenSearch returns: [query, [titles], [descriptions], [urls]]
  const [_query, titles, descriptions, urls] = (await response.json()) as [string, string[], string[], string[]]

  return titles.map((title, index) => ({
    title,
    description: descriptions[index] || '',
    url: urls[index] || '',
  }))
}

/**
 * Fetch a Wikipedia article's text extract
 * Returns plain text summary (HTML stripped)
 *
 * @param title - Wikipedia article title
 * @param fullContent - If true, fetch full article content; if false, only intro section (default: false)
 */
export async function fetchWikipediaArticle(title: string, fullContent = false): Promise<WikipediaArticle> {
  const url = new URL(WIKIPEDIA_API_BASE)
  url.searchParams.set('action', 'query')
  url.searchParams.set('titles', title)
  url.searchParams.set('prop', 'extracts|info|pageprops')
  url.searchParams.set('redirects', 'true') // Follow redirects automatically
  if (!fullContent) {
    url.searchParams.set('exintro', 'true') // Only intro section
  }
  url.searchParams.set('explaintext', 'true') // Plain text, no HTML
  url.searchParams.set('inprop', 'url') // Include URL
  url.searchParams.set('format', 'json')
  url.searchParams.set('origin', '*') // Enable CORS

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(`Wikipedia fetch failed: ${response.statusText}`)
  }

  const data = await response.json()
  const pages = data.query?.pages || {}
  const pageId = Object.keys(pages)[0]

  if (!pageId || pageId === '-1') {
    throw new Error(`Wikipedia article not found: ${title}`)
  }

  const page = pages[pageId]
  const isDisambiguation = page.pageprops?.disambiguation !== undefined

  // If we have no extract and there's a redirect, log info for debugging
  if (!page.extract && data.query?.redirects) {
    console.log(`Wikipedia redirect: "${title}" -> "${data.query.redirects[0].to}"`)
  }

  return {
    title: page.title,
    extract: page.extract || '',
    url: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    fullContent,
    isDisambiguation,
  }
}

/**
 * Search for an article and return the best match
 * If exactTitle is provided, fetch that directly
 * Otherwise, search and return the first result
 */
export async function getWikipediaArticle(query: string, exactTitle?: string): Promise<WikipediaArticle> {
  if (exactTitle) {
    return fetchWikipediaArticle(exactTitle)
  }

  // Search first to find the best match
  const results = await searchWikipedia(query, 1)
  if (results.length === 0) {
    throw new Error(`No Wikipedia articles found for: ${query}`)
  }

  // Fetch the full article for the first result
  return fetchWikipediaArticle(results[0].title)
}
