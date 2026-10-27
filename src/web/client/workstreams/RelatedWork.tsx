import { relationshipLabel, relationshipsFor } from './relationshipModel.ts'
import { useWorkstreamDetail } from './WorkstreamDetailContext.ts'

export function RelatedWork({ limit }: { limit?: number }) {
  const { item, all, onInspectRelationship } = useWorkstreamDetail()
  return (
    <>
      {relationshipsFor(item, all)
        .slice(0, limit)
        .map((relation) => {
          const id = relation.fromId === item.id ? relation.toId : relation.fromId
          const target = all.find((candidate) => candidate.id === id)
          const title = target?.title ?? 'Unavailable workstream'
          return (
            <button
              type="button"
              className="sky-workstream-related"
              key={`${relation.fromId}:${relation.toId}:${relation.kind}:${relation.activityId ?? ''}:${relation.requiredActivityId ?? ''}`}
              aria-label={`Inspect ${relationshipLabel(relation, item.id).toLowerCase()} relationship with ${title}`}
              onClick={() => onInspectRelationship(relation)}
            >
              <span aria-hidden="true">↔</span>
              <span>
                <strong>{title}</strong>
                <small>
                  {relationshipLabel(relation, item.id)}
                  {relation.reason ? ` · ${relation.reason}` : ''}
                </small>
              </span>
              <span aria-hidden="true">›</span>
            </button>
          )
        })}
    </>
  )
}
