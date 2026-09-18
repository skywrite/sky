import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import AutomationsStatusTask from '#commands/all/automations/status.ts'
import type * as Config from '#config'
import { readOptional, withLock } from '#lib/outbox/files.ts'
import { workstreamsCharter } from '#lib/workstreams/setup.ts'
import { workstreamStoragePaths } from '#lib/workstreams/storagePaths.ts'
import { assert, test } from '#test'
import { createAutomationsHost } from './createAutomationsHost.ts'
import { createAutomationRoutes } from './mod.ts'

test('managed charters remain readable, editable and pausable without recreating notebook copies', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-managed-charter-'))
  try {
    const config = {
      DIR_BASE: path.join(root, 'notebook'),
      DIR_STATE: path.join(root, 'state'),
      DIR_AUTOMATIONS: path.join(root, 'notebook', 'automations'),
      FILE_AUTOMATIONS_STATE: path.join(root, 'state', 'automations.json'),
    } as typeof Config
    const managed = workstreamStoragePaths(config).automationsDir
    await mkdir(path.join(managed, 'system'), { recursive: true })
    const file = path.join(managed, 'system', 'review-work.md')
    const contents = workstreamsCharter('2025-03-15')
    await writeFile(file, contents)
    const host = createAutomationsHost(config, {})
    const app = createAutomationRoutes(host)
    const response = await app.request('http://localhost/automation/review-work/file')
    const missing = await app.request('http://localhost/automation/missing/file')
    const traversal = await app.request('http://localhost/automation/%2E%2E%2Fprivate/file')
    const pause = await host.setStatus('review-work', 'paused')
    const setup = await host.configuration('review-work')
    const status = await new AutomationsStatusTask().run({
      args: { verbose: false },
      context: { config, output: { log() {} } },
    } as unknown as Parameters<AutomationsStatusTask['run']>[0])
    const paused = (await readFile(file, 'utf8')).replace('every: 5m', 'every: 15m')
    const saved = await host.save('review-work', paused)
    const duplicate = await host.create('review-work', contents)
    assert({
      given: 'a managed charter nested outside the notebook',
      should: 'serve only discovered identities, preserve pause/edit behavior and reject duplicate creation',
      actual: [
        response.status,
        await response.text(),
        missing.status,
        traversal.status,
        pause,
        setup?.commands[0]?.run,
        status.data?.rows.map(({ name, managed, file, state }) => ({ name, managed, file, state })),
        saved,
        await readFile(file, 'utf8'),
        duplicate,
        await readOptional(path.join(config.DIR_AUTOMATIONS, 'review-work.md')),
      ],
      expected: [
        200,
        contents,
        404,
        404,
        true,
        'workstreams:scan',
        [{ name: 'review-work', managed: true, file: path.join('system', 'review-work.md'), state: 'paused' }],
        { kind: 'saved' },
        paused,
        { kind: 'exists' },
        undefined,
      ],
    })
    const created = await host.create('workstream-review', contents)
    const ordinary = contents.replace('workstreams:scan', 'day:start')
    await host.create('morning-start', ordinary)
    assert({
      given: 'new workstream and ordinary automations created through the generic automation UI',
      should: 'write only the workstream charter to managed state and retain ordinary notebook charters',
      actual: [
        created,
        await readFile(path.join(managed, 'workstream-review.md'), 'utf8'),
        await readOptional(path.join(config.DIR_AUTOMATIONS, 'workstream-review.md')),
        await readFile(path.join(config.DIR_AUTOMATIONS, 'morning-start.md'), 'utf8'),
      ],
      expected: [{ kind: 'created' }, contents, undefined, ordinary],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an automation edit waits for migration and finds the moved charter before saving', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-managed-charter-'))
  try {
    const config = {
      DIR_BASE: path.join(root, 'notebook'),
      DIR_STATE: path.join(root, 'state'),
      DIR_AUTOMATIONS: path.join(root, 'notebook', 'automations'),
    } as typeof Config
    const paths = workstreamStoragePaths(config)
    await mkdir(config.DIR_AUTOMATIONS, { recursive: true })
    await mkdir(paths.automationsDir, { recursive: true })
    const legacy = path.join(config.DIR_AUTOMATIONS, 'review-work.md')
    const moved = path.join(paths.automationsDir, 'review-work.md')
    await writeFile(legacy, workstreamsCharter('2025-03-15'))
    const host = createAutomationsHost(config, {})
    let pause: Promise<boolean> | undefined
    let finished = false
    await withLock(path.join(paths.stateDir, 'storage.lock'), async () => {
      pause = host.setStatus('review-work', 'paused').then((result) => {
        finished = true
        return result
      })
      await new Promise((resolve) => setTimeout(resolve, 40))
      assert({
        given: 'a migration holding the shared storage lock',
        should: 'defer the charter edit',
        actual: finished,
        expected: false,
      })
      await rename(legacy, moved)
    })
    await pause
    assert({
      given: 'the charter moved while its pause action waited',
      should: 'pause the relocated file and leave no stale notebook copy',
      actual: [finished, (await readFile(moved, 'utf8')).includes('status: paused'), await readOptional(legacy)],
      expected: [true, true, undefined],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
