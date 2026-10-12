import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { runCommand } from '#lib/sys/mod.ts'
import { assert, test } from '#test'

test('day:timezone creates the day file when today has none', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'day-timezone-test-'))
  try {
    // Config is resolved on import, so a child process isolates the notebook.
    const result = await runCommand(
      'bun',
      [
        '--eval',
        `
      import { strict as check } from 'node:assert'
      import Task from '#commands/all/day/timezone.ts'
      import { readDay } from '#shared/nbfs/mod.ts'
      import { PlainDate } from '#universal/dates/nbdt/mod.ts'
      const set = await new Task().run({
        args: {},
        context: { output: { log() {} } },
        tasks: { run: async () => ({ data: { iana: 'Europe/Paris' } }) },
      })
      check.equal(set.ok, true, set.message)
      const saved = await readDay(new PlainDate())
      check.equal(saved.started, undefined)
      check.equal(saved.timezone, 'Europe/Paris')
    `,
      ],
      { env: { SKY_DIR: path.join(temp, 'notebook'), SKY_DATA_DIR: path.join(temp, 'user-data') } },
    )
    assert({
      given: 'a timezone set before today has a day file',
      should: 'create the day, unstarted, with the timezone',
      actual: result.success || result.stderr,
      expected: true,
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
