/**
 * Hono app factory for the notebook service.
 *
 * Used by both run.ts (production) and server.ts (testing).
 */

import * as path from 'node:path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { readTextFile } from '#shared/fs/mod.ts'
import * as jsend from '../jsend.ts'
import type { Store } from '../store.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import type { YogaServerInstance } from 'graphql-yoga'
import { resolveContext } from '../context/mod.ts'
import {
  buildMarkdownDocumentEditorState,
  buildMarkdownPreviewPath,
  exportMarkdownPreviewPdf,
  MarkdownSaveConflictError,
  readMarkdownContent,
  renderMarkdownPreviewDocument,
  resolveMarkdownPreviewMode,
  resolveMarkdownPreviewRequest,
  resolveMarkdownPreviewTheme,
  saveMarkdownContent,
} from './markdown-preview/mod.ts'
import { renderBlockPreview } from './markdown-preview/blockPreview.ts'

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
  /** Directory containing static files (index.html) */
  staticDir: string
  /** Base notebook directory that preview paths are relative to */
  markdownBaseDir: string
  /** Directories containing markdown files that can be previewed */
  markdownDirs: string[]
  /** Additional route handlers (e.g., /site-html for production) */
  customRoutes?: Map<string, (req: Request) => Promise<Response>>
}

/**
 * Create a Hono app with all service routes.
 */
export function createHttpApp(options: HttpHandlerOptions): Hono {
  const { store, yoga, markdownStore, staticDir, markdownBaseDir, markdownDirs, customRoutes } = options

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

  async function handleMarkdownPreview(
    fileParam: string | undefined,
    themeParam: string | undefined,
    modeParam: string | undefined,
  ): Promise<Response> {
    if (!fileParam) {
      const html = await renderMarkdownPreviewDocument(null, {
        markdownBaseDir,
        markdownDirs,
        defaultTheme: resolveMarkdownPreviewTheme(themeParam),
        mode: resolveMarkdownPreviewMode(modeParam),
      })
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      })
    }

    const previewRequest = resolveMarkdownPreviewRequest(fileParam, themeParam, markdownBaseDir, markdownDirs)
    if (!previewRequest.ok) {
      return new Response(previewRequest.message, { status: previewRequest.status })
    }

    try {
      const html = await renderMarkdownPreviewDocument(previewRequest.value, {
        markdownBaseDir,
        markdownDirs,
        mode: resolveMarkdownPreviewMode(modeParam),
      })
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      })
    } catch (err) {
      const error = err as NodeJS.ErrnoException
      if (error?.code === 'ENOENT') {
        return new Response('Markdown file not found', { status: 404 })
      }

      const message = err instanceof Error ? err.message : String(err)
      return new Response(`Failed to render markdown preview: ${message}`, { status: 500 })
    }
  }

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

  app.get('/docs', async (c) => {
    const fileParam = c.req.query('file')
    const themeParam = c.req.query('theme')
    if (fileParam) {
      return c.redirect(
        buildMarkdownPreviewPath(fileParam, {
          theme: themeParam,
          mode: resolveMarkdownPreviewMode(c.req.query('mode')),
        }),
        302,
      )
    }

    return await handleMarkdownPreview(undefined, themeParam, c.req.query('mode'))
  })

  app.get('/docs/*', async (c) => {
    const fileParam = decodeRoutePath(c.req.url, '/docs/')

    return await handleMarkdownPreview(fileParam, c.req.query('theme'), c.req.query('mode'))
  })

  app.get('/markdown/view', (c) => {
    return c.redirect(
      buildMarkdownPreviewPath(c.req.query('file') ?? '', {
        theme: c.req.query('theme'),
        mode: resolveMarkdownPreviewMode(c.req.query('mode')),
      }),
      302,
    )
  })

  app.get('/markdown/view/*', (c) => {
    return c.redirect(
      buildMarkdownPreviewPath(decodeRoutePath(c.req.url, '/markdown/view/') ?? '', {
        theme: c.req.query('theme'),
        mode: resolveMarkdownPreviewMode(c.req.query('mode')),
      }),
      302,
    )
  })

  // Static index page
  app.get('/', async (c) => {
    const indexHtml = await readTextFile(path.join(staticDir, 'index.html'))
    return c.html(indexHtml)
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
