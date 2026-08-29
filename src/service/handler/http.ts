/**
 * Hono app factory for the notebook service.
 *
 * Used by both run.ts (production) and server.ts (testing).
 */

import type { YogaServerInstance } from 'graphql-yoga'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { resolveContext } from '../context/mod.ts'
import * as jsend from '../jsend.ts'
import type { Store } from '../store.ts'
import { type ChatRoutesOptions, createChatRoutes } from './chat/mod.ts'
import { createDayRoutes } from './day/mod.ts'
import { createExplorerRoutes, explorerHref } from './explorer/mod.ts'
import { searchNotebook } from './home/mod.ts'
import { renderBlockPreview } from './markdown-preview/blockPreview.ts'
import {
  buildMarkdownDocumentEditorState,
  exportMarkdownPreviewPdf,
  MarkdownSaveConflictError,
  readMarkdownContent,
  resolveMarkdownPreviewRequest,
  saveMarkdownContent,
} from './markdown-preview/mod.ts'
import { getThemeAsset, renderAppHtml } from './theme/mod.ts'

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
}

/**
 * Create a Hono app with all service routes.
 */
export function createHttpApp(options: HttpHandlerOptions): Hono {
  const { store, yoga, markdownStore, markdownBaseDir, markdownDirs, customRoutes, chat } = options

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

  app.get('/docs/_api/document/*', async (c) => {
    const fileParam = decodeRoutePath(c.req.url, '/docs/_api/document/')
    const previewRequest = resolveMarkdownPreviewRequest(fileParam, undefined, markdownBaseDir, markdownDirs)
    if (!previewRequest.ok) {
      return c.json({ message: previewRequest.message }, previewRequest.status)
    }

    try {
      const snapshot = await readMarkdownContent(previewRequest.value.filePath)
      const documentState = await buildMarkdownDocumentEditorState(snapshot.content, snapshot.version)

      return c.json({
        relativePath: previewRequest.value.relativePath,
        ...documentState,
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

  app.post('/docs/_api/render-block', async (c) => {
    try {
      const payload = await c.req.json<{
        raw?: unknown
        type?: unknown
      }>()

      if (typeof payload.raw !== 'string') {
        return c.json({ message: 'Missing required field: raw' }, 400)
      }

      if (typeof payload.type !== 'string') {
        return c.json({ message: 'Missing required field: type' }, 400)
      }

      return c.json({
        html: await renderBlockPreview(payload.type, payload.raw),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ message }, 400)
    }
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
