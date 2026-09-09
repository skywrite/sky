import type { TrackingAsk, TrackingColumn, TrackingSchedule, TrackingStorage } from '#shared/models/Tracking/mod.ts'

export interface Tracker {
  name: string
  title: string
  question: string
  category: string
  ask: TrackingAsk
  schedule: TrackingSchedule
  storage: TrackingStorage
  status: 'active' | 'archived'
  columns: TrackingColumn[]
  start: string | null
  end: string | null
  markdown: string
  path: string
  revision: string
  hasRecords: boolean
}

export interface TrackingEntry {
  /** Identifies one physical row in a particular version of its source file. */
  id: string
  /** Stable across unrelated appends, preserving the reader's DOM and text selection. */
  key?: string
  date: string
  values: Record<string, string>
  source: string
}

export interface TrackingMetric {
  tracker: Tracker
  entries: TrackingEntry[]
  warnings: string[]
}

export interface TrackingReport {
  today: string
  time: string
  start: string
  end: string
  window: 'morning' | 'evening'
  metrics: TrackingMetric[]
  errors: Array<{ name: string; message: string }>
  canParse: boolean
}

export interface TrackerInput {
  title: string
  question: string
  category: string
  ask: TrackingAsk
  schedule: TrackingSchedule
  columns: TrackingColumn[]
  start: string
  end: string | null
  markdown: string
}

export interface TrackingMutation {
  name: string
  undoId: string
}

export interface TrackingPreview {
  date: string | null
  values: Record<string, string>
  message: string | null
}

export class TrackingError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409 | 413 = 400,
  ) {
    super(message)
  }
}
