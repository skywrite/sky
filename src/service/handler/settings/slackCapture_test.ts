import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import * as config from '#config'
import runDueAutomations from '#lib/automations/runDue.ts'
import Automation from '#shared/models/Automation/mod.ts'
import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { createAutomationsHost } from '../automations/createAutomationsHost.ts'
import { createSlackCaptureHost, SLACK_CAPTURE_NAME } from './slackCapture.ts'

async function withNotebook(
  run: (state: {
    dir: string
    file: string
    statePath: string
    automations: ReturnType<typeof createAutomationsHost>
    capture: ReturnType<typeof createSlackCaptureHost>
  }) => Promise<void>,
) {
  const root = await mkdtemp(path.join(tmpdir(), 'slack-capture-automation-'))
  const dir = path.join(root, 'automations')
  const file = path.join(dir, `${SLACK_CAPTURE_NAME}.md`)
  const statePath = path.join(root, 'state', 'automations.json')
  const automations = createAutomationsHost(
    {
      ...config,
      DIR_BASE: root,
      DIR_STATE: path.join(root, 'state'),
      DIR_AUTOMATIONS: dir,
      FILE_AUTOMATIONS_STATE: statePath,
    },
    {},
  )
  try {
    await run({ dir, file, statePath, automations, capture: createSlackCaptureHost(automations, () => '2031-03-16') })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('Slack capture is one system automation running the existing commands every five minutes', async () => {
  await withNotebook(async ({ dir, file, statePath, capture }) => {
    const before = await capture.read()
    const enabled = await capture.update({ enabled: true })
    const automation = Automation.fromMarkdown(await readFile(file, 'utf8'), SLACK_CAPTURE_NAME)
    const calls: { run: string; args: Record<string, unknown> }[] = []
    const invoke = async ({ run, args }: { run: string; args: Record<string, unknown> }) => {
      calls.push({ run, args })
      return { outcome: 'nothing' as const }
    }
    const lengths: number[] = []
    for (const time of ['09:00', '09:04', '09:05']) {
      await runDueAutomations({ dir, statePath, systemNow: new ZonedDateTime(`2031-03-16 ${time}`, 'UTC'), invoke })
      lengths.push(calls.length)
    }
    assert({
      given: 'capture enabled for a notebook, followed by three ordinary scheduler checks',
      should: 'create one grouped five-minute system charter and run both capture-all commands only when due',
      actual: [before, enabled, automation.kind, automation.commands, lengths, calls],
      expected: [
        { name: null, enabled: false, minutes: 5, schedule: 'every 5m' },
        { name: 'slack-capture', enabled: true, minutes: 5, schedule: 'every 5m' },
        'system',
        [
          { run: 'slack:saved', args: { captureAll: true } },
          { run: 'slack:todos', args: { captureAll: true } },
        ],
        [2, 2, 4],
        [
          { run: 'slack:saved', args: { captureAll: true } },
          { run: 'slack:todos', args: { captureAll: true } },
          { run: 'slack:saved', args: { captureAll: true } },
          { run: 'slack:todos', args: { captureAll: true } },
        ],
      ],
    })
  })
})

test('Slack settings and Automations share the same interval, pause and existing charter', async () => {
  await withNotebook(async ({ dir, file, capture, automations }) => {
    await capture.update({ enabled: true })
    const renamed = path.join(dir, 'my-slack-captures.md')
    await rename(file, renamed)
    const custom =
      (await readFile(renamed, 'utf8'))
        .replace('every: 5m', 'every: 17m # Keep this comment')
        .replace('status: active', 'status: paused') + '\nKeep my instructions.\n'
    await writeFile(renamed, custom)
    const before = await capture.read()
    const changed = await capture.update({ minutes: 15 })
    const after = await readFile(renamed, 'utf8')
    await capture.update({ enabled: true })
    const configuration = await automations.configuration('my-slack-captures')
    await automations.setStatus('my-slack-captures', 'paused')
    const paused = await capture.read()
    assert({
      given: 'a renamed, paused charter customized through Automations and later edited in Slack settings',
      should: 'reuse its identity, preserve comments and instructions, and keep both surfaces in sync',
      actual: [
        before,
        changed,
        configuration?.every,
        after.includes('# Keep this comment'),
        after.endsWith('\nKeep my instructions.\n'),
        paused.enabled,
        (await automations.status()).rows.map((row) => row.name),
      ],
      expected: [
        { name: 'my-slack-captures', enabled: false, minutes: 17, schedule: 'every 17m' },
        { name: 'my-slack-captures', enabled: false, minutes: 15, schedule: 'every 15m' },
        '15m',
        true,
        true,
        false,
        ['my-slack-captures'],
      ],
    })
  })
})

test('Slack capture refuses conflicts and preserves existing files and disconnected notebooks', async () => {
  await withNotebook(async ({ dir, file, capture, automations }) => {
    await mkdir(dir, { recursive: true })
    const unrelated = '---\nrun: day:start\nevery: 1h\nstatus: paused\n---\nKeep this automation.\n'
    for (const contents of [unrelated, '---\nrun: day:start\nevery: 0m\n---\n']) {
      await writeFile(file, contents)
      const refused = await capture.update({ enabled: true }).then(
        () => false,
        () => true,
      )
      assert({
        given: 'the chosen filename belongs to another command or an unreadable charter',
        should: 'refuse to overwrite it',
        actual: [refused, await readFile(file, 'utf8')],
        expected: [true, contents],
      })
    }
    await rm(file)
    const disconnected = createSlackCaptureHost(automations, undefined, () => false)
    const refusal = await disconnected.update({ enabled: true }).then(
      () => '',
      (error: Error) => error.message,
    )
    assert({
      given: 'Slack is not configured',
      should: 'explain the prerequisite without creating an active job',
      actual: [refusal, (await automations.status()).rows.length],
      expected: ['Connect Slack before turning on automatic capture.', 0],
    })
  })
})
