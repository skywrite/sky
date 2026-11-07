import { mkdtemp, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Hono } from 'hono'
import sharp from 'sharp'
import { assert, test } from '#test'
import { splitChatFiles, withChatFiles } from '#universal/ai/chatFiles.ts'
import { imageMarkupInstructions, type ImageMarkup } from '#universal/ai/imageMarkup.ts'
import { chatFileContext } from './files.ts'
import { FILE_CHAT_PREFS, fileChatHost } from './filesTestHelpers.ts'
import { createChatRoutes } from './mod.ts'

const markup: ImageMarkup = {
  width: 160,
  height: 100,
  marks: [
    {
      kind: 'arrow',
      points: [
        { x: 0.2, y: 0.3 },
        { x: 0.6, y: 0.7 },
      ],
      instruction: 'Make the vase blue.',
    },
  ],
  instruction: 'Keep the table.',
  format: 'webp',
}

test('Chat retains originals and paired markup through upload, transcript serialization and resend', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sky-photo-markup-'))
  try {
    const fixture = fileChatHost(root)
    const app = new Hono().route('/chat', createChatRoutes(fixture.host))
    const photo = await sharp({ create: { width: 160, height: 100, channels: 3, background: '#b7ac99' } })
      .png()
      .toBuffer()
    const form = new FormData()
    const file = new File([photo], 'Atlas [room].png', { type: 'image/png' })
    const message = imageMarkupInstructions('Please make these changes.', [file], [markup])
    form.set('message', JSON.stringify({ ...FILE_CHAT_PREFS, message }))
    form.append('files', file)
    form.set('markups', JSON.stringify([markup]))
    const response = await app.request('/chat/marked/messages', { method: 'POST', body: form })
    await response.text()
    const content = fixture.sessions.get('marked')!.turns[0]!.content
    const parsed = splitChatFiles(content)
    const ref = parsed.files[0]!
    const download = await app.request(ref.url)
    const overlay = await app.request(ref.markup!.url)
    const overlayBytes = new Uint8Array(await overlay.arrayBuffer())
    const metadata = await sharp(overlayBytes).metadata()
    const context = JSON.stringify(fixture.calls[0])
    assert({
      given: 'one annotated photo',
      should:
        'keep the original exact, retain an aligned transparent overlay and send numbered guidance with Sunburst/max',
      actual: [
        response.status,
        parsed.files.length,
        ref.name,
        ref.markup?.count,
        Buffer.from(await download.arrayBuffer()).equals(photo),
        metadata.width,
        metadata.height,
        (await sharp(overlayBytes).stats()).isOpaque,
        context.includes('markup='),
        context.includes('sunburst'),
        context.includes('Make the vase blue.'),
        withChatFiles(parsed.text, parsed.files) === content,
      ],
      expected: [200, 1, 'Atlas [room].png', 1, true, 160, 100, false, true, true, true, true],
    })
    const branchContext = chatFileContext([{ role: 'user', content }], fixture.host.attachmentsRoot!)
    assert({
      given: 'a saved or branched transcript',
      should: 'retain both the original and overlay paths for follow-up edits',
      actual: [branchContext.includes('Markup for Atlas [room].png'), branchContext.includes('Sunburst/max')],
      expected: [true, true],
    })
    const resend = await app.request('/chat/resend/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...FILE_CHAT_PREFS, message: content }),
    })
    await resend.text()
    assert({
      given: 'a restart resend with durable links and no browser files',
      should: 'restore the paired annotation layer',
      actual: [
        resend.status,
        splitChatFiles(fixture.sessions.get('resend')!.turns[0]!.content).files[0]?.markup?.count,
        JSON.stringify(fixture.calls.at(-1)).includes('markup='),
      ],
      expected: [200, 1, true],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Invalid markup fails before a model turn with an actionable photo error', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sky-photo-markup-invalid-'))
  try {
    const fixture = fileChatHost(root)
    const app = new Hono().route('/chat', createChatRoutes(fixture.host))
    const photo = await sharp({ create: { width: 160, height: 100, channels: 3, background: 'white' } })
      .png()
      .toBuffer()
    const statuses: number[] = []
    const errors: string[] = []
    for (const marks of [
      'invalid JSON',
      JSON.stringify([markup, markup]),
      JSON.stringify([{ ...markup, width: 100 }]),
    ]) {
      const form = new FormData()
      form.set('message', JSON.stringify({ ...FILE_CHAT_PREFS, message: 'Change the vase.' }))
      form.append('files', new File([photo], 'Atlas-room.png', { type: 'image/png' }))
      form.set('markups', marks)
      const response = await app.request('/chat/invalid/messages', { method: 'POST', body: form })
      statuses.push(response.status)
      errors.push((await response.json()).message)
    }
    assert({
      given: 'broken JSON, a mismatched file list or marks on a different image size',
      should: 'reject without invoking the model and identify the mismatched photo',
      actual: [
        statuses,
        fixture.calls.length,
        errors[0]?.includes('Reopen Mark up'),
        errors[2]?.includes('Atlas-room.png'),
        errors[2]?.includes('dimensions after orientation'),
      ],
      expected: [[400, 400, 400], 0, true, true, true],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
