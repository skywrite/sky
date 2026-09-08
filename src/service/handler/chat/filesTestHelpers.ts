import * as path from 'node:path'
import type { ModelMessage } from 'ai'
import type { ResolvedModel } from '#shared/ai/models.ts'
import ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { ChatRoutesOptions, ThreadRestore } from './mod.ts'

export const FILE_CHAT_PREFS = { profile: 'test', contextTokens: 0, saves: true }
export const FILE_CHAT_REPLY = 'The proposal includes a two-week pilot.'

/** Real sessions and file storage, with the model and clock replaced by synthetic fixtures. */
export function fileChatHost(root: string, snapshots: ThreadRestore[] = []) {
  const calls: ModelMessage[][] = []
  const sessions = new Map<string, ChatSession>()
  const snapshotPath = (id: string) => path.join(root, 'state', `${id}.md`)
  const host: ChatRoutesOptions = {
    timeDir: path.join(root, 'time'),
    attachmentsRoot: path.join(root, 'attachments'),
    snapshotPath,
    snapshots: async () => snapshots,
    settings: {
      defaultModel: 'test',
      defaultContextTokens: 0,
      choices: () => [{ name: 'test', label: 'Test model', provider: 'Test', roles: ['Thinking'] }],
      resolve: () => ({ model: {} as ResolvedModel, profile: { provider: 'test', model: 'test' } }),
    },
    endDefaults: {
      autoTag: false,
      autoRel: false,
      enricher: {
        summarize: async () => 'Atlas proposal',
        chooseTags: async () => undefined,
        chooseRel: async () => undefined,
      },
    },
    createSession: async (id, onEvent, prefs, _ask, restore) => {
      const session = new ChatSession({
        today: new PlainDate('2026-01-27'),
        startTime: restore?.startTime ?? new PlainDateTime('2026-01-27 09:30'),
        days: 0,
        baseDir: root,
        timeDir: path.join(root, 'time'),
        contextTokens: prefs.contextTokens ?? 0,
        resume: null,
        restore: restore?.state,
        attachments: restore?.attachments,
        model: {} as ResolvedModel,
        profile: { provider: 'test', model: 'test' },
        producers: {
          produceInitialQuery: async () => ({ ok: true, value: { paths: [] } }),
          evolveQueries: async () => ({ ok: true, value: { queries: [], changed: false } }),
          executeQuery: async () => ({ ok: true, value: { paths: [] } }),
        },
        ambient: { today: { date: '2026-01-27', dayOfWeek: 'Tuesday' }, health: [], prices: [] },
        systemPrompt: async () => 'Discuss the attached documents.',
        tools: async () => ({ tools: {}, toolApproval: {} }),
        approvalHandler: async () => ({ approved: true, reason: 'test' }),
        autosavePath: snapshotPath(id),
        onEvent,
        invokeModel: async ({ messages, sink }) => {
          calls.push(structuredClone(messages))
          sink.write(FILE_CHAT_REPLY)
          return {
            text: FILE_CHAT_REPLY,
            content: [],
            steps: [],
            responseMessages: [{ role: 'assistant', content: FILE_CHAT_REPLY }],
          }
        },
        fetchContext: async () => [],
        now: async () => new PlainDateTime('2026-01-27 09:31'),
        logError: async () => {},
      })
      sessions.set(id, session)
      return session
    },
  }
  return { host, calls, sessions, snapshotPath }
}
