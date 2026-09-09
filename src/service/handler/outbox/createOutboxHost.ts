import * as path from 'node:path'
import process from 'node:process'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import type { CommandResult } from '#commands/mod.ts'
import type * as Config from '#config'
import { createCheckProcess } from '#lib/outbox/checkProcess.ts'
import { readOptional } from '#lib/outbox/files.ts'
import { canQueueFollowups, createFollowupPlanner, reconcileFollowups } from '#lib/outbox/followups.ts'
import { OUTBOX_MODEL_LABEL } from '#lib/outbox/model.ts'
import { readScanProgress } from '#lib/outbox/progress.ts'
import { rangeKey } from '#lib/outbox/range.ts'
import { OutboxReview } from '#lib/outbox/review.ts'
import { createOutboxRuntime } from '#lib/outbox/runtime.ts'
import { createReplyComposer } from '#lib/outbox/triage.ts'
import { OutboxError, type OutboxRecord } from '#lib/outbox/types.ts'
import { runWithUsageSource } from '#shared/ai/usageLog.ts'
import { loadAutomationDir } from '#shared/models/Automation/loadAutomationDir.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import type { OutboxReport, OutboxRoutesOptions } from './mod.ts'
import { checkNativeDraft } from './native.ts'
import { createScanJob } from './scanJob.ts'

export function createOutboxHost(config: typeof Config, env: Record<string, string>): OutboxRoutesOptions {
  const { store, sources } = createOutboxRuntime(config)
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
      return runWithUsageSource('outbox:compose', () => createReplyComposer(owner)(input))
    },
    (input) => runWithUsageSource('outbox:followups', () => createFollowupPlanner()(input)),
  )

  const followupJobs = new Set<string>()
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
        items: latest.filter((item) => item.status !== 'dismissed'),
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
    save: (id, revision, draft) => review.save(id, revision, draft),
    approve: async (id, revision, draft, reviewedChanges) => {
      const item = await review.approve(id, revision, draft, reviewedChanges)
      startFollowups(item)
      return item
    },
    retryFollowups: async (id, revision) => {
      const item = await review.retryFollowups(id, revision)
      startFollowups(item)
      return item
    },
    dismiss: (id, revision) => review.dismiss(id, revision),
    preferences: (text, revision) => store.savePreferences(text, revision),
    get: (id) => store.get(id),
    compose: (id, revision, draft, instruction, reviewedChanges) =>
      review.compose(id, revision, draft, instruction, reviewedChanges),
    reportSent: (id, revision, evidence) => review.reportSent(id, revision, evidence),
  }
}
