import { spyOn } from 'bun:test'
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { resolveCommandArgs } from '#commands/lib/core/resolveCommandArgs.ts'
import { CommandPlatform } from '#commands/mod.ts'
import * as config from '#config'
import * as nbfs from '#lib/nbfs/mod.ts'
import * as imageNames from '#lib/notebook/imageName.ts'
import { makeTempDir } from '#shared/fs/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { assert, test } from '#test'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import * as extraction from './_lib/extractFromImage.ts'
import MessageNewTask from './new.ts'

test('message images use complete content summaries and preserve same-named files and shared attachments', async () => {
  const root = await makeTempDir({ prefix: 'sky-message-image-name-' })
  const when = new PlainDateTime('2026-01-27 15:30')
  const now = new ZonedDateTime(when.toString(), 'UTC')
  const context = CommandContext.test(
    {
      ...config,
      DIR_BASE: root,
      DIR_TIME: path.join(root, 'time'),
      DIR_STATE: path.join(root, 'state'),
      DIR_ATTACHMENTS: path.join(root, 'attachments'),
      FILE_ABOUT_ME: path.join(root, 'about-me.md'),
    },
    { notebookNow: now, systemNow: now },
  ).fork({ platform: CommandPlatform.Server, compositionDepth: 1 })
  const saved: Document[] = []
  const summary = 'Atlas API review and delivery schedule'
  const filename = '2026-01-27_153000_Atlas-API-review-and-delivery-schedule.png'
  const attachDir = path.join(context.config.DIR_ATTACHMENTS, dayAttachmentsDir(when.plainDate))
  const mocks = [
    spyOn(imageNames, 'imageCreationStamp').mockReturnValue('2026-01-27_153000'),
    spyOn(extraction, 'extractMessageFromImage').mockResolvedValue({
      platform: 'Signal',
      from: 'Jane Doe',
      to: 'Me',
      summary,
      when: null,
      continuityNotes: null,
      messages: [{ sender: 'Jane Doe', text: 'Review the Atlas API delivery schedule.', time: null }],
    }),
    spyOn(nbfs.DayDirFileWriter.prototype, 'write').mockImplementation(async (file, content) => {
      saved.push(Document.fromMarkdown(content))
      return file
    }),
    spyOn(nbfs, 'writeDayItems').mockResolvedValue(),
  ]
  try {
    const args = await resolveCommandArgs({
      description: MessageNewTask.description,
      callerArgs: {},
      callerDepth: 1,
      overrides: { fromImage: path.join(root, 'camera.png'), when, category: 'Personal Complete', fresh: false },
    })
    for (const [index, file] of [
      path.join(root, 'camera.png'),
      path.join(root, 'other.png'),
      path.join(attachDir, filename),
    ].entries()) {
      if (index < 2) await writeFile(file, `synthetic screenshot ${index + 1}`)
      const result = await new MessageNewTask().run({
        args: { ...args, fromImage: file } as Parameters<MessageNewTask['run']>[0]['args'],
        context,
        tasks: new CommandService(context),
        rawArgs: { _: [], when: when.toString() },
      })
      assert({
        given: 'a screenshot filed as a message',
        should: 'finish successfully',
        actual: result.ok,
        expected: true,
      })
    }
    assert({
      given: 'two different images with the same summary, then reusing a saved attachment',
      should: 'keep readable names, distinct bytes and valid references without deleting a shared image',
      actual: [
        saved.map((note) => note.attachments.map(({ file }) => file)),
        saved.map((note) => note.yaml.summary),
        saved.every((note) => note.markdown.includes('Review the Atlas API delivery schedule.')),
        (await readdir(attachDir)).sort(),
        await readFile(path.join(attachDir, filename), 'utf8'),
        await readFile(path.join(attachDir, filename.replace('.png', '_2.png')), 'utf8'),
      ],
      expected: [
        [[filename], [filename.replace('.png', '_2.png')], [filename]],
        [summary, summary, summary],
        true,
        [filename, filename.replace('.png', '_2.png')].sort(),
        'synthetic screenshot 1',
        'synthetic screenshot 2',
      ],
    })
  } finally {
    for (const mock of mocks) mock.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})
