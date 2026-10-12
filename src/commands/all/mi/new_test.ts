import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { runCommand } from '#lib/sys/mod.ts'
import { assert, test } from '#test'

test('mi:new creates the day file when the MI lands on a day that has none', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'mi-new-test-'))
  try {
    // Config is resolved on import, so a child process isolates the notebook.
    const result = await runCommand(
      'bun',
      [
        '--eval',
        `
      import { mock } from 'bun:test'
      import { strict as check } from 'node:assert'
      import { readFile } from 'node:fs/promises'
      import * as path from 'node:path'
      import * as config from '#config'
      import dayFile from '#shared/nbfs/dayFile.ts'
      import { readDay } from '#shared/nbfs/mod.ts'
      import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
      mock.module('open-editor', () => ({ default() {} }))
      const { default: Task } = await import('#commands/all/mi/new.ts')
      const when = new PlainDateTime('2026-04-11 08:00')
      const created = await new Task().run({
        args: { summary: 'Ship the Atlas draft', ai: false, dryRun: false, inspect: false, depend: false, when, noAutoTag: true, noAutoRel: true },
        context: { config, output: { log() {} } },
      })
      check.equal(created.ok, true, created.message)
      check.equal((await readDay(when.plainDate)).started, undefined)
      const daily = await readFile(path.join(config.DIR_TIME, dayFile(when.plainDate)), 'utf8')
      check.equal(daily.split(created.data.file).length - 1, 1)
    `,
      ],
      { env: { SKY_DIR: path.join(temp, 'notebook'), SKY_DATA_DIR: path.join(temp, 'user-data') } },
    )
    assert({
      given: 'an MI saved onto a day that has no day file',
      should: 'create the day, unstarted, with the MI linked',
      actual: result.success || result.stderr,
      expected: true,
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
