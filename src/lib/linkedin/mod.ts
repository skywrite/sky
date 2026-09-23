import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import { readJson, writeJson } from '#lib/jobs/files.ts'
import { createProcessJob, type JobRecord } from '#lib/jobs/mod.ts'
import { linkedInUrl, type LinkedInDraft, type LinkedInImport, type LinkedInImportHost } from './types.ts'
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
  const view = async (job: JobRecord<LinkedInDraft, LinkedInInput>): Promise<LinkedInImport> => ({
    id: job.id,
    url: job.input.url,
    status: job.status,
    stage: (await readJson<{ stage: string }>(job.input.progressFile))?.stage ?? 'Opening LinkedIn…',
    ...(job.result ? { draft: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
  })
  return {
    async start(value) {
      const url = linkedInUrl(value)
      const token = randomUUID()
      const job = await jobs.start({
        url,
        profileDir: path.join(dir, 'browser'),
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
  }
}
