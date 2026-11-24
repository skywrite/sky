import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { runCommand } from '#lib/sys/mod.ts'
import { assert, test } from '#test'

test('decisions:create --when dates, files and logs a decision on the day it was made', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'decisions-create-test-'))
  try {
    // Config is resolved on import, so a child process isolates the notebook.
    const result = await runCommand(
      'bun',
      [
        '--eval',
        `
      import { mock } from 'bun:test'
      import { strict as check } from 'node:assert'
      import { mkdir, readFile, writeFile } from 'node:fs/promises'
      import * as path from 'node:path'
      import { DIR_DECISIONS, DIR_TIME } from '#config'
      import dayFile from '#shared/nbfs/dayFile.ts'
      import { PlainDate } from '#universal/dates/nbdt/mod.ts'
      mock.module('open-editor', () => ({ default() {} }))
      const { default: Task } = await import('#commands/all/decisions/create.ts')
      const today = PlainDate.today()
      const made = new PlainDate('2025-03-10')
      // Today is started, so the notebook has a clock; the day it was made carries its own timezone.
      // A lone dash is how a day file writes an empty list.
      for (const [day, tz] of [[today, 'UTC'], [made, 'America/New_York']]) {
        const file = path.join(DIR_TIME, dayFile(day))
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, '---\\nstarted: 08:00\\ntz: ' + tz + '\\n---\\n\\n# ' + day.ymd + '\\n\\n## Personal Complete\\n-\\n')
      }
      const run = (when) =>
        new Task().run({
          args: {
            title: 'No releases on Fridays',
            name: 'No-Friday-Releases',
            context: 'Two Friday releases needed weekend fixes with nobody on call.',
            desiredOutcomes: 'No weekend fixes.',
            decision: 'No releases on Fridays, until the on-call rota is staffed.',
            inForce: true,
            when,
            category: 'Personal Complete',
            noAutoTag: true,
            noAutoRel: true,
          },
          context: { output: { log() {}, error() {} } },
        })
      check.equal((await run('last spring')).ok, false)
      check.equal((await run(today.addDays(2).ymd)).ok, false)
      const created = await run('2025-03-10 15:00')
      check.equal(created.ok, true, created.message)
      const content = await readFile(path.join(DIR_DECISIONS, '2025', 'in-force', '03', 'No-Friday-Releases.md'), 'utf8')
      check.ok(content.includes('identified: 2025-03-10 15:00-04:00[America/New_York]'), content)
      check.ok(content.includes('resolved: 2025-03-10 15:00-04:00[America/New_York]'), content)
      check.ok(content.includes('\\ninForce: true\\n'), content)
      check.ok(content.includes('\\ncreated: 2025-03-10\\n'), content)
      check.ok(content.includes('\\nupdated: ' + today.ymd + '\\n'), content)
      const logged = (day) => readFile(path.join(DIR_TIME, dayFile(day)), 'utf8').then((text) => text.split('decisions/No-Friday-Releases -> Decided').length - 1)
      check.equal(await logged(made), 1)
      check.equal(await logged(today), 0)
    `,
      ],
      { env: { SKY_DIR: path.join(temp, 'notebook'), SKY_DATA_DIR: path.join(temp, 'user-data') } },
    )
    assert({
      given:
        'a decision made on an earlier day and recorded today, after a moment that is no date and one that has not happened',
      should:
        "refuse both of those, then date and file the decision by the day it was made, in that day's timezone, and log it there and not today",
      actual: result.success || result.stderr,
      expected: true,
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
