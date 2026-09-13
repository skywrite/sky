import { spyOn } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import * as path from 'node:path'
import * as runs from '#commands/all/audio/transcript/lib/transcriptRun.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import type { PlacePrompt, Prompter } from '#commands/lib/prompt/Prompter.ts'
import { CommandPlatform } from '#commands/mod.ts'
import * as config from '#config'
import * as documents from '#lib/service/documents.ts'
import type { DocumentIO } from '#shared/models/Person/write.ts'
import { assert, test } from '#test'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import * as routes from './lib/actionItemRoutes.ts'
import MeetingNewTask from './new.ts'

const NOW = '2026-01-27 12:00'
const FILE = 'time/2026/W05/01-27/actions/meetings/0930_Atlas-planning.md'

test('meeting:new resumes a filed meeting, saves notes before routing, and retains the run if saving fails', async () => {
  const root = await mkdtemp('/tmp/sky-meeting-actions-')
  const runOptions = { dir: path.join(root, 'runs'), now: () => NOW }
  let notes = '---\nsummary: Atlas planning\nwho: Jane Doe\nwhen: 2026-01-27 09:30\n---\n\n# Meeting\n'
  let fail = true
  const operations: string[] = []
  const prompts: PlacePrompt[] = []
  const io: DocumentIO = {
    read: (file) => {
      if (file !== FILE) throw new Error('Expected the notebook-relative meeting path')
      return Promise.resolve({ path: FILE, content: notes, version: 1 })
    },
    save: (_file, content) => {
      if (fail) return Promise.reject(new Error('Could not write the meeting notes'))
      notes = content
      operations.push('saved notes')
      return Promise.resolve({ saved: true })
    },
  }
  const mocks = [
    spyOn(runs, 'runOptionsFor').mockReturnValue(runOptions),
    spyOn(documents, 'serviceDocumentIO').mockReturnValue(io),
    spyOn(routes, 'lastCreatedDay').mockResolvedValue('2026-02-01'),
    spyOn(routes, 'countWaiting').mockResolvedValue(0),
    spyOn(routes, 'executeActionItemRoute').mockImplementation(async (route) => {
      operations.push(`routed ${route.task}`)
    }),
  ]
  try {
    const run = await runs.TranscriptRun.open('mock-action-review', runOptions)
    await run.put('filed', { file: path.join(root, FILE), actionItems: [], routeActions: true })
    const base = CommandContext.test({ ...config, DIR_BASE: root }, { notebookNow: new ZonedDateTime(NOW, 'UTC') })
    const prompt: Prompter = {
      interactive: true,
      text: () => Promise.resolve(null),
      confirm: () => Promise.resolve(null),
      select: () => Promise.resolve(null),
      multiselect: () => Promise.resolve(null),
      form: () => Promise.resolve(null),
      place: (p) => {
        prompts.push(p)
        return Promise.resolve([
          { value: 'new-1', label: 'Review the launch checklist', when: { date: null, time: null } },
        ])
      },
    }
    const context = base.fork({ platform: CommandPlatform.Server, prompt })
    const tasks = new CommandService(context)
    const command = new MeetingNewTask()
    const input = {
      context,
      tasks,
      rawArgs: { _: [] },
      args: {
        run: run.key,
        fromText: path.join(root, 'recap.txt'),
        fromZoomVtt: undefined,
        fromVoiceMemo: undefined,
        when: PlainDateTime.fromString(NOW),
        day: undefined,
        who: undefined,
        duration: undefined,
        clock: undefined,
        category: 'Professional Complete',
        medium: 'Zoom',
        summary: '',
        noActions: false,
        noAutoTag: true,
        noAutoRel: true,
        fresh: false,
      },
    }
    const failed = await command.run(input)
    assert({
      given: 'a resumed import with no extracted items and a failed save of a newly added item',
      should: 'offer the empty review, surface the save error, keep the checkpoint, and create no tasks',
      actual: [
        prompts[0]?.source?.title,
        prompts[0]?.items.length,
        failed.ok,
        failed.message?.includes('Could not write the meeting notes'),
        Boolean(await run.get('filed')),
        operations,
      ],
      expected: ['Atlas planning', 0, false, true, true, []],
    })
    fail = false
    const result = await command.run(input)
    assert({
      given: 'the same import retried after the save becomes available',
      should: 'save its new item before routing a linked task, then clear the finished checkpoint',
      actual: [result.ok, notes.includes('- Review the launch checklist'), operations, await run.get('filed')],
      expected: [
        true,
        true,
        ['saved notes', `routed Review the launch checklist — [Atlas planning · 2026-01-27](/${FILE})`],
        null,
      ],
    })
  } finally {
    for (const mock of mocks) mock.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})
