import { assert, test } from '#test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  beginEvent,
  configureLogging,
  getDailyFileSink,
  logger,
  resetLogging,
  resolveLevel,
  safeJsonLinesFormatter,
  sweepLogs,
} from './log.ts'
import type { LogLevel } from './log.ts'

// A fixed instant (2026-01-15T12:00:00Z) so date math in tests is
// deterministic and no test ever reads the clock.
const NOW_MS = Date.UTC(2026, 0, 15, 12, 0, 0)
const DAY_MS = 86_400_000

/**
 * Log into a throwaway directory and read back the records that landed.
 *
 * Always writes under the OS temp dir — never the real log directory.
 */
function capture(write: () => void, level?: LogLevel): Record<string, any>[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sky-log-test-'))
  try {
    resetLogging()
    configureLogging({ stream: 'service', dir, level })
    write()
    resetLogging()
    const files = readdirSync(dir).filter((name) => name.startsWith('service.'))
    const raw = files
      .map((name) => readFileSync(path.join(dir, name), 'utf8'))
      .join('')
      .trim()
    return raw === '' ? [] : raw.split('\n').map((line) => JSON.parse(line))
  } finally {
    resetLogging()
    rmSync(dir, { recursive: true, force: true })
  }
}

/** A synthetic LogRecord for driving sinks and formatters directly. */
function record(overrides: Record<string, unknown> = {}): any {
  return {
    category: ['sky', 'test'],
    level: 'info',
    message: ['hello'],
    rawMessage: 'hello',
    timestamp: NOW_MS,
    properties: {},
    ...overrides,
  }
}

test('an error logged directly keeps its message and stack', () => {
  const [rec] = capture(() => logger('sync').error(new Error('write failed')))
  assert({
    given: 'an Error passed straight to error()',
    should: 'record its name and message rather than an empty object',
    actual: { name: rec.error.name, message: rec.error.message },
    expected: { name: 'Error', message: 'write failed' },
  })
  assert({
    given: 'an Error passed straight to error()',
    should: 'preserve a non-empty stack',
    actual: typeof rec.error.stack === 'string' && rec.error.stack.length > 0,
    expected: true,
  })
})

test('an error cause chain survives serialization', () => {
  const [rec] = capture(() => logger('sync').error(new Error('write failed', { cause: new Error('disk full') })))
  assert({
    given: 'an Error whose cause is another Error',
    should: 'serialize the cause with its own message',
    actual: rec.error.cause.message,
    expected: 'disk full',
  })
})

test('an AggregateError keeps every aggregated error', () => {
  const [rec] = capture(() => logger('sync').error(new AggregateError([new Error('a'), new Error('b')], 'both failed')))
  assert({
    given: 'an AggregateError with two members',
    should: 'serialize each member message',
    actual: rec.error.errors.map((e: { message: string }) => e.message),
    expected: ['a', 'b'],
  })
})

test('a circular property does not discard the record', () => {
  const circular: Record<string, unknown> = { name: 'loop' }
  circular.self = circular
  const records = capture(() => logger('sync').warn('circular payload', { circular }))
  assert({
    given: 'a property containing a reference to itself',
    should: 'still write the record, marking the cycle',
    actual: records.map((r) => r.circular),
    expected: [{ name: 'loop', self: '[Circular]' }],
  })
})

test('a BigInt property does not discard the record', () => {
  const records = capture(() => logger('sync').warn('bigint payload', { n: 1n }))
  assert({
    given: 'a property holding a BigInt',
    should: 'write the record with the value stringified',
    actual: records.map((r) => r.n),
    expected: ['1n'],
  })
})

test('a value repeated across sibling branches is not mistaken for a cycle', () => {
  const shared = { id: 7 }
  const cyclic: Record<string, unknown> = { left: shared, right: shared }
  cyclic.self = cyclic
  const [rec] = capture(() => logger('sync').warn('shared payload', { cyclic }))
  assert({
    given: 'the same object referenced twice on separate branches',
    should: 'serialize it in full both times',
    actual: { left: rec.cyclic.left, right: rec.cyclic.right },
    expected: { left: { id: 7 }, right: { id: 7 } },
  })
})

test('properties are flattened to the top of the record', () => {
  const [rec] = capture(() => logger('heartbeat').info('Checked {count} follow(s)', { count: 3 }))
  assert({
    given: 'a message template with a placeholder',
    should: 'render the message and flatten the value to a top-level field',
    actual: { message: rec.message, count: rec.count, nested: rec.properties },
    expected: { message: 'Checked 3 follow(s)', count: 3, nested: undefined },
  })
})

test('a property colliding with a record key is prefixed, not clobbering', () => {
  const [rec] = capture(() => logger('sync').info('collision', { level: 'boss', message: 'custom' }))
  assert({
    given: 'properties named "level" and "message"',
    should: 'keep the record fields and move the properties under a prefix',
    actual: { level: rec.level, message: rec.message, _level: rec._level, _message: rec._message },
    expected: { level: 'INFO', message: 'collision', _level: 'boss', _message: 'custom' },
  })
})

test('a subsystem logger writes a queryable category', () => {
  const [rec] = capture(() => logger('heartbeat').info('woken'))
  assert({
    given: 'logger("heartbeat")',
    should: 'namespace the record under the sky root',
    actual: rec.logger,
    expected: 'sky.heartbeat',
  })
})

test('every record carries a UTC timestamp', () => {
  const [rec] = capture(() => logger('sync').info('tick'))
  assert({
    given: 'any record',
    should: 'stamp it with a UTC ISO-8601 time, immune to a local timezone flip',
    actual: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(rec['@timestamp']),
    expected: true,
  })
})

test('records below the configured level are dropped', () => {
  const records = capture(() => {
    const log = logger('sync')
    log.debug('too quiet')
    log.info('loud enough')
  }, 'info')
  assert({
    given: 'a debug record while the level is info',
    should: 'write only the info record',
    actual: records.map((r) => r.message),
    expected: ['loud enough'],
  })
})

test('the daily file is named for the stream and the UTC date', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sky-log-test-'))
  try {
    resetLogging()
    configureLogging({ stream: 'service', dir })
    logger('sync').info('tick')
    resetLogging()
    assert({
      given: 'one record through the configured sink',
      should: 'create exactly one service.<date>.jsonl file',
      actual: readdirSync(dir).map((name) => /^service\.\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)),
      expected: [true],
    })
  } finally {
    resetLogging()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the sink rolls to a new file when a record crosses midnight UTC', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sky-log-test-'))
  try {
    const sink = getDailyFileSink(dir, 'service', { formatter: safeJsonLinesFormatter })
    sink(record({ timestamp: NOW_MS }))
    sink(record({ timestamp: NOW_MS + DAY_MS }))
    sink[Symbol.dispose]()
    assert({
      given: 'two records a day apart',
      should: 'write two date-named files, one line each',
      actual: readdirSync(dir)
        .sort()
        .map((name) => [name, readFileSync(path.join(dir, name), 'utf8').trim().split('\n').length]),
      expected: [
        ['service.2026-01-15.jsonl', 1],
        ['service.2026-01-16.jsonl', 1],
      ],
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the sweep deletes files past retention and spares the rest', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sky-log-test-'))
  try {
    // 91 days before NOW_MS (2026-01-15) is 2025-10-16; 89 days is 2025-10-18.
    writeFileSync(path.join(dir, 'service.2025-10-16.jsonl'), 'old\n')
    writeFileSync(path.join(dir, 'cli.2025-10-16.jsonl'), 'old\n')
    writeFileSync(path.join(dir, 'service.2025-10-18.jsonl'), 'young\n')
    writeFileSync(path.join(dir, 'unrelated.txt'), 'keep\n')
    sweepLogs(dir, NOW_MS)
    assert({
      given: 'files on both sides of the 90-day cutoff, across streams',
      should: 'delete only the log files past retention',
      actual: readdirSync(dir).sort(),
      expected: ['service.2025-10-18.jsonl', 'unrelated.txt'],
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the sweep enforces the size cap oldest-first, sparing today', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sky-log-test-'))
  try {
    // Three ~200 MiB files against the 500 MiB cap: the oldest must go, and
    // today's file must survive even while the total still exceeds the cap.
    const big = 'x'.repeat(200 * 1024 * 1024)
    writeFileSync(path.join(dir, 'service.2026-01-13.jsonl'), big)
    writeFileSync(path.join(dir, 'service.2026-01-14.jsonl'), big)
    writeFileSync(path.join(dir, 'service.2026-01-15.jsonl'), big)
    writeFileSync(path.join(dir, 'cli.2026-01-15.jsonl'), big)
    sweepLogs(dir, NOW_MS)
    assert({
      given: 'four large files exceeding the cap, two dated today',
      should: 'delete oldest-first but never a file from the current day',
      actual: readdirSync(dir).sort(),
      expected: ['cli.2026-01-15.jsonl', 'service.2026-01-15.jsonl'],
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('beginEvent emits one wide record with outcome and duration', () => {
  const records = capture(() => {
    const tick = beginEvent(logger('heartbeat'), 'tick')
    tick.set({ checked: 3 })
    tick.set({ idleMs: 250 })
    tick.emit()
  })
  const [rec] = records
  assert({
    given: 'an event with fields accumulated across two set() calls',
    should: 'emit exactly one record carrying them all',
    actual: records.length === 1 && {
      event: rec.event,
      outcome: rec.outcome,
      checked: rec.checked,
      idleMs: rec.idleMs,
      message: rec.message,
    },
    expected: { event: 'tick', outcome: 'ok', checked: 3, idleMs: 250, message: 'tick' },
  })
  assert({
    given: 'an emitted event',
    should: 'carry a numeric duration',
    actual: typeof rec.durationMs === 'number' && rec.durationMs >= 0,
    expected: true,
  })
})

test('beginEvent fail() records the error at error level', () => {
  const [rec] = capture(() => {
    const tick = beginEvent(logger('heartbeat'), 'tick', { level: 'debug' })
    tick.fail(new Error('boom'), { checked: 1 })
  })
  assert({
    given: 'an event that failed',
    should: 'emit at error level with outcome, fields, and the stack preserved',
    actual: {
      level: rec.level,
      outcome: rec.outcome,
      checked: rec.checked,
      message: rec.error.message,
      hasStack: typeof rec.error.stack === 'string' && rec.error.stack.length > 0,
    },
    expected: { level: 'ERROR', outcome: 'error', checked: 1, message: 'boom', hasStack: true },
  })
})

test('beginEvent respects a debug emit level', () => {
  const records = capture(() => {
    beginEvent(logger('heartbeat'), 'tick', { level: 'debug' }).emit()
    beginEvent(logger('heartbeat'), 'boot').emit()
  }, 'info')
  assert({
    given: 'a debug-level event while the sink level is info',
    should: 'drop the debug event and keep the info one',
    actual: records.map((r) => r.event),
    expected: ['boot'],
  })
})

test('resolveLevel accepts the spelling everyone actually types', () => {
  assert({
    given: 'SKY_LOG_LEVEL=warn',
    should: 'map onto LogTape\'s "warning" level',
    actual: resolveLevel('warn'),
    expected: 'warning',
  })
})

test('resolveLevel is case- and whitespace-insensitive', () => {
  assert({
    given: 'a level with stray case and padding',
    should: 'normalize it',
    actual: resolveLevel('  DEBUG '),
    expected: 'debug',
  })
})

test('resolveLevel falls back rather than throwing', () => {
  assert({
    given: 'an unset, blank, and nonsense level',
    should: 'return the default so a typo cannot stop the service booting',
    actual: [resolveLevel(undefined), resolveLevel('   '), resolveLevel('chatty')],
    expected: ['info', 'info', 'info'],
  })
})
