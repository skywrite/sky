import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import runDueAutomations, { type Invoke, type TriggerContext } from './runDue.ts'

const EVERY_5M = `---
run: google:email:inbox:fetch
every: 5m
args:
  label: Sky/Follow
---
Keep followed mail current.
`

const WEEKDAY_0930 = `---
run: ai:task
at: EVERY-WEEKDAY 09:30
---
Report the open.
`

const PAUSED = `---
run: day:start
at: 07:00
status: paused
---
Paused for now.
`

const EXPIRED = `---
run: day:start
at: 07:00
until: 2026-08-01
---
Done with this.
`

const BROKEN = `---
run: day:start
at: EVERY-MONDAY 09:00
---
Misspelled pattern.
`

/** Monday 2026-08-24, 09:35 local */
function mondayMorning(time = '09:35'): ZonedDateTime {
  return new ZonedDateTime(new PlainDateTime(time, '2026-08-24'), 'UTC')
}

async function makeDirs(files: Record<string, string>): Promise<{ root: string; dir: string; statePath: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'run-due-test-'))
  const dir = path.join(root, 'automations')
  await mkdir(dir, { recursive: true })
  for (const [name, contents] of Object.entries(files)) await writeFile(path.join(dir, name), contents)
  return { root, dir, statePath: path.join(root, 'state', 'automations.json') }
}

/** Records what it was asked to do and reports success */
function recorder(outcome: 'acted' | 'nothing' = 'acted') {
  const calls: { run: string; args: Record<string, unknown>; context: TriggerContext }[] = []
  const invoke: Invoke = async (job) => {
    calls.push({ run: job.run, args: job.args, context: job.context })
    return { outcome }
  }
  return { calls, invoke }
}

test('runDueAutomations - runs what is owed and leaves the rest alone', async () => {
  const { root, dir, statePath } = await makeDirs({
    'email-fetch.md': EVERY_5M,
    'market-open.md': WEEKDAY_0930,
    'paused.md': PAUSED,
    'expired.md': EXPIRED,
  })

  try {
    const { calls, invoke } = recorder()
    const summary = await runDueAutomations({ dir, statePath, systemNow: mondayMorning(), invoke })

    assert({
      given: 'four charters, two of them owed a run',
      should: 'run both and stand the others down with a reason',
      actual: {
        ran: summary.ran.map((r) => r.name),
        invoked: calls.map((c) => c.run).sort(),
        stoodDown: summary.stoodDown,
        considered: summary.considered,
      },
      expected: {
        ran: ['email-fetch', 'market-open'],
        invoked: ['ai:task', 'google:email:inbox:fetch'],
        stoodDown: [
          { name: 'expired', reason: 'expired' },
          { name: 'paused', reason: 'paused' },
        ],
        considered: 4,
      },
    })

    assert({
      given: 'a charter carrying args',
      should: 'hand them to the command untouched',
      actual: calls.find((c) => c.run === 'google:email:inbox:fetch')?.args,
      expected: { label: 'Sky/Follow' },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runDueAutomations - a second pass finds nothing owed', async () => {
  const { root, dir, statePath } = await makeDirs({ 'email-fetch.md': EVERY_5M })

  try {
    const first = recorder()
    await runDueAutomations({ dir, statePath, systemNow: mondayMorning('09:35'), invoke: first.invoke })

    // Two minutes later, well inside the five-minute interval
    const second = recorder()
    const summary = await runDueAutomations({
      dir,
      statePath,
      systemNow: mondayMorning('09:37'),
      invoke: second.invoke,
    })

    assert({
      given: 'a five-minute charter asked again two minutes later',
      should: 'stay quiet, because the stamp from the first pass was kept',
      actual: { ran: summary.ran.length, invoked: second.calls.length, notDue: summary.notDue },
      expected: { ran: 0, invoked: 0, notDue: ['email-fetch'] },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runDueAutomations - hands each run its firing and how late it is', async () => {
  const { root, dir, statePath } = await makeDirs({ 'market-open.md': WEEKDAY_0930 })

  try {
    const { calls, invoke } = recorder()
    // Machine was dark all morning; first pass is at 13:00, 3h30m after the firing
    await runDueAutomations({ dir, statePath, systemNow: mondayMorning('13:00'), invoke })

    assert({
      given: 'a 09:30 firing first reached at 13:00',
      should: 'name the firing, its frame, and the lateness',
      actual: {
        target: calls[0]?.context.target,
        frame: calls[0]?.context.frame,
        lateMinutes: calls[0]?.context.lateMinutes,
      },
      expected: { target: 'EVERY-WEEKDAY 09:30', frame: 'local', lateMinutes: 210 },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runDueAutomations - records the outcome a command reports', async () => {
  const { root, dir, statePath } = await makeDirs({ 'email-fetch.md': EVERY_5M })

  try {
    const invoke: Invoke = async () => ({ outcome: 'nothing', message: 'no new mail' })
    const summary = await runDueAutomations({ dir, statePath, systemNow: mondayMorning(), invoke })

    assert({
      given: 'a command reporting there was nothing to do',
      should: 'keep that distinct from having acted',
      actual: summary.ran.map((r) => [r.outcome, r.message]),
      expected: [['nothing', 'no new mail']],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runDueAutomations - a throwing command is recorded as failed and does not stop the pass', async () => {
  const { root, dir, statePath } = await makeDirs({ 'email-fetch.md': EVERY_5M, 'market-open.md': WEEKDAY_0930 })

  try {
    const invoke: Invoke = async (job) => {
      if (job.name === 'email-fetch') throw new Error('gmail refused the token')
      return { outcome: 'acted' }
    }
    const summary = await runDueAutomations({ dir, statePath, systemNow: mondayMorning(), invoke })

    assert({
      given: 'the first charter throwing',
      should: 'record it as failed and still run the second',
      actual: summary.ran.map((r) => [r.name, r.outcome, r.message]),
      expected: [
        ['email-fetch', 'failed', 'gmail refused the token'],
        ['market-open', 'acted', undefined],
      ],
    })

    // A failure that left no stamp would be retried on every single tick
    const second = recorder()
    const again = await runDueAutomations({ dir, statePath, systemNow: mondayMorning('09:37'), invoke: second.invoke })
    assert({
      given: 'the next pass two minutes later',
      should: 'not retry the failure immediately',
      actual: again.ran.map((r) => r.name),
      expected: [],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runDueAutomations - a hung command is abandoned rather than wedging every later pass', async () => {
  const { root, dir, statePath } = await makeDirs({ 'email-fetch.md': EVERY_5M, 'market-open.md': WEEKDAY_0930 })

  try {
    const invoke: Invoke = async (job) => {
      if (job.name === 'email-fetch') await new Promise(() => {}) // never settles
      return { outcome: 'acted' }
    }
    const summary = await runDueAutomations({
      dir,
      statePath,
      systemNow: mondayMorning(),
      invoke,
      timeoutMs: 40,
    })

    assert({
      given: 'a command that never finishes',
      should: 'abandon it, record the reason, and still run the next charter',
      actual: {
        outcomes: summary.ran.map((r) => [r.name, r.outcome]),
        saysWhy: summary.ran[0]?.message?.includes('without finishing') ?? false,
      },
      expected: {
        outcomes: [
          ['email-fetch', 'failed'],
          ['market-open', 'acted'],
        ],
        saysWhy: true,
      },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runDueAutomations - an unreadable charter is reported without harming the others', async () => {
  const { root, dir, statePath } = await makeDirs({ 'email-fetch.md': EVERY_5M, 'broken.md': BROKEN })

  try {
    const { calls, invoke } = recorder()
    const summary = await runDueAutomations({ dir, statePath, systemNow: mondayMorning(), invoke })

    assert({
      given: 'a directory holding one charter with a misspelled pattern',
      should: 'run the good one and name the bad one',
      actual: {
        ran: calls.map((c) => c.run),
        errorFiles: summary.charterErrors.map((e) => path.basename(e.path)),
        saysWhy: summary.charterErrors[0]?.error.includes('EVERY-MONDAY') ?? false,
      },
      expected: { ran: ['google:email:inbox:fetch'], errorFiles: ['broken.md'], saysWhy: true },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runDueAutomations - surfaces frontmatter keys nothing reads', async () => {
  const charter = '---\nrun: day:start\nat: 09:00\ntimezone: America/New_York\n---\nA misspelled tz:.\n'
  const { root, dir, statePath } = await makeDirs({ 'typo.md': charter })

  try {
    const { invoke } = recorder()
    const summary = await runDueAutomations({ dir, statePath, systemNow: mondayMorning(), invoke })

    assert({
      given: 'a charter saying timezone: where it meant tz:',
      should: 'still run it, but report the key nothing reads',
      actual: summary.unknownKeys,
      expected: [{ name: 'typo', keys: ['timezone'] }],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runDueAutomations - a quiet pass writes no state file at all', async () => {
  const { root, dir, statePath } = await makeDirs({ 'paused.md': PAUSED })

  try {
    const { invoke } = recorder()
    await runDueAutomations({ dir, statePath, systemNow: mondayMorning(), invoke })

    assert({
      given: 'a pass where nothing was owed',
      should: 'leave the state directory untouched',
      actual: await readdir(path.dirname(statePath)).catch(() => 'no directory'),
      expected: 'no directory',
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runDueAutomations - an empty or missing directory is a quiet pass', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'run-due-empty-'))

  try {
    const { invoke } = recorder()
    const summary = await runDueAutomations({
      dir: path.join(root, 'automations'),
      statePath: path.join(root, 'state.json'),
      systemNow: mondayMorning(),
      invoke,
    })

    assert({
      given: 'no automations directory',
      should: 'do nothing without complaining',
      actual: { considered: summary.considered, ran: summary.ran.length, errors: summary.charterErrors.length },
      expected: { considered: 0, ran: 0, errors: 0 },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
