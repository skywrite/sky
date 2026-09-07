import { z } from 'zod'

export const SourceSchema = z.object({
  ref: z.string(),
  hash: z.string(),
  from: z.string(),
  to: z.string(),
  body: z.string(),
})

export const TargetSchema = z.discriminatedUnion('medium', [
  z.object({ medium: z.literal('Slack'), link: z.string() }),
  z.object({ medium: z.literal('Email'), account: z.string(), thread: z.string() }),
])

export const ConversationSchema = z.object({
  key: z.string(),
  version: z.string(),
  medium: z.enum(['Slack', 'Email']),
  sources: z.array(SourceSchema),
  target: TargetSchema.nullable(),
  limitations: z.array(z.string()),
})

export const ReviewSchema = z.object({
  at: z.string(),
  original: z.string(),
  final: z.string(),
  sourceVersion: z.string(),
})

export const ItemSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/),
  created: z.string(),
  updated: z.string(),
  status: z.enum(['needs_review', 'placing', 'ready', 'placement_unknown', 'dismissed']),
  conversation: ConversationSchema,
  title: z.string(),
  situation: z.string(),
  reasoning: z.string(),
  questions: z.array(z.string()),
  originalDraft: z.string(),
  draft: z.string(),
  edited: z.boolean(),
  stale: z.boolean(),
  reviews: z.array(ReviewSchema),
  native: z.object({ id: z.string(), url: z.string() }).nullable(),
  placementError: z.string().nullable(),
  placementOwner: z.number().int().positive().optional(),
})

export type Conversation = z.infer<typeof ConversationSchema>
export type OutboxItem = z.infer<typeof ItemSchema>
export type OutboxRecord = OutboxItem & { revision: string }
export type Review = z.infer<typeof ReviewSchema>
export type DraftProposal = {
  action: 'ignore' | 'draft' | 'decision'
  title: string
  situation: string
  reasoning: string
  questions: string[]
  draft: string
}

export type ScanReport = {
  outcome: 'acted' | 'nothing' | 'failed'
  considered: number
  prepared: number
  ignored: number
  stale: number
  failed: number
  pending: number
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
