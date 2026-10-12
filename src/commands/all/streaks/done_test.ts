import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { runCommand } from '#lib/sys/mod.ts'
import { assert, test } from '#test'

test('streaks:done creates the day file when the day has none', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'streaks-done-test-'))
  try {
    // Config is resolved on import, so a child process isolates the notebook.
    const result = await runCommand(
      'bun',
      [
        '--eval',
        `
      import { strict as check } from 'node:assert'
      import { mkdir, writeFile } from 'node:fs/promises'
      import * as path from 'node:path'
      import Task from '#commands/all/streaks/done.ts'
      import { DIR_STREAKS } from '#config'
      import StreakDocument from '#shared/models/Streak/mod.ts'
      import { readDay } from '#shared/nbfs/mod.ts'
      import { PlainDate } from '#universal/dates/nbdt/mod.ts'
      const day = new PlainDate('2026-04-11')
      const streak = StreakDocument.create({ name: 'atlas-walk', title: 'Atlas walk', schedule: 'daily', start: new PlainDate('2026-04-01'), why: 'A daily walk.', createdOn: '2026-04-01' })
      await mkdir(path.join(DIR_STREAKS, 'active'), { recursive: true })
      await writeFile(path.join(DIR_STREAKS, 'active', 'atlas-walk.md'), streak.toMarkdown())
      const done = await new Task().run({ args: { name: 'atlas-walk', day }, context: { output: { log() {}, error() {} } } })
      check.equal(done.ok, true, done.message)
      const saved = await readDay(day)
      check.equal(saved.started, undefined)
      check.deepEqual(saved.lists.find((list) => list.title === 'Streaks')?.items, ['~~Atlas walk~~'])
    `,
      ],
      { env: { SKY_DIR: path.join(temp, 'notebook'), SKY_DATA_DIR: path.join(temp, 'user-data') } },
    )
    assert({
      given: 'a streak marked done on a day that has no day file',
      should: 'create the day, unstarted, with the streak struck',
      actual: result.success || result.stderr,
      expected: true,
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
