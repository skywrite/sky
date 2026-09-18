import type { Activity, Workstream } from '#lib/workstreams/types.ts'
import type { CanvasRelationship } from './workstreamsCanvas.tsx'

export const relationshipLabels: Record<CanvasRelationship['kind'], string> = {
  related: 'Related to',
  contributes: 'Contributes to',
  parent: 'Part of',
  prerequisite: 'Needs a result from',
}

export function relationshipLabel(relationship: CanvasRelationship, viewedId?: string): string {
  if (relationship.toId !== viewedId) return relationshipLabels[relationship.kind]
  return {
    related: 'Related to',
    contributes: 'Contributed to by',
    parent: 'Includes',
    prerequisite: 'Provides a result for',
  }[relationship.kind]
}

export function requiredResultAvailable(requirement: Activity['requires'][number], all: Workstream[]): boolean {
  const work = all.find((candidate) => candidate.id === requirement.workstreamId && !candidate.deletion)
  const activity = work?.activities.find((candidate) => candidate.id === requirement.activityId)
  return activity?.subworkstreamId
    ? all.some((child) => child.id === activity.subworkstreamId && !child.deletion && child.state === 'completed')
    : activity?.state === 'done'
}

export function relationshipsFor(item: Workstream, all: Workstream[]): CanvasRelationship[] {
  return all.flatMap((source): CanvasRelationship[] => {
    const edges: CanvasRelationship[] = source.relations.map((relation) => ({
      kind: relation.kind,
      fromId: source.id,
      toId: relation.targetId,
      reason: relation.reason,
    }))
    if (source.parentId) edges.push({ kind: 'parent', fromId: source.id, toId: source.parentId, reason: '' })
    for (const activity of source.activities)
      for (const requirement of activity.requires)
        edges.push({
          kind: 'prerequisite',
          fromId: source.id,
          toId: requirement.workstreamId,
          activityId: activity.id,
          requiredActivityId: requirement.activityId,
          reason: requirement.result,
        })
    return edges.filter((edge) => edge.fromId !== edge.toId && (edge.fromId === item.id || edge.toId === item.id))
  })
}

export function proposalRelationship(
  item: Workstream,
  proposal: Workstream['proposals'][number],
): CanvasRelationship | null {
  if (proposal.kind !== 'relation' || !proposal.targetId) return null
  const legacy = /^(related|contributes|part-of|prerequisite):\s*/.exec(proposal.reason)?.[1]
  const kind = proposal.relationKind ?? legacy ?? 'related'
  return {
    fromId: item.id,
    toId: proposal.targetId,
    kind: kind === 'part-of' ? 'parent' : (kind as CanvasRelationship['kind']),
    reason: proposal.reason,
    activityId: proposal.activityId,
    requiredActivityId: proposal.requiredActivityId,
    proposalId: proposal.id,
  }
}

/** Only the owning record is patched; changing an edge cannot overwrite its neighbor. */
export function relationshipChanges(
  source: Workstream,
  next: CanvasRelationship | null,
  previous?: CanvasRelationship,
): Partial<Workstream> {
  if ((next && next.fromId !== source.id) || (previous && previous.fromId !== source.id))
    throw new Error('Open the workstream that owns this relationship.')
  const changes: Partial<Workstream> = {}
  if (previous) {
    if (previous.kind === 'parent') {
      if (source.parentId === previous.toId) changes.parentId = undefined
    } else if (previous.kind === 'prerequisite') {
      changes.activities = source.activities.map((activity) =>
        activity.id === previous.activityId
          ? {
              ...activity,
              requires: activity.requires.filter(
                (entry) => entry.workstreamId !== previous.toId || entry.activityId !== previous.requiredActivityId,
              ),
            }
          : activity,
      )
    } else changes.relations = source.relations.filter((entry) => entry.targetId !== previous.toId)
  }
  if (!next) return changes
  if (next.fromId === next.toId) throw new Error('Choose a different workstream.')
  if (next.kind === 'parent') changes.parentId = next.toId
  else if (next.kind === 'prerequisite') {
    if (!next.activityId || !next.requiredActivityId || !next.reason.trim())
      throw new Error('Choose the activity that is waiting and the result it needs.')
    if (!source.activities.some((activity) => activity.id === next.activityId))
      throw new Error('The activity that is waiting could not be found.')
    changes.activities = (changes.activities ?? source.activities).map((activity) =>
      activity.id === next.activityId
        ? {
            ...activity,
            requires: [
              ...activity.requires.filter(
                (entry) => entry.workstreamId !== next.toId || entry.activityId !== next.requiredActivityId,
              ),
              { workstreamId: next.toId, activityId: next.requiredActivityId!, result: next.reason.trim() },
            ],
          }
        : activity,
    )
  } else
    changes.relations = [
      ...(changes.relations ?? source.relations).filter((entry) => entry.targetId !== next.toId),
      { targetId: next.toId, kind: next.kind, reason: next.reason.trim() },
    ]
  return changes
}
