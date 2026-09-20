import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import * as config from '#config'
import { makeTempDir } from '#shared/fs/mod.ts'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

export async function withDayNotebook(
  run: (notebook: { context: CommandContext; tasks: CommandService; rawArgs: { _: string[] } }) => Promise<void>,
) {
  const root = await makeTempDir({ prefix: 'day-lifecycle-test-' })
  const now = new ZonedDateTime(new PlainDateTime('2031-03-16T08:00:00'), 'UTC')
  const context = CommandContext.test(
    {
      ...config,
      DIR_BASE: root,
      DIR_TIME: path.join(root, 'time'),
      DIR_STATE: path.join(root, 'state'),
      DIR_STREAKS: path.join(root, 'streaks'),
      DAY_START_COMMANDS: [],
      PORT_SERVER: 0,
    },
    { notebookNow: now, systemNow: now },
  )
  try {
    await run({ context, tasks: new CommandService(context), rawArgs: { _: [] } })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
