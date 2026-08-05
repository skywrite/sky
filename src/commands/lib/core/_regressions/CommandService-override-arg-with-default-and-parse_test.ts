import * as config from '#config'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { BufferedOutput } from '../../output/BufferedOutput.ts'
import CommandContext from '../CommandContext.ts'
import CommandService from '../CommandService.ts'

/**
 * REGRESSION TEST: CommandService.run() should override arguments with default + parse
 *
 * Previously, when a task argument had both a default value AND a parse function,
 * CommandService.run() would throw an error when trying to override that argument.
 *
 * Bug (FIXED):
 * - a param with default + parse (originally day:timezone's <day>, since removed)
 * - Overriding it via tasks.run('...', { param: value }) would fail
 * - Error: "Value with same name set as both an argument and flag"
 *
 * Root cause: CommandService was merging THEN transforming, causing transformArgs
 * to see both the default value and the override value.
 *
 * Fix: Transform FIRST (applies defaults), THEN merge overrides on top.
 *
 * projects:close carries the shape the regression needs: `category` has both a
 * default and a parse function, `when` has a default, and `name` is ArgOrFlag.
 * The bogus status makes run() fail fast on its first validation, before any
 * filesystem access — the transform/merge under test happens before run().
 */
test('CommandService.run() should override argument with default value and parse function', async () => {
  const output = new BufferedOutput()
  const context = CommandContext.test(config).fork({ output })
  const service = new CommandService(context)

  let errorMessage = ''
  let result
  try {
    result = await service.run('projects:close', {
      name: 'Atlas',
      status: 'bogus-status',
      category: 'Personal Complete',
      when: new PlainDateTime('2022-03-09 10:00'),
    })
    if (result.error) {
      errorMessage = result.error instanceof Error ? result.error.message : String(result.error)
    }
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e)
  }

  assert({
    given: 'overrides for params with default + parse functions',
    should: 'not fail with "Value with same name set as both an argument and flag"',
    actual: errorMessage.includes('same name set as both'),
    expected: false,
  })

  assert({
    given: 'a bogus status override',
    should: 'reach run() and fail on status validation (overrides survived the merge)',
    actual: result !== undefined && result.status === 'fail' && (result.message ?? '').includes('Invalid status'),
    expected: true,
  })
})
