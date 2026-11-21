import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Context } from 'hono'
import { VIDEO_CONTENT_TYPES } from '#lib/media/video.ts'

/** Serve the original recording with byte-range support so the browser can seek through large files. */
export async function serveVideo(c: Context, file: string): Promise<Response | undefined> {
  const type = VIDEO_CONTENT_TYPES[extname(file).toLowerCase()]
  if (!type || !(await stat(file)).isFile()) return
  const response = await serveStatic({ path: file })(c, async () => {})
  if (!response) return
  response.headers.set('Content-Type', type)
  response.headers.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(basename(file))}`)
  response.headers.set('Accept-Ranges', 'bytes')
  response.headers.set('Cache-Control', 'no-cache')
  return response
}
