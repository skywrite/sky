import * as path from 'node:path'
import process from 'node:process'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import type { CommandResult } from '#commands/mod.ts'
import type * as Config from '#config'
import { createCheckProcess } from '#lib/outbox/checkProcess.ts'
import { createComposeProcess } from '#lib/outbox/composeProcess.ts'
import { readOptional } from '#lib/outbox/files.ts'
import { canQueueFollowups, createFollowupPlanner, reconcileFollowups } from '#lib/outbox/followups.ts'
import { OUTBOX_MODEL_LABEL } from '#lib/outbox/model.ts'
import { readScanProgress } from '#lib/outbox/progress.ts'
import { rangeKey } from '#lib/outbox/range.ts'
import { OutboxReview } from '#lib/outbox/review.ts'
import { createOutboxRuntime } from '#lib/outbox/runtime.ts'
import { createReplyComposer } from '#lib/outbox/triage.ts'
import { OutboxError, type OutboxRecord } from '#lib/outbox/types.ts'
import { captureOutboxRevision } from '#lib/writingVoice/outbox.ts'
import { createWritingVoice } from '#lib/writingVoice/runtime.ts'
import { runWithUsageSource } from '#shared/ai/usageLog.ts'
import { loadAutomationDir } from '#shared/models/Automation/loadAutomationDir.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import type { OutboxReport, OutboxRoutesOptions } from './mod.ts'
import { checkNativeDraft } from './native.ts'
import { createScanJob } from './scanJob.ts'

export function createOutboxHost(
  config: typeof Config,
  env: Record<string, string>,
  options: { composeInProcess?: boolean } = {},
): OutboxRoutesOptions {
  const { store, sources } = createOutboxRuntime(config)
  const voice = createWritingVoice(config)
  const learningJobs = new Set<string>()
  const startLearning = (id: string) => {
    if (learningJobs.has(id)) return
    learningJobs.add(id)
    void runWithUsageSource('me:voice:learn', () => voice.prepare(id))
      .catch(() => {})
      .finally(() => learningJobs.delete(id))
  }
  const learnRevision = async (before: OutboxRecord | null, after: OutboxRecord, accepted = false) => {
    if (!before) return after
    try {
      const example = await captureOutboxRevision(voice, before, after, accepted)
      if (example && !example.question && !example.lesson && !example.error) startLearning(example.id)
      return after
    } catch (error) {
      return {
        ...after,
        writingVoiceError: `Your draft is saved, but the writing example could not be saved: ${error instanceof Error ? error.message : 'unknown error'}`,
      }
    }
  }
  const service = () => new CommandService(CommandContext.server(config, env))
  const automation = async () => {
    const { byName } = await loadAutomationDir(config.DIR_AUTOMATIONS)
    return [...byName.values()].find(({ automation }) => automation.run === 'outbox:scan')?.automation ?? null
  }
  const requireSuccess = <T>(result: CommandResult<T>): T => {
    if (result.status !== 'success' || !result.data)
      throw new OutboxError(result.message ?? 'Outbox could not complete this step.')
    return result.data
  }
  const scanJob = createScanJob(createCheckProcess(config, env, store), () => readScanProgress(store))
  const review = new OutboxReview(
    store,
    sources,
    async (item) => {
      const target = item.conversation.target
      if (!target) throw new OutboxError('No native destination is available.')
      const commands = service()
      if (target.medium === 'Email') {
        const data = item.native
          ? requireSuccess(
              await commands.run('google:email:draft:update', {
                draftId: item.native.id,
                body: item.draft,
                account: target.account,
                noOpen: true,
              }),
            )
          : requireSuccess(
              await commands.run('google:email:draft:reply', {
                thread: target.thread,
                body: item.draft,
                account: target.account,
                noOpen: true,
              }),
            )
        return { id: data.draftId, url: data.url }
      }
      const data = item.native
        ? requireSuccess(await commands.run('slack:draft:update', { draftId: item.native.id, text: item.draft }))
        : requireSuccess(await commands.run('slack:draft:reply', { link: target.link, text: item.draft, noOpen: true }))
      return { id: data.draftId ?? '', url: data.url ?? target.link }
    },
    () => new ZonedDateTime().toUTC().normalize().plainDateTime.toString(),
    (item) =>
      checkNativeDraft(item, {
        workspace: config.SLACK_WORKSPACE ?? '',
        secrets: CommandContext.server(config, env).secrets,
      }),
    async (input) => {
      const owner = ((await readOptional(config.FILE_ABOUT_ME)) ?? '').slice(0, 16_000)
      return runWithUsageSource('outbox:compose', () =>
        createReplyComposer(owner, undefined, (draft) => voice.draft(draft))(input),
      )
    },
    (input) =>
      runWithUsageSource('outbox:followups', () =>
        createFollowupPlanner(undefined, (draft) => voice.draft(draft))(input),
      ),
  )

  const followupJobs = new Set<string>()
  const composition = createComposeProcess(config, env, store, (id, revision, draft, instruction) =>
    review.prepareCompose(id, revision, draft, instruction),
  )
  const startFollowups = (item: OutboxRecord) => {
    if (
      followupJobs.has(item.id) ||
      !canQueueFollowups(item) ||
      !['pending', 'preparing'].includes(item.followupStatus ?? '')
    )
      return
    followupJobs.add(item.id)
    void review
      .completeFollowups(item.id)
      .catch(() => {})
      .finally(() => followupJobs.delete(item.id))
  }

  return {
    report: async () => {
      for (const example of await voice.store.list()) {
        if (
          example.source.startsWith('outbox:') &&
          !example.lesson &&
          !example.error &&
          (!example.question || example.answer)
        )
          startLearning(example.id)
      }
      const [items, preferences, job, last, check] = await Promise.all([
        store.list(),
        store.preferences(),
        automation(),
        readOptional(path.join(store.stateDir, 'last-scan.json')),
        scanJob.status(),
      ])
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.status !== 'placing' || !item.placementOwner) continue
        try {
          process.kill(item.placementOwner, 0)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue
          items[i] = await store.put(
            {
              ...item,
              status: 'placement_unknown',
              placementError: 'Sky restarted before draft placement could be confirmed. Check the native app.',
            },
            item.revision,
          )
        }
      }
      for (const item of items) {
        startFollowups(item)
        await reconcileFollowups(store, item)
      }
      const latest = await store.list()
      return {
        items: await Promise.all(latest.filter((item) => item.status !== 'dismissed').map(composition.decorate)),
        followupsRunning: latest.some(
          (item) => canQueueFollowups(item) && ['pending', 'preparing'].includes(item.followupStatus ?? ''),
        ),
        preferences,
        automation: job ? { name: job.name, status: job.status } : null,
        lastScan: last ? (JSON.parse(last) as OutboxReport['lastScan']) : null,
        check,
        search: await store.scanRange(new ZonedDateTime().date),
        today: new ZonedDateTime().date,
        modelLabel: OUTBOX_MODEL_LABEL,
      }
    },
    setup: async () => requireSuccess(await service().run('outbox:setup', {})),
    scan: async (selection) => {
      const job = await automation()
      if (!job) throw new OutboxError('Enable Outbox first.')
      if (selection) {
        const check = await scanJob.status()
        if (check.running) {
          const runningRange = check.progress?.range ?? (await store.scanRange(new ZonedDateTime().date)).value
          if (rangeKey(runningRange) !== rangeKey(selection.range))
            throw new OutboxError('A check is already running. Wait for it to finish before changing the range.', 409)
          return scanJob.start()
        }
        await store.saveScanRange(selection.range, selection.revision, new ZonedDateTime().date)
      }
      return scanJob.start()
    },
    save: async (id, revision, draft) => {
      const before = await store.get(id)
      return learnRevision(before, await review.save(id, revision, draft))
    },
    approve: async (id, revision, draft, reviewedChanges) => {
      const before = await store.get(id)
      const item = await review.approve(id, revision, draft, reviewedChanges)
      startFollowups(item)
      return learnRevision(before, item, true)
    },
    retryFollowups: async (id, revision) => {
      const item = await review.retryFollowups(id, revision)
      startFollowups(item)
      return item
    },
    dismiss: (id, revision) => review.dismiss(id, revision),
    preferences: (text, revision) => store.savePreferences(text, revision),
    get: async (id) => {
      const item = await store.get(id)
      return item ? composition.decorate(item) : null
    },
    compose: (id, revision, draft, instruction, reviewedChanges) =>
      options.composeInProcess
        ? review.composePrepared(id, revision, instruction, reviewedChanges)
        : composition.start(id, revision, draft, instruction, reviewedChanges),
    reportSent: async (id, revision, evidence) => {
      const before = await store.get(id)
      const item = await review.reportSent(id, revision, evidence)
      return learnRevision(before, item, true)
    },
  }
}
