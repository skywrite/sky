import { assert, test } from '#test'
import { BufferedOutput, ConsoleOutput } from './mod.ts'

test('BufferedOutput captures logs', () => {
  const output = new BufferedOutput()

  output.log('test message')
  output.log('another message')

  const logs = output.getLogs()
  assert({
    given: 'BufferedOutput with two logs',
    should: 'capture both messages',
    actual: logs,
    expected: ['test message', 'another message'],
  })
})

test('BufferedOutput captures errors', () => {
  const output = new BufferedOutput()

  output.error('error message')
  output.error('another error')

  const errors = output.getErrors()
  assert({
    given: 'BufferedOutput with two errors',
    should: 'capture both error messages',
    actual: errors,
    expected: ['error message', 'another error'],
  })
})

test('BufferedOutput hasLog works', () => {
  const output = new BufferedOutput()

  output.log('test message')

  assert({
    given: 'BufferedOutput with a log containing "test"',
    should: 'return true for hasLog("test")',
    actual: output.hasLog('test'),
    expected: true,
  })

  assert({
    given: 'BufferedOutput without "missing"',
    should: 'return false for hasLog("missing")',
    actual: output.hasLog('missing'),
    expected: false,
  })
})

test('BufferedOutput hasError works', () => {
  const output = new BufferedOutput()

  output.error('error message')

  assert({
    given: 'BufferedOutput with an error containing "error"',
    should: 'return true for hasError("error")',
    actual: output.hasError('error'),
    expected: true,
  })

  assert({
    given: 'BufferedOutput without "missing"',
    should: 'return false for hasError("missing")',
    actual: output.hasError('missing'),
    expected: false,
  })
})

test('BufferedOutput clear works', () => {
  const output = new BufferedOutput()

  output.log('test')
  output.error('error')

  assert({
    given: 'BufferedOutput with logs and errors',
    should: 'have non-empty arrays before clear',
    actual: [output.getLogs().length, output.getErrors().length],
    expected: [1, 1],
  })

  output.clear()

  assert({
    given: 'BufferedOutput after clear()',
    should: 'have empty arrays',
    actual: [output.getLogs().length, output.getErrors().length],
    expected: [0, 0],
  })
})

test('ConsoleOutput is instantiable', () => {
  const output = new ConsoleOutput()

  assert({
    given: 'ConsoleOutput instance',
    should: 'have log and error functions',
    actual: [typeof output.log, typeof output.error],
    expected: ['function', 'function'],
  })
})
