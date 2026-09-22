import * as path from 'node:path'
import type { ModelMessage } from 'ai'
import { WritingVoice } from '#lib/writingVoice/agent.ts'
import { writingDraftBrief, writingDraftTools } from '#lib/writingVoice/draftChat.ts'
import { WritingDraftStore } from '#lib/writingVoice/drafts.ts'
import { WritingVoiceStore } from '#lib/writingVoice/store.ts'
import { intelligence } from '#lib/writingVoice/testHelpers.ts'
import { createWritingVoiceTools } from '#lib/writingVoice/tools.ts'
import type { VoiceDraftInput } from '#lib/writingVoice/types.ts'
import { unsavedDraftsOf } from './drafts.ts'
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
    tools: async (hooks, thread) => {
      const unsaved = () =>
        unsavedDraftsOf(thread.id, drafts, thread.runs, thread.started)(hooks.writingDrafts?.list() ?? [])
      const tools = createWritingVoiceTools(drafts, {
        source: 'chat:fixture',
        drafts: writingDraftTools(hooks, drafts, unsaved),
      })
      execute = (tools.me_voice as { execute: typeof execute }).execute
      const instructions = await writingDraftBrief(hooks, drafts, await unsaved())
      // The scripted model reads its brief as a real one does: the selected draft, else the latest listed.
      const listed = JSON.parse(instructions.slice(instructions.lastIndexOf('\n') + 1)) as {
        selected?: string
        drafts: { draftId: string; draftRevision?: number; unavailable?: boolean }[]
      }
      const target =
        listed.drafts.find((draft) => draft.draftId === listed.selected && !draft.unavailable) ??
        listed.drafts.findLast((draft) => !draft.unavailable)
      currentId = target?.draftId
      currentRevision = target?.draftRevision
      calls.briefs?.push(instructions)
      return { tools, toolApproval: {}, instructions }
    },
    invokeModel: async (args, report) => {
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
      const toolCallId = `mock-writing-${args.messages.length}`
      report({ type: 'tool-execution-start', toolName: 'me_voice', toolCallId, input, phase: 'running', started: 1000 })
      const result = await execute(input)
      report({ type: 'tool-execution-end', toolName: 'me_voice', toolCallId, output: result, finished: 2000 })
      if (!result.success) throw new Error(String(result.error))
      const text =
        calls.reply?.(String(result.draft)) ??
        `Here is the message.\n\n> ${String(result.draft).replaceAll('\n', '\n> ')}\n\nPlease check the timing before sending.`
      args.sink.write(text)
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
                  // Only a draft the owner has used has a record to name.
                  ...(result.draftId
                    ? { draftId: String(result.draftId), draftRevision: Number(result.draftRevision) }
                    : {}),
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
