import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Hono } from 'hono'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import { assert, test } from '#test'
import type { ChatImage } from '#universal/ai/chatImages.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createChatFileRoutes } from './files.ts'
import { prepareChatImageResult } from './images.ts'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><title>Atlas badge</title><rect x="4" y="4" width="24" height="24" fill="#ff8000"/></svg>'

test('Generated SVG downloads survive removal of evidence files while only the PNG is displayed inline', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sky-chat-drawing-'))
  try {
    const generated = path.join(root, 'generated')
    await mkdir(generated)
    const pngPath = path.join(generated, 'Atlas badge.png')
    const svgPath = path.join(generated, 'Atlas badge.svg')
    await writeFile(pngPath, png)
    await writeFile(svgPath, svg)
    const attachmentsRoot = path.join(root, 'attachments')
    const attachments: Attachment[] = []
    const images: ChatImage[] = []
    const prepare = prepareChatImageResult({
      today: new PlainDate('2026-01-27'),
      attachmentsRoot,
      onAttachments: (files) => attachments.push(...files),
      onImages: (files) => images.push(...files),
    })
    const result = await prepare('ai:image', { success: true, images: [pngPath], svgs: [svgPath], method: 'drawing' })
    await rm(generated, { recursive: true })
    const drawing = (result.drawingArtifacts as Array<{ name: string; url: string; path: string }>)[0]!
    const image = (result.imageArtifacts as Array<ChatImage & { path: string }>)[0]!
    const app = new Hono().route('/chat/files', createChatFileRoutes(attachmentsRoot))
    const download = await app.request(drawing.url)
    const preview = await app.request(`${drawing.url}?preview=1`)
    assert({
      given: 'a successful drawing has both an inline PNG and an editable SVG in its generated evidence directory',
      should: 'retain both attachments, expose a durable download URL and refuse inline SVG rendering',
      actual: [
        result.success,
        result.method,
        attachments.map((file) => file.file),
        images.map((file) => file.url),
        drawing.name,
        drawing.url.includes('Atlas%20badge.svg'),
        await readFile(drawing.path, 'utf8'),
        download.status,
        download.headers.get('content-type'),
        download.headers.get('content-disposition')?.startsWith('attachment;'),
        download.headers.get('x-content-type-options'),
        await download.text(),
        preview.status,
        String(result.display).includes('Download editable SVG'),
        String(result.display).includes('PNG remains the inline preview'),
      ],
      expected: [
        true,
        'drawing',
        ['Atlas badge.png', 'Atlas badge.svg'],
        [image.url],
        'Atlas badge.svg',
        true,
        svg,
        200,
        'application/octet-stream',
        true,
        'nosniff',
        svg,
        415,
        true,
        true,
      ],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('An unavailable SVG artifact cannot turn a successful image generation into a failure', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sky-chat-drawing-missing-'))
  try {
    const pngPath = path.join(root, 'badge.png')
    await writeFile(pngPath, png)
    const images: ChatImage[] = []
    const attachments: Attachment[] = []
    const prepare = prepareChatImageResult({
      today: new PlainDate('2026-01-27'),
      attachmentsRoot: path.join(root, 'attachments'),
      onAttachments: (files) => attachments.push(...files),
      onImages: (files) => images.push(...files),
    })
    const result = await prepare('ai:image', {
      success: true,
      images: [pngPath],
      svgs: [path.join(root, 'missing.svg')],
      quality: 'max',
    })
    assert({
      given: 'the raster result exists but its editable companion is missing',
      should: 'keep the paid result and preview, reporting only the missing download',
      actual: [
        result.success,
        result.quality,
        images.length,
        attachments.map((file) => file.file),
        result.drawingArtifacts,
        typeof result.drawingArtifactError,
        result.previewError,
      ],
      expected: [true, 'max', 1, ['badge.png'], [], 'string', undefined],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('SVG retention is independent of a missing raster preview and never enters the image callback', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sky-chat-drawing-only-'))
  try {
    const source = path.join(root, 'badge.svg')
    await writeFile(source, svg)
    const images: ChatImage[] = []
    const attachments: Attachment[] = []
    const prepare = prepareChatImageResult({
      today: new PlainDate('2026-01-27'),
      attachmentsRoot: path.join(root, 'attachments'),
      onAttachments: (files) => attachments.push(...files),
      onImages: (files) => images.push(...files),
    })
    const result = await prepare('ai:image', {
      success: true,
      images: [path.join(root, 'missing.png')],
      svgs: [null, source],
    })
    assert({
      given: 'the PNG preview is unavailable but the editable vector is present',
      should: 'retain the vector download without presenting it as a browser image',
      actual: [
        result.success,
        images.length,
        attachments.map((file) => file.file),
        (result.drawingArtifacts as unknown[]).length,
        typeof result.previewError,
        result.drawingArtifactError,
      ],
      expected: [true, 0, ['badge.svg'], 1, 'string', undefined],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
