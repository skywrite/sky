import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { runCommand } from '#lib/sys/mod.ts'
import { assert, test } from '#test'

test('email:new keeps same-minute threads separate and recaptures only a matching identity', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'email-new-test-'))
  try {
    // The command reads import-time configuration; isolate its real filesystem writes.
    const result = await runCommand(
      'bun',
      [
        '--eval',
        `
      import { strict as check } from 'node:assert'
      import { mkdir, readFile, writeFile } from 'node:fs/promises'
      import * as path from 'node:path'
      import Task from '#commands/all/email/new.ts'
      import { DIR_TIME } from '#config'
      import DayDocument from '#shared/models/Day/mod.ts'
      import EmailDocument from '#shared/models/Email/mod.ts'
      import dayFile from '#shared/nbfs/dayFile.ts'
      import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
      const when = new PlainDateTime('2026-04-10 09:00')
      const dayPath = path.join(DIR_TIME, dayFile(when.plainDate))
      await mkdir(path.dirname(dayPath), { recursive: true })
      await writeFile(dayPath, '# 2026-04-10\\n\\n')
      const capture = async (args) => {
        const result = await new Task().run({
          args: { from: 'Jane Doe', to: 'John Smith', subject: 'Weekly planning', summary: 'Atlas planning', when, noEditor: true, ...args },
          context: { output: { log() {} } },
        })
        check.equal(result.ok, true, result.message)
        return result.data.filePath
      }
      const read = (file) => readFile(path.join(path.dirname(dayPath), file), 'utf8')
      const first = await capture({ threadId: '101', follow: 'atlas-first', markdown: 'First thread.' })
      const firstDoc = EmailDocument.fromMarkdown(await read(first))
      await writeFile(path.join(path.dirname(dayPath), first), new EmailDocument({ ...firstDoc.yaml, tags: 'first-only', attachments: [{ file: 'first.pdf' }] }, firstDoc.markdown).toMarkdown())
      const firstBefore = await read(first)
      // Even identical subjects and filenames must not make different threads the same capture.
      const second = await capture({ threadId: '102', follow: 'atlas-second', markdown: 'Second thread.' })
      check.notEqual(first, second)
      check.equal(await read(first), firstBefore)
      check.ok((await read(second)).includes('Second thread.'))
      const secondDoc = EmailDocument.fromMarkdown(await read(second))
      check.equal(secondDoc.yaml.tags, null)
      check.deepEqual(secondDoc.attachments, [])
      await writeFile(path.join(path.dirname(dayPath), second), new EmailDocument({ ...secondDoc.yaml, custom: 'keep', tags: 'planning' }, secondDoc.markdown).toMarkdown())
      const secondAgain = await capture({ threadId: '102', follow: 'atlas-second', summary: 'Updated title', markdown: 'Second thread updated.' })
      check.equal(secondAgain, second)
      const updated = EmailDocument.fromMarkdown(await read(second))
      check.equal(updated.yaml.threadId, '102')
      check.equal(updated.yaml.custom, 'keep')
      check.equal(updated.yaml.tags, 'planning')
      check.ok(updated.markdown.includes('Second thread updated.'))
      check.equal(await read(first), firstBefore)
      // Existing follow IDs identify captures written before threadId was stored.
      const legacyDoc = EmailDocument.fromMarkdown(firstBefore)
      delete legacyDoc.yaml.threadId
      await writeFile(path.join(path.dirname(dayPath), first), legacyDoc.toMarkdown())
      check.equal(await capture({ threadId: '101', follow: 'atlas-first', markdown: 'First thread updated.' }), first)
      const followOnly = await capture({ follow: 'atlas-third', markdown: 'Legacy follow.' })
      check.equal(await capture({ follow: 'atlas-third', markdown: 'Legacy follow updated.' }), followOnly)
      // A missing identity is not evidence that another capture may be replaced.
      const anonymous = await capture({ markdown: 'Manual email.' })
      const anotherAnonymous = await capture({ markdown: 'Another manual email.' })
      check.notEqual(anonymous, anotherAnonymous)
      const daily = DayDocument.fromMarkdown(await readFile(dayPath, 'utf8'))
      const key = '09:00 > Jane Doe to John Smith Email'
      check.deepEqual([key, key + ' (2)', key + ' (3)', key + ' (4)', key + ' (5)'].map(key => daily.getCompleteItem(key)?.path), [first, second, followOnly, anonymous, anotherAnonymous])
      for (const file of [first, second, followOnly, anonymous, anotherAnonymous]) check.ok((await read(file)).length > 0)
    `,
      ],
      { env: { SKY_DIR: path.join(temp, 'notebook'), SKY_DATA_DIR: path.join(temp, 'user-data') } },
    )
    assert({
      given: 'different threads and repeated captures from one sender at the same minute',
      should: 'keep each email, its stable file path, metadata and separate day link',
      actual: result.success || result.stderr,
      expected: true,
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
