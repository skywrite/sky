import * as path from 'node:path'
import type { ModelMessage } from 'ai'
import { WritingVoice } from '#lib/writingVoice/agent.ts'
import { writingDraftBrief, writingDraftTools } from '#lib/writingVoice/draftChat.ts'
import { WritingDraftStore } from '#lib/writingVoice/drafts.ts'
import { WritingVoiceStore } from '#lib/writingVoice/store.ts'
import { intelligence } from '#lib/writingVoice/testHelpers.ts'
import { createWritingVoiceTools } from '#lib/writingVoice/tools.ts'
import type { VoiceDraftInput } from '#lib/writingVoice/types.ts'
import { replyThreadTestHost } from './replyThreadsTestHelpers.ts'

export const ORIGINAL_DRAFT = 'Hi Jane,\n\nThe Atlas draft is ready. Please review it with the launch team.\n\nThanks.'
export const EDITED_DRAFT = 'Hi Jane,\n\nThe Atlas draft is ready. Please review it by Friday.\n\nThanks.'
export const WARM_DRAFT =
  'Hi Jane,\n\nThe Atlas draft is ready. I would appreciate your review by Friday.\n\nThanks for your help.'

/** The HTTP routes, tools, writer and persistence are real; only model answers are scripted. */
export function writingDraftTestHost(
  root: string,
  calls: {
    inputs?: VoiceDraftInput[]
    briefs?: string[]
    draft?: (input: VoiceDraftInput) => string
    reply?: (text: string) => string
  } = {},
) {
  const voice = new WritingVoice(new WritingVoiceStore(root, path.join(root, 'voice-state')), {
    ...intelligence,
    draft: async (input) => {
      calls.inputs?.push(input)
      return calls.draft?.(input) ?? (/warmer/i.test(input.instruction ?? '') ? WARM_DRAFT : input.meaning)
    },
    question: async (example) => ({
      before: example.original.slice(0, 499),
      after: example.revised.slice(0, 499),
      question: 'What should Sky learn from this change?',
      options: ['Make the requested action explicit.', 'This wording only fits this situation.'],
    }),
  })
  const drafts = new WritingDraftStore(voice, undefined, async () => 'Atlas Review')
  let execute: (input: unknown) => Promise<Record<string, unknown>>
  let currentId: string | undefined
  let currentRevision: number | undefined
  const host = replyThreadTestHost(root, {
    tools: async (hooks) => {
      const tools = createWritingVoiceTools(voice, {
        source: 'chat:fixture',
        drafts: writingDraftTools(hooks, drafts, 'chat:fixture'),
      })
      execute = (tools.me_voice as { execute: typeof execute }).execute
      currentId = hooks.writingDrafts?.focus() ?? hooks.writingDrafts?.list().at(-1)?.id
      currentRevision = currentId ? (await drafts.require(currentId)).revision : undefined
      const instructions = await writingDraftBrief(hooks, drafts)
      calls.briefs?.push(instructions)
      return { tools, toolApproval: {}, instructions }
    },
    invokeModel: async (args) => {
      const last = args.messages.findLast((message) => message.role === 'user')
      const direction =
        typeof last?.content === 'string'
          ? last.content
          : (last?.content
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n') ?? '')
      const input = {
        action: 'draft',
        meaning: ORIGINAL_DRAFT,
        medium: 'Email',
        recipient: 'Jane Doe',
        instruction: direction,
        ...(currentId ? { draftId: currentId, draftRevision: currentRevision } : { newDraft: true }),
      }
      const result = await execute(input)
      if (!result.success) throw new Error(String(result.error))
      const text =
        calls.reply?.(String(result.draft)) ??
        `Here is the message.\n\n> ${String(result.draft).replaceAll('\n', '\n> ')}\n\nPlease check the timing before sending.`
      args.sink.write(text)
      const toolCallId = `mock-writing-${args.messages.length}`
      const responseMessages: ModelMessage[] = [
        { role: 'assistant', content: [{ type: 'tool-call', toolName: 'me_voice', toolCallId, input }] },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolName: 'me_voice',
              toolCallId,
              output: {
                type: 'json',
                value: {
                  success: true,
                  draft: String(result.draft),
                  draftId: String(result.draftId),
                  draftRevision: Number(result.draftRevision),
                  rulesRevision: String(result.rulesRevision),
                },
              },
            },
          ],
        },
        { role: 'assistant', content: text },
      ]
      return { text, content: [], steps: [], responseMessages }
    },
  })
  return { ...host, writingDrafts: drafts }
}
