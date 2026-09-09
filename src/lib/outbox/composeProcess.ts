import * as path from 'node:path'
import type * as Config from '#config'
import { withProcessLock } from '#lib/jobs/files.ts'
import { createProcessJob, type JobRecord } from '#lib/jobs/mod.ts'
import type { OutboxStore } from './store.ts'
import { OutboxError, type OutboxRecord } from './types.ts'

export type ComposeProcessInput = {
  id: string
  revision: string
  submittedRevision: string
  draft: string
  instruction: string
  direction?: NonNullable<OutboxRecord['replyDirections']>[number]
  reviewedChanges: boolean
}

type PrepareCompose = (id: string, revision: string, draft: string, instruction: string) => Promise<OutboxRecord>

export function createComposeProcess(
  config: typeof Config,
  env: Record<string, string>,
  store: OutboxStore,
  prepare: PrepareCompose,
  options: { module?: string | URL } = {},
) {
  const directory = (id: string) => {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new OutboxError('Invalid Outbox item.', 404)
    return path.join(store.stateDir, 'compose-jobs', id)
  }
  const job = (id: string) =>
    createProcessJob<ComposeProcessInput, OutboxRecord>({
      dir: directory(id),
      module: options.module ?? new URL('./composeWorker.ts', import.meta.url),
      env: {
        ...env,
        SKY_DIR: config.DIR_BASE,
        SKY_DATA_DIR: config.DIR_USER_DATA,
        SKY_CODE_DIR: config.DIR_CODE,
        SKY_INPUT_DIR: config.DIR_INPUT,
        SKY_OUTPUT_DIR: config.DIR_OUTPUT,
      },
    })
  const decorateWith = (item: OutboxRecord, current: JobRecord<OutboxRecord, ComposeProcessInput> | null) => {
    const direction = item.replyDirections?.at(-1)
    // A later request can reuse the conversation ID. Only report work belonging
    // to this saved instruction; source refreshes may change the conversation itself.
    if (
      !current ||
      !direction ||
      direction.text !== current.input.instruction ||
      (current.input.direction &&
        (direction.at !== current.input.direction.at ||
          direction.sourceVersion !== current.input.direction.sourceVersion)) ||
      (current.status === 'complete' && item.draft !== current.result?.draft) ||
      (current.status === 'failed' && item.draft !== current.input.draft)
    )
      return item
    return {
      ...item,
      composition: {
        id: current.id,
        status: current.status,
        revision: current.input.revision,
        submittedRevision: current.input.submittedRevision,
        ...(current.error ? { error: current.error } : {}),
      },
    }
  }
  const get = async (id: string) => {
    const item = await store.get(id)
    if (!item) throw new OutboxError('This decision is no longer available.', 404)
    return item
  }
  return {
    async decorate(item: OutboxRecord): Promise<OutboxRecord> {
      const current = await job(item.id).status()
      // The worker can finish while status is read; pair its status with the latest draft.
      return decorateWith(current ? await get(item.id) : item, current)
    },
    start: (
      id: string,
      revision: string,
      draft: string,
      instruction: string,
      reviewedChanges = false,
    ): Promise<OutboxRecord> =>
      withProcessLock(path.join(directory(id), 'startup'), async () => {
        const execution = job(id)
        const active = await execution.status()
        if (active?.status === 'running') {
          const sameRequest =
            [active.input.submittedRevision, active.input.revision].includes(revision) &&
            active.input.draft === draft.trim() &&
            active.input.instruction === instruction.trim() &&
            active.input.reviewedChanges === reviewedChanges
          if (!sameRequest)
            throw new OutboxError('Sky is already revising this draft. Wait for it to finish before trying again.', 409)
          return decorateWith(await get(id), active)
        }
        // Persist the owner's words before handing model work to another process.
        const saved = await prepare(id, revision, draft, instruction)
        const accepted = await execution.start({
          id,
          revision: saved.revision,
          submittedRevision: revision,
          draft: saved.draft,
          instruction: instruction.trim(),
          direction: saved.replyDirections?.at(-1),
          reviewedChanges,
        })
        return decorateWith(await get(id), accepted)
      }),
  }
}
