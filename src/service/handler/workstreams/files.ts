import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { Hono } from 'hono'
import { workstreamFile } from '#lib/workstreams/files.ts'
import type { WorkstreamStore } from '#lib/workstreams/store.ts'
import { WorkstreamError } from '#lib/workstreams/types.ts'
import type { KeepOptions } from '../attachments/keep.ts'
import { safeAttachmentName } from '../attachments/mod.ts'
import { createAttachmentRoutes } from '../attachments/routes.ts'
import { createExplorerRoutes } from '../explorer/mod.ts'
import {
  decodeRoutePath,
  exportMarkdownPreviewPdf,
  MarkdownSaveConflictError,
  readMarkdownContent,
  resolveMarkdownPreviewRequest,
  saveMarkdownContent,
} from '../markdown-preview/mod.ts'

/** Preserve document URLs while exposing only owned content, never workstream permissions or checkpoints. */
export function createWorkstreamFileRoutes(
  store: WorkstreamStore,
  contentType: (file: string) => string,
  keep?: KeepOptions,
  legacyAttachmentsRoot?: string,
): Hono {
  const app = new Hono()
  const explorer = createExplorerRoutes({ markdownBaseDir: store.contentRoot, markdownDirs: [store.dir] })
  const attachments = createAttachmentRoutes({
    markdownBaseDir: store.contentRoot,
    markdownDirs: [store.dir],
    userDataDir: store.contentRoot,
    keep,
  })
  const owns = (relative: string | undefined): relative is string =>
    relative === 'workstreams' || Boolean(relative?.startsWith('workstreams/'))
  const resolve = async (relative: string) => {
    if (relative.split('/').some((part) => !part || part.startsWith('.')) || relative.includes('\\'))
      throw new WorkstreamError('Choose a workstream content path without hidden directories or traversal.', 403)
    await store.initialize()
    return workstreamFile(store.contentRoot, path.join(store.contentRoot, relative))
  }
  app.onError((error, c) => {
    if (error instanceof MarkdownSaveConflictError)
      return c.json({ message: error.message, content: error.currentContent, version: error.currentVersion }, 409)
    if (error instanceof WorkstreamError) return c.json({ message: error.message }, error.status)
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR')
      return c.json({ message: 'Workstream file not found.' }, 404)
    return c.json({ message: error.message }, 500)
  })

  for (const kind of ['doc', 'dir'])
    app.get(`/explorer/_api/${kind}`, async (c, next) => {
      const relative = c.req.query('path')
      if (!owns(relative)) return next()
      await resolve(relative)
      return explorer.request(`/${kind}?path=${encodeURIComponent(relative)}`)
    })

  for (const kind of ['attach', 'attach-locate', 'attach-move'])
    app.all(`/docs/_api/${kind}/*`, async (c, next) => {
      const relative = decodeRoutePath(c.req.url, `/docs/_api/${kind}/`)
      if (!owns(relative)) return next()
      await resolve(relative)
      await store.resolveFile(relative)
      if (c.req.method === 'PUT' && c.req.query('name'))
        await workstreamFile(
          store.contentRoot,
          path.join(store.contentRoot, path.dirname(relative), safeAttachmentName(c.req.query('name')!)),
        )
      return attachments.fetch(c.req.raw)
    })
  app.post('/docs/_api/attach-undo', async (c, next) => {
    // Move receipts belong to the keeper that issued them; unrelated notebook receipts continue below.
    const response = await attachments.fetch(c.req.raw.clone())
    return response.status === 404 ? next() : response
  })

  app.on(['GET', 'PUT'], '/docs/_api/content/*', async (c, next) => {
    const relative = decodeRoutePath(c.req.url, '/docs/_api/content/')
    if (!owns(relative)) return next()
    const file = await resolve(relative)
    if (path.extname(file).toLowerCase() !== '.md')
      return c.json({ message: 'Preview route only supports .md files' }, 400)
    if (c.req.method === 'GET') {
      const snapshot = await readMarkdownContent(file)
      return c.json({
        relativePath: relative,
        version: snapshot.version,
        ...(c.req.query('meta') === '1' ? {} : { content: snapshot.content }),
      })
    }
    const input = await c.req.json<{ content?: unknown; version?: unknown; force?: unknown }>()
    if (typeof input.content !== 'string') return c.json({ message: 'Missing required field: content' }, 400)
    if (input.version != null && typeof input.version !== 'number')
      return c.json({ message: 'Expected version to be a number' }, 400)
    const saved = await saveMarkdownContent(
      file,
      input.content,
      input.version as number | undefined,
      input.force === true,
    )
    return c.json({ relativePath: relative, version: saved.version })
  })

  app.get('/docs/_api/file/*', async (c, next) => {
    const relative = decodeRoutePath(c.req.url, '/docs/_api/file/')
    if (!owns(relative)) return next()
    const file = await resolve(relative)
    const data = await readFile(file).catch(async (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !legacyAttachmentsRoot) throw error
      // Older pasted files already lived outside the notebook in its user-data mirror.
      const legacy = await workstreamFile(legacyAttachmentsRoot, path.join(legacyAttachmentsRoot, relative))
      return readFile(legacy)
    })
    return c.body(data, 200, { 'content-type': contentType(file), 'cache-control': 'no-cache' })
  })

  app.post('/docs/_api/export-pdf/*', async (c, next) => {
    const relative = decodeRoutePath(c.req.url, '/docs/_api/export-pdf/')
    if (!owns(relative)) return next()
    await resolve(relative)
    const request = resolveMarkdownPreviewRequest(relative, c.req.query('theme'), store.contentRoot, [store.dir])
    if (!request.ok) return c.json({ message: request.message }, request.status)
    const pdfPath = await exportMarkdownPreviewPdf(request.value.filePath, request.value.theme)
    return c.json({ relativePath: relative, pdfPath })
  })
  return app
}
