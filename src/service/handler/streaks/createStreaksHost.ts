import * as path from 'node:path'
import { hash } from '#lib/outbox/files.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { StreaksRoutesOptions } from './mod.ts'
import { StreaksStore } from './store.ts'

export function createStreaksHost(config: Record<string, unknown>): StreaksRoutesOptions {
  const timeDir = config.DIR_TIME as string
  const userDataDir = config.DIR_USER_DATA as string
  return {
    store: new StreaksStore(
      {
        root: config.DIR_BASE as string,
        timeDir,
        streaksDir: config.DIR_STREAKS as string,
        stateDir: path.join(userDataDir, 'streaks'),
        dayStateDir: path.join(userDataDir, 'day-planning'),
        workstreamsStateDir: path.join(
          config.DIR_STATE as string,
          'workstreams',
          hash(config.DIR_BASE as string).slice(0, 16),
        ),
      },
      async () => {
        try {
          return (await fetchNow({ timeDir })).plainDateTime
        } catch {
          // A fresh notebook can create its first streak before it has a started day.
          return new PlainDateTime()
        }
      },
    ),
  }
}
