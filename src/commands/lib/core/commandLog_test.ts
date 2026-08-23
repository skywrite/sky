import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { configureLogging, resetLogging } from '#shared/log.ts'
import { assert, test } from '#test'
import { beginCommandRun, type CommandRunFields } from './commandLog.ts'

/**
 * Drive a run and read back the records it wrote.
 *
 * Writes only under the OS temp dir — never the real log directory.
 */
function capture(fields: CommandRunFields, close: (run: ReturnType<typeof beginCommandRun>) => void) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sky-cmdlog-test-'))
  try {
    resetLogging()
    configureLogging({ stream: 'cli', dir })
    close(beginCommandRun(fields))
    resetLogging()
    const raw = readdirSync(dir)
      .map((name) => readFileSync(path.join(dir, name), 'utf8'))
      .join('')
      .trim()
    return raw === '' ? [] : raw.split('\n').map((line) => JSON.parse(line) as Record<string, any>)
  } finally {
    resetLogging()
    rmSync(dir, { recursive: true, force: true })
  }
}

test('a command run writes a start record and an end record', () => {
  const records = capture({ command: 'day:start', depth: 0 }, (run) => run.finish({ status: 'success' }))
  assert({
    given: 'a run that finished',
    should: 'write exactly one start and one end record',
    actual: records.map((r) => r.event),
    expected: ['command-start', 'command'],
  })
})

test('the parent command is recorded so a run can be attributed', () => {
  const records = capture({ command: 'day:start', parent: 'automate:daily', depth: 1 }, (run) =>
    run.finish({ status: 'success' }),
  )
  assert({
    given: 'a run triggered by another command',
    should: 'name the parent on both records',
    actual: records.map((r) => ({ parent: r.parent, depth: r.depth })),
    expected: [
      { parent: 'automate:daily', depth: 1 },
      { parent: 'automate:daily', depth: 1 },
    ],
  })
})

test('a headless dispatch records no parent', () => {
  const records = capture({ command: 'slack:follow:check', depth: 0 }, (run) => run.finish({ status: 'success' }))
  assert({
    given: 'a run with no invoking command',
    should: 'leave the parent field absent rather than inventing one',
    actual: records.map((r) => r.parent ?? null),
    expected: [null, null],
  })
})

test("nested runs stay at info so an automator's work is not hidden", () => {
  const records = capture({ command: 'util:weather', parent: 'automate:daily', depth: 3 }, (run) =>
    run.finish({ status: 'success' }),
  )
  assert({
    given: 'a deeply nested run',
    should: 'log at info, not debug',
    actual: records.map((r) => r.level),
    expected: ['INFO', 'INFO'],
  })
})

test('a failing result is recorded as its own outcome, not an error', () => {
  const records = capture({ command: 'day:start', depth: 0 }, (run) => run.finish({ status: 'fail' }))
  assert({
    given: 'a command that returned fail',
    should: 'record outcome fail and stay at info — a fail is a legitimate answer',
    actual: { outcome: records[1]!.outcome, level: records[1]!.level },
    expected: { outcome: 'fail', level: 'INFO' },
  })
})

test('an error result is recorded at error level', () => {
  const records = capture({ command: 'day:start', depth: 0 }, (run) => run.finish({ status: 'error' }))
  assert({
    given: 'a command that returned error',
    should: 'record outcome error so it survives a raised log level',
    actual: { outcome: records[1]!.outcome, level: records[1]!.level },
    expected: { outcome: 'error', level: 'ERROR' },
  })
})

test('a command returning nothing counts as success', () => {
  const records = capture({ command: 'legacy:command', depth: 0 }, (run) => run.finish(undefined))
  assert({
    given: 'a legacy command that returns no result',
    should: 'treat it as success, matching how command-runner reads an absent result',
    actual: records[1]!.outcome,
    expected: 'success',
  })
})

test('a thrown failure keeps its message and stack', () => {
  const records = capture({ command: 'day:start', depth: 0 }, (run) =>
    run.fail(new Error('boom', { cause: new Error('root') })),
  )
  const end = records[1]!
  assert({
    given: 'a run that threw',
    should: 'record error level, the message, and the cause chain',
    actual: {
      level: end.level,
      outcome: end.outcome,
      message: end.error.message,
      cause: end.error.cause.message,
    },
    expected: { level: 'ERROR', outcome: 'error', message: 'boom', cause: 'root' },
  })
})

test('a non-Error throw is still recorded', () => {
  const records = capture({ command: 'day:start', depth: 0 }, (run) => run.fail({ code: 'ENOENT', why: 'gone' }))
  assert({
    given: 'a thrown value that is not an Error',
    should: 'record it rather than dropping the failure',
    actual: records[1]!.error,
    expected: { code: 'ENOENT', why: 'gone' },
  })
})

test('an unclosed run leaves only a start record', () => {
  const records = capture({ command: 'day:start', depth: 0 }, () => {
    // Deliberately never closed — this is the hang fingerprint.
  })
  assert({
    given: 'a run that never finished',
    should: 'leave a start with no end, which is how a hang is detected',
    actual: records.map((r) => r.event),
    expected: ['command-start'],
  })
})

test('both records carry the pid so a hung run can be traced to a process', () => {
  const records = capture({ command: 'day:start', depth: 0 }, (run) => run.finish({ status: 'success' }))
  assert({
    given: 'any run',
    should: 'stamp both records with this process id',
    actual: records.map((r) => r.pid),
    expected: [process.pid, process.pid],
  })
})

test('the end record carries a duration', () => {
  const records = capture({ command: 'day:start', depth: 0 }, (run) => run.finish({ status: 'success' }))
  assert({
    given: 'a finished run',
    should: 'report a numeric duration',
    actual: typeof records[1]!.durationMs === 'number' && records[1]!.durationMs >= 0,
    expected: true,
  })
})
