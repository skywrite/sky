import { Hono } from 'hono'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { type PeopleIndex, profileHref } from '../people/types.ts'
import { searchAllNotebook, validSearchFilter } from './notebook.ts'
import type { SearchResponse, SearchResult, SearchScoring } from './types.ts'

/** A person or organization opens on its page, at the address People & Orgs keeps for it. */
async function withProfilePages(
  response: SearchResponse,
  profiles: { index(): Promise<PeopleIndex> },
): Promise<SearchResponse> {
  const isProfile = (result: SearchResult) => result.kind === 'person' || result.kind === 'org'
  if (!response.results.some(isProfile) && !response.dayItems.some(isProfile)) return response
  // Without their addresses, profiles still open as files
  const index = await profiles.index().catch(() => null)
  if (!index) return response
  const pages = new Map(
    [...index.people, ...index.orgs].map((profile) => [`${profile.type}:${profile.id}`, profileHref(profile)]),
  )
  const open = (result: SearchResult): SearchResult => ({
    ...result,
    href: pages.get(`${result.kind}:${result.relativePath}`) ?? result.href,
  })
  return { ...response, results: response.results.map(open), dayItems: response.dayItems.map(open) }
}

export function createSearchRoutes(options: {
  store: MarkdownStore | null
  base: string
  roots: string[]
  scoring: SearchScoring
  today?: () => PlainDate
  /** People & Orgs; absent, people and organizations open in Explorer */
  profiles?: { index(): Promise<PeopleIndex> } | null
}) {
  const routes = new Hono()
  routes.get('/', async (c) => {
    if (!options.store) return c.json({ message: 'The notebook search is still loading. Try again shortly.' }, 503)
    const integer = (name: string, fallback: number, maximum: number) => {
      const value = Number(c.req.query(name) ?? fallback)
      return Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.trunc(value))) : fallback
    }
    let today: PlainDate
    try {
      today = options.today?.() ?? fetchNowSync().plainDateTime.plainDate
    } catch {
      today = PlainDate.today()
    }
    const response = searchAllNotebook(options.store, options.base, (c.req.query('q') ?? '').trim().slice(0, 500), {
      roots: options.roots,
      today,
      scoring: options.scoring,
      kind: validSearchFilter(c.req.query('kind') ?? ''),
      sort: c.req.query('sort'),
      offset: integer('offset', 0, 1_000_000),
      limit: Math.max(1, integer('limit', 40, 100)),
    })
    return c.json(options.profiles ? await withProfilePages(response, options.profiles) : response)
  })
  return routes
}
