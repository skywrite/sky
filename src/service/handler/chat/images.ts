import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { copyToDayAttachments } from '#lib/notebook/attachments.ts'
import type { ToolHooks } from '#shared/models/Chat/ChatSession/mod.ts'
import type { ChatImage } from '#universal/ai/chatImages.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { safeAttachmentName } from '../attachments/mod.ts'

/** Only inert raster formats may be served inline from chat attachments. */
export function chatImageMediaType(data: Uint8Array): string | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => data[i] === byte)) return 'image/png'
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  const header = Buffer.from(data.subarray(0, 12)).toString('ascii')
  if (header.startsWith('RIFF') && header.slice(8) === 'WEBP') return 'image/webp'
  return null
}

/** Local image creation stays a CLI command; the web host owns its durable URLs. */
export function prepareChatImageResult(options: {
  today: PlainDate
  attachmentsRoot: string
  onAttachments: ToolHooks['onAttachments']
  onImages: ToolHooks['onImages']
}) {
  return async (command: string, result: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (command !== 'ai:image' || result.success !== true || !Array.isArray(result.images)) return result
    const images: Array<ChatImage & { path: string }> = []
    const failures: string[] = []
    for (const source of result.images) {
      if (typeof source !== 'string') continue
      try {
        if (!chatImageMediaType(await readFile(source))) throw new Error('Unsupported image format')
        const copy = await copyToDayAttachments({
          sourcePath: source,
          attachmentsRoot: options.attachmentsRoot,
          day: options.today,
          fileName: safeAttachmentName(path.basename(source)),
        })
        if (!copy) throw new Error('Generated file is missing')
        const image = {
          name: copy.attachment.file,
          url: `/chat/files/${options.today.ymd}/${encodeURIComponent(copy.attachment.file)}`,
          path: copy.path,
        }
        images.push(image)
        options.onAttachments([copy.attachment])
        options.onImages([image])
      } catch (error) {
        // Generation already succeeded. A preview/storage failure must not
        // make the model unknowingly repeat a paid generation.
        failures.push(`${path.basename(source)}: ${(error as Error).message}`)
      }
    }
    return {
      ...result,
      imageArtifacts: images,
      ...(failures.length
        ? { previewError: `Images were generated, but some previews could not be saved: ${failures.join('; ')}` }
        : {}),
      display:
        'The web chat displays imageArtifacts automatically. For follow-up edits, pass the chosen artifact path as refs. Do not embed local filesystem paths as browser images.',
    }
  }
}
