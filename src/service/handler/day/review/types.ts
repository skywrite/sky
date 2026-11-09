import type { Tracker } from '#lib/tracking/types.ts'
import type { DayItemAddress } from '../organizingTypes.ts'

export type ReviewKind = 'carry' | 'streak' | 'tracking' | 'meeting' | 'check'
export const REVIEW_STEPS = ['carry', 'reminder', 'streak', 'tracking', 'meeting', 'chat', 'summary'] as const
export type ReviewStep = (typeof REVIEW_STEPS)[number]
/** A `carry` item from the Reminders list: reminders are moved to today, where to-dos are copied. */
export const isReminder = (item: ReviewItem) =>
  item.kind === 'carry' && /^reminders$/i.test(item.address?.list.trim() ?? '')
export const reviewItemStep = (item: ReviewItem): ReviewStep =>
  isReminder(item) ? 'reminder' : item.kind === 'check' ? 'meeting' : item.kind
export interface ReviewItem {
  id: string
  kind: ReviewKind
  title: string
  detail?: string
  href?: string
  blocked?: string
  address?: DayItemAddress
  name?: string
  tracker?: Tracker
  meeting?: { title: string; when: string }
}

/** A recap is `missing` with no file and no run here, `skipped` when the person let the summary go ahead without it. */
export type JobStatus = 'waiting' | 'running' | 'done' | 'error' | 'stopped' | 'skipped' | 'missing'
export interface ReviewJob {
  id: string
  title: string
  status: JobStatus
  message?: string
}

/** The waiting day the return prompt starts as it shows; `message` says why it did not start. */
export interface ReviewStart {
  ymd: string
  /** Monday … Sunday */
  weekday: string
  status: 'running' | 'done' | 'error'
  message?: string
}

export interface ReviewState {
  day: string
  paused: boolean
  step?: ReviewStep
  /** A `copied` to-do stayed on its day; a `moved` reminder left it, as did tasks in reviews saved before copying. */
  answers: Record<string, { item: ReviewItem; result: 'skipped' | 'done' | 'copied' | 'moved'; target?: string }>
  drafts: Record<string, Record<string, string>>
  recaps: ReviewJob[]
  summary: ReviewJob
}

export interface ReviewView extends ReviewState {
  step: ReviewStep
  today: string
  items: ReviewItem[]
  hasDay: boolean
  summarized: boolean
  summaryHref: string | null
  chats: ReviewChat[]
  /** The day this review's return prompt started, or null when it started none. */
  start: ReviewStart | null
}

export interface ReviewChat {
  id: string
  title: string
  started: string
  lastActive: string | null
  saves: boolean
  busy: boolean
}

export interface ReviewRuntime {
  status(): Promise<{ pending: string | null; supported: boolean }>
  acknowledge(day: string): Promise<void>
  /** Every installed recap in display order, `saved` when the day has its file; `id` is the app, run as `recap:<id>`. */
  recaps(day: string): Promise<{ id: string; title: string; saved: boolean }[]>
  /** Runs one recap; a message says why no file came of it. */
  recap(id: string, day: string): Promise<string | void>
  /** The signal is the person's Stop: the run ends before it writes. */
  summarize(day: string, signal: AbortSignal): Promise<void>
}
