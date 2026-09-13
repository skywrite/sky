import { z } from 'zod'

export const RequestId = z.string().regex(/^[a-f0-9]{32}$/)
export const RequestCitationSchema = z.object({
  kind: z.enum(['message', 'owner_report']),
  ref: z.string(),
  message: z.string(),
  heading: z.string().optional(),
  at: z.string().nullable(),
  quote: z.string().min(1).max(2000),
})
export const RequestReportSchema = z.object({
  at: z.string(),
  sourceVersion: z.string(),
  evidence: z.string(),
  reply: z.string(),
})
export const RequestResponseSchema = z.object({
  action: z.enum(['draft', 'decision']),
  destination: z.enum(['source_conversation', 'separate_conversation']).optional(),
  draft: z.string(),
  questions: z.array(z.string()),
  explanation: z.string(),
})
export const RequestAttentionSchema = z.object({
  action: z.enum(['reply', 'waiting', 'none']),
  basis: z.enum(['direct_request', 'active_exchange', 'owner_commitment', 'initiative_decision', 'none']),
  explanation: z.string().max(1600),
  evidence: z.array(RequestCitationSchema).max(4),
  initiative: z.object({ ref: z.string(), title: z.string() }).optional(),
})
export const RequestRecordSchema = z.object({
  id: RequestId,
  summary: z.string().min(1).max(600),
  origin: RequestCitationSchema,
  status: z.enum(['open', 'resolved', 'dismissed', 'uncertain']),
  explanation: z.string().max(1600),
  context: z.string().max(3000),
  evidence: z.array(RequestCitationSchema).max(4),
  resolution: RequestCitationSchema.nullable(),
  present: z.boolean().default(true),
  dismissal: z.object({ at: z.string(), sourceVersion: z.string(), kind: z.enum(['owner', 'legacy']) }).optional(),
  reports: z.array(RequestReportSchema).default([]),
  response: RequestResponseSchema.optional(),
  attention: RequestAttentionSchema.optional(),
})
export const RequestAnalysisStampSchema = z.object({
  version: z.string(),
  sourceVersion: z.string(),
  updated: z.string(),
  units: z.number().int().nonnegative(),
})
export type RequestCitation = z.infer<typeof RequestCitationSchema>
export type RequestReport = z.infer<typeof RequestReportSchema>
export type RequestRecord = z.infer<typeof RequestRecordSchema>
export type RequestResponse = z.infer<typeof RequestResponseSchema>
export type RequestAnalysisStamp = z.infer<typeof RequestAnalysisStampSchema>

export const requestNeedsReply = (request: RequestRecord): boolean =>
  request.present &&
  (request.status === 'open' || request.status === 'uncertain') &&
  (!request.attention ||
    (request.attention.action === 'reply' &&
      request.attention.basis !== 'none' &&
      request.attention.evidence.length > 0))
