import type { WorkstreamDraft } from '#lib/workstreams/ai.ts'
import { relationshipProposal } from '#lib/workstreams/relationships.ts'
import { ActivitySchema, type Activity, type Workstream } from '#lib/workstreams/types.ts'

type Proposal = {
  title: string
  outcome: string
  understanding?: string
  unknowns?: string[]
  activities: Activity[]
  proposals: Workstream['proposals']
}
type DraftProposal = Pick<WorkstreamDraft, 'title' | 'outcome'> & Partial<Omit<WorkstreamDraft, 'title' | 'outcome'>>

export function normalizeWorkstreamProposal(value: DraftProposal): Proposal {
  return {
    title: value.title,
    outcome: value.outcome,
    understanding: value.understanding,
    unknowns: value.unknowns ?? [],
    activities: [
      ...(value.activities ?? []).map((activity) =>
        ActivitySchema.parse({
          id: crypto.randomUUID(),
          title: activity.title,
          notes: activity.description ?? '',
          executor: activity.executor ?? 'human',
          state: 'proposed',
        }),
      ),
      ...(value.decisions ?? []).map((decision) =>
        ActivitySchema.parse({
          id: crypto.randomUUID(),
          title: decision.question,
          kind: 'decision',
          notes: decision.context ?? '',
          recommendation: decision.recommendation ?? '',
          state: 'proposed',
        }),
      ),
    ],
    proposals: [
      ...(value.coordination &&
      (value.coordination.stakeholders?.length ||
        value.coordination.reporting?.length ||
        value.coordination.timeline ||
        value.coordination.metrics?.length)
        ? [
            {
              id: crypto.randomUUID(),
              kind: 'coordination' as const,
              title: 'People, timing, and updates',
              reason: 'Details Sky drew from your intention, with suggestions to review.',
              coordination: value.coordination,
            },
          ]
        : []),
      ...(value.subworkstreams ?? []).map((child) => ({
        id: crypto.randomUUID(),
        kind: 'subworkstream' as const,
        title: child.title,
        outcome: child.outcome,
        reason: child.reason,
      })),
      ...(value.relationships ?? []).map((relation) => ({
        id: crypto.randomUUID(),
        ...relationshipProposal(relation),
      })),
      ...(value.suggestions ?? []).map((suggestion) => ({
        id: crypto.randomUUID(),
        kind: 'suggestion' as const,
        title: suggestion,
        reason: 'A possible next refinement from Sky.',
      })),
    ],
  }
}

export function acceptWorkstreamProposal(proposal: Proposal): Proposal {
  return { ...proposal, activities: proposal.activities.map((activity) => ({ ...activity, state: 'ready' })) }
}
