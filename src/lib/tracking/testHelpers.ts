import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { TrackingStore, type TrackingParser } from './store.ts'
import type { TrackerInput } from './types.ts'

export const TRACKING_TODAY = '2030-06-18'
export const sleepInput: TrackerInput = {
  title: 'Sleep',
  question: 'How long did you sleep?',
  category: 'Health',
  ask: 'morning',
  schedule: 'daily',
  start: '2030-06-01',
  end: null,
  columns: [
    { name: 'duration', type: 'duration', unit: 'hr', aggregate: 'mean' },
    { name: 'notes', type: 'text', aggregate: 'collect' },
  ],
  markdown: 'Notice what helps me wake up rested.\n',
}

export async function trackingFixture(parse?: TrackingParser) {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-tracking-test-'))
  const dirs = {
    root,
    timeDir: path.join(root, 'time'),
    dataTrackingDir: path.join(root, 'data/tracking'),
    trackingDir: path.join(root, 'tracking'),
    stateDir: path.join(root, '.state/tracking'),
  }
  const store = new TrackingStore(dirs, async () => ({ date: new PlainDate(TRACKING_TODAY), time: '8:15' }), parse)
  const put = async (relative: string, contents: string) => {
    const file = path.join(root, relative)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, contents)
    return file
  }
  return { root, dirs, store, put, dispose: () => rm(root, { recursive: true, force: true }) }
}
