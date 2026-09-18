import { z } from 'zod'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const DateOnly = z.string().refine((value) => {
  try {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && new PlainDate(value).ymd === value
  } catch {
    return false
  }
}, 'Use a valid YYYY-MM-DD date.')
const Basis = z.enum(['stated', 'suggested'])

/** Reviewable coordination only. No source-access, execution, assignment, or delivery grants belong here. */
export const CoordinationProposalSchema = z.object({
  stakeholders: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        role: z.string().max(1000),
        contact: z.string().max(1000).optional(),
        reason: z.string().max(1600),
        basis: Basis,
      }),
    )
    .max(6)
    .optional(),
  reporting: z
    .array(
      z.object({
        audience: z.string().trim().min(1).max(500),
        medium: z.enum(['email', 'slack', 'document', 'other']),
        destination: z.string().max(1000).optional(),
        cadenceDays: z.number().int().min(1).max(365),
        instructions: z.string().max(4000),
        detail: z.enum(['summary', 'operational']),
        artifacts: z.array(z.string().max(500)).max(6),
        reason: z.string().max(1600),
        basis: Basis,
      }),
    )
    .max(6)
    .optional(),
  timeline: z
    .object({ start: DateOnly.optional(), due: DateOnly.optional(), reason: z.string().max(1600), basis: Basis })
    .refine(
      (value) => !value.start || !value.due || value.start <= value.due,
      'A proposed deadline cannot precede its start.',
    )
    .optional(),
  metrics: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(300),
        target: z.string().trim().min(1).max(1000),
        current: z.string().max(1000).optional(),
        unit: z.string().max(200).optional(),
        reason: z.string().max(1600),
        basis: z.literal('stated'),
        sourceQuote: z.string().trim().min(1).max(2000),
      }),
    )
    .max(6)
    .optional(),
})

export type CoordinationProposal = z.infer<typeof CoordinationProposalSchema>

/** Metrics require something actually supplied by the person or selected context, not a generic generated KPI. */
export function groundCoordination(
  proposal: CoordinationProposal,
  context: Record<string, unknown>,
): CoordinationProposal {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()
  const strings: string[] = []
  const visit = (value: unknown, depth: number): void => {
    if (depth > 12) return
    if (typeof value === 'string') strings.push(normalize(value))
    else if (Array.isArray(value)) value.forEach((entry) => visit(entry, depth + 1))
    else if (value && typeof value === 'object') Object.values(value).forEach((entry) => visit(entry, depth + 1))
  }
  visit(context, 0)
  return {
    ...proposal,
    ...(proposal.metrics
      ? {
          metrics: proposal.metrics.filter((metric) => {
            const quote = normalize(metric.sourceQuote)
            return (
              strings.some((text) => text.includes(quote)) &&
              quote.includes(normalize(metric.target)) &&
              (!metric.current || quote.includes(normalize(metric.current)))
            )
          }),
        }
      : {}),
  }
}
