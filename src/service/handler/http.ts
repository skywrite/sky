/**
 * Hono app factory for the notebook service.
 *
 * Used by both run.ts (production) and server.ts (testing).
 */

import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { YogaServerInstance } from 'graphql-yoga'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { resolveContext } from '../context/mod.ts'
import * as jsend from '../jsend.ts'
import type { Store } from '../store.ts'
import { attachmentCandidates, storeAttachment } from './attachments/mod.ts'
import { type ChatRoutesOptions, createChatRoutes } from './chat/mod.ts'
import { type ClockRoutesOptions, createClockRoutes } from './clock/mod.ts'
import { createDayRoutes } from './day/mod.ts'
import { createExplorerRoutes, explorerHref } from './explorer/mod.ts'
import { searchNotebook } from './home/mod.ts'
import {
  exportMarkdownPreviewPdf,
  MarkdownSaveConflictError,
  readMarkdownContent,
  resolveMarkdownPreviewRequest,
  saveMarkdownContent,
  isPathWithinRoot,
  isPathWithinRoots,
} from './markdown-preview/mod.ts'
import { createSettingsRoutes, type SettingsRoutesOptions } from './settings/mod.ts'
import { getThemeAsset, renderAppHtml } from './theme/mod.ts'
import {
  backlinksOf,
  COMPLETION_KINDS,
  complete,
  type CompletionKind,
  resolveNames,
  scoresFrom,
  vocabularyOf,
} from './vocabulary/mod.ts'
import { createVoiceRoutes, type VoiceRoutesOptions } from './voice/mod.ts'

/**
 * Options for creating the HTTP app.
 */
export interface HttpHandlerOptions {
  /** Store instance for data access */
  store: Store
  /** GraphQL yoga instance */
  yoga: YogaServerInstance<object, object>
  /** MarkdownStore for context resolution (null if not ready) */
  markdownStore: MarkdownStore | null
  /** Base notebook directory that preview paths are relative to */
  markdownBaseDir: string
  /** Directories containing markdown files that can be previewed */
  markdownDirs: string[]
  /** Additional route handlers (e.g., /site-html for production) */
  customRoutes?: Map<string, (req: Request) => Promise<Response>>
  /** The browser's chat host; absent, /chat is not served */
  chat?: ChatRoutesOptions
  /** The browser's voice host; absent, /voice is not served */
  voice?: VoiceRoutesOptions
  /** The settings page's host; absent, /settings/_api is not served */
  settings?: SettingsRoutesOptions
  /** The clock page's host; absent, /clock/_api is not served */
  clock?: ClockRoutesOptions
  /** The user-data directory: day attachments and the media mirror of the notebook's directories (CLP-16) */
  userDataDir: string
}

/**
 * Create a Hono app with all service routes.
 */
export function createHttpApp(options: HttpHandlerOptions): Hono {
  const {
    store,
    yoga,
    markdownStore,
    markdownBaseDir,
    markdownDirs,
    customRoutes,
    chat,
    voice,
    settings,
    clock,
    userDataDir,
  } = options

  const app = new Hono()

  // CORS middleware
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
    }),
  )

  // Add Access-Control-Allow-Private-Network (not supported by Hono's cors middleware)
  app.use('*', async (c, next) => {
    await next()
    c.res.headers.set('Access-Control-Allow-Private-Network', 'true')
  })

  // GraphQL HTTP queries (WebSocket upgrades handled at server level)
  app.all('/graphql', async (c) => {
    return await yoga.handleRequest(c.req.raw, {})
  })

  // Chat over HTTP: a session per thread, each turn streamed as SSE — and
  // the day the threads live in
  if (chat) {
    app.route('/chat', createChatRoutes(chat))
    app.route('/day', createDayRoutes({ markdownBaseDir, timeDir: chat.timeDir, aboutMePath: chat.aboutMePath }))
  }

  // Voice over the web: the browser holds the call; the service mints its
  // secret and runs its tools. The page itself is /voice, below.
  if (voice) {
    app.route('/voice', createVoiceRoutes(voice))
  }

  // The settings page's data: the configuration as the service reads it.
  // The page itself is /settings, below.
  if (settings) {
    app.route('/settings/_api', createSettingsRoutes(settings))
  }

  // The clock page's data: the two clocks and the converter. The page itself is /clock, below.
  if (clock) {
    app.route('/clock/_api', createClockRoutes(clock))
  }

  // Context resolution endpoint (GraphQL query + relationship traversal)
  app.post('/context', async (c) => {
    if (!markdownStore) {
      return c.json(jsend.fail({ message: 'MarkdownStore not ready' }), 503)
    }

    try {
      const { query, depth = 1 } = await c.req.json<{ query: string; depth?: number }>()
      if (!query || typeof query !== 'string') {
        return c.json(jsend.fail({ message: 'Missing required field: query' }), 400)
      }

      const result = await resolveContext(query, depth, markdownStore)
      return c.json(jsend.success(result))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json(jsend.fail({ message }), 400)
    }
  })

  // Custom routes (e.g., /site-html in production)
  if (customRoutes) {
    for (const [routePath, handler] of customRoutes) {
      app.all(routePath, async (c) => {
        return handler(c.req.raw)
      })
    }
  }

  // REST endpoints
  app.get('/people.json', (c) => {
    return c.json(
      jsend.success({
        people: Array.from(store.people).toSorted(),
      }),
    )
  })

  app.get('/orgs.json', (c) => {
    return c.json(
      jsend.success({
        organizations: Array.from(store.organizations).toSorted(),
      }),
    )
  })

  app.get('/tags.json', (c) => {
    return c.json(
      jsend.success({
        tags: Array.from(store.tags).toSorted(),
      }),
    )
  })

  app.get('/tag-words.json', (c) => {
    const tags = Array.from(store.tags).toSorted()
    const wordSet = new Set<string>()
    tags.forEach((tag) => {
      if (tag.includes('/')) {
        const tokens = tag.split('/')
        tokens.forEach((t) => wordSet.add(t.toLowerCase()))
      } else {
        wordSet.add(tag.toLowerCase())
      }
    })

    return c.json(
      jsend.success({
        words: Array.from(wordSet).toSorted(),
      }),
    )
  })

  app.get('/info.json', (c) => {
    return c.json(jsend.success({ message: 'Future home for info' }))
  })

  // The file's data API. The file pages themselves are the explorer's; see below.
  app.get('/docs/_api/content/*', async (c) => {
    const fileParam = decodeRoutePath(c.req.url, '/docs/_api/content/')
    const previewRequest = resolveMarkdownPreviewRequest(fileParam, undefined, markdownBaseDir, markdownDirs)
    if (!previewRequest.ok) {
      return c.json({ message: previewRequest.message }, previewRequest.status)
    }

    try {
      const snapshot = await readMarkdownContent(previewRequest.value.filePath)
      if (c.req.query('meta') === '1') {
        return c.json({
          relativePath: previewRequest.value.relativePath,
          version: snapshot.version,
        })
      }

      return c.json({
        relativePath: previewRequest.value.relativePath,
        version: snapshot.version,
        content: snapshot.content,
      })
    } catch (err) {
      const error = err as NodeJS.ErrnoException
      if (error?.code === 'ENOENT') {
        return c.json({ message: 'Markdown file not found' }, 404)
      }

      const message = err instanceof Error ? err.message : String(err)
      return c.json({ message }, 500)
    }
  })

  // What the front matter panel completes from: people, orgs, projects, places and documents by
  // name, tags with counts, and — per top-level directory — the keys in use and a key's values.
  app.get('/docs/_api/complete', (c) => {
    if (!markdownStore) return c.json({ items: [] })
    const kind = c.req.query('kind') ?? ''
    if (!COMPLETION_KINDS.has(kind)) return c.json({ message: 'Unknown completion kind' }, 400)
    const limit = Number.parseInt(c.req.query('limit') ?? '', 10)
    // A notebook with no started day yet (fresh install, a test's temp tree)
    // cannot compute notebook-now — complete without the recency anchor
    // rather than failing the whole panel.
    let today: string | undefined
    try {
      today = fetchNowSync().plainDateTime.plainDate.toString()
    } catch {
      today = undefined
    }
    const items = complete(
      vocabularyOf(markdownStore, path.resolve(markdownBaseDir)),
      {
        kind: kind as CompletionKind,
        query: c.req.query('q') ?? '',
        key: c.req.query('key'),
        dir: c.req.query('dir'),
        limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : undefined,
      },
      scoresFrom(store.getPeopleWithScores(), store.getOrganizationsWithScores(), store.getTagsWithScores()),
      today,
    )
    return c.json({ items })
  })

  // What points at a document (rel, who, from, to, cc, org, where), newest first.
  app.get('/docs/_api/backlinks', (c) => {
    if (!markdownStore) return c.json({ items: [], total: 0 })
    const target = c.req.query('path') ?? ''
    if (!target || path.isAbsolute(target) || target.includes('..')) return c.json({ message: 'Missing path' }, 400)
    const items = backlinksOf(markdownStore, path.resolve(markdownBaseDir), path.normalize(target))
    const limit = Number.parseInt(c.req.query('limit') ?? '', 10)
    return c.json({ items: Number.isFinite(limit) && limit > 0 ? items.slice(0, limit) : items, total: items.length })
  })

  // Where the names in a document's front matter point — its chips become links.
  app.post('/docs/_api/resolve', async (c) => {
    if (!markdownStore) return c.json({ resolved: {} })
    const body = (await c.req.json().catch(() => null)) as { names?: unknown; path?: unknown } | null
    const names = Array.isArray(body?.names)
      ? body.names.filter((name): name is string => typeof name === 'string').slice(0, 500)
      : []
    const base = path.resolve(markdownBaseDir)
    const source =
      typeof body?.path === 'string' && !path.isAbsolute(body.path) ? path.resolve(base, body.path) : undefined
    return c.json({ resolved: resolveNames(markdownStore, base, names, source) })
  })

  // A file beside a document — in the notebook, in the media mirror of the document's directory,
  // or, for a day document, in the day's attachments (IMG-1, CLP-16).
  app.get('/docs/_api/file/*', async (c) => {
    const fileParam = decodeRoutePath(c.req.url, '/docs/_api/file/')
    if (!fileParam || path.isAbsolute(fileParam)) return c.json({ message: 'Missing file path' }, 400)
    const base = path.resolve(markdownBaseDir)
    const relativePath = path.normalize(fileParam)
    const filePath = path.resolve(base, relativePath)
    if (!isPathWithinRoot(filePath, base) || !isPathWithinRoots(filePath, markdownDirs)) {
      return c.json({ message: 'Requested file is outside the notebook' }, 403)
    }
    const media = path.resolve(userDataDir)
    const candidates = [
      filePath,
      ...attachmentCandidates(relativePath, media).filter((candidate) => isPathWithinRoot(candidate, media)),
    ]
    for (const candidate of candidates) {
      try {
        const data = await readFile(candidate)
        return c.body(data, 200, { 'content-type': contentTypeOf(candidate), 'cache-control': 'no-cache' })
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code
        if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') continue
        return c.json({ message: err instanceof Error ? err.message : String(err) }, 500)
      }
    }
    return c.json({ message: 'File not found' }, 404)
  })

  // A file pasted or dropped into a document (CLP-16): the bytes are stored beside the document —
  // a day document's in the day's attachments — and the name the copy carries comes back.
  app.put('/docs/_api/attach/*', async (c) => {
    const fileParam = decodeRoutePath(c.req.url, '/docs/_api/attach/')
    const previewRequest = resolveMarkdownPreviewRequest(fileParam, undefined, markdownBaseDir, markdownDirs)
    if (!previewRequest.ok) return c.json({ message: previewRequest.message }, previewRequest.status)
    const name = c.req.query('name')?.trim()
    if (!name) return c.json({ message: 'Missing file name' }, 400)
    const data = new Uint8Array(await c.req.arrayBuffer())
    if (data.byteLength === 0) return c.json({ message: 'Empty file' }, 400)
    try {
      const stored = await storeAttachment({ userDataDir, relativePath: previewRequest.value.relativePath, name, data })
      return c.json(stored)
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.put('/docs/_api/content/*', async (c) => {
    const fileParam = decodeRoutePath(c.req.url, '/docs/_api/content/')
    const previewRequest = resolveMarkdownPreviewRequest(fileParam, undefined, markdownBaseDir, markdownDirs)
    if (!previewRequest.ok) {
      return c.json({ message: previewRequest.message }, previewRequest.status)
    }

    try {
      const payload = await c.req.json<{
        content?: unknown
        version?: unknown
        force?: unknown
      }>()

      if (typeof payload.content !== 'string') {
        return c.json({ message: 'Missing required field: content' }, 400)
      }

      if (payload.version != null && typeof payload.version !== 'number') {
        return c.json({ message: 'Expected version to be a number' }, 400)
      }

      const snapshot = await saveMarkdownContent(
        previewRequest.value.filePath,
        payload.content,
        payload.version as number | undefined,
        payload.force === true,
      )

      return c.json({
        relativePath: previewRequest.value.relativePath,
        version: snapshot.version,
      })
    } catch (err) {
      if (err instanceof MarkdownSaveConflictError) {
        return c.json(
          {
            message: err.message,
            content: err.currentContent,
            version: err.currentVersion,
          },
          409,
        )
      }

      const error = err as NodeJS.ErrnoException
      if (error?.code === 'ENOENT') {
        return c.json({ message: 'Markdown file not found' }, 404)
      }

      const message = err instanceof Error ? err.message : String(err)
      return c.json({ message }, 500)
    }
  })

  app.get('/docs/_api/search', (c) => {
    if (!markdownStore) {
      return c.json({ message: 'Search index not ready' }, 503)
    }

    const query = (c.req.query('q') ?? '').trim()
    const limitRaw = Number(c.req.query('limit') ?? '20')
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50) : 20

    let today: PlainDate | undefined
    try {
      today = fetchNowSync().plainDateTime.plainDate
    } catch {
      today = undefined
    }

    return c.json({
      query,
      results: searchNotebook(markdownStore, markdownBaseDir, query, limit, today, {
        personScores: store.scoring.personScores,
        orgScores: store.scoring.orgScores,
      }),
    })
  })

  app.post('/docs/_api/export-pdf/*', async (c) => {
    const fileParam = decodeRoutePath(c.req.url, '/docs/_api/export-pdf/')
    const previewRequest = resolveMarkdownPreviewRequest(fileParam, c.req.query('theme'), markdownBaseDir, markdownDirs)
    if (!previewRequest.ok) {
      return c.json({ message: previewRequest.message }, previewRequest.status)
    }

    try {
      const pdfPath = await exportMarkdownPreviewPdf(previewRequest.value.filePath, previewRequest.value.theme)
      return c.json({
        relativePath: previewRequest.value.relativePath,
        pdfPath,
      })
    } catch (err) {
      const error = err as NodeJS.ErrnoException
      if (error?.code === 'ENOENT') {
        return c.json({ message: 'Markdown file not found' }, 404)
      }

      const message = err instanceof Error ? err.message : String(err)
      return c.json({ message }, 500)
    }
  })

  // The file pages of old — /docs/<file>, and /markdown/view before it — live on in the explorer.
  app.get('/docs', (c) => {
    return c.redirect(explorerHref(c.req.query('file') ?? ''), 302)
  })

  app.get('/docs/*', (c) => {
    return c.redirect(explorerHref(decodeRoutePath(c.req.url, '/docs/') ?? ''), 302)
  })

  app.get('/markdown/view', (c) => {
    return c.redirect(explorerHref(c.req.query('file') ?? ''), 302)
  })

  app.get('/markdown/view/*', (c) => {
    return c.redirect(explorerHref(decodeRoutePath(c.req.url, '/markdown/view/') ?? ''), 302)
  })

  // The app shell (Mantine on the sky theme; client bundled by Bun at first request).
  // `/` is the blank canvas being wired up; `/theme` is the living reference mock.
  app.get('/', (c) => {
    return c.html(renderAppHtml('sky'))
  })

  app.get('/thread/*', (c) => {
    return c.html(renderAppHtml('sky'))
  })

  app.get('/voice', (c) => {
    return c.html(renderAppHtml('sky'))
  })

  // The audition — every voice saying one passage. Reached by ai:voice:audition, not the sidebar.
  app.get('/voice/audition', (c) => {
    return c.html(renderAppHtml('sky · audition'))
  })

  // Settings: the app's preferences, one section per page — /settings/voice, /settings/appearance, ….
  // Its data lives under /settings/_api/….
  app.get('/settings', (c) => {
    return c.html(renderAppHtml('sky'))
  })
  app.get('/settings/*', (c) => {
    // A data path with no settings host stays a 404, not a page.
    if (c.req.path.startsWith('/settings/_api/')) return c.json(jsend.fail({ message: 'Not found.' }), 404)
    return c.html(renderAppHtml('sky'))
  })

  // The clock: notebook time against the world's. Its data lives under /clock/_api/….
  app.get('/clock', (c) => {
    return c.html(renderAppHtml('sky'))
  })

  // The explorer: the notebook's files as a tree, any one of them open to read.
  // Its data lives under /explorer/_api/…; the page is /explorer, or /explorer/<file>.
  app.route('/explorer/_api', createExplorerRoutes({ markdownBaseDir, markdownDirs }))
  app.get('/explorer', (c) => {
    return c.html(renderAppHtml('sky'))
  })
  app.get('/explorer/*', (c) => {
    return c.html(renderAppHtml('sky'))
  })

  // A day's page is its date — /2026-08-27. Its data lives under /day/….
  app.get('/:ymd{\\d{4}-\\d{2}-\\d{2}}', (c) => {
    return c.html(renderAppHtml('sky'))
  })

  app.get('/theme', (c) => {
    return c.html(renderAppHtml('sky · theme'))
  })

  app.get('/_assets/:name', async (c) => {
    try {
      const asset = await getThemeAsset(c.req.param('name'))
      if (!asset) return c.json({ message: 'Not found.' }, 404)
      return new Response(asset.content, {
        headers: { 'Content-Type': asset.type, 'Cache-Control': 'no-cache' },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ message }, 500)
    }
  })

  // 404 fallback
  app.notFound((c) => {
    return c.json(jsend.fail({ message: 'Not found.' }), 404)
  })

  return app
}

function decodeRoutePath(url: string, prefix: string): string | undefined {
  const pathname = new URL(url).pathname
  const routePath = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : ''
  return routePath.length > 0 ? routePath.split('/').map(decodeURIComponent).join('/') : undefined
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

function contentTypeOf(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}
