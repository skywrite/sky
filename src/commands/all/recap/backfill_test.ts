import * as path from 'node:path'
import type { CommandsManifest } from '#commands/all/cli/_commandsManifest.ts'
import { withDayNotebook } from '#commands/all/day/_testNotebook.ts'
import { commandOutcome } from '#lib/automations/commandOutcome.ts'
import { ensureDay } from '#lib/nbfs/mod.ts'
import { readDay, writeDay } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import RecapBackfillTask from './backfill.ts'
import writeRecapFile from './lib/writeRecapFile.ts'

const sampleManifest: CommandsManifest = {
  version: 2,
  commands: {
    core: [
      {
        name: 'recap:coding',
        file: '/commands/recap/coding.ts',
        description: 'Recap coding',
        flags: [
          { name: 'day', kind: 'arg', type: 'plainDate', description: 'Day' },
          { name: 'no-editor', kind: 'flag', type: 'bool', description: 'No editor' },
        ],
        aiChatTool: false,
      },
      {
        name: 'recap:backfill',
        file: '/commands/recap/backfill.ts',
        description: 'Backfill recaps',
        flags: [{ name: 'days', kind: 'flag', type: 'number', description: 'Days' }],
        aiChatTool: false,
      },
    ],
    local: [
      {
        name: 'recap:journal',
        file: '/extra/recap/journal.ts',
        description: 'Recap journal',
        flags: [{ name: 'day', kind: 'arg', type: 'plainDate', description: 'Day' }],
        aiChatTool: false,
      },
    ],
    global: [],
  },
}

test('recap:backfill writes missing recaps, skips existing ones, and maps cleanly to automation outcomes', async () => {
  await withDayNotebook(async (notebook) => {
    const timeDir = notebook.context.config.DIR_TIME
    const today = new PlainDate('2025-03-15')
    const yesterday = today.addDays(-1)
    const twoDaysAgo = today.addDays(-2)

    await ensureDay(today, timeDir)
    const startedToday = (await readDay(today, timeDir)).setStarted(
      new ZonedDateTime({ date: today.ymd, time: '08:00', timezone: 'UTC' }),
    )
    await writeDay(startedToday, timeDir)

    await writeRecapFile({
      day: twoDaysAgo,
      app: 'coding',
      prefix: '09-00',
      contents: '---\napp: coding\n---\n# Existing\n',
      timeDir,
    })

    const invoked: Array<{ command: string; day: string; supportsNoEditor: boolean }> = []
    const cmd = new RecapBackfillTask({
      loadManifest: async () => sampleManifest,
      today: () => today,
      runRecap: async (spec, day) => {
        invoked.push({ command: spec.command, day: day.ymd, supportsNoEditor: spec.supportsNoEditor })
        if (spec.app === 'coding') {
          await writeRecapFile({
            day,
            app: spec.app,
            prefix: '10-00',
            contents: `---\napp: ${spec.app}\n---\n# Backfilled\n`,
            timeDir,
          })
        }
        return { ok: true }
      },
    })

    const first = await cmd.run({
      ...notebook,
      args: { days: 2, apps: undefined, dryRun: false, force: false },
    })

    const second = await cmd.run({
      ...notebook,
      args: { days: 2, apps: undefined, dryRun: false, force: false },
    })

    assert({
      given: 'a notebook with today started, one existing recap, and one quiet app',
      should: 'backfill missing recaps on pass 1 (acted) and stay quiet on pass 2 (nothing)',
      actual: {
        firstStatus: first.status,
        firstOutcome: commandOutcome(first).outcome,
        firstRecapped: first.data?.recapped,
        firstEmpty: first.data?.empty,
        secondStatus: second.status,
        secondOutcome: commandOutcome(second).outcome,
        invoked,
      },
      expected: {
        firstStatus: 'success',
        firstOutcome: 'acted',
        firstRecapped: [{ day: yesterday.ymd, app: 'coding' }],
        firstEmpty: [
          { day: twoDaysAgo.ymd, app: 'journal' },
          { day: yesterday.ymd, app: 'journal' },
        ],
        secondStatus: 'success',
        secondOutcome: 'nothing',
        invoked: [
          { command: 'recap:journal', day: twoDaysAgo.ymd, supportsNoEditor: false },
          { command: 'recap:coding', day: yesterday.ymd, supportsNoEditor: true },
          { command: 'recap:journal', day: yesterday.ymd, supportsNoEditor: false },
        ],
      },
    })
  })
})

test('recap:backfill returns a fail result with data on partial failure and rejects invalid flags', async () => {
  await withDayNotebook(async (notebook) => {
    const timeDir = notebook.context.config.DIR_TIME
    const today = new PlainDate('2025-03-15')

    await ensureDay(today, timeDir)
    const startedToday = (await readDay(today, timeDir)).setStarted(
      new ZonedDateTime({ date: today.ymd, time: '08:00', timezone: 'UTC' }),
    )
    await writeDay(startedToday, timeDir)

    const cmd = new RecapBackfillTask({
      loadManifest: async () => sampleManifest,
      today: () => today,
      runRecap: async (spec, day) => {
        if (spec.app === 'journal') return { ok: false, message: 'Token expired' }
        await writeRecapFile({
          day,
          app: spec.app,
          prefix: '11-00',
          contents: `---\napp: ${spec.app}\n---\n# Created\n`,
          timeDir,
        })
        return { ok: true }
      },
    })

    const partial = await cmd.run({
      ...notebook,
      args: { days: 1, apps: undefined, dryRun: false, force: false },
    })

    const invalidDays = await cmd.run({
      ...notebook,
      args: { days: 0, apps: undefined, dryRun: false, force: false },
    })

    const unknownApp = await cmd.run({
      ...notebook,
      args: { days: 1, apps: 'does-not-exist', dryRun: false, force: false },
    })

    assert({
      given: 'a partial failure and invalid flag inputs',
      should: 'fail with structured progress on partial failure and fail cleanly on invalid args',
      actual: {
        partialStatus: partial.status,
        partialOutcome: commandOutcome(partial).outcome,
        partialRecapped: partial.data?.recapped,
        partialErrors: partial.data?.errors,
        invalidDaysOk: invalidDays.ok,
        unknownAppOk: unknownApp.ok,
        stateFileDir: path.basename(path.join(notebook.context.config.DIR_STATE, 'recap')),
      },
      expected: {
        partialStatus: 'fail',
        partialOutcome: 'failed',
        partialRecapped: [{ day: '2025-03-14', app: 'coding' }],
        partialErrors: [{ day: '2025-03-14', app: 'journal', message: 'Token expired' }],
        invalidDaysOk: false,
        unknownAppOk: false,
        stateFileDir: 'recap',
      },
    })
  })
})
