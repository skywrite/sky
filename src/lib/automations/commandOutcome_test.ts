import { CommandResult } from '#commands/mod.ts'
import { assert, test } from '#test'
import { commandOutcome } from './commandOutcome.ts'

test('automation outcomes distinguish a quiet pass, work, and failure', () => {
  assert({
    given: 'legacy success, explicit quiet work, and a failed command',
    should: 'preserve truthful ledger outcomes and messages',
    actual: [
      commandOutcome(CommandResult.success()),
      commandOutcome(CommandResult.success({ outcome: 'nothing' }, 'No new messages.')),
      commandOutcome(CommandResult.fail('Cannot read state', { outcome: 'acted' })),
    ],
    expected: [
      { outcome: 'acted' },
      { outcome: 'nothing', message: 'No new messages.' },
      { outcome: 'failed', message: 'Cannot read state' },
    ],
  })
})
