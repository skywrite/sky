import { Button } from '@mantine/core'
import type { Key } from 'react'
import type { Workstream } from '#lib/workstreams/types.ts'
import { useWorkstreamDetail } from './WorkstreamDetailContext.ts'
import { CoordinationPreview } from './workstreamsCoordination.tsx'
import { workstreamRequest } from './workstreamsRequest.ts'

export function ProposalRow({
  proposal,
}: {
  key?: Key | null
  proposal: NonNullable<Workstream['proposals']>[number]
}) {
  const { item, busy, act, onReviewRelationship } = useWorkstreamDetail()
  return (
    <div className="sky-workstream-suggestion">
      <strong>{proposal.title}</strong>
      {proposal.reason !== proposal.title && <p>{proposal.reason}</p>}
      {proposal.outcome && <p>{proposal.outcome}</p>}
      {proposal.kind === 'coordination' && proposal.coordination && (
        <CoordinationPreview proposal={proposal.coordination} />
      )}
      <div className="sky-workstream-brief-actions">
        <Button
          size="xs"
          variant="primary-quiet"
          disabled={busy}
          onClick={() =>
            proposal.kind === 'relation'
              ? onReviewRelationship(item.id, proposal.id)
              : void act(async () => {
                  await workstreamRequest(`/${item.id}/proposals/${proposal.id}/accept`, 'POST', {
                    revision: item.revision,
                  })
                })
          }
        >
          {proposal.kind === 'relation' ? 'Review relationship' : 'Apply suggestion'}
        </Button>
        <Button
          size="xs"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              await workstreamRequest(`/${item.id}/proposals/${proposal.id}/dismiss`, 'POST', {
                revision: item.revision,
              })
            })
          }
        >
          Dismiss
        </Button>
      </div>
    </div>
  )
}
