import { mkdir, realpath } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Hono } from 'hono'
import { withProcessLock } from '#lib/jobs/files.ts'
import { atomicWrite, hash } from '#lib/outbox/files.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { MarkdownSaveConflictError, readMarkdownContent } from '../markdown-preview/content.ts'
import { toNotebookRelativePath } from '../markdown-preview/request.ts'

export const WHITEBOARD_FILENAME = 'whiteboard.md'

export interface WhiteboardSnapshot {
  /** Notebook-relative path to the whiteboard file, e.g. `time/whiteboard.md`. */
  path: string
  /** Whether the whiteboard file exists on disk yet. */
  exists: boolean
  content: string
  version: number | null
}

export interface WhiteboardRoutesOptions {
  markdownBaseDir: string
  timeDir: string
  markdownStore: MarkdownStore | null
}

/**
 * HTTP routes for the persistent notebook whiteboard (`time/whiteboard.md`).
 * Reads cleanly when the file does not exist yet (returning an empty snapshot)
 * and creates parent directories on the first save with optimistic version checks.
 */
export function createWhiteboardRoutes({ markdownBaseDir, timeDir, markdownStore }: WhiteboardRoutesOptions): Hono {
  const app = new Hono()
  const filePath = path.join(timeDir, WHITEBOARD_FILENAME)
  const relativePath = toNotebookRelativePath(path.resolve(markdownBaseDir), path.resolve(filePath))

  app.get('/', async (c) => {
    try {
      const snapshot = await readMarkdownContent(filePath)
      const body: WhiteboardSnapshot = {
        path: relativePath,
        exists: true,
        content: snapshot.content,
        version: snapshot.version,
      }
      return c.json(body)
    } catch (err) {
      const error = err as NodeJS.ErrnoException
      if (error?.code === 'ENOENT') {
        const body: WhiteboardSnapshot = {
          path: relativePath,
          exists: false,
          content: '',
          version: null,
        }
        return c.json(body)
      }
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ message }, 500)
    }
  })

  app.put('/', async (c) => {
    let payload: { content?: unknown; version?: unknown; force?: unknown }
    try {
      payload = await c.req.json()
    } catch {
      return c.json({ message: 'Body must be JSON' }, 400)
    }

    if (typeof payload.content !== 'string') {
      return c.json({ message: 'Missing required field: content' }, 400)
    }
    if (payload.version != null && typeof payload.version !== 'number') {
      return c.json({ message: 'Expected version to be a number or null' }, 400)
    }

    const expectedVersion = (payload.version as number | null | undefined) ?? null
    const force = payload.force === true

    try {
      // Match `withMarkdownWrite`'s canonical lock key even before `time/whiteboard.md` exists on disk.
      await mkdir(path.dirname(filePath), { recursive: true })
      const canonical = path.join(await realpath(path.dirname(filePath)), path.basename(filePath))
      const snapshot = await withProcessLock(
        path.join(os.tmpdir(), 'sky-markdown-writes', hash(canonical)),
        async () => {
          let current: Awaited<ReturnType<typeof readMarkdownContent>> | null = null
          try {
            current = await readMarkdownContent(filePath)
          } catch (err) {
            const error = err as NodeJS.ErrnoException
            if (error?.code !== 'ENOENT') throw err
          }

          if (current && !force && (expectedVersion === null || current.version !== expectedVersion)) {
            throw new MarkdownSaveConflictError(current)
          }

          await atomicWrite(filePath, payload.content as string)
          return await readMarkdownContent(filePath)
        },
      )

      markdownStore?.set(filePath, snapshot.content)

      const body: WhiteboardSnapshot = {
        path: relativePath,
        exists: true,
        content: snapshot.content,
        version: snapshot.version,
      }
      return c.json(body)
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
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ message }, 500)
    }
  })

  return app
}
