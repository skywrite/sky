import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { readOptional } from '#lib/outbox/files.ts'
import Automation from '#shared/models/Automation/mod.ts'
import { assert, test } from '#test'
import { setupWorkstreams, workstreamsCharter } from './setup.ts'

test('workstream setup uses the existing scheduler and preserves an existing pause', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-workstreams-setup-'))
  try {
    const dir = path.join(root, 'automations')
    const state = path.join(root, 'state')
    const first = await setupWorkstreams(dir, state, '2025-03-15')
    const file = path.join(state, 'automations', 'workstreams.md')
    await writeFile(file, (await readFile(file, 'utf8')).replace('status: active', 'status: paused'))
    const second = await setupWorkstreams(dir, state, '2025-03-16')
    const charter = Automation.fromMarkdown(await readFile(file, 'utf8'), 'workstreams')
    assert({
      given: 'setup called twice with a user pause in between',
      should: 'preserve the ordinary system charter and its pause',
      actual: [
        first.created,
        second.created,
        charter.run,
        charter.kind,
        charter.status,
        charter.unknownKeys,
        await readOptional(path.join(dir, 'workstreams.md')),
      ],
      expected: [true, false, 'workstreams:scan', 'system', 'paused', [], undefined],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('workstream setup discovers a renamed paused legacy charter during migration without creating another', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-workstreams-setup-'))
  try {
    const dir = path.join(root, 'notebook', 'automations')
    const state = path.join(root, 'state')
    await mkdir(path.join(dir, 'system'), { recursive: true })
    const contents = workstreamsCharter('2025-03-15').replace('status: active', 'status: paused')
    const file = path.join(dir, 'system', 'review-work.md')
    await writeFile(file, contents)
    const result = await setupWorkstreams(dir, state, '2025-03-16')
    assert({
      given: 'an existing renamed workstream charter paused in the notebook',
      should: 'preserve its identity and exact contents instead of enabling a replacement',
      actual: [
        result,
        await readFile(file, 'utf8'),
        await readOptional(path.join(state, 'automations', 'workstreams.md')),
      ],
      expected: [{ created: false, name: 'review-work' }, contents, undefined],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
