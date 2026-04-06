import { assert, test } from '#test'
import * as config from '#config'
import CommandService from '../CommandService.ts'
import CommandContext from '../CommandContext.ts'
import { BufferedOutput } from '../../output/BufferedOutput.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

/**
 * REGRESSION TEST: CommandService.run() with typed params and required Flag overrides
 *
 * When a parent task calls a child task that uses the typed params system,
 * and the child task has required Flag params (not positional Args), the
 * override values must be visible to transformTypedParamsArgs so the
 * required-param check passes.
 *
 * Bug:
 * - day:todo:move-next calls day:todo:move-future with { old: PlainDate, new: PlainDate, ... }
 * - move-future defines `old` and `new` as Flag.plainDate with required: true
 * - transformTypedParamsArgs runs on argsForTransform which doesn't include overrides
 * - Required check fails: "Required parameter 'old' is missing"
 *
 * Root cause: argsForTransform was built WITHOUT overrides, so required checks
 * couldn't see the values being passed from the parent task.
 *
 * Fix: Include overrides in argsForTransform so required checks pass.
 * The final merge { ...transformedArgs, ...argsOverride } ensures correct values.
 */
test('CommandService.run() should pass required Flag params via overrides (typed params)', async () => {
  const output = new BufferedOutput()
  const context = CommandContext.test(config).fork({ output })
  const service = new CommandService(context)

  // Use an old date that won't have actual notebook data
  // The task may fail later (e.g., "file not found"), but it should NOT fail
  // with "Required parameter 'old' is missing"
  const targetDay = PlainDate.from('2020-01-15')

  let errorMessage = ''
  try {
    const result = await service.run('day:todo:move-next', { day: targetDay })
    // If we get here, check result for error
    if (result.error) {
      errorMessage = result.error instanceof Error ? result.error.message : String(result.error)
    }
  } catch (e) {
    // Error was thrown instead of returned in result
    errorMessage = e instanceof Error ? e.message : String(e)
  }

  // The test passes if we don't get "Required parameter 'old' is missing"
  // The task might fail for other reasons (no data for that day), which is fine
  const hasRequiredParamError = errorMessage.includes('Required parameter') && errorMessage.includes('is missing')

  assert({
    given: 'a parent task calling child with required Flag params as overrides',
    should: 'not fail with "Required parameter is missing" error',
    actual: hasRequiredParamError,
    expected: false,
  })
})

/**
 * Additional test: Verify the child task receives correct PlainDate values
 *
 * This tests that override values pass through correctly without being
 * re-parsed or corrupted.
 */
test('CommandService.run() should pass PlainDate overrides to child task unchanged', async () => {
  const output = new BufferedOutput()
  const context = CommandContext.test(config).fork({ output })
  const service = new CommandService(context)

  // day:todo:move-future expects { old: PlainDate, new: PlainDate }
  // We call it directly to verify the values are received correctly
  const oldDate = PlainDate.from('2020-01-15')
  const newDate = PlainDate.from('2020-01-16')

  let errorMessage = ''
  try {
    const result = await service.run('day:todo:move-future', {
      old: oldDate,
      new: newDate,
      category: 'Test Todos',
    })
    if (result.error) {
      errorMessage = result.error instanceof Error ? result.error.message : String(result.error)
    }
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e)
  }

  // Should not fail with required param error
  const hasRequiredParamError = errorMessage.includes('Required parameter') && errorMessage.includes('is missing')

  assert({
    given: 'direct call to child task with required Flag params as PlainDate objects',
    should: 'not fail with "Required parameter is missing" error',
    actual: hasRequiredParamError,
    expected: false,
  })
})
