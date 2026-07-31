import { assert, test } from '#test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { LogLevel } from '@logtape/logtape'
import { configureLogging, logger, resetLogging, resolveLevel } from './log.ts'

/**
 * Log into a throwaway file and read back the records that landed.
 *
 * Always writes under the OS temp dir — never the configured user data dir,
 * which on a real machine is inside the notebook.
 */
function capture(write: () => void, level?: LogLevel): Record<string, any>[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sky-log-test-'))
  const file = path.join(dir, 'service.jsonl')
  try {
    resetLogging()
    configureLogging({ path: file, level })
    write()
    resetLogging()
    const raw = readFileSync(file, 'utf8').trim()
    return raw === '' ? [] : raw.split('\n').map((line) => JSON.parse(line))
  } finally {
    resetLogging()
    rmSync(dir, { recursive: true, force: true })
  }
}

test('an error logged directly keeps its message and stack', () => {
  const [record] = capture(() => logger('sync').error(new Error('write failed')))
  assert({
    given: 'an Error passed straight to error()',
    should: 'record its name and message rather than an empty object',
    actual: { name: record.properties.error.name, message: record.properties.error.message },
    expected: { name: 'Error', message: 'write failed' },
  })
  assert({
    given: 'an Error passed straight to error()',
    should: 'preserve a non-empty stack',
    actual: typeof record.properties.error.stack === 'string' && record.properties.error.stack.length > 0,
    expected: true,
  })
})

test('an error cause chain survives serialization', () => {
  const [record] = capture(() => logger('sync').error(new Error('write failed', { cause: new Error('disk full') })))
  assert({
    given: 'an Error whose cause is another Error',
    should: 'serialize the cause with its own message',
    actual: record.properties.error.cause.message,
    expected: 'disk full',
  })
})

test('an AggregateError keeps every aggregated error', () => {
  const [record] = capture(() =>
    logger('sync').error(new AggregateError([new Error('a'), new Error('b')], 'both failed')),
  )
  assert({
    given: 'an AggregateError with two members',
    should: 'serialize each member message',
    actual: record.properties.error.errors.map((e: { message: string }) => e.message),
    expected: ['a', 'b'],
  })
})

test('a circular property does not discard the record', () => {
  const circular: Record<string, unknown> = { name: 'loop' }
  circular.self = circular
  const records = capture(() => logger('sync').warn('circular payload', { circular }))
  assert({
    given: 'a property containing a reference to itself',
    should: 'still write the record',
    actual: records.length,
    expected: 1,
  })
  assert({
    given: 'a property containing a reference to itself',
    should: 'keep the serializable fields and mark the cycle',
    actual: records[0].properties.circular,
    expected: { name: 'loop', self: '[Circular]' },
  })
})

test('a BigInt property does not discard the record', () => {
  const records = capture(() => logger('sync').warn('bigint payload', { n: 1n }))
  assert({
    given: 'a property holding a BigInt',
    should: 'write the record with the value stringified',
    actual: records.map((r) => r.properties.n),
    expected: ['1n'],
  })
})

test('a value repeated across sibling branches is not mistaken for a cycle', () => {
  const shared = { id: 7 }
  const cyclic: Record<string, unknown> = { left: shared, right: shared }
  cyclic.self = cyclic
  const [record] = capture(() => logger('sync').warn('shared payload', { cyclic }))
  assert({
    given: 'the same object referenced twice on separate branches',
    should: 'serialize it in full both times',
    actual: { left: record.properties.cyclic.left, right: record.properties.cyclic.right },
    expected: { left: { id: 7 }, right: { id: 7 } },
  })
})

test('structured properties are recorded alongside the rendered message', () => {
  const [record] = capture(() => logger('heartbeat').info('Checked {count} follow(s)', { count: 3 }))
  assert({
    given: 'a message template with a placeholder',
    should: 'render the message and keep the value as a queryable field',
    actual: { message: record.message, count: record.properties.count },
    expected: { message: 'Checked 3 follow(s)', count: 3 },
  })
})

test('a subsystem logger writes a queryable category', () => {
  const [record] = capture(() => logger('heartbeat').info('woken'))
  assert({
    given: 'logger("heartbeat")',
    should: 'namespace the record under the sky root',
    actual: record.logger,
    expected: 'sky.heartbeat',
  })
})

test('every record carries a UTC timestamp', () => {
  const [record] = capture(() => logger('sync').info('tick'))
  assert({
    given: 'any record',
    should: 'stamp it with a UTC ISO-8601 time, immune to a local timezone flip',
    actual: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record['@timestamp']),
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
