import { assert, test } from '#test'
import * as config from '#config'
import CommandService from '../CommandService.ts'
import CommandContext from '../CommandContext.ts'
import { BufferedOutput } from '../../output/BufferedOutput.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

/**
 * REGRESSION TEST: CommandService.run() should override arguments with default + parse
 *
 * Previously, when a task argument had both a default value AND a parse function,
 * CommandService.run() would throw an error when trying to override that argument.
 *
 * Bug (FIXED):
 * - day:timezone has argument: <day> with default PlainDate.today() and parse parsePartialDate
 * - Calling tasks.run('day:timezone', { day: PlainDate.from('2022-03-09') }) would fail
 * - Error: "Value with same name set as both an argument and flag"
 *
 * Root cause: CommandService was merging THEN transforming, causing transformArgs
 * to see both the default value and the override value.
 *
 * Fix: Transform FIRST (applies defaults), THEN merge overrides on top.
 */
test('CommandService.run() should override argument with default value and parse function', async () => {
  const output = new BufferedOutput()
  const context = CommandContext.test(config).fork({ output })
  const service = new CommandService(context)

  // The day argument in day:timezone has:
  // 1. Default value: PlainDate.today()
  // 2. Parse function: parsePartialDate
  //
  // We want to override it with a specific PlainDate
  const targetDay = PlainDate.from('2022-03-09')

  const result = await service.run('day:timezone', { day: targetDay })

  // The override should work successfully (not throw "Value with same name set as both an argument and flag")
  assert({
    given: 'a task with default + parse function argument',
    should: 'successfully override the argument value',
    actual: result.status,
    expected: 'success',
  })
})
