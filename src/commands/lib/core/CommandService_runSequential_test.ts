import * as config from '#config'
import { assert, test } from '#test'
import { BufferedOutput } from '../output/BufferedOutput.ts'
import CommandContext from './CommandContext.ts'
import CommandService from './CommandService.ts'

test('CommandService.runSequential() returns success when all tasks succeed', async () => {
  const output = new BufferedOutput()
  const context = CommandContext.test(config).fork({ output })
  const service = new CommandService(context)

  const result = await service.runSequential([['test:context'], ['test:context']])

  assert({
    given: 'all tasks succeed',
    should: 'return success',
    actual: result.status,
    expected: 'success',
  })
})

test('CommandService.runSequential() stops on first failure and returns fail result', async () => {
  const output = new BufferedOutput()
  const context = CommandContext.test(config).fork({ output })
  const service = new CommandService(context)

  const result = await service.runSequential([
    ['test:context'],
    ['test:result-demo', { fail: true }],
    ['test:context'], // Should not run
  ])

  assert({
    given: 'a task fails in sequence',
    should: 'return fail status',
    actual: result.status,
    expected: 'fail',
  })

  assert({
    given: 'a task fails in sequence',
    should: 'return the failure message',
    actual: result.message,
    expected: 'Validation failed',
  })
})

test('CommandService.runSequential() stops on first error and returns error result', async () => {
  const output = new BufferedOutput()
  const context = CommandContext.test(config).fork({ output })
  const service = new CommandService(context)

  const result = await service.runSequential([
    ['test:context'],
    ['test:result-demo', { error: true }],
    ['test:context'], // Should not run
  ])

  assert({
    given: 'a task errors in sequence',
    should: 'return error status',
    actual: result.status,
    expected: 'error',
  })
})

test('CommandService.runSequential() returns success for empty task list', async () => {
  const output = new BufferedOutput()
  const context = CommandContext.test(config).fork({ output })
  const service = new CommandService(context)

  const result = await service.runSequential([])

  assert({
    given: 'an empty task list',
    should: 'return success',
    actual: result.status,
    expected: 'success',
  })
})
