import { tool } from 'ai'
import { z } from 'zod'
import { assert, test } from '#test'
import { liveToolOutput, voiceChatTools } from './chatTools.ts'

test('voice preserves native PDF and image content instead of sending file metadata alone', () => {
  assert({
    given: 'the shared read_file model output',
    should: 'forward every text and native document part to the managed Responses backend',
    actual: liveToolOutput({
      type: 'content',
      value: [
        { type: 'text', text: 'Atlas report' },
        { type: 'file', filename: 'Atlas.pdf', mediaType: 'application/pdf', data: { type: 'data', data: 'cGRm' } },
        { type: 'file', filename: 'Atlas.png', mediaType: 'image/png', data: { type: 'data', data: 'aW1hZ2U=' } },
      ],
    }),
    expected: [
      { type: 'input_text', text: 'Atlas report' },
      { type: 'input_file', filename: 'Atlas.pdf', file_data: 'data:application/pdf;base64,cGRm' },
      { type: 'input_image', detail: 'auto', image_url: 'data:image/png;base64,aW1hZ2U=' },
    ],
  })
})

test('voice validates shared tool schemas and forwards cancellation to every executor', async () => {
  let executions = 0
  let seenSignal: AbortSignal | undefined
  const lifetime = new AbortController()
  const events: string[] = []
  const shared = {
    newly_added_chat_tool: tool({
      description: 'A tool added to chat is available in voice.',
      inputSchema: z.object({ count: z.number().int().positive() }),
      execute: async ({ count }: { count: number }, { abortSignal }: { abortSignal?: AbortSignal }) => {
        executions++
        seenSignal = abortSignal
        return { count }
      },
    }),
  }
  const { tools } = await voiceChatTools(
    {
      build: async () => ({ tools: shared, toolApproval: {}, systemInstructions: 'Shared instructions.' }),
      record: (event) => events.push(event.type),
      persist: async () => {},
      close: async () => {},
    },
    [],
    lifetime.signal,
  )
  let invalid = ''
  try {
    await tools.get('newly_added_chat_tool')!.run({ count: -1 })
  } catch (error) {
    invalid = String(error)
  }
  await tools.get('newly_added_chat_tool')!.run({ count: 2 }, undefined, 'delegation', 'call')
  lifetime.abort()
  let stopped = false
  try {
    await tools.get('newly_added_chat_tool')!.run({ count: 3 })
  } catch {
    stopped = true
  }
  assert({
    given: 'a newly registered tool, invalid input, and a stopped call',
    should: 'share the tool automatically, reject invalid input, and honor cancellation',
    actual: [
      [...tools.keys()],
      invalid.includes('Invalid newly_added_chat_tool arguments'),
      executions,
      seenSignal?.aborted,
      stopped,
      events,
    ],
    expected: [['newly_added_chat_tool'], true, 1, true, true, ['tool-execution-start', 'tool-execution-end']],
  })
})
