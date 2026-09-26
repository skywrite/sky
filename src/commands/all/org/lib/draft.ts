import { readFile } from 'node:fs/promises'
import { relative, sep } from 'node:path'
import colors from 'picocolors'
import { walk } from '#shared/fs/mod.ts'
import { normalizeUrl } from '#shared/universal/urls/normalize.ts'
import { categorizeOrganization } from './categorize.ts'
import type { OrganizationDraft, OrganizationRequest } from './document.ts'
import { webFetch, type WebFetchResult } from './webFetch.ts'
import { getWikipediaArticleAI, type WikipediaSelectionResult } from './wikipedia.ts'

export interface DraftRequest extends OrganizationRequest {
  /** Wikipedia search query or exact article title; the name by default, false to skip */
  wikipedia?: string | false
  /** The website, when it was already fetched to find the name */
  prefetchedSite?: WebFetchResult
  /** Progress lines, as org:new prints them */
  log?: (line: string) => void
}

/**
 * Learn what org:new writes about an organization: its category, kind, ticker, website and a short
 * description, from its website and Wikipedia. Either source failing degrades to categorizing
 * without it; only categorization itself throws. A forced sector and subcategory skip all lookups.
 */
export async function draftOrganization(orgsDir: string, request: DraftRequest): Promise<OrganizationDraft> {
  const log = request.log ?? (() => {})
  const { name, site, prefetchedSite } = request
  const wikipediaQuery = request.wikipedia === false ? undefined : (request.wikipedia ?? name)
  // Normalize site URL if provided (always, regardless of forced categorization)
  let normalizedSite = site ? normalizeUrl(site) : undefined

  if (request.sector && request.subcategory) {
    log(`Using forced categorization: ${request.sector}/${request.subcategory}`)
    return { name, sector: request.sector, subcategory: request.subcategory, kind: 'unknown', site: normalizedSite }
  }

  // Site and Wikipedia enrichment are independent (normalizedSite is already
  // derived from the arg), so run them concurrently.
  const [webFetchResult, wikipediaResult] = await Promise.all([
    (async (): Promise<WebFetchResult | undefined> => {
      if (prefetchedSite) return prefetchedSite // fetched during name detection
      if (!site) return undefined
      log(`Fetching site: ${site}`)
      try {
        return await webFetch(site)
      } catch (error) {
        log(`Site fetch failed (${(error as Error).message}), continuing without it`)
        return undefined
      }
    })(),
    (async (): Promise<WikipediaSelectionResult | undefined> => {
      if (!wikipediaQuery) {
        log('Skipping Wikipedia enrichment (--no-wikipedia flag set)')
        return undefined
      }
      log(`Fetching Wikipedia: ${wikipediaQuery}`)
      try {
        return await getWikipediaArticleAI(wikipediaQuery, {
          orgName: name,
          website: normalizedSite,
          fullContent: true, // Get full article content for better categorization and ticker extraction
        })
      } catch {
        log(`Wikipedia not found for "${wikipediaQuery}", continuing without it`)
        return undefined
      }
    })(),
  ])

  if (webFetchResult) {
    log(`Site summary: ${webFetchResult.summary}`)
  }
  if (wikipediaResult) {
    log(`Wikipedia article: ${wikipediaResult.article.title}`)
    log(`Wikipedia confidence: ${wikipediaResult.confidence}`)
    log(`Selection reasoning: ${wikipediaResult.reasoning}`)
  }

  // Load the taxonomy guide and the categories that actually exist on disk
  const taxonomyPath = new URL('./taxonomy.md', import.meta.url).pathname
  const taxonomyInfo = await readFile(taxonomyPath, 'utf-8')
  const categoriesInUse = await listCategoriesInUse(orgsDir)

  // Categorize with all available sources
  log('Categorizing with AI...')
  const categorization = await categorizeOrganization(
    { guide: taxonomyInfo, inUse: categoriesInUse || '(none yet)' },
    name,
    {
      webFetch: webFetchResult,
      wikipedia: wikipediaResult,
    },
  )

  const sector = request.sector || categorization.sector
  const subcategory = request.subcategory || categorization.subcategory
  const { kind, ticker, description } = categorization

  // Use website from categorizer if not already set
  if (!normalizedSite && categorization.website) {
    normalizedSite = normalizeUrl(categorization.website)
    log(`${colors.bold('Website:')} ${normalizedSite}`)
  }

  // Highlight new category suggestions
  if (categorization.isNewCategory) {
    log(`${colors.bold(colors.yellow('✨ NEW CATEGORY SUGGESTED:'))} ${sector}/${subcategory}`)
    if (categorization.categoryReasoning) {
      log(`${colors.bold(colors.yellow('Reasoning:'))} ${categorization.categoryReasoning}`)
    }
  } else {
    log(`${colors.bold('Categorized as:')} ${sector}/${subcategory}`)
  }

  log(`${colors.bold('Confidence:')} ${categorization.confidence}`)
  log(`${colors.bold('Kind:')} ${kind}`)
  if (ticker) {
    log(`${colors.bold('Ticker:')} ${ticker}`)
  }
  if (description) {
    log(`${colors.bold('Description:')} ${description}`)
  }

  return {
    name,
    sector,
    subcategory,
    kind,
    site: normalizedSite,
    ticker,
    description,
    wikipediaUrl: wikipediaResult?.article.url,
  }
}

/** Find an org file with the given basename anywhere under orgs/, case-insensitively. */
export async function findExistingOrgFile(orgsDir: string, filename: string): Promise<string | undefined> {
  const target = filename.toLowerCase()
  for await (const entry of walk(orgsDir, { includeDirs: false, exts: ['.md'] })) {
    if (entry.name.toLowerCase() === target) return entry.path
  }
  return undefined
}

/**
 * Render the sector/subcategory pairs that exist on disk, one sector per line
 * ("crypto: exchanges, wallets"). Derived from org files rather than bare
 * directories, so an empty dir doesn't count as in use.
 */
export async function listCategoriesInUse(orgsDir: string): Promise<string> {
  const sectors = new Map<string, Set<string>>()
  for await (const entry of walk(orgsDir, { includeDirs: false, exts: ['.md'] })) {
    const segments = relative(orgsDir, entry.path).split(sep)
    if (segments.length < 3) continue // orgs live at sector/subcategory/file.md
    const [sector, subcategory] = segments
    let subcategories = sectors.get(sector)
    if (!subcategories) {
      subcategories = new Set()
      sectors.set(sector, subcategories)
    }
    subcategories.add(subcategory)
  }
  return [...sectors.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sector, subcategories]) => `${sector}: ${[...subcategories].sort().join(', ')}`)
    .join('\n')
}
