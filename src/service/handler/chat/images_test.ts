import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Hono } from 'hono'
import { runToolCommand } from '#commands/lib/chat/notebookTools.ts'
import { CommandResult, type CommandService } from '#commands/mod.ts'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import { assert, test } from '#test'
import { type ChatImage, imagePreviewUrl, withChatImages } from '#universal/ai/chatImages.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { chatFileContext, createChatFileRoutes } from './files.ts'
import { prepareChatImageResult } from './images.ts'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

test('Generated image results retain downloadable copies and edit references after the original moves', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sky-chat-images-'))
  try {
    const source = path.join(root, 'lighthouse.png')
    const attachmentsRoot = path.join(root, 'attachments')
    await writeFile(source, png)
    const attachments: Attachment[] = []
    const images: ChatImage[] = []
    const prepareResult = prepareChatImageResult({
      today: new PlainDate('2026-01-27'),
      attachmentsRoot,
      onAttachments: (files) => attachments.push(...files),
      onImages: (files) => images.push(...files),
    })
    const tasks = {
      run: async () => CommandResult.success({ images: [source], model: 'gpt-image-2.5-flare', quality: 'high' }),
    } as unknown as CommandService
    const result = await runToolCommand(tasks, { toolName: 'ai_image', commandName: 'ai:image' }, {}, { prepareResult })
    await rm(source)
    const artifact = (result.imageArtifacts as Array<ChatImage & { path: string }>)[0]!
    const app = new Hono().route('/chat/files', createChatFileRoutes(attachmentsRoot))
    const download = await app.request(artifact.url)
    const preview = await app.request(imagePreviewUrl(artifact))
    assert({
      given: 'a successful image tool whose original output file was removed',
      should: 'serve the retained image inline and as a download, and record its reference on the session',
      actual: [
        result.success,
        result.model,
        result.quality,
        preview.headers.get('content-type'),
        preview.headers.get('content-disposition')?.startsWith('inline;'),
        download.headers.get('content-disposition')?.startsWith('attachment;'),
        Buffer.from(await download.arrayBuffer()).equals(png),
        (await readFile(artifact.path)).equals(png),
        attachments.map((file) => file.file),
        images.map((file) => file.url),
      ],
      expected: [
        true,
        'gpt-image-2.5-flare',
        'high',
        'image/png',
        true,
        true,
        true,
        true,
        ['lighthouse.png'],
        [artifact.url],
      ],
    })
    assert({
      given: 'a filed or branched conversation containing the generated image',
      should: 'give the next model the durable local path for another edit',
      actual: chatFileContext(
        [{ role: 'assistant', content: withChatImages('Created.', images) }],
        attachmentsRoot,
      ).includes(artifact.path),
      expected: true,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Preview routes reject active content, invalid paths, and symlinks escaping the attachment root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sky-chat-image-route-'))
  try {
    const attachmentsRoot = path.join(root, 'attachments')
    const dayDir = path.join(attachmentsRoot, '2026/01/27')
    await mkdir(dayDir, { recursive: true })
    await writeFile(path.join(dayDir, 'disguised.png'), '<script>alert(1)</script>')
    await writeFile(path.join(root, 'outside.png'), png)
    await symlink(path.join(root, 'outside.png'), path.join(dayDir, 'linked.png'))
    const app = new Hono().route('/chat/files', createChatFileRoutes(attachmentsRoot))
    const statuses: number[] = []
    for (const url of [
      '/chat/files/2026-01-27/disguised.png?preview=1',
      '/chat/files/2026-01-27/linked.png?preview=1',
      '/chat/files/2026-01-27/linked.png',
      '/chat/files/2026-01-27/%2e%2e%2foutside.png?preview=1',
      '/chat/files/2026-01-27/missing.png?preview=1',
    ])
      statuses.push((await app.request(url)).status)
    assert({
      given: 'unsafe or unavailable preview targets',
      should: 'refuse them without serving arbitrary files inline',
      actual: statuses,
      expected: [415, 400, 400, 400, 404],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('A preview failure retains the successful generation outcome', async () => {
  const images: ChatImage[] = []
  const prepare = prepareChatImageResult({
    today: new PlainDate('2026-01-27'),
    attachmentsRoot: '/tmp/synthetic-attachments',
    onAttachments: () => {},
    onImages: (files) => images.push(...files),
  })
  const result = await prepare('ai:image', {
    success: true,
    images: ['/tmp/nonexistent-image-test-fixture.png'],
    model: 'gpt-image-2.5-sunburst',
    quality: 'max',
  })
  assert({
    given: 'an image was generated but cannot be retained for preview',
    should: 'report the storage failure without inviting an automatic paid retry',
    actual: [result.success, images.length, typeof result.previewError],
    expected: [true, 0, 'string'],
  })
})
