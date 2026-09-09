import * as path from 'node:path'
import { currentMoment } from '#commands/all/track/lib/moment.ts'
import { parseEntry } from '#commands/all/track/lib/parse.ts'
import { TrackingStore } from '#lib/tracking/store.ts'
import type { TrackingRoutesOptions } from './mod.ts'

export function createTrackingHost(config: Record<string, unknown>): TrackingRoutesOptions {
  const timeDir = config.DIR_TIME as string
  return {
    store: new TrackingStore(
      {
        root: config.DIR_BASE as string,
        timeDir,
        trackingDir: config.DIR_TRACKING as string,
        dataTrackingDir: config.DIR_DATA_TRACKING as string,
        stateDir: path.join(config.DIR_USER_DATA as string, 'tracking'),
      },
      () => currentMoment(timeDir),
      parseEntry,
    ),
  }
}
