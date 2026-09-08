import { mkdtemp, readdir, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Hono } from 'hono'
import { loadResumeSession } from '#shared/models/Chat/ChatStore/mod.ts'
import { assert, test } from '#test'
import { MAX_CHAT_FILE_BYTES, splitChatFiles } from '#universal/ai/chatFiles.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { chatFileContext } from './files.ts'
import { FILE_CHAT_PREFS, fileChatHost } from './filesTestHelpers.ts'
import { createChatRoutes } from './mod.ts'

function upload(files: File[], message = 'Read the proposal.') {
  const body = new FormData()
  body.set('message', JSON.stringify({ ...FILE_CHAT_PREFS, message }))
  for (const file of files) body.append('files', file)
  return { method: 'POST', body }
}

test('chat uploads carry document contents, keep original bytes, and survive recovery and closing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sky-chat-files-test-'))
  try {
    const fixture = fileChatHost(root)
    const app = new Hono().route('/chat', createChatRoutes(fixture.host))
    const proposal = '# Atlas proposal\nA two-week pilot with a demo on Friday.'
    const pdf = '%PDF-1.4\nSynthetic PDF fixture\n%%EOF'
    const response = await app.request(
      '/chat/demo/messages',
      upload([
        new File([proposal], 'Atlas [proposal].md'),
        new File([pdf], 'Atlas.pdf', { type: 'application/pdf' }),
        new File([new Uint8Array([137, 80, 78, 71])], 'diagram.png', { type: 'image/png' }),
      ]),
    )
    const stream = await response.text()
    const first = fixture.calls[0]?.[0]
    const parts = first && Array.isArray(first.content) ? first.content : []
    const turn = fixture.sessions.get('demo')!.turns[0]!
    const clipped = splitChatFiles(turn.content)
    assert({
      given: 'a text proposal, PDF and image sent while notebook context is closed',
      should: 'attach the actual contents to the first model call and publish durable clips on the user message',
      actual: {
        status: response.status,
        sent: stream.includes('event: user-message'),
        text: parts.some((part) => part.type === 'text' && part.text.includes(proposal)),
        pdf: parts.some(
          (part) =>
            part.type === 'file' &&
            part.mediaType === 'application/pdf' &&
            typeof part.data === 'string' &&
            Buffer.from(part.data, 'base64').toString() === pdf,
        ),
        image: parts.some((part) => part.type === 'image' && part.mediaType === 'image/png'),
        textOnly: clipped.text,
        names: clipped.files.map((file) => file.name),
      },
      expected: {
        status: 200,
        sent: true,
        text: true,
        pdf: true,
        image: true,
        textOnly: 'Read the proposal.',
        names: ['Atlas [proposal].md', 'Atlas.pdf', 'diagram.png'],
      },
    })
    const download = await app.request(clipped.files[0]!.url)
    assert({
      given: 'a clip is opened',
      should: 'download the original bytes',
      actual: {
        text: await download.text(),
        download: download.headers.get('content-disposition')?.startsWith('attachment;'),
      },
      expected: { text: proposal, download: true },
    })

    const saved = await loadResumeSession(fixture.snapshotPath('demo'), { baseDir: root, snapshot: true })
    const restored = fileChatHost(root, [
      {
        id: 'demo',
        prefs: FILE_CHAT_PREFS,
        startTime: new PlainDateTime('2026-01-27 09:30'),
        state: saved.state,
        attachments: saved.attachments,
      },
    ])
    const restarted = new Hono().route('/chat', createChatRoutes(restored.host))
    const followup = await restarted.request('/chat/demo/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...FILE_CHAT_PREFS, message: 'What is the pilot length?', continuing: true }),
    })
    await followup.text()
    assert({
      given: 'the service restarts and the next message names no file',
      should: 'keep the earlier file content in model history and the clip in the transcript',
      actual: {
        restoredContent: JSON.stringify(restored.calls[0]).includes(proposal.replaceAll('\n', '\\n')),
        clips: splitChatFiles(restored.sessions.get('demo')!.turns[0]!.content).files,
        attachments: saved.attachments?.length,
      },
      expected: { restoredContent: true, clips: clipped.files, attachments: 3 },
    })
    const end = await restarted.request('/chat/demo/end', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ save: true }),
    })
    const ended = (await end.json()) as { saved: { path: string } }
    const filed = await loadResumeSession(ended.saved.path, { baseDir: root })
    assert({
      given: 'the conversation is saved and closed',
      should: 'keep the clipped files downloadable',
      actual: {
        status: end.status,
        saved: Boolean(ended.saved),
        attachments: filed.attachments.length,
        reread: chatFileContext(filed.state.conversation, fixture.host.attachmentsRoot!).includes(
          path.join(root, 'attachments/2026/01/27/2026-01-27_Chat_Atlas-proposal.md'),
        ),
        download: (await restarted.request(clipped.files[0]!.url)).status,
      },
      expected: { status: 200, saved: true, attachments: 3, reread: true, download: 200 },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('chat rejects unusable uploads before a model turn and can send a file without text', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sky-chat-file-errors-'))
  try {
    const fixture = fileChatHost(root)
    const app = new Hono().route('/chat', createChatRoutes(fixture.host))
    const cases = [
      [new File([], 'empty.txt')],
      [new File([new Uint8Array([0, 1, 2])], 'archive.bin')],
      Array.from({ length: 11 }, (_, i) => new File(['notes'], `notes-${i}.md`)),
      [new File([new Uint8Array(MAX_CHAT_FILE_BYTES + 1)], 'large.pdf')],
    ]
    const statuses: number[] = []
    for (const files of cases) statuses.push((await app.request('/chat/demo/messages', upload(files))).status)
    const malformed = new FormData()
    malformed.set('message', '{bad')
    malformed.set('files', new File(['notes'], 'notes.txt'))
    statuses.push((await app.request('/chat/demo/messages', { method: 'POST', body: malformed })).status)
    assert({
      given: 'empty, binary, too many, oversized files, or malformed message metadata',
      should: 'return readable errors without invoking the model',
      actual: { statuses, calls: fixture.calls.length },
      expected: { statuses: [400, 400, 400, 400, 400], calls: 0 },
    })
    const read = await app.request('/chat/demo/messages', upload([new File(['Pilot terms.'], '../Atlas.md')], ''))
    await read.text()
    const message = fixture.sessions.get('demo')!.turns[0]!.content
    assert({
      given: 'a file alone with a path in its browser name',
      should: 'read it under a safe filename and supply a default prompt',
      actual: {
        status: read.status,
        text: splitChatFiles(message).text,
        copies: await readdir(path.join(root, 'attachments/2026/01/27')),
      },
      expected: { status: 200, text: 'Read the attached files.', copies: ['2026-01-27_Chat_Atlas.md'] },
    })
    const resend = await app.request('/chat/resend/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...FILE_CHAT_PREFS, message }),
    })
    await resend.text()
    assert({
      given: 'an interrupted message is sent again using only its durable link',
      should: 'reread the attachment without the original browser file or another copy',
      actual: {
        read: JSON.stringify(fixture.calls[1]).includes('Pilot terms.'),
        copies: (await readdir(path.join(root, 'attachments/2026/01/27'))).length,
      },
      expected: { read: true, copies: 1 },
    })
    assert({
      given: 'an encoded path traversal in a file link',
      should: 'refuse to read outside day attachments',
      actual: (await app.request('/chat/files/2026-01-27/..%2Fprivate.txt')).status,
      expected: 400,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
