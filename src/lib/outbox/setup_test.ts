import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import Automation from '#shared/models/Automation/mod.ts'
import { assert, test } from '#test'
import { outboxCharter, setupOutbox } from './setup.ts'

test('system automation setup preserves an existing pause and uses the ordinary charter parser', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-setup-'))
  try {
    const dir = path.join(root, 'automations')
    const state = path.join(root, 'state')
    const first = await setupOutbox(dir, state, '2025-03-15')
    const file = path.join(dir, 'outbox.md')
    const paused = (await readFile(file, 'utf8')).replace('status: active', 'status: paused')
    await writeFile(file, paused)
    const second = await setupOutbox(dir, state, '2025-03-16')
    const loaded = Automation.fromMarkdown(await readFile(file, 'utf8'), 'outbox')
    const legacy = Automation.fromMarkdown('---\nrun: day:start\nevery: 1h\n---\n', 'morning')
    assert({
      given: 'Outbox is installed twice and paused between installs',
      should: 'respect the charter without migrating legacy automations',
      actual: [first.created, second.created, loaded.kind, loaded.status, loaded.unknownKeys, legacy.kind],
      expected: [true, false, 'system', 'paused', [], 'personal'],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Outbox system charter retains a five-minute trigger', () => {
  const automation = Automation.fromMarkdown(outboxCharter('2025-03-15'), 'outbox')
  assert({
    given: 'the shipped Outbox charter',
    should: 'run the saved-message worker through the existing scheduler',
    actual: { kind: automation.kind, run: automation.run, trigger: automation.trigger.kind },
    expected: { kind: 'system', run: 'outbox:scan', trigger: 'every' },
  })
})
