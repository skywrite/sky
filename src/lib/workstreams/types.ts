import { z } from 'zod'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { ActionPolicySchema, ActionVerificationSchema } from './actionOutcome.ts'
import type { WorkstreamColor } from './colors.ts'
import { CoordinationProposalSchema } from './coordination.ts'
import {
  DecisionAssumptionSchema,
  DecisionPolicySchema,
  DecisionRecordSchema,
  DecisionResolutionSchema,
} from './decisionPolicy.ts'

const WorkDate = z.string().refine((value) => {
  try {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && new PlainDate(value).ymd === value
  } catch {
    return false
  }
}, 'Use a valid YYYY-MM-DD date.')

export const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/)
export const CreationOperationId = z.string().trim().min(1).max(256)
export const ActivityState = z.enum(['proposed', 'ready', 'running', 'waiting', 'done', 'canceled'])
export const Lifecycle = z.enum(['proposed', 'active', 'paused', 'completed', 'canceled'])
export const SkyMode = z.enum(['off', 'assist', 'drive'])
export const RelationshipKind = z.enum(['related', 'contributes', 'part-of', 'prerequisite'])

export const ParticipationSchema = z
  .object({
    day: WorkDate,
    title: z.string(),
    state: ActivityState,
    reportedAt: z.string().optional(),
    operationId: z.string().optional(),
    removed: z.boolean().optional(),
  })
  .passthrough()

export const ActivitySchema = z
  .object({
    id: Id,
    title: z.string().min(1).max(500),
    kind: z.enum(['action', 'decision', 'report']).default('action'),
    state: ActivityState.default('ready'),
    executor: z.enum(['human', 'sky']).default('human'),
    outcome: z.string().default(''),
    notes: z.string().default(''),
    result: z.string().default(''),
    recommendation: z.string().default(''),
    decisionAssumptions: z.array(DecisionAssumptionSchema).optional(),
    decisionAnalysis: DecisionRecordSchema.optional(),
    decisionResolution: DecisionResolutionSchema.optional(),
    decisionHistory: z.array(DecisionRecordSchema).optional(),
    actionVerification: ActionVerificationSchema.optional(),
    waitingFor: z.string().default(''),
    start: WorkDate.optional(),
    end: WorkDate.optional(),
    due: WorkDate.optional(),
    person: z.string().optional(),
    decisionPath: z.string().optional(),
    subworkstreamId: Id.optional(),
    outboxId: z.string().optional(),
    artifactIds: z.array(Id).default([]),
    requires: z.array(z.object({ workstreamId: Id, activityId: Id, result: z.string().default('') })).default([]),
    participation: z.array(ParticipationSchema).default([]),
  })
  .passthrough()

export const SourceSchema = z
  .object({
    id: Id,
    path: z.string().min(1).max(2000),
    label: z.string().default(''),
    sensitive: z.boolean().default(false),
    stakeholderIds: z.array(Id).optional(),
  })
  .passthrough()

export const ReportingSchema = z
  .object({
    id: Id,
    audience: z.string().min(1).max(500),
    medium: z.enum(['email', 'slack', 'document', 'other']).default('document'),
    destination: z.string().default(''),
    cadenceDays: z.number().int().min(1).max(365).default(7),
    instructions: z.string().default(''),
    detail: z.enum(['summary', 'operational']).default('summary'),
    allowSensitive: z.boolean().default(false),
    permittedSourceIds: z.array(Id).default([]),
    artifacts: z.array(z.string()).default([]),
    attachments: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(200),
          url: z
            .string()
            .url()
            .refine((value) => new URL(value).protocol === 'https:', 'Use an HTTPS artifact link.'),
        }),
      )
      .optional(),
    nextDueAt: z.string().optional(),
    lastPreparedAt: z.string().optional(),
  })
  .passthrough()

export const ArtifactSchema = z
  .object({
    id: Id,
    title: z.string(),
    path: z.string(),
    created: z.string(),
    activityId: Id.optional(),
    reportingId: Id.optional(),
    kind: z.enum(['draft', 'report', 'research', 'other']).default('draft'),
  })
  .passthrough()

export const HistorySchema = z
  .object({
    id: Id,
    at: z.string(),
    actor: z.enum(['human', 'sky']),
    kind: z.string(),
    summary: z.string(),
    activityId: Id.optional(),
    operationId: z.string().optional(),
  })
  .passthrough()

export const SkySchema = z
  .object({
    mode: SkyMode.default('off'),
    instruction: z
      .string()
      .default('Help clarify the outcome, prepare useful work, and bring me decisions that need my judgment.'),
    reviewEveryHours: z.number().min(0.25).max(720).default(24),
    maxRunsPerDay: z.number().int().min(1).max(96).default(8),
    maxRunsTotal: z.number().int().min(1).max(10000).optional(),
    decisionPolicies: z.record(Id, DecisionPolicySchema).default({}),
    actionPolicies: z.record(Id, ActionPolicySchema).default({}),
    lastReviewedAt: z.string().optional(),
    nextReviewAt: z.string().optional(),
    lastSummary: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough()

export const WorkstreamSchema = z
  .object({
    id: Id,
    title: z.string().min(1).max(200),
    intent: z.string().default(''),
    outcome: z.string().default(''),
    understanding: z.string().default(''),
    unknowns: z.array(z.string()).default([]),
    proposals: z
      .array(
        z.object({
          id: Id,
          kind: z.enum(['outcome', 'subworkstream', 'relation', 'suggestion', 'coordination']),
          title: z.string(),
          reason: z.string(),
          targetId: Id.optional(),
          relationKind: RelationshipKind.optional(),
          activityId: Id.optional(),
          requiredActivityId: Id.optional(),
          requiredResult: z.string().max(2400).optional(),
          outcome: z.string().optional(),
          coordination: CoordinationProposalSchema.optional(),
        }),
      )
      .default([]),
    notes: z.string().default(''),
    state: Lifecycle.default('active'),
    created: z.string(),
    updated: z.string(),
    creationOperationId: CreationOperationId.optional(),
    deletion: z.object({ id: Id, at: z.string(), previousRevision: z.string() }).optional(),
    parentId: Id.optional(),
    start: WorkDate.optional(),
    due: WorkDate.optional(),
    activities: z.array(ActivitySchema).default([]),
    sources: z.array(SourceSchema).default([]),
    relations: z
      .array(
        z.object({
          targetId: Id,
          kind: z.enum(['related', 'contributes']).default('related'),
          reason: z.string().default(''),
        }),
      )
      .default([]),
    stakeholders: z
      .array(z.object({ id: Id, name: z.string(), role: z.string().default(''), contact: z.string().default('') }))
      .default([]),
    metrics: z
      .array(
        z.object({
          id: Id,
          name: z.string(),
          target: z.string().default(''),
          current: z.string().default(''),
          unit: z.string().default(''),
        }),
      )
      .default([]),
    reporting: z.array(ReportingSchema).default([]),
    artifacts: z.array(ArtifactSchema).default([]),
    history: z.array(HistorySchema).default([]),
    sky: SkySchema.default(() => SkySchema.parse({})),
  })
  .passthrough()

export const RunSchema = z
  .object({
    id: Id,
    workstreamId: Id,
    status: z.enum(['running', 'completed', 'failed', 'interrupted', 'nothing']),
    trigger: z.enum(['manual', 'scheduled', 'context']),
    started: z.string(),
    finished: z.string().optional(),
    summary: z.string().default(''),
    error: z.string().optional(),
    artifactIds: z.array(Id).default([]),
  })
  .passthrough()

export type Workstream = z.infer<typeof WorkstreamSchema>
export type WorkstreamRecord = Workstream & { revision: string; path: string }
export type WorkstreamDeletionReceipt = { id: string; title: string; revision: string; purging?: boolean }
export type Activity = z.infer<typeof ActivitySchema>
export type Participation = z.infer<typeof ParticipationSchema>
export type WorkstreamSource = z.infer<typeof SourceSchema>
export type Reporting = z.infer<typeof ReportingSchema>
export type Artifact = z.infer<typeof ArtifactSchema>
export type WorkstreamRun = z.infer<typeof RunSchema>
export type SkySettings = z.infer<typeof SkySchema>
export type SkyGrant = Pick<
  SkySettings,
  'mode' | 'instruction' | 'reviewEveryHours' | 'maxRunsPerDay' | 'maxRunsTotal' | 'decisionPolicies' | 'actionPolicies'
> & { revision: string }

export type WorkstreamReport = {
  items: WorkstreamRecord[]
  deleted?: WorkstreamDeletionReceipt[]
  errors: { path: string; message: string }[]
  automation: { name: string; status: 'active' | 'paused' } | null
  today: string
  layout: Record<string, { x: number; y: number; order?: number; color?: WorkstreamColor }>
}

export class WorkstreamError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 503 = 400,
  ) {
    super(message)
    this.name = 'WorkstreamError'
  }
}
