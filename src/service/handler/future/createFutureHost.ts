import type { TrackingStore } from '#lib/tracking/store.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { FutureRoutesOptions } from './mod.ts'
import { FutureStore } from './store.ts'

export function createFutureHost(
  config: Record<string, unknown>,
  notebook: () => MarkdownStore | null,
  tracking: TrackingStore,
): FutureRoutesOptions {
  const timeDir = config.DIR_TIME as string
  return {
    store: new FutureStore(
      { root: config.DIR_BASE as string, goalsDir: config.DIR_GOALS as string },
      notebook,
      tracking,
      async () => {
        try {
          return (await fetchNow({ timeDir })).plainDateTime.plainDate
        } catch {
          // A fresh notebook can set its first goal before it has a started day.
          return PlainDate.today()
        }
      },
    ),
  }
}
