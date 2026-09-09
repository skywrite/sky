import { existsSync } from 'node:fs'
import { appendFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import type { AutomationPassInput } from '../process.ts'
import runDueAutomations from '../runDue.ts'

export type FixturePassInput = AutomationPassInput & { root: string }

export default async function pass(input: FixturePassInput) {
  return runDueAutomations({
    dir: path.join(input.root, 'charters'),
    statePath: path.join(input.root, 'ledger.json'),
    systemNow: new ZonedDateTime(input.dateTime, input.timezone),
    timeoutMs: null,
    invoke: async ({ name }) => {
      await appendFile(path.join(input.root, 'calls'), `${name}\n`)
      await writeFile(path.join(input.root, 'started'), 'ready')
      while (!existsSync(path.join(input.root, 'finish'))) await delay(10)
      return { outcome: 'acted', message: 'Mock work finished.' }
    },
  })
}
