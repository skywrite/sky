import { stat } from 'node:fs/promises'
import { z } from 'zod'
import type * as Config from '#config'
import { readOptional } from '#lib/outbox/files.ts'
import { createOutboxRuntime } from '#lib/outbox/runtime.ts'
import { draftWorkstream } from '#lib/workstreams/ai.ts'
import { captureWorkstream } from '#lib/workstreams/capture.ts'
import { loadCaptureContext } from '#lib/workstreams/captureContext.ts'
import { planWorkstreamDay } from '#lib/workstreams/day.ts'
import { workstreamIdentityTime } from '#lib/workstreams/identities.ts'
import { createWorkstreamOutbox } from '#lib/workstreams/outbox.ts'
import { runWorkstream } from '#lib/workstreams/runner.ts'
import { createWorkstreamsRuntime } from '#lib/workstreams/runtime.ts'
import { setupWorkstreams } from '#lib/workstreams/setup.ts'
import { workstreamStoragePaths } from '#lib/workstreams/storagePaths.ts'
import { workstreamNow } from '#lib/workstreams/store.ts'
import { WorkstreamError } from '#lib/workstreams/types.ts'
import { loadAutomationDir } from '#shared/models/Automation/loadAutomationDir.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { WorkstreamsRoutesOptions } from './mod.ts'

export function createWorkstreamsHost(config: typeof Config): WorkstreamsRoutesOptions {
  const runtime = createWorkstreamsRuntime(config)
  const { store } = runtime
  const outboxRuntime = createOutboxRuntime(config)
  const communications = createWorkstreamOutbox({ workstreams: store, ...outboxRuntime, now: workstreamNow })
  return {
    store,
    reportDelivery: runtime.reportDelivery,
    now: workstreamNow,
    identityTime: workstreamIdentityTime,
    today: () => fetchNowSync().plainDateTime.plainDate.ymd,
    automation: async () => {
      await store.initialize()
      const { byName } = await loadAutomationDir(config.DIR_AUTOMATIONS, [
        workstreamStoragePaths(config).automationsDir,
      ])
      const job = [...byName.values()].find(({ automation }) => automation.run === 'workstreams:scan')?.automation
      return job ? { name: job.name, status: job.status } : null
    },
    setup: async () => {
      await store.initialize()
      return setupWorkstreams(config.DIR_AUTOMATIONS, store.stateDir, fetchNowSync().plainDateTime.plainDate.ymd)
    },
    capture: async (input, signal) => {
      const timeout = AbortSignal.timeout(30_000)
      const captureSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
      captureSignal.throwIfAborted()
      let today: PlainDate
      try {
        today = fetchNowSync().normalize().plainDateTime.plainDate
      } catch {
        today = PlainDate.today()
      }
      const context = await loadCaptureContext(
        {
          notebookDir: config.DIR_BASE,
          timeDir: config.DIR_TIME,
          today,
          intent: [input.intent, ...input.answers.map((answer) => answer.answer)].join('\n'),
        },
        captureSignal,
      )
      captureSignal.throwIfAborted()
      return captureWorkstream(input, context, today, captureSignal)
    },
    draft: async (intent, selected) => {
      if (selected.length > 20) throw new WorkstreamError('Choose at most 20 sources for this initial review.')
      const sources: { id: string; path: string; label: string; sensitive: boolean; content: string }[] = []
      for (const source of selected) {
        const file = await store.resolveFile(source.path)
        if (!/\.(md|txt)$/i.test(file) || (await stat(file)).size > 1_000_000)
          throw new WorkstreamError('Choose a Markdown or text source under 1 MB.')
        sources.push({ ...source, content: (await readOptional(file))?.slice(0, 12000) ?? '' })
      }
      const existing = (await store.list())
        .slice(0, 100)
        .map(({ id, title, outcome, state, parentId, relations, activities }) => ({
          id,
          title,
          outcome,
          state,
          parentId,
          relations,
          activities: activities
            .slice(0, 12)
            .map(({ id, title, outcome, state, result }) => ({ id, title, outcome, state, result })),
          omittedActivities: Math.max(0, activities.length - 12),
        }))
      return draftWorkstream({
        objective: intent,
        existing,
        sources,
        now: workstreamNow(),
        today: fetchNowSync().plainDateTime.plainDate.ymd,
      })
    },
    run: (id, request, trigger, reportingId) =>
      runWorkstream({ ...runtime, id, request, trigger, reportingId, now: workstreamNow() }),
    communications: communications.list,
    planDay: (id, activityId, day, revision) =>
      planWorkstreamDay({ store, timeDir: config.DIR_TIME, now: workstreamNow }, id, activityId, day, revision),
    outbox: (workstreamId, activityId, value) => {
      const data = z
        .object({
          revision: z.string(),
          title: z.string(),
          draft: z.string(),
          medium: z.enum(['Email', 'Slack']),
          destination: z.string().optional(),
          intentId: z.string().optional(),
          sourceRef: z.string().optional(),
          decisionIds: z.array(z.string()).optional(),
          sourceIds: z.array(z.string()).optional(),
        })
        .parse(value)
      return communications.prepare({ ...data, workstreamId, activityId })
    },
    sent: async (workstreamId, activityId, value) => {
      const data = z.object({ evidence: z.string().min(1) }).parse(value)
      const work = await store.get(workstreamId)
      const activity = work?.activities.find((item) => item.id === activityId)
      const item = activity?.outboxId ? await outboxRuntime.store.get(activity.outboxId) : null
      if (!item) throw new WorkstreamError('This activity has no linked Outbox item.', 404)
      await communications.reportSent(item.id, item.revision, data.evidence)
      return store.get(workstreamId)
    },
    response: (workstreamId, activityId, value) => {
      const data = z
        .object({ revision: z.string(), sourceRef: z.string(), result: z.string(), accepted: z.boolean() })
        .parse(value)
      return communications.reportResponse({ ...data, workstreamId, activityId })
    },
  }
}
