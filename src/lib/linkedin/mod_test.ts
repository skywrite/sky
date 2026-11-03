import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { writeJson } from '#lib/jobs/files.ts'
import { jobFile, type JobRecord } from '#lib/jobs/mod.ts'
import { assert, test } from '#test'
import { createLinkedInHost } from './mod.ts'
import type { LinkedInDraft } from './types.ts'
import type { LinkedInInput } from './worker.ts'

const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'

test('a dismissed LinkedIn import stays dismissed, and a newer import is offered', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-linkedin-host-test-'))
  const config = { DIR_STATE: root, DIR_BASE: root, DIR_CODE: root, DIR_USER_DATA: root }
  const jobs = path.join(root, 'linkedin', 'jobs')
  // Stands in for a worker that already finished
  const finish = async (id: string) => {
    const url = 'https://www.linkedin.com/in/jane-doe-example/'
    const record: JobRecord<LinkedInDraft, LinkedInInput> = {
      id,
      status: 'complete',
      owner: process.pid,
      input: {
        url,
        progressFile: path.join(root, `${id}-progress.json`),
        cancelFile: path.join(root, `${id}-cancel.json`),
      },
      result: { url, name: 'Jane Doe', title: 'Design lead', location: 'Portland', about: '', current: [], past: [] },
    }
    await writeJson(jobFile(jobs, id), record)
    await writeJson(path.join(jobs, 'current.json'), { id })
  }
  try {
    await finish(first)
    const host = createLinkedInHost(config, {})
    const offered = await host.status()
    await host.dismiss(first)
    const reopened = await createLinkedInHost(config, {}).status()
    assert({
      given: 'a finished import dismissed once',
      should: 'stay dismissed for a fresh host, as in a new tab or after a service restart',
      actual: [offered?.dismissed, reopened?.status, reopened?.dismissed],
      expected: [undefined, 'complete', true],
    })

    await finish(second)
    const newer = await host.status()
    await host.dismiss(second)
    // An older tab still showing the earlier import
    await host.dismiss(first)
    assert({
      given: 'a newer import, dismissed, then an older tab dismissing the earlier import',
      should: 'offer the newer import until it is dismissed, then keep it dismissed',
      actual: [newer?.dismissed, (await host.status())?.dismissed],
      expected: [undefined, true],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
