import type { Tracker } from '#lib/tracking/types.ts'
import type { DayItemAddress } from '../organizingTypes.ts'

export type ReviewKind = 'carry' | 'streak' | 'tracking' | 'meeting' | 'check'
export const REVIEW_STEPS = ['carry', 'streak', 'tracking', 'meeting', 'chat', 'summary'] as const
export type ReviewStep = (typeof REVIEW_STEPS)[number]
export const reviewItemStep = (item: ReviewItem): ReviewStep => (item.kind === 'check' ? 'meeting' : item.kind)
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

export type JobStatus = 'waiting' | 'running' | 'done' | 'error' | 'skipped'
export interface ReviewJob {
  id: string
  title: string
  status: JobStatus
  message?: string
}

export interface ReviewState {
  day: string
  paused: boolean
  step?: ReviewStep
  answers: Record<string, { item: ReviewItem; result: 'skipped' | 'done' | 'moved'; target?: string }>
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
}

export interface ReviewChat {
  id: string
  title: string
  started: string
  lastActive: string | null
  saves: boolean
  busy: boolean
}

export const RECAPS = [
  { id: 'slack', title: 'Slack recap' },
  { id: 'github', title: 'GitHub recap' },
  { id: 'codex', title: 'Codex recap' },
  { id: 'claude-code', title: 'Claude Code recap' },
] as const
export type RecapId = (typeof RECAPS)[number]['id']

export interface ReviewRuntime {
  status(): Promise<{ pending: string | null; supported: boolean }>
  claim(): Promise<string | null>
  acknowledge(day: string): Promise<void>
  recap(id: RecapId, day: string): Promise<string | void>
  summarize(day: string): Promise<void>
}
