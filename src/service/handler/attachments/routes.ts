/**
 * A file kept beside a document (CLP-16): pasted or dropped into the editor,
 * or added from the rail. The bytes land as a copy through PUT; the rail
 * first asks where the original is and, when this Mac has it, moves it in —
 * nothing uploads. A day document's files join the day's attachments; any
 * other document's sit in the user-data mirror of its directory.
 */

import { Hono } from 'hono'
import { decodeRoutePath, resolveMarkdownPreviewRequest } from '../markdown-preview/mod.ts'
import { createKeeper, factsOf, type KeepOptions, listFiles, moveRequestOf } from './keep.ts'
import { attachmentDestination, storeAttachment } from './mod.ts'

/** Where these routes live, mounted at the root; the document's path follows the route name. */
export const ATTACHMENT_MOUNT = '/docs/_api'

export interface AttachmentRoutesOptions {
  markdownBaseDir: string
  markdownDirs: string[]
  userDataDir: string
  keep?: KeepOptions
}

export function createAttachmentRoutes(options: AttachmentRoutesOptions): Hono {
  const { markdownBaseDir, markdownDirs, userDataDir } = options
  const keeper = createKeeper(options.keep)
  const app = new Hono()

  /** The document a route names, resolved and checked against the notebook's roots. */
  const documentOf = (url: string, route: string) =>
    resolveMarkdownPreviewRequest(
      decodeRoutePath(url, `${ATTACHMENT_MOUNT}/${route}/`),
      undefined,
      markdownBaseDir,
      markdownDirs,
    )

  // What is beside the document already: the files of its directory, by name.
  app.get(`${ATTACHMENT_MOUNT}/attach/*`, async (c) => {
    const document = documentOf(c.req.url, 'attach')
    if (!document.ok) return c.json({ message: document.message }, document.status)
    const { dir } = attachmentDestination(document.value.relativePath, userDataDir)
    return c.json({ files: await listFiles(dir) })
  })

  // The bytes, as a copy — the name the copy carries comes back.
  app.put(`${ATTACHMENT_MOUNT}/attach/*`, async (c) => {
    const document = documentOf(c.req.url, 'attach')
    if (!document.ok) return c.json({ message: document.message }, document.status)
    const name = c.req.query('name')?.trim()
    if (!name) return c.json({ message: 'Missing file name' }, 400)
    const data = new Uint8Array(await c.req.arrayBuffer())
    if (data.byteLength === 0) return c.json({ message: 'Empty file' }, 400)
    try {
      return c.json(await storeAttachment({ userDataDir, relativePath: document.value.relativePath, name, data }))
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // Where the original is, from the three facts a drop carries.
  app.post(`${ATTACHMENT_MOUNT}/attach-locate/*`, async (c) => {
    const document = documentOf(c.req.url, 'attach-locate')
    if (!document.ok) return c.json({ message: document.message }, document.status)
    const facts = factsOf(await c.req.json().catch(() => null))
    if (!facts) return c.json({ message: 'expected {name, size, lastModified}' }, 400)
    const { dir } = attachmentDestination(document.value.relativePath, userDataDir)
    return c.json(await keeper.locate(dir, facts))
  })

  // The move: only a file the look found, still as the look saw it.
  app.post(`${ATTACHMENT_MOUNT}/attach-move/*`, async (c) => {
    const document = documentOf(c.req.url, 'attach-move')
    if (!document.ok) return c.json({ message: document.message }, document.status)
    const request = moveRequestOf(await c.req.json().catch(() => null))
    if (!request) return c.json({ message: 'a file name is required' }, 400)
    const { dir, day } = attachmentDestination(document.value.relativePath, userDataDir)
    const moved = await keeper.move(dir, request)
    if ('refused' in moved) return c.json({ message: moved.refused }, 409)
    return c.json({ file: moved.name, ...(day ? { day } : {}), moveId: moved.moveId, from: moved.from })
  })

  // Back where it came from, while the note is still up.
  app.post(`${ATTACHMENT_MOUNT}/attach-undo`, async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    const moveId = typeof body?.moveId === 'string' ? body.moveId : ''
    const undone = await keeper.undo(moveId)
    if (undone === 'nothing') return c.json({ message: 'nothing to undo' }, 404)
    if (undone === 'moved-on') return c.json({ message: 'the file has moved on' }, 409)
    return c.json({ ok: true })
  })

  return app
}
