import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { runCommand } from '#lib/sys/mod.ts'
import { assert, test } from '#test'

test('Future saves a decision by running decisions:create itself, with the fields the page holds', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'future-decisions-test-'))
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
      import * as config from '#config'
      import dayFile from '#shared/nbfs/dayFile.ts'
      import { PlainDate } from '#universal/dates/nbdt/mod.ts'
      mock.module('open-editor', () => ({ default() {} }))
      const { createDecisionCommands } = await import('#service/handler/future/decisionCommands.ts')
      const today = PlainDate.today()
      const made = today.addDays(-3)
      // A lone dash is how a day file writes an empty list.
      for (const day of [today, made]) {
        const file = path.join(config.DIR_TIME, dayFile(day))
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, '---\\nstarted: 08:00\\ntz: UTC\\n---\\n\\n# ' + day.ymd + '\\n\\n## Personal Complete\\n-\\n')
      }
      // No service stands behind this notebook, so the tag and rel lookups are left out.
      const commands = createDecisionCommands(config, {}, { enrich: false })
      const fields = { context: 'Two Friday releases needed weekend fixes.', desiredOutcomes: 'No weekend fixes.', rel: [], category: 'Personal' }

      const kept = await commands.create({ ...fields, title: 'No releases on Fridays', decision: 'None, until the rota is staffed.', inForce: true, when: made.ymd })
      const content = await readFile(kept.file, 'utf8')
      check.ok(kept.file.includes(path.join('decisions', String(made.year), 'in-force')), kept.file)
      check.ok(content.includes('\\ninForce: true\\n'), content)
      check.ok(content.includes('\\ncreated: ' + made.ymd + '\\n'), content)
      const logged = await readFile(path.join(config.DIR_TIME, dayFile(made)), 'utf8')
      check.ok(logged.includes('decisions/' + kept.name + ' -> Decided'), logged)

      const open = await commands.create({ ...fields, title: 'Whether to add a second on-call', inForce: false, target: today.addDays(10).ymd })
      check.ok(open.file.includes(path.join('decisions', String(today.year), 'pending')), open.file)
      check.ok((await readFile(open.file, 'utf8')).includes('target: ' + today.addDays(10).ymd), 'target')

      await check.rejects(commands.create({ ...fields, title: 'A rule with nothing decided', inForce: true }), /only be in force once it is made/)
    `,
      ],
      { env: { SKY_DIR: path.join(temp, 'notebook'), SKY_DATA_DIR: path.join(temp, 'user-data') } },
    )
    assert({
      given:
        'a decision made three days ago and still in force, an open one with a decide-by day, and one the command refuses',
      should:
        'file the first under in-force on the day it was made with its day line, the second as pending with its day, and pass on the refusal in the command’s words',
      actual: result.success || result.stderr,
      expected: true,
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
