import * as path from 'node:path'
import type { ResolvedModel } from '#shared/ai/models.ts'
import type { ModelInvoker } from '#shared/models/Chat/ChatEngine/mod.ts'
import ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { ChatRoutesOptions, ThreadRestore } from './mod.ts'
import type { ChatPlanController } from './plan.ts'

/** A real session and recovery file, with synthetic model work and no notebook access. */
export function planTestHost(
  root: string,
  work: (plan: ChatPlanController, input: Parameters<ModelInvoker>[0]) => Promise<void>,
  snapshots?: () => Promise<ThreadRestore[]>,
): ChatRoutesOptions {
  return {
    timeDir: path.join(root, 'time'),
    settings: {
      defaultModel: 'test',
      defaultContextTokens: 0,
      choices: () => [{ name: 'test', label: 'Test model', provider: 'Test', roles: ['Thinking'] }],
      resolve: () => ({ model: {} as ResolvedModel, profile: { model: 'test' } }),
    },
    snapshots,
    snapshotPath: (id) => path.join(root, `${id}.md`),
    createSession: async (id, onEvent, _prefs, _ask, restore, _runs, plan) =>
      new ChatSession({
        today: new PlainDate('2026-01-27'),
        startTime: new PlainDateTime('2026-01-27 09:30'),
        days: 0,
        baseDir: root,
        timeDir: path.join(root, 'time'),
        contextTokens: 0,
        resume: null,
        restore: restore?.state,
        parent: restore?.parent ?? null,
        model: {} as ResolvedModel,
        profile: { model: 'test' },
        ambient: { today: { date: '2026-01-27', dayOfWeek: 'Tuesday' }, health: [], prices: [] },
        producers: {
          produceInitialQuery: async () => ({ ok: true, value: { paths: [] } }),
          evolveQueries: async () => ({ ok: true, value: { queries: [], changed: false } }),
          executeQuery: async () => ({ ok: true, value: { paths: [] } }),
        },
        systemPrompt: async () => 'Test assistant.',
        tools: async () => ({ tools: plan!.tools(), toolApproval: {} }),
        approvalHandler: async () => ({ approved: false, reason: 'Unused.' }),
        autosavePath: path.join(root, `${id}.md`),
        onEvent,
        now: async () => new PlainDateTime('2026-01-27 09:31'),
        logError: async () => {},
        invokeModel: async (input) => {
          await work(plan!, input)
          return { text: '', content: [], steps: [], responseMessages: [] }
        },
      }),
  }
}

export function samplePlan() {
  return {
    revision: 0,
    title: 'Collect example documents',
    outcome: 'Checked documents together in one folder.',
    status: 'working' as const,
    note: '',
    finalCheck: '',
    artifacts: [],
    steps: [
      {
        id: 'sources',
        title: 'Confirm the sources',
        status: 'done' as const,
        kind: 'reasoning' as const,
        detail: 'The example sources are listed in this conversation.',
        evidence: [],
        items: [],
      },
      {
        id: 'collect',
        title: 'Collect documents',
        status: 'working' as const,
        kind: 'action' as const,
        detail: 'Opening the example provider.',
        evidence: [],
        items: [],
      },
      {
        id: 'check',
        title: 'Check the final set',
        status: 'pending' as const,
        kind: 'reasoning' as const,
        detail: '',
        evidence: [],
        items: [],
      },
    ],
  }
}

export const planMessage = (message: string, extra: object = {}): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message, profile: 'test', contextTokens: 0, saves: false, ...extra }),
})
