import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { runCommand } from '#lib/sys/mod.ts'
import { assert, test } from '#test'

test('decisions:resolve creates the day file when the decision lands on a day that has none', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'decisions-resolve-test-'))
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
      import DecisionDocument from '#shared/models/Decision/mod.ts'
      import dayFile from '#shared/nbfs/dayFile.ts'
      import { readDay } from '#shared/nbfs/mod.ts'
      import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
      mock.module('@clack/prompts', () => ({ intro() {}, outro() {}, cancel() {}, isCancel: () => false, text: async () => 'Go with the Atlas vendor.' }))
      mock.module('open-editor', () => ({ default() {} }))
      const { default: Task } = await import('#commands/all/decisions/resolve.ts')
      const pending = path.join(DIR_DECISIONS, '2026', 'pending', '04', 'atlas-vendor.md')
      await mkdir(path.dirname(pending), { recursive: true })
      await writeFile(pending, DecisionDocument.create({ name: 'atlas-vendor', title: 'Pick the Atlas vendor' }).toMarkdown())
      const when = new PlainDateTime('2026-04-11 10:00')
      const resolved = await new Task().run({
        args: { name: 'atlas-vendor', when, category: 'Professional Complete' },
        context: { output: { log() {}, error() {} } },
      })
      check.equal(resolved.ok, true, resolved.message)
      check.equal((await readDay(when.plainDate)).started, undefined)
      const daily = await readFile(path.join(DIR_TIME, dayFile(when.plainDate)), 'utf8')
      check.equal(daily.split('decisions/atlas-vendor -> Resolved').length - 1, 1)
    `,
      ],
      { env: { SKY_DIR: path.join(temp, 'notebook'), SKY_DATA_DIR: path.join(temp, 'user-data') } },
    )
    assert({
      given: 'a decision resolved onto a day that has no day file',
      should: 'create the day, unstarted, with the resolution logged',
      actual: result.success || result.stderr,
      expected: true,
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
