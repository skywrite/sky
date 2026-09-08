import { realpath, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { Hono } from 'hono'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { readMarkdownContent, saveMarkdownContent } from '../markdown-preview/content.ts'
import { isPathWithinRoot, isPathWithinRoots, resolveMarkdownPreviewRequest } from '../markdown-preview/request.ts'
import { linkCatalog, searchLinks } from './catalog.ts'
import { changeLinks } from './content.ts'
import type { ImportLinksHost, LinkItem } from './types.ts'

export function linkValues(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some((v) => typeof v !== 'string' || !v.trim() || v.length > 2048)
  )
    throw new Error('Choose up to 100 notebook links.')
  return [...new Set(value.map((v: string) => v.trim()))]
}

export function createLinks(
  store: MarkdownStore | null,
  base: string,
  dirs: string[],
): { routes: Hono; host: ImportLinksHost } {
  const routes = new Hono()
  const writes = new Map<string, Promise<void>>()
  const catalog = () => (store ? linkCatalog(store, base, dirs) : Promise.resolve([]))
  const lookup = (items: LinkItem[], value: string, source?: string) => {
    const exact = items.find((item) => item.value === value)
    if (exact) return exact
    const ref = store?.resolve(value, source ? { sourceFilePath: source } : undefined)
    return ref && 'path' in ref ? items.find((item) => path.resolve(base, item.path) === ref.path) : undefined
  }
  const allowed = async (file: string) => {
    const actual = await realpath(file)
    const actualBase = await realpath(base)
    const actualDirs = await Promise.all(dirs.map((dir) => realpath(dir).catch(() => path.resolve(dir))))
    if (!isPathWithinRoot(actual, actualBase) || !isPathWithinRoots(actual, actualDirs))
      throw new Error('Choose a record inside the notebook.')
  }
  const host: ImportLinksHost = {
    async validate(values) {
      if (values.length === 0) return
      const items = await catalog()
      for (const value of values) {
        const hit = lookup(items, value)
        if (!hit) throw new Error('A selected record is no longer available. Search for it again.')
        await allowed(path.resolve(base, hit.path))
        await stat(path.resolve(base, hit.path))
      }
    },
    update(file, add, remove) {
      const work = (writes.get(file) ?? Promise.resolve())
        .catch(() => {})
        .then(async () => {
          const request = resolveMarkdownPreviewRequest(file, undefined, base, dirs)
          if (!request.ok) throw new Error(request.message)
          const absolute = request.value.filePath
          await allowed(absolute)
          const current = await readMarkdownContent(absolute)
          const identity = (value: string) => {
            const ref = store?.resolve(value, { sourceFilePath: absolute })
            return ref && 'path' in ref ? String(ref.path) : value
          }
          const self = new Set([file, file.replace(/\.md$/i, '')])
          if (add.some((v) => self.has(v) || identity(v) === absolute))
            throw new Error('A record cannot link to itself.')
          const content = changeLinks(current.content, add, remove, identity)
          if (content !== current.content) await saveMarkdownContent(absolute, content, current.version)
          store?.set(absolute, content)
        })
      writes.set(file, work)
      void work
        .finally(() => {
          if (writes.get(file) === work) writes.delete(file)
        })
        .catch(() => {})
      return work
    },
  }
  routes.get('/', async (c) => {
    if (!store) return c.json({ message: 'The notebook search is still loading.' }, 503)
    const matches = searchLinks(
      await catalog(),
      c.req.query('q') ?? '',
      c.req.query('kind') ?? '',
      c.req.query('day') ?? '',
      c.req.query('exclude') ?? '',
    )
    const raw = Number(c.req.query('offset') ?? 0)
    const offset = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0
    let today: string
    try {
      today = fetchNowSync().plainDateTime.plainDate.ymd
    } catch {
      today = PlainDate.today().ymd
    }
    return c.json({ items: matches.slice(offset, offset + 40), total: matches.length, today })
  })
  routes.post('/resolve', async (c) => {
    try {
      const body = await c.req.json()
      const values = linkValues(body.values)
      const items = await catalog()
      const source = typeof body.file === 'string' ? path.resolve(base, body.file) : undefined
      return c.json({
        items: values.flatMap((value) => {
          const hit = lookup(items, value, source)
          return hit ? [{ ...hit, value }] : []
        }),
      })
    } catch (error) {
      return c.json({ message: (error as Error).message }, 400)
    }
  })
  return { routes, host }
}
