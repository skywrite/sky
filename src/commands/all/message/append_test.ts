import { spyOn } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { CommandResult } from '#commands/mod.ts'
import * as config from '#config'
import * as summaries from '#lib/notebook/enrich/summarize.ts'
import { hash } from '#lib/outbox/files.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import MessageAppendTask from './append.ts'

test('appending transcribes only new clips and safely retries a completed addition', async () => {
  const root = await mkdtemp('/tmp/sky-message-append-command-')
  const file = 'time/2026/W05/01-27/actions/messages/09-30_iMessage-Audio_Atlas.md'
  const paths = {
    ...config,
    DIR_BASE: root,
    DIR_TIME: path.join(root, 'time'),
    DIR_USER_DATA: path.join(root, 'state'),
  }
  const now = new ZonedDateTime('2026-01-27 10:00', 'UTC')
  const context = CommandContext.test(paths, { notebookNow: now, systemNow: now })
  const tasks = new CommandService(context)
  const summarize = spyOn(summaries, 'summarizeTranscript').mockResolvedValue('This should never replace the summary')
  const summary = 'Reviewing the Atlas plan on Friday'
  const calls: unknown[] = []
  const child = spyOn(tasks, 'run').mockImplementation(async (name, args) => {
    calls.push([name, args])
    return CommandResult.success({ run: null, cleanedText: '### Turn 1\n\nYes, on Friday.', rel: [] })
  })
  try {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(
      path.join(root, file),
      `---\nfrom: Jane Doe\nto: Me\nwhen: 2026-01-27 09:30\nmedium: iMessage Audio\nsummary: ${summary}\naudioClips:\n  - ${hash('already imported')}\n---\n\n**Jane Doe:**\n\nCan we review it?\n`,
    )
    const files = ['old.caf', 'reply.caf', 'renamed.caf'].map((name) => path.join(root, name))
    await Promise.all(files.map((file, index) => writeFile(file, index === 0 ? 'already imported' : 'new recording')))
    const input = {
      context,
      tasks,
      rawArgs: { _: [] },
      args: { file, fromAudioTurns: files, audioSpeakers: ['Jane Doe', 'Me', 'Me'], fresh: false },
    }
    const task = new MessageAppendTask()
    const first = await task.run(input)
    const content = await readFile(path.join(root, file), 'utf8')
    const second = await task.run(input)
    assert({
      given: 'a known clip plus two filenames containing the same new recording, then the same import retried',
      should: 'transcribe the new recording once and retain the conversation and its original summary',
      actual: [
        first.ok,
        second.ok,
        calls,
        (await readFile(path.join(root, file), 'utf8')) === content,
        content.split('Yes, on Friday.').length - 1,
        content.includes('Can we review it?'),
        Document.fromMarkdown(content).yaml.summary,
        summarize.mock.calls.length,
      ],
      expected: [
        true,
        true,
        [['audio:transcript:clean', { fromAudioTurns: [files[1]], fresh: false, save: false, output: undefined }]],
        true,
        1,
        true,
        summary,
        0,
      ],
    })
  } finally {
    summarize.mockRestore()
    child.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})
