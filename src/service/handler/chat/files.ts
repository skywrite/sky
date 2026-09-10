import { mkdtemp, readFile as readBytes, realpath, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Hono } from 'hono'
import { readFile, toUserContent } from '#commands/lib/chat/fileTools.ts'
import type { ChatMessageFiles } from '#shared/models/Chat/ChatSession/mod.ts'
import type { ConversationMessage } from '#shared/models/Chat/type.d.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { type ChatFileRef, MAX_CHAT_FILE_BYTES, splitChatFiles, withChatFiles } from '#universal/ai/chatFiles.ts'
import { splitChatImages } from '#universal/ai/chatImages.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { safeAttachmentName } from '../attachments/mod.ts'
import { chatImageMediaType } from './images.ts'

function attachmentPath(root: string, day: string, file: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || safeAttachmentName(file) !== file || /[/\\]/.test(file))
    throw new Error('Invalid chat attachment.')
  return path.join(root, dayAttachmentsDir(new PlainDate(day)), file)
}

/** Filed transcripts and branches have links but no provider history: the console tool can reread their copies. */
export function chatFileContext(turns: readonly ConversationMessage[], attachmentsRoot: string): string {
  const paths = new Map<string, string>()
  for (const turn of turns) {
    const refs = turn.role === 'user' ? splitChatFiles(turn.content).files : splitChatImages(turn.content).images
    for (const ref of refs) {
      try {
        const [, , , day, file] = ref.url.split('/')
        paths.set(attachmentPath(attachmentsRoot, day!, decodeURIComponent(file!)), ref.name)
      } catch {
        // A hand-edited invalid link is not a local file reference.
      }
    }
  }
  if (paths.size === 0) return ''
  return [
    'Files attached earlier in this conversation. Use read_file on these copies when you need their contents and they are not already in context:',
    ...[...paths].map(([file, name]) => JSON.stringify({ name, path: file })),
  ].join('\n')
}

/** Reuse the console reader and keep only its durable copy after handling the upload. */
export async function readChatFiles(
  message: string,
  uploads: File[],
  refs: ChatFileRef[],
  today: PlainDate,
  attachmentsRoot: string,
): Promise<{ message: string; files: ChatMessageFiles }> {
  const files: ChatMessageFiles = { content: [], attachments: [] }
  const links: ChatFileRef[] = []
  let bytes = 0
  const read = async (source: string, name: string) => {
    const { output, document } = await readFile(
      { path: source },
      { today, attachmentsRoot, cwd: attachmentsRoot, onAttachments: (added) => files.attachments.push(...added) },
    )
    if (!output.success) throw new Error(`${name}: ${output.error}`)
    if (!document) throw new Error(`${name} could not be read.`)
    bytes += output.bytes
    if (bytes > MAX_CHAT_FILE_BYTES) throw new Error('Attachments must total 20 MB or less.')
    // A temporary browser upload is gone before the model answers; its copy is the path to reread.
    files.content.push(...toUserContent({ ...output, path: output.attachmentPath }, document))
    links.push({ name, url: `/chat/files/${today.ymd}/${encodeURIComponent(output.attachment)}` })
  }
  // A resend after a restart already has durable links, so it needs no browser File objects.
  for (const ref of refs) {
    const [, , , day, file] = ref.url.split('/')
    await read(attachmentPath(attachmentsRoot, day!, decodeURIComponent(file!)), ref.name)
  }
  for (const upload of uploads) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-chat-upload-'))
    try {
      const name = safeAttachmentName(upload.name)
      const source = path.join(dir, name)
      await writeFile(source, new Uint8Array(await upload.arrayBuffer()))
      await read(source, name)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
  return { message: withChatFiles(message || 'Read the attached files.', links), files }
}

/** The link in a transcript continues to work after the thread is closed or the service restarts. */
export function createChatFileRoutes(attachmentsRoot: string): Hono {
  const app = new Hono()
  app.get('/:day/:file', async (c) => {
    let target: string
    try {
      target = attachmentPath(attachmentsRoot, c.req.param('day'), c.req.param('file'))
    } catch {
      return c.json({ message: 'Invalid chat attachment.' }, 400)
    }
    try {
      const [root, resolved] = await Promise.all([realpath(attachmentsRoot), realpath(target)])
      if (!resolved.startsWith(root + path.sep)) return c.json({ message: 'Invalid chat attachment.' }, 400)
      const data = await readBytes(resolved)
      const preview = c.req.query('preview') === '1'
      const mediaType = preview ? chatImageMediaType(data) : 'application/octet-stream'
      if (!mediaType) return c.json({ message: 'This file cannot be previewed as an image.' }, 415)
      return c.body(data, 200, {
        'content-type': mediaType,
        'content-disposition': `${preview ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(path.basename(target))}`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-cache',
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return c.json({ message: 'File not found.' }, 404)
      throw error
    }
  })
  return app
}
