import { mkdtemp, readFile as readBytes, realpath, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Hono } from 'hono'
import sharp from 'sharp'
import { validateImageMarkup } from '#commands/all/ai/image/lib/markup.ts'
import { prepareReferenceImage } from '#commands/all/ai/image/lib/references.ts'
import { readFile, toUserContent } from '#commands/lib/chat/fileTools.ts'
import type { ChatMessageFiles } from '#shared/models/Chat/ChatSession/mod.ts'
import type { ConversationMessage } from '#shared/models/Chat/type.d.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { type ChatFileRef, MAX_CHAT_FILE_BYTES, splitChatFiles, withChatFiles } from '#universal/ai/chatFiles.ts'
import { splitChatImages } from '#universal/ai/chatImages.ts'
import { imageMarkupSvg, isImageMarkup, type ImageMarkup } from '#universal/ai/imageMarkup.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { safeAttachmentName } from '../attachments/mod.ts'
import { chatImageMediaType } from './images.ts'

function attachmentPath(root: string, day: string, file: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || safeAttachmentName(file) !== file || /[/\\]/.test(file))
    throw new Error('Invalid chat attachment.')
  return path.join(root, dayAttachmentsDir(new PlainDate(day)), file)
}

function linkedPath(root: string, url: string): string {
  const [, , , day, file] = url.split('/')
  return attachmentPath(root, day!, decodeURIComponent(file!))
}

/** Bound JSON before parsing; each entry belongs to the upload at the same position. */
export function readUploadMarkups(raw: FormDataEntryValue | null | undefined, count: number): (ImageMarkup | null)[] {
  if (raw == null) return []
  if (typeof raw !== 'string' || raw.length > 2_000_000)
    throw new Error('Photo markup is too large. Remove some marks and try again.')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Photo markup could not be read. Reopen Mark up and try again.')
  }
  if (
    !Array.isArray(parsed) ||
    (parsed.length !== 0 && parsed.length !== count) ||
    parsed.some((markup) => markup !== null && !isImageMarkup(markup))
  )
    throw new Error('Photo markup does not match the attachments. Reopen Mark up and try again.')
  return parsed
}

function markupContext(source: string, overlay: string): string {
  return `Photo edit with numbered markup. Use ai:image with refs=${JSON.stringify(source)} first, markup=${JSON.stringify(overlay)}, model="sunburst", quality="max", and the requested output format. The transparent overlay is guidance, not another reference or a mask. Follow the numbered instructions and remove the annotation marks in the final image. Do not flatten the overlay onto the original or combine it with a mask.`
}

/** Filed transcripts and branches have links but no provider history: the console tool can reread their copies. */
export function chatFileContext(turns: readonly ConversationMessage[], attachmentsRoot: string): string {
  const paths = new Map<string, string>()
  for (const turn of turns) {
    const refs = turn.role === 'user' ? splitChatFiles(turn.content).files : splitChatImages(turn.content).images
    for (const ref of refs) {
      try {
        const source = linkedPath(attachmentsRoot, ref.url)
        paths.set(source, ref.name)
        if (ref.markup)
          paths.set(
            linkedPath(attachmentsRoot, ref.markup.url),
            `Markup for ${ref.name}; pass as ai:image markup with ${source} as the first reference, Sunburst/max. See the numbered instructions in the original message.`,
          )
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
  markups: readonly (ImageMarkup | null)[] = [],
): Promise<{ message: string; files: ChatMessageFiles }> {
  const files: ChatMessageFiles = { content: [], attachments: [] }
  const links: ChatFileRef[] = []
  let bytes = 0
  const read = async (source: string, name: string, clip = true) => {
    const { output, document } = await readFile(
      { path: source },
      { today, attachmentsRoot, cwd: attachmentsRoot, onAttachments: (added) => files.attachments.push(...added) },
    )
    if (!output.success) throw new Error(`${name}: ${output.error}`)
    if (!document) throw new Error(`${name} could not be read.`)
    if (clip) bytes += output.bytes
    if (bytes > MAX_CHAT_FILE_BYTES) throw new Error('Attachments must total 20 MB or less.')
    // A temporary browser upload is gone before the model answers; its copy is the path to reread.
    files.content.push(...toUserContent({ ...output, path: output.attachmentPath }, document))
    const link = { name, url: `/chat/files/${today.ymd}/${encodeURIComponent(output.attachment)}` }
    if (clip) links.push(link)
    return { link, path: output.attachmentPath! }
  }
  // A resend after a restart already has durable links, so it needs no browser File objects.
  for (const ref of refs) {
    const source = linkedPath(attachmentsRoot, ref.url)
    if (ref.markup) {
      const overlay = linkedPath(attachmentsRoot, ref.markup.url)
      await validateImageMarkup(
        await readBytes(overlay),
        await prepareReferenceImage(await readBytes(source), ref.name),
      )
      const original = await read(source, ref.name)
      const retained = await read(overlay, `Markup for ${ref.name}`, false)
      links.at(-1)!.markup = { url: retained.link.url, count: ref.markup.count }
      files.content.push({ type: 'text', text: markupContext(original.path, retained.path) })
    } else await read(source, ref.name)
  }
  for (const [index, upload] of uploads.entries()) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-chat-upload-'))
    try {
      const name = safeAttachmentName(upload.name)
      const source = path.join(dir, name)
      const data = new Uint8Array(await upload.arrayBuffer())
      await writeFile(source, data)
      const markup = markups[index]
      let overlay: Uint8Array | undefined
      if (markup?.marks.length) {
        try {
          if (!/\.(png|jpe?g|webp)$/i.test(name)) throw new Error('Attach a PNG, JPEG or WebP photo to mark up.')
          overlay = await sharp(Buffer.from(imageMarkupSvg(markup)))
            .png()
            .toBuffer()
          await validateImageMarkup(overlay, await prepareReferenceImage(data, name))
        } catch (error) {
          throw new Error(`${name}: ${(error as Error).message}`)
        }
      }
      const original = await read(source, name)
      if (overlay && markup) {
        const overlayName = `${path.parse(name).name}-markup.png`
        const overlayPath = path.join(dir, overlayName)
        await writeFile(overlayPath, overlay)
        const retained = await read(overlayPath, overlayName, false)
        links.at(-1)!.markup = { url: retained.link.url, count: markup.marks.length }
        files.content.push({ type: 'text', text: markupContext(original.path, retained.path) })
      }
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
