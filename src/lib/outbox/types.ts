import { z } from 'zod'
import { WritingDraftId } from '#lib/writingVoice/draftId.ts'
import type { WritingDraft } from '#lib/writingVoice/draftTypes.ts'
import { OutboxItemId } from './itemId.ts'
import { ScanRangeSchema, type ScanRange } from './range.ts'
import { RequestAnalysisStampSchema, RequestId, RequestRecordSchema, type RequestResponse } from './requestTypes.ts'

export const MAX_OUTBOX_DRAFT_CHARS = 40_000

export const SourceSchema = z.object({
  ref: z.string(),
  hash: z.string(),
  from: z.string(),
  to: z.string(),
  body: z.string(),
  times: z.array(z.string()).optional(),
})

export const TargetSchema = z.discriminatedUnion('medium', [
  z.object({ medium: z.literal('Slack'), link: z.string() }),
  z.object({ medium: z.literal('Email'), account: z.string(), thread: z.string() }),
  // A Beeper chat: the desktop app places the draft, whatever network the chat is on.
  z.object({ medium: z.literal('Beeper'), account: z.string(), chat: z.string(), group: z.boolean().optional() }),
])

export const ConversationSchema = z.object({
  key: z.string(),
  version: z.string(),
  /** The app the conversation happened in: Slack, Email, or a chat network Beeper carries. */
  medium: z.string().min(1),
  sources: z.array(SourceSchema),
  target: TargetSchema.nullable(),
  limitations: z.array(z.string()),
  incomplete: z.boolean().optional(),
})

export const ReviewSchema = z.object({
  at: z.string(),
  original: z.string(),
  final: z.string(),
  sourceVersion: z.string(),
})

export const FollowupProposalSchema = z.object({
  recipient: z.string().trim().min(1).max(160),
  commitment: z.string().trim().min(1).max(2000),
  title: z.string().trim().min(1).max(160),
  situation: z.string().trim().min(1).max(1600),
  draft: z.string().trim().min(1).max(8000),
})

export const FollowupSchema = FollowupProposalSchema.extend({
  id: OutboxItemId,
})

export const ReplyOptionSchema = z.object({
  label: z.string().min(1).max(70),
  instruction: z.string().min(1).max(1200),
})

/** A snapshot of the specific work informing this draft, checked again at approval. */
export const WorkstreamLinkSchema = z.object({
  workstreamId: z.string(),
  activityId: z.string().optional(),
  decisionIds: z.array(z.string()).default([]),
  title: z.string(),
  context: z.string(),
  contextVersion: z.string(),
  sourceIds: z.array(z.string()).optional(),
  fullContext: z.boolean().optional(),
})

export const ItemSchema = z.object({
  id: OutboxItemId,
  created: z.string(),
  updated: z.string(),
  status: z.enum(['needs_review', 'placing', 'ready', 'placement_unknown', 'dismissed']),
  requests: z.array(RequestRecordSchema).optional(),
  requestIds: z.array(RequestId).optional(),
  requestAnalysis: RequestAnalysisStampSchema.optional(),
  conversation: ConversationSchema,
  title: z.string(),
  situation: z.string(),
  summary: z.string().optional(),
  reasoning: z.string(),
  questions: z.array(z.string()),
  recommendation: z.string().optional(),
  replyOptions: z.array(ReplyOptionSchema).max(4).optional(),
  replyDirections: z
    .array(z.object({ at: z.string(), text: z.string().max(4000), sourceVersion: z.string() }))
    .max(12)
    .optional(),
  originalDraft: z.string(),
  draft: z.string(),
  draftId: WritingDraftId.optional(),
  edited: z.boolean(),
  stale: z.boolean(),
  reviews: z.array(ReviewSchema),
  native: z.object({ id: z.string(), url: z.string() }).nullable(),
  placementError: z.string().nullable(),
  placementOwner: z.number().int().positive().optional(),
  workstreams: z.array(WorkstreamLinkSchema).optional(),
  /** Stable producer identity; retries of this intent reuse its existing review item. */
  intentIds: z.array(z.string()).optional(),
  origin: z.enum(['conversation', 'workstream', 'followup']).optional(),
  recipient: z.string().optional(),
  /** Prepared from the exact approved reply; materialized only after confirmed handoff or a sent report. */
  followups: z.array(FollowupSchema).max(4).optional(),
  followupContext: z
    .object({ reply: z.string(), sourceVersion: z.string(), conversation: ConversationSchema.optional() })
    .optional(),
  followupStatus: z.enum(['pending', 'preparing', 'complete', 'failed']).optional(),
  followupError: z.string().optional(),
  followupOf: z
    .object({
      id: OutboxItemId,
      title: z.string(),
      reply: z.string(),
      commitment: z.string(),
      at: z.string(),
      sourceVersion: z.string(),
    })
    .optional(),
  requestSources: z.array(z.object({ ref: z.string(), hash: z.string() })).optional(),
  contextError: z.string().optional(),
  delivery: z.object({ at: z.string(), evidence: z.string(), kind: z.literal('owner_report') }).optional(),
  reviewRange: ScanRangeSchema.optional(),
  responseHistory: z
    .array(
      z.object({
        at: z.string(),
        sourceVersion: z.string(),
        kind: z.enum(['owner_report', 'captured_reply']),
        evidence: z.string(),
        reply: z.string().optional(),
      }),
    )
    .optional(),
})

export type Conversation = z.infer<typeof ConversationSchema>
export type WorkstreamLink = z.infer<typeof WorkstreamLinkSchema>
export type OutboxItem = z.infer<typeof ItemSchema>
export type OutboxRecord = OutboxItem & {
  revision: string
  writingDraft?: WritingDraft
  /** The item's words as the shared editor shows them while no notebook record exists. Never persisted. */
  unsavedDraft?: WritingDraft
  /** Worker status is local process state, never persisted in the decision record. */
  composition?: {
    id: string
    status: 'running' | 'complete' | 'failed'
    revision: string
    submittedRevision?: string
    error?: string
  }
}
export type Review = z.infer<typeof ReviewSchema>
export type FollowupProposal = z.infer<typeof FollowupProposalSchema>
export type Followup = z.infer<typeof FollowupSchema>
export type PrepareFollowups = (input: {
  item: OutboxRecord
  reply: string
  preferences: string
}) => Promise<FollowupProposal[]>
export type DraftProposal = {
  action: 'ignore' | 'draft' | 'decision'
  title: string
  situation: string
  summary?: string
  reasoning: string
  questions: string[]
  draft: string
  recommendation?: string
  replyOptions?: z.infer<typeof ReplyOptionSchema>[]
  responseEvidence?: { ref: string; quote: string } | null
  requestPlans?: { id: string; response: RequestResponse }[]
}

export type ComposeReply = (input: {
  item: OutboxRecord
  draft: string
  instruction: string
  preferences: string
  examples: Review[]
}) => Promise<DraftProposal>

export type ScanReport = {
  outcome: 'acted' | 'nothing' | 'failed'
  considered: number
  prepared: number
  ignored: number
  stale: number
  failed: number
  pending: number
  date?: string
  total?: number
  completed?: number
  unchanged?: number
  answered?: number
  incomplete?: number
  range?: ScanRange
}

export type ScanCheck = {
  key: string
  version: string
  refs: string[]
  medium?: Conversation['medium']
  title: string
  reason: string
  disposition: 'review' | 'ignored' | 'preserved' | 'answered' | 'failed'
  itemId?: string
  model?: string
  modelProfile?: string
  rangeKey?: string
  limitations?: string[]
  itemRevision?: string
  requestAnalysisVersion?: string
}

export type ScanProgress = ScanReport & {
  id: string
  date: string
  at: string
  owner: number
  status: 'running' | 'complete' | 'failed'
  total: number
  completed: number
  checks: ScanCheck[]
  error?: string
}

export class OutboxError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 503 = 400,
  ) {
    super(message)
    this.name = 'OutboxError'
  }
}
