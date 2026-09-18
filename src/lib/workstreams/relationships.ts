import { z } from 'zod'
import type { WorkstreamReview } from './ai.ts'
import { Id, RelationshipKind, WorkstreamError, type Workstream } from './types.ts'

export const RelationshipEditSchema = z.object({
  kind: RelationshipKind,
  targetId: Id,
  reason: z.string().trim().max(2400),
  activityId: Id.optional(),
  requiredActivityId: Id.optional(),
  requiredResult: z.string().trim().max(2400).optional(),
})

export function relationshipProposal(
  relation: WorkstreamReview['relationships'][number],
): Omit<Workstream['proposals'][number], 'id'> {
  return {
    kind: 'relation',
    title: relation.reason,
    targetId: relation.workstreamId,
    relationKind: relation.kind === 'child' ? 'part-of' : relation.kind,
    reason: relation.reason,
    activityId: relation.activityId,
    requiredActivityId: relation.requiredActivityId,
    requiredResult: relation.requiredResult,
  }
}

/** The current work contributes to / belongs to / needs a result from the target. */
export function acceptRelationship(
  work: Workstream,
  proposal: Workstream['proposals'][number],
  override?: z.infer<typeof RelationshipEditSchema>,
): Partial<Workstream> {
  // Earlier Sky runs retained the kind only as a reason prefix. Do not turn those prerequisites into related work.
  const legacy = /^(related|contributes|part-of|prerequisite|child):\s*/.exec(proposal.reason)
  if (!override && !proposal.relationKind && legacy?.[1] === 'child')
    throw new WorkstreamError('Choose which workstream is part of the other before accepting this relationship.')
  const relation = RelationshipEditSchema.parse(
    override ?? {
      kind: proposal.relationKind ?? legacy?.[1] ?? 'related',
      targetId: proposal.targetId,
      reason: legacy ? proposal.reason.slice(legacy[0].length) : proposal.reason,
      activityId: proposal.activityId,
      requiredActivityId: proposal.requiredActivityId,
      requiredResult: proposal.requiredResult,
    },
  )
  if (relation.kind === 'part-of') return { parentId: relation.targetId }
  if (relation.kind === 'prerequisite') {
    if (!relation.activityId || !relation.requiredActivityId || !relation.requiredResult)
      throw new WorkstreamError('Choose the activity that is waiting, the activity it needs, and the required result.')
    if (!work.activities.some((activity) => activity.id === relation.activityId))
      throw new WorkstreamError('The activity that needs this result could not be found.')
    return {
      activities: work.activities.map((activity) =>
        activity.id === relation.activityId
          ? {
              ...activity,
              requires: [
                ...activity.requires.filter(
                  (requirement) =>
                    requirement.workstreamId !== relation.targetId ||
                    requirement.activityId !== relation.requiredActivityId,
                ),
                {
                  workstreamId: relation.targetId,
                  activityId: relation.requiredActivityId!,
                  result: relation.requiredResult!,
                },
              ],
            }
          : activity,
      ),
    }
  }
  return {
    relations: [
      ...work.relations.filter((entry) => entry.targetId !== relation.targetId),
      { targetId: relation.targetId, kind: relation.kind, reason: relation.reason },
    ],
  }
}
