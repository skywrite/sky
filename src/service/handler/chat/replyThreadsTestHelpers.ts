import * as path from 'node:path'
import type { ModelMessage } from 'ai'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { exists } from '#shared/fs/mod.ts'
import type { ModelInvoker } from '#shared/models/Chat/ChatEngine/mod.ts'
import ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import type { ToolFactory } from '#shared/models/Chat/ChatSession/mod.ts'
import { chatAutosaveFilename, listChatAutosaves } from '#shared/models/Chat/ChatStore/autosave.ts'
import { loadResumeSession } from '#shared/models/Chat/ChatStore/mod.ts'
import { setUserSpeakerLabel } from '#shared/models/Chat/document/mod.ts'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { interruptedOf } from './interrupted.ts'
import type { ChatRoutesOptions, ThreadRestore } from './mod.ts'
import { restoreToolRuns } from './toolRuns.ts'

export const REPLY_TEST_DAY = new PlainDate('2026-02-04')
const START = new PlainDateTime('2026-02-04 10:00')
const MODEL = 'test-thread-model'

export interface ReplyTestCall {
  id: string
  messages: ModelMessage[]
  reply: boolean
}

/** Real chat sessions and persistence with deterministic specialist results; never calls an external service. */
export function replyThreadTestHost(
  baseDir: string,
  over: {
    calls?: ReplyTestCall[]
    wait?: (call: ReplyTestCall) => Promise<void>
    tools?: ToolFactory
    invokeModel?: ModelInvoker
    systemPrompt?: string
  } = {},
): ChatRoutesOptions {
  setUserSpeakerLabel('Jane')
  const stateDir = path.join(baseDir, 'state')
  const timeDir = path.join(baseDir, 'time')
  const snapshotPath = (id: string, start: PlainDateTime) => path.join(stateDir, chatAutosaveFilename(start, id))
  const openSaved: NonNullable<ChatRoutesOptions['openSaved']> = async (file) => {
    const absolute = path.resolve(baseDir, file)
    if (!absolute.startsWith(`${timeDir}${path.sep}`) || !(await exists(absolute))) return null
    return { resume: await loadResumeSession(absolute, { baseDir }), startTime: START }
  }
  return {
    timeDir,
    attachmentsRoot: path.join(baseDir, 'attachments'),
    snapshotPath,
    openSaved,
    title: async (turns) => turns.find((turn) => turn.role === 'user')?.content.slice(0, 64) ?? 'Conversation',
    settings: {
      defaultModel: MODEL,
      defaultContextTokens: 0,
      choices: () => [{ name: MODEL, label: 'Test model', provider: 'Test', roles: ['Thinking'] }],
      resolve: (name) => {
        if (name !== MODEL) throw new Error('Unknown test model')
        return { model: {} as ResolvedModel, profile: { provider: 'test', model: name } }
      },
      profileFor: () => MODEL,
    },
    endDefaults: {
      autoTag: false,
      autoRel: false,
      memoryDir: null,
      people: false,
      enricher: {
        summarize: async () => 'Mock conversation',
        chooseTags: async () => undefined,
        chooseRel: async () => undefined,
      },
    },
    snapshots: async () => {
      const restores: ThreadRestore[] = []
      for (const ref of await listChatAutosaves(stateDir)) {
        const loaded = await loadResumeSession(ref.path, { baseDir, snapshot: true })
        const { state, interrupted } = interruptedOf(loaded.state)
        const host = loaded.recovery?.host
        const saved = typeof host?.saved === 'string' ? await openSaved(host.saved) : null
        restores.push({
          id: ref.session,
          startTime: ref.startTime,
          state,
          interrupted,
          parent: loaded.parent,
          parentId: typeof host?.parentId === 'string' ? host.parentId : null,
          runs: restoreToolRuns(host?.runs),
          title: typeof host?.title === 'string' ? host.title : null,
          approvals: loaded.approvals,
          attachments: loaded.attachments,
          prefs: { profile: MODEL, contextTokens: 0, saves: typeof host?.saves === 'boolean' ? host.saves : true },
          ...(saved ? { resume: { ...saved.resume, state } } : {}),
        })
      }
      return restores
    },
    createSession: async (id, onEvent, prefs, ask, restore) =>
      new ChatSession({
        today: REPLY_TEST_DAY,
        startTime: restore?.startTime ?? START,
        days: 7,
        baseDir,
        timeDir,
        contextTokens: 0,
        resume: restore?.resume ?? null,
        restore: restore?.resume ? undefined : restore?.state,
        parent: restore?.resume ? null : restore?.parent,
        attachments: restore?.attachments,
        model: {} as ResolvedModel,
        profile: { provider: 'test', model: MODEL },
        producers: {
          produceInitialQuery: async () => ({ ok: true, value: { paths: [] } }),
          evolveQueries: async () => ({ ok: true, value: { queries: [], changed: false } }),
          executeQuery: async () => ({ ok: true, value: { paths: [] } }),
        },
        ambient: { today: { date: REPLY_TEST_DAY.ymd, dayOfWeek: 'Wednesday' }, health: [], prices: [] },
        systemPrompt: async () => over.systemPrompt ?? 'Synthetic chat for thread verification.',
        tools: over.tools ?? (async () => ({ tools: {}, toolApproval: {} })),
        approvalHandler: async ({ toolName }) => ask({ toolName, lines: ['Synthetic document update'] }),
        approvals: () => [...(restore?.approvals ?? [])],
        autosavePath: snapshotPath(id, restore?.startTime ?? START),
        onEvent,
        fetchContext: async () => [],
        now: async () => START,
        logError: async () => {},
        invokeModel:
          over.invokeModel ??
          (async (args) => {
            const isReply = (restore?.parent ?? restore?.resume?.parent)?.kind === 'thread'
            const call = { id, messages: structuredClone(args.messages), reply: isReply }
            over.calls?.push(call)
            const toolName = isReply ? 'me_voice' : 'legal_review'
            const toolCallId = `${id}-${args.messages.length}`
            const input = { task: isReply ? 'Draft the team response' : 'Review the mock agreements' }
            onEvent({ type: 'tool-execution-start', toolName, toolCallId, input, phase: 'running', started: 1000 })
            await over.wait?.(call)
            const text = isReply
              ? '> Dear team,\n>\n> I have reviewed all five agreements. Please align the shared terms before the next draft.\n>\n> Thank you.'
              : 'All five agreements have been reviewed together.\n\nThe shared terms need to be aligned before we draft the team response.'
            const output = {
              success: true,
              review: 'Mock contracts A, B, C, D and E share a defined term.',
              ...(isReply ? { draft: text } : {}),
            }
            onEvent({ type: 'tool-execution-end', toolName, toolCallId, output, finished: 2000 })
            args.sink.write(text)
            return {
              text,
              content: [],
              steps: [],
              responseMessages: [
                { role: 'assistant', content: [{ type: 'tool-call', toolName, toolCallId, input }] },
                {
                  role: 'tool',
                  content: [{ type: 'tool-result', toolName, toolCallId, output: { type: 'json', value: output } }],
                },
                { role: 'assistant', content: text },
              ],
              usage: {
                inputTokens: 80,
                outputTokens: 20,
                totalTokens: 100,
                inputTokenDetails: { noCacheTokens: 80, cacheReadTokens: 0, cacheWriteTokens: 0 },
                outputTokenDetails: { textTokens: 20, reasoningTokens: 0 },
              },
            }
          }),
      }),
  }
}
