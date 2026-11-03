import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import { readJson, writeJson } from '#lib/jobs/files.ts'
import { createProcessJob, type JobRecord } from '#lib/jobs/mod.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import {
  linkedInUrl,
  type LinkedInDraft,
  type LinkedInImport,
  type LinkedInImportHost,
  type LinkedInImportPhase,
} from './types.ts'
import type { LinkedInInput } from './worker.ts'

export function createLinkedInHost(
  config: { DIR_STATE: string; DIR_BASE: string; DIR_CODE: string; DIR_USER_DATA: string },
  env: Record<string, string>,
): LinkedInImportHost {
  const dir = path.join(config.DIR_STATE, 'linkedin')
  const jobs = createProcessJob<LinkedInInput, LinkedInDraft>({
    dir: path.join(dir, 'jobs'),
    module: new URL('./worker.ts', import.meta.url),
    env: { ...env, SKY_DIR: config.DIR_BASE, SKY_CODE_DIR: config.DIR_CODE, SKY_DATA_DIR: config.DIR_USER_DATA },
  })
  // Kept with the job state, not in a browser tab, so a dismissed notice stays gone in new tabs and after restarts.
  const dismissedFile = path.join(dir, 'dismissed.json')
  const view = async (job: JobRecord<LinkedInDraft, LinkedInInput>): Promise<LinkedInImport> => {
    const [progress, dismissed] = await Promise.all([
      readJson<{ stage: string; phase?: LinkedInImportPhase; startedAt?: number }>(job.input.progressFile),
      readJson<{ id: string }>(dismissedFile),
    ])
    return {
      id: job.id,
      url: job.input.url,
      status: job.status,
      stage: progress?.stage ?? 'Opening LinkedIn…',
      phase: progress?.phase,
      elapsedSeconds:
        typeof progress?.startedAt === 'number'
          ? Math.max(0, Math.floor((ZonedDateTime.now().epochMilliseconds - progress.startedAt) / 1000))
          : undefined,
      ...(job.result ? { draft: job.result } : {}),
      ...(job.error ? { error: job.error } : {}),
      ...(dismissed?.id === job.id ? { dismissed: true } : {}),
    }
  }
  return {
    async start(value) {
      const url = linkedInUrl(value)
      const token = randomUUID()
      const job = await jobs.start({
        url,
        progressFile: path.join(dir, 'progress', `${token}.json`),
        cancelFile: path.join(dir, 'cancel', `${token}.json`),
      })
      if (job.input.url !== url && job.status === 'running')
        throw new Error('Another LinkedIn profile is being imported. Finish or cancel that import first.')
      return view(job)
    },
    async status() {
      const job = await jobs.status()
      return job ? view(job) : null
    },
    async cancel(id) {
      const job = await jobs.status()
      if (job?.id === id && job.status === 'running') await writeJson(job.input.cancelFile, { cancelled: true })
    },
    async dismiss(id) {
      const job = await jobs.status()
      // An older tab dismissing an earlier import must not bring back a newer one that was dismissed.
      if (job?.id === id) await writeJson(dismissedFile, { id })
    },
  }
}
