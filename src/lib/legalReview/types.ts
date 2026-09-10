import { z } from 'zod'

export const EvidenceSchema = z.object({
  documentId: z.string(),
  location: z
    .string()
    .min(1)
    .describe('Printed page and clause/section, or an explicit statement that numbering is unavailable'),
  quote: z.string().min(1).describe('Verbatim supporting text, never an invented quotation for a missing provision'),
})

export const AnalysisSchema = z.object({
  title: z.string().min(1),
  perspective: z.object({
    party: z
      .string()
      .describe('The represented person/entity, or Unknown when the supplied context cannot establish it'),
    basis: z
      .string()
      .describe('Which supplied profile or conversation facts establish the perspective; distinguish inference'),
    priorities: z.array(z.string()),
    uncertainties: z.array(z.string()),
  }),
  documents: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      version: z.string().describe('Document date/version if stated; otherwise Version not stated'),
      purpose: z.string(),
      coverage: z.enum(['complete', 'partial']),
      limitations: z.array(z.string()),
      relationships: z.array(
        z.object({
          documentId: z.string(),
          kind: z.enum(['amends', 'supplements', 'incorporates', 'takes-precedence', 'related']),
          explanation: z.string(),
        }),
      ),
    }),
  ),
  findings: z.array(
    z.object({
      existingId: z
        .string()
        .nullable()
        .describe('Use the prior finding ID when revisiting the same issue; null for a new issue'),
      title: z.string().min(1),
      severity: z.enum(['glaring', 'material', 'uncertainty']),
      kind: z.enum(['clause', 'missing-protection', 'interaction']),
      assessment: z.enum(['open', 'addressed', 'uncertain']).describe('AI assessment only, never a user decision'),
      explanation: z.string().min(1),
      recommendation: z.string(),
      evidence: z.array(EvidenceSchema).min(1),
    }),
  ),
  missingDocuments: z.array(z.string()),
  comparison: z
    .string()
    .min(1)
    .describe(
      'Two to four concise sentences on consequential relationships and precedence; distinguish conflicts from intentional exceptions. No coverage checklist or recap of each clause.',
    ),
})

export type Analysis = z.infer<typeof AnalysisSchema>
export type Evidence = z.infer<typeof EvidenceSchema> & { verification: 'text-matched' | 'pdf-citation' | 'unverified' }
export type ReviewDocument = {
  id: string
  name: string
  file: string
  hash: string
  added: string
  replaces?: string
  supersededBy?: string
  status: 'pending' | 'reviewed' | 'partial'
  details?: Analysis['documents'][number]
}
export type Finding = Omit<Analysis['findings'][number], 'existingId' | 'evidence'> & {
  id: string
  evidence: Evidence[]
  needsRecheck: boolean
}
export const DecisionSchema = z.object({
  findingId: z.string(),
  action: z.enum(['ask-team', 'accept-risk', 'resolved', 'reopen']),
  note: z.string().max(4000).default(''),
})
export type Decision = z.infer<typeof DecisionSchema> & { id: string; at: string; source: 'user'; basis: string }
export type LegalReview = {
  version: 1
  id: string
  created: string
  updated: string
  title: string
  revision: number
  expectedDocuments?: number
  focus: string
  source: string
  documents: ReviewDocument[]
  findings: Finding[]
  decisions: Decision[]
  perspective?: Analysis['perspective']
  missingDocuments: string[]
  comparison: { status: 'needed' | 'current'; summary: string; at?: string }
  lastError?: string
}

export type ReviewSource = { path: string; name: string }
export const SavedReviewSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  created: z.string(),
  updated: z.string(),
  title: z.string(),
  revision: z.number().int().nonnegative(),
  expectedDocuments: z.number().int().positive().optional(),
  focus: z.string(),
  source: z.string(),
  documents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      file: z.string(),
      hash: z.string(),
      added: z.string(),
      replaces: z.string().optional(),
      supersededBy: z.string().optional(),
      status: z.enum(['pending', 'reviewed', 'partial']),
      details: AnalysisSchema.shape.documents.element.optional(),
    }),
  ),
  findings: z.array(
    AnalysisSchema.shape.findings.element.omit({ existingId: true, evidence: true }).extend({
      id: z.string(),
      needsRecheck: z.boolean(),
      evidence: z.array(
        EvidenceSchema.extend({ verification: z.enum(['text-matched', 'pdf-citation', 'unverified']) }),
      ),
    }),
  ),
  decisions: z.array(
    DecisionSchema.extend({ id: z.string(), at: z.string(), source: z.literal('user'), basis: z.string() }),
  ),
  perspective: AnalysisSchema.shape.perspective.optional(),
  missingDocuments: z.array(z.string()),
  comparison: z.object({ status: z.enum(['needed', 'current']), summary: z.string(), at: z.string().optional() }),
  lastError: z.string().optional(),
})

export type ReviewContext = {
  source: string
  instructions: string
  conversation: readonly { role: 'user' | 'assistant'; content: string }[]
}
export type ReviewInput = {
  id?: string
  sources: ReviewSource[]
  replaces?: string
  focus?: string
  expectedDocuments?: number
  context: ReviewContext
  onCreated?: (id: string) => Promise<void>
}

export function activeDocuments(review: LegalReview): ReviewDocument[] {
  return review.documents.filter((document) => !document.supersededBy)
}

export function openFindings(review: LegalReview): Finding[] {
  return review.findings.filter((finding) => {
    const decision = review.decisions.findLast((item) => item.findingId === finding.id)
    if (finding.needsRecheck) return true
    if (decision && decision.basis !== findingBasis(finding)) return true
    if (decision?.action === 'accept-risk' || decision?.action === 'resolved') return false
    return decision?.action === 'reopen' || finding.assessment !== 'addressed'
  })
}

/** Decisions apply to what the user actually reviewed, not a subsequently changed recommendation. */
export function findingBasis(finding: Finding): string {
  return JSON.stringify([
    finding.title,
    finding.severity,
    finding.assessment,
    finding.explanation,
    finding.recommendation,
    finding.evidence,
  ])
}
