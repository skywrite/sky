import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { runCommand } from '#lib/sys/mod.ts'
import { assert, test } from '#test'

test('slack:new recaptures in place and retains new messages when an attachment is unavailable', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'slack-new-test-'))
  try {
    // Config is resolved on import. A child process isolates both notebook and
    // attachment paths without mocking modules used by other tests.
    const result = await runCommand(
      'bun',
      [
        '--eval',
        `
      import { strict as check } from 'node:assert'
      import { mkdir, readFile, writeFile } from 'node:fs/promises'
      import * as path from 'node:path'
      import Task from '#commands/all/slack/new.ts'
      import { DIR_TIME } from '#config'
      import MessageDocument from '#shared/models/Message/mod.ts'
      import { parseSlackConversation } from '#shared/models/Message/slack/parse.ts'
      import { pendingSlackAttachment } from '#shared/models/Message/slack/write.ts'
      import dayFile from '#shared/nbfs/dayFile.ts'
      import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
      const when = new PlainDateTime('2026-04-10 09:00')
      const dayPath = path.join(DIR_TIME, dayFile(when.plainDate))
      await mkdir(path.dirname(dayPath), { recursive: true })
      await writeFile(dayPath, '# 2026-04-10\\n\\n')
      const first = { channelId: 'C0ATLAS', ts: '1770000000.000001', timeLabel: when.toString(), userName: 'Jane Doe', text: 'First.' }
      const second = { ...first, ts: '1770000000.000002', text: 'Second.' }
      const capture = (messages) => new Task().run({
        args: { from: 'Jane Doe', to: 'John Smith', summary: 'Atlas', when, link: 'https://atlas.slack.com/archives/C0ATLAS/p1770000000000001', slackMessages: JSON.stringify(messages), noEditor: true, noAutoTag: true, noAutoRel: true },
        rawArgs: { when: when.toString() }, context: { output: { log() {} } }, tasks: { run() { throw new Error('Unexpected task') } },
      })
      const created = await capture([first])
      check.equal(created.ok, true, created.message)
      const file = path.join(path.dirname(dayPath), created.data.filePath)
      let doc = MessageDocument.fromMarkdown(await readFile(file, 'utf8'))
      check.equal(doc.when.toString(), when.toString())
      doc = new MessageDocument({ ...doc.yaml, custom: 'keep', rel: ['projects/Atlas'] }, doc.markdown + '\\n## Notes\\n\\nKeep this note.\\n')
      await writeFile(file, doc.toMarkdown())
      const updated = await capture([first, second])
      check.equal(updated.ok, true, updated.message)
      check.equal(updated.data.filePath, created.data.filePath)
      const saved = await readFile(file, 'utf8')
      const parsed = MessageDocument.fromMarkdown(saved)
      check.equal(parseSlackConversation(parsed.markdown).messages.length, 2)
      check.equal(parsed.yaml.custom, 'keep')
      check.deepEqual(parsed.yaml.rel, ['projects/Atlas'])
      check.ok(parsed.markdown.includes('Keep this note.'))
      const repeated = await capture([first, second])
      check.equal(repeated.ok, true, repeated.message)
      check.equal(await readFile(file, 'utf8'), saved)
      const daily = await readFile(dayPath, 'utf8')
      check.equal(daily.split(created.data.filePath).length - 1, 1)
      const pending = await capture([first, second, { ...second, ts: '1770000000.000003', files: [{ id: 'F0MISSING', name: 'report.pdf', error: 'Unavailable' }] }])
      check.equal(pending.ok, true, pending.message)
      const pendingDoc = MessageDocument.fromMarkdown(await readFile(file, 'utf8'))
      const conversation = parseSlackConversation(pendingDoc.markdown)
      check.equal(conversation.messages.length, 3)
      check.deepEqual(conversation.messages.slice(0, 2).map(m => m.markdown), parseSlackConversation(parsed.markdown).messages.map(m => m.markdown))
      check.ok(pendingSlackAttachment(conversation.attachments[0]))
      check.equal(pendingDoc.yaml.custom, 'keep')
      check.ok(pendingDoc.markdown.includes('Keep this note.'))
      check.equal(pendingDoc.attachments.length, 0)
      check.equal(await readFile(dayPath, 'utf8'), daily)
    `,
      ],
      { env: { SKY_DIR: path.join(temp, 'notebook'), SKY_DATA_DIR: path.join(temp, 'user-data') } },
    )
    assert({
      given: 'captures through the actual command in an isolated notebook',
      should: 'retain the path, metadata, notes and day link across updates and failures',
      actual: result.success || result.stderr,
      expected: true,
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
