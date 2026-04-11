import { assert, test } from '#test'
import { CommandResult, isError, isFail, isFailOrError, isSuccess } from './CommandResult.ts'

test('CommandResult.success creates success result', () => {
  const result = CommandResult.success({ foo: 'bar' }, 'Operation completed')

  assert({
    given: 'data and message',
    should: 'create success result with correct status',
    actual: result.status,
    expected: 'success',
  })

  assert({
    given: 'data and message',
    should: 'include the data',
    actual: result.data,
    expected: { foo: 'bar' },
  })

  assert({
    given: 'data and message',
    should: 'include the message',
    actual: result.message,
    expected: 'Operation completed',
  })

  assert({
    given: 'success result',
    should: 'return true for isSuccess',
    actual: isSuccess(result),
    expected: true,
  })
})

test('CommandResult.success with no data', () => {
  const result = CommandResult.success()

  assert({
    given: 'no arguments',
    should: 'create success result',
    actual: result.status,
    expected: 'success',
  })

  assert({
    given: 'no arguments',
    should: 'have undefined data',
    actual: result.data,
    expected: undefined,
  })
})

test('CommandResult.fail creates fail result', () => {
  const result = CommandResult.fail('Invalid input', { field: 'email' })

  assert({
    given: 'message and data',
    should: 'create fail result',
    actual: result.status,
    expected: 'fail',
  })

  assert({
    given: 'message and data',
    should: 'include the message',
    actual: result.message,
    expected: 'Invalid input',
  })

  assert({
    given: 'message and data',
    should: 'include the data',
    actual: result.data,
    expected: { field: 'email' },
  })

  assert({
    given: 'fail result',
    should: 'return true for isFail',
    actual: isFail(result),
    expected: true,
  })
})

test('CommandResult.error with Error object', () => {
  const error = new Error('Something went wrong')
  const result = CommandResult.error(error)

  assert({
    given: 'Error object',
    should: 'create error result',
    actual: result.status,
    expected: 'error',
  })

  assert({
    given: 'Error object',
    should: 'include the error',
    actual: result.error,
    expected: error,
  })

  assert({
    given: 'Error object',
    should: 'use error message as message',
    actual: result.message,
    expected: 'Something went wrong',
  })

  assert({
    given: 'error result',
    should: 'return true for isError',
    actual: isError(result),
    expected: true,
  })
})

test('CommandResult.error with string', () => {
  const result = CommandResult.error('Connection failed', 'Unable to connect')

  assert({
    given: 'string error and custom message',
    should: 'create error result',
    actual: result.status,
    expected: 'error',
  })

  assert({
    given: 'string error',
    should: 'convert to Error instance',
    actual: result.error instanceof Error,
    expected: true,
  })

  assert({
    given: 'string error',
    should: 'use string as error message',
    actual: result.error?.message,
    expected: 'Connection failed',
  })

  assert({
    given: 'custom message parameter',
    should: 'override default message',
    actual: result.message,
    expected: 'Unable to connect',
  })
})

test('Type guards distinguish between result types', () => {
  const success = CommandResult.success({ value: 42 })
  const fail = CommandResult.fail('Validation failed')
  const error = CommandResult.error('System error')

  assert({
    given: 'success result',
    should: 'only match isSuccess guard',
    actual: [isSuccess(success), isFail(success), isError(success)],
    expected: [true, false, false],
  })

  assert({
    given: 'fail result',
    should: 'only match isFail guard',
    actual: [isSuccess(fail), isFail(fail), isError(fail)],
    expected: [false, true, false],
  })

  assert({
    given: 'error result',
    should: 'only match isError guard',
    actual: [isSuccess(error), isFail(error), isError(error)],
    expected: [false, false, true],
  })
})

test('isFailOrError guard identifies fail or error results', () => {
  const success = CommandResult.success({ value: 42 })
  const fail = CommandResult.fail('Validation failed')
  const error = CommandResult.error('System error')

  assert({
    given: 'success result',
    should: 'return false for isFailOrError',
    actual: isFailOrError(success),
    expected: false,
  })

  assert({
    given: 'fail result',
    should: 'return true for isFailOrError',
    actual: isFailOrError(fail),
    expected: true,
  })

  assert({
    given: 'error result',
    should: 'return true for isFailOrError',
    actual: isFailOrError(error),
    expected: true,
  })
})

test('CommandResult.ok getter returns true for success', () => {
  const success = CommandResult.success({ value: 42 })
  const fail = CommandResult.fail('Validation failed')
  const error = CommandResult.error('System error')

  assert({
    given: 'success result',
    should: 'return true for .ok',
    actual: success.ok,
    expected: true,
  })

  assert({
    given: 'fail result',
    should: 'return false for .ok',
    actual: fail.ok,
    expected: false,
  })

  assert({
    given: 'error result',
    should: 'return false for .ok',
    actual: error.ok,
    expected: false,
  })
})

test('CommandResult.failed getter returns true for fail', () => {
  const success = CommandResult.success({ value: 42 })
  const fail = CommandResult.fail('Validation failed')
  const error = CommandResult.error('System error')

  assert({
    given: 'success result',
    should: 'return false for .failed',
    actual: success.failed,
    expected: false,
  })

  assert({
    given: 'fail result',
    should: 'return true for .failed',
    actual: fail.failed,
    expected: true,
  })

  assert({
    given: 'error result',
    should: 'return false for .failed (use !ok for fail OR error)',
    actual: error.failed,
    expected: false,
  })
})

test('!result.ok checks for any non-success', () => {
  const success = CommandResult.success({ value: 42 })
  const fail = CommandResult.fail('Validation failed')
  const error = CommandResult.error('System error')

  assert({
    given: 'success result',
    should: 'return false for !ok',
    actual: !success.ok,
    expected: false,
  })

  assert({
    given: 'fail result',
    should: 'return true for !ok',
    actual: !fail.ok,
    expected: true,
  })

  assert({
    given: 'error result',
    should: 'return true for !ok',
    actual: !error.ok,
    expected: true,
  })
})
