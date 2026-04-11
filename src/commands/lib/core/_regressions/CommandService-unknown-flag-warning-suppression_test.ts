import { assert, test } from '#test'
import * as config from '#config'
import CommandService from '../CommandService.ts'
import CommandContext from '../CommandContext.ts'
import { BufferedOutput } from '../../output/BufferedOutput.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

/**
 * REGRESSION TEST: Unknown flag warnings should be suppressed for composed tasks
 *
 * When a parent task calls a child task via CommandService.run() and passes
 * override args, those args should NOT trigger "is not a defined flag" warnings.
 *
 * Bug:
 * - day:todo:move-future calls day:todo:incomplete with { day: PlainDate, ... }
 * - In incomplete, `day` is defined as an Arg (positional), not a Flag
 * - transformTypedParamsArgs warns about unknown flags at compositionDepth === 0
 * - But CommandService.run() passes this.context.compositionDepth (parent's depth = 0)
 *   instead of the child's depth (parent + 1 = 1)
 * - Result: Warning "day is not a defined flag" is shown even for composed tasks
 *
 * Reproduction:
 *   sky day:todo:move-future --old=24 --new=26
 *   # Shows: "day is not a defined flag." before the actual output
 *
 * Root cause: In CommandService.run(), transformTypedParamsArgs is called with
 * this.context.compositionDepth (parent's depth) instead of the child's depth
 * (this.context.compositionDepth + 1).
 *
 * Fix: Pass compositionDepth + 1 to transformTypedParamsArgs in CommandService.run()
 * and CommandService.runWithPrompts().
 */
test('CommandService.run() should suppress unknown flag warnings for composed tasks', async () => {
  const output = new BufferedOutput()
  const context = CommandContext.test(config).fork({ output })
  // This simulates what task-runner.ts does: creates CommandService at compositionDepth 0
  const service = new CommandService(context)

  // Simulate what move-future does: call incomplete with { day: PlainDate }
  // In incomplete, `day` is defined as an Arg (positional), not a Flag.
  // When passed as an override, it should NOT trigger "is not a defined flag" warning.
  const targetDay = PlainDate.from('2020-01-15')

  // Capture console output to check for warnings
  const consoleOutput: string[] = []
  const originalLog = console.log
  console.log = (...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(' '))
  }

  try {
    // This is exactly what move-future does internally:
    // tasks.run('day:todo:incomplete', { day: oldDate, category, cleanOnly })
    // The `day` param is an Arg in incomplete, so it shouldn't warn.
    await service.run('day:todo:incomplete', {
      day: targetDay,
      category: 'Professional Todos',
    })
  } catch {
    // Task may fail (no data for that day), that's fine
  } finally {
    console.log = originalLog
  }

  // Check that no "is not a defined flag" warning was logged
  const hasUnknownFlagWarning = consoleOutput.some((line) => line.includes('is not a defined flag'))

  assert({
    given: 'CommandService.run() passing an Arg param (not Flag) as override',
    should: 'not show "is not a defined flag" warning',
    actual: hasUnknownFlagWarning,
    expected: false,
  })
})
