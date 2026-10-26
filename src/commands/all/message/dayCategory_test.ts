import { spyOn } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { CommandPlatform } from '#commands/mod.ts'
import * as config from '#config'
import * as categorization from '#lib/messageDayCategory.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import MessageDocument from '#shared/models/Message/document/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import MessageNewTask from './new.ts'

test('message imports choose existing day sections for iMessage and audio while respecting explicit categories', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-message-day-category-'))
  const when = new PlainDateTime('2026-01-27 15:30')
  const now = new ZonedDateTime(when.toString(), 'UTC')
  const paths = {
    ...config,
    DIR_BASE: root,
    DIR_TIME: path.join(root, 'time'),
    DIR_STATE: path.join(root, 'state'),
    DIR_ATTACHMENTS: path.join(root, 'attachments'),
    DIR_PEOPLE: path.join(root, 'people'),
    DIR_PEOPLE_OLD: path.join(root, 'people-old'),
    FILE_ABOUT_ME: path.join(root, 'about-me.md'),
  }
  const context = CommandContext.test(paths, { notebookNow: now, systemNow: now }).fork({
    platform: CommandPlatform.Server,
    compositionDepth: 1,
  })
  const inputs: categorization.MessageDayCategoryInput[] = []
  const mock = spyOn(categorization, 'notebookMessageDayCategorizer').mockReturnValue(async (message) => {
    inputs.push(message)
    return message.medium === 'iMessage Audio' ? 'Professional' : 'Personal'
  })
  const cases = [
    { medium: 'iMessage', explicit: undefined, expected: 'Personal Complete' },
    { medium: 'iMessage Audio', explicit: undefined, expected: 'Professional Complete' },
    { medium: 'iMessage', explicit: 'Professional', expected: 'Professional Complete' },
    { medium: 'iMessage', explicit: 'Personal', expected: 'Personal Complete' },
    { medium: 'Signal', explicit: undefined, expected: 'Professional Complete' },
  ]
  try {
    await mkdir(paths.DIR_TIME, { recursive: true })
    for (const [index, item] of cases.entries()) {
      const summary = `Conversation ${index + 1}`
      const result = await new MessageNewTask().run({
        args: {
          from: 'Alex Doe',
          to: 'Jane Doe',
          summary,
          medium: item.medium,
          when,
          category: `${item.explicit ?? 'Professional'} Complete`,
          fresh: false,
          fromImage: undefined,
          fromAudio: undefined,
          fromAudioTurns: undefined,
          audioSpeakers: undefined,
          fromText: undefined,
          aiContext: undefined,
        },
        rawArgs: { _: [], ...(item.explicit ? { category: item.explicit } : {}) },
        context,
        tasks: new CommandService(context),
      })
      if (!result.ok || !result.data) throw new Error('Synthetic message import failed')
      const saved = MessageDocument.fromMarkdown(await readFile(result.data.filePath, 'utf8'))
      const day = DayDocument.fromMarkdown(await readFile(path.join(paths.DIR_TIME, dayFile(when.plainDate)), 'utf8'))
      assert({
        given: `${item.medium} with ${item.explicit ?? 'automatic'} categorization`,
        should: 'place its single entry in the chosen Complete section and keep category fields out of the files',
        actual: [
          day.lists.filter((list) => list.items.some((row) => row.includes(summary))).map((list) => list.title),
          Object.hasOwn(saved.yaml, 'category'),
          Object.hasOwn(day.yaml, 'category'),
          saved.from,
          saved.to,
        ],
        expected: [[item.expected], false, false, 'Alex Doe', 'Jane Doe'],
      })
    }
    assert({
      given: 'automatic iMessage imports, explicit category choices and another network',
      should: 'ask the relationship classifier only for the two automatic iMessage entries',
      actual: inputs.map(({ medium, from, to }) => ({ medium, from, to })),
      expected: ['iMessage', 'iMessage Audio'].map((medium) => ({ medium, from: 'Alex Doe', to: 'Jane Doe' })),
    })
  } finally {
    mock.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})
