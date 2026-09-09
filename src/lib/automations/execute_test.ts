import { assert, test } from '#test'
import { executeAutomationCommands } from './execute.ts'

const COMMANDS = ['recap:journal', 'recap:notes', 'recap:tasks'].map((run) => ({ run, args: { day: 'yesterday' } }))

test('executeAutomationCommands - waits for each command and continues after failure', async () => {
  const events: string[] = []
  const result = await executeAutomationCommands(COMMANDS, async ({ run }) => {
    events.push(`start ${run}`)
    await Promise.resolve()
    events.push(`finish ${run}`)
    if (run === 'recap:notes') throw new Error('Mock source unavailable')
    return { outcome: 'acted', message: 'Recap saved' }
  })
  assert({
    given: 'three commands where the second throws',
    should: 'finish each in order, run the third and report one failed outcome with each result',
    actual: [events, result],
    expected: [
      COMMANDS.flatMap(({ run }) => [`start ${run}`, `finish ${run}`]),
      {
        outcome: 'failed',
        message:
          'recap:journal: acted — Recap saved\nrecap:notes: failed — Mock source unavailable\nrecap:tasks: acted — Recap saved',
      },
    ],
  })
})

test('executeAutomationCommands - preserves quiet, successful and reported failure outcomes', async () => {
  const actual: string[] = []
  for (const outcome of ['nothing', 'acted', 'failed'] as const) {
    const result = await executeAutomationCommands(COMMANDS, async ({ run }) => ({
      outcome: run === 'recap:notes' ? outcome : 'nothing',
    }))
    actual.push(result.outcome)
  }
  assert({
    given: 'a group with nothing to do, work completed or a reported failure',
    should: 'keep the three overall outcomes distinct',
    actual,
    expected: ['nothing', 'acted', 'failed'],
  })
  assert({
    given: 'a legacy single-command result',
    should: 'retain its original message',
    actual: await executeAutomationCommands(COMMANDS.slice(0, 1), async () => ({
      outcome: 'nothing',
      message: 'No new entries',
    })),
    expected: { outcome: 'nothing', message: 'No new entries' },
  })
})
