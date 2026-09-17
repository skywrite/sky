import { writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { ModelMessage } from 'ai'
import { runToolCommand } from '#commands/lib/chat/notebookTools.ts'
import { CommandResult, type CommandService } from '#commands/mod.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { chatFileContext } from './files.ts'
import { fileChatHost } from './filesTestHelpers.ts'
import { prepareChatImageResult } from './images.ts'

/** Real sessions, tool adaptation, uploads and storage; synthetic model and raster bytes. */
export function imageChatHost(root: string) {
  const { host, snapshotPath } = fileChatHost(root)
  const calls: Array<{ messages: ModelMessage[]; files: string }> = []
  let releaseFirst = () => {}
  const firstReply = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  )
  host.createSession = async (id, onEvent, prefs, _ask, restore) => {
    const today = new PlainDate('2026-01-27')
    let prepareResult: ReturnType<typeof prepareChatImageResult>
    const session = new ChatSession({
      today,
      startTime: restore?.startTime ?? new PlainDateTime('2026-01-27 09:30'),
      days: 0,
      baseDir: root,
      timeDir: host.timeDir,
      contextTokens: prefs.contextTokens ?? 0,
      resume: null,
      restore: restore?.state,
      attachments: restore?.attachments,
      model: {} as ResolvedModel,
      profile: { model: 'test' },
      producers: {
        produceInitialQuery: async () => ({ ok: true, value: { paths: [] } }),
        evolveQueries: async () => ({ ok: true, value: { queries: [], changed: false } }),
        executeQuery: async () => ({ ok: true, value: { paths: [] } }),
      },
      ambient: { today: { date: today.ymd, dayOfWeek: 'Tuesday' }, health: [], prices: [] },
      systemPrompt: async () => 'Create or edit the requested image.',
      tools: async ({ onAttachments, onImages }) => {
        prepareResult = prepareChatImageResult({
          today,
          attachmentsRoot: host.attachmentsRoot!,
          onAttachments,
          onImages,
        })
        return { tools: {}, toolApproval: {} }
      },
      approvalHandler: async () => ({ approved: true, reason: 'test' }),
      autosavePath: snapshotPath(id),
      onEvent,
      invokeModel: async ({ messages, sink }) => {
        calls.push({
          messages: structuredClone(messages),
          files: chatFileContext(session.turns, host.attachmentsRoot!),
        })
        const count = calls.length
        const source = path.join(root, `lighthouse-${count}.png`)
        await writeFile(source, png)
        const tasks = {
          run: async () => CommandResult.success({ images: [source], model: 'gpt-image-2.5-flare', quality: 'high' }),
        } as unknown as CommandService
        const toolName = 'ai_image'
        const toolCallId = `image-${count}`
        onEvent({
          type: 'tool-execution-start',
          toolName,
          toolCallId,
          started: 1,
          phase: 'running',
          input: { prompt: 'A lighthouse illustration' },
        })
        const output = await runToolCommand(tasks, { toolName, commandName: 'ai:image' }, {}, { prepareResult })
        onEvent({ type: 'tool-execution-end', toolName, toolCallId, finished: 2, output })
        if (count === 1) await firstReply
        const text = `Here is image ${count}.`
        sink.write(text)
        return { text, content: [], steps: [], responseMessages: [{ role: 'assistant', content: text }] }
      },
      fetchContext: async () => [],
      now: async () => new PlainDateTime('2026-01-27 09:31'),
      logError: async () => {},
    })
    return session
  }
  return { host, calls, releaseFirst: () => releaseFirst() }
}
