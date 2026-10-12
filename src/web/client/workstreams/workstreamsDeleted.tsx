import { Button, Drawer, Modal } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useState } from 'react'
import type { WorkstreamDeletionReceipt } from '#lib/workstreams/types.ts'
import './workstreamsDeleted.css'

const HIDDEN_DELETIONS = 'sky-workstreams-hidden-deletions'

export function useHiddenWorkstreamDeletions() {
  const [hidden, setHidden] = useState<Record<string, string>>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(HIDDEN_DELETIONS) ?? '{}')
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
      return Object.fromEntries(Object.entries(value).filter((entry) => typeof entry[1] === 'string'))
    } catch {
      return {}
    }
  })
  const hide = (receipts: WorkstreamDeletionReceipt[]) => {
    const next = Object.fromEntries(receipts.map((receipt) => [receipt.id, receipt.revision]))
    setHidden(next)
    try {
      localStorage.setItem(HIDDEN_DELETIONS, JSON.stringify(next))
    } catch {
      // Hiding still works for this visit when browser preferences are unavailable.
    }
  }
  return { hidden, hide }
}

export type DeletedWorkView = 'list' | WorkstreamDeletionReceipt | null

export function DeletedWorkDialog({
  view,
  receipts,
  busy,
  error,
  onView,
  onRestore,
  onPurge,
}: {
  view: DeletedWorkView
  receipts: WorkstreamDeletionReceipt[]
  busy: boolean
  error: string
  onView: (view: DeletedWorkView) => void
  onRestore: (receipt: WorkstreamDeletionReceipt) => void
  onPurge: (receipt: WorkstreamDeletionReceipt) => void
}) {
  const phone = useMediaQuery('(max-width: 600px)')
  const confirming = view && view !== 'list' ? view : null
  const title = confirming ? `Delete “${confirming.title}” permanently?` : 'Deleted work'
  const close = () => {
    if (!busy) onView(null)
  }
  const content = (
    <div className="sky-workstreams-deleted-dialog">
      {error && (
        <p role="alert" className="sky-workstreams-error">
          {error}
        </p>
      )}
      {confirming ? (
        <>
          <p>This removes the workstream and its own saved files.</p>
          <p className="sky-workstreams-deleted-consequence">You won’t be able to undo it.</p>
          <div className="sky-dialog-actions">
            <Button disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={() => onPurge(confirming)}>
              Delete permanently
            </Button>
          </div>
        </>
      ) : receipts.length ? (
        receipts.map((receipt) => (
          <div className="sky-workstreams-deleted-row" key={`${receipt.id}:${receipt.revision}`}>
            <span>{receipt.title}</span>
            <div className="sky-workstreams-deleted-actions">
              <Button
                size="sm"
                disabled={busy || receipt.purging}
                aria-label={`Undo delete ${receipt.title}`}
                onClick={() => onRestore(receipt)}
              >
                Restore
              </Button>
              <Button
                size="sm"
                variant="danger-quiet"
                disabled={busy}
                aria-label={`Delete permanently ${receipt.title}`}
                onClick={() => onView(receipt)}
              >
                Delete permanently…
              </Button>
            </div>
          </div>
        ))
      ) : (
        <p>No deleted workstreams.</p>
      )}
    </div>
  )
  return phone ? (
    <Drawer
      opened={!!view}
      onClose={close}
      title={title}
      position="bottom"
      size="auto"
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
      withCloseButton={!busy}
    >
      {content}
    </Drawer>
  ) : (
    <Modal
      opened={!!view}
      onClose={close}
      title={title}
      size="md"
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
      withCloseButton={!busy}
    >
      {content}
    </Modal>
  )
}
