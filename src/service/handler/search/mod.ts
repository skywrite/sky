import { Hono } from 'hono'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { searchAllNotebook, validSearchFilter } from './notebook.ts'
import type { SearchScoring } from './types.ts'

export function createSearchRoutes(options: {
  store: MarkdownStore | null
  base: string
  roots: string[]
  scoring: SearchScoring
  today?: () => PlainDate
}) {
  const routes = new Hono()
  routes.get('/', (c) => {
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
    return c.json(
      searchAllNotebook(options.store, options.base, (c.req.query('q') ?? '').trim().slice(0, 500), {
        roots: options.roots,
        today,
        scoring: options.scoring,
        kind: validSearchFilter(c.req.query('kind') ?? ''),
        sort: c.req.query('sort'),
        offset: integer('offset', 0, 1_000_000),
        limit: Math.max(1, integer('limit', 40, 100)),
      }),
    )
  })
  return routes
}
