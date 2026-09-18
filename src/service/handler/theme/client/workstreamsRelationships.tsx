import { Button, Drawer, Modal, Select, Textarea } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useState } from 'react'
import type { Workstream, WorkstreamRecord } from '#lib/workstreams/types.ts'
import type { CanvasRelationship } from './workstreamsCanvas.tsx'
import { relationshipLabels, requiredResultAvailable } from './workstreamsRelationshipModel.ts'
import './workstreamsRelationships.css'

export type RelationshipEditorTarget = {
  source: WorkstreamRecord
  toId?: string
  relationship?: CanvasRelationship
  proposal?: Workstream['proposals'][number]
}

export function WorkstreamRelationshipEditor({
  target,
  all,
  busy,
  error,
  onClose,
  onSave,
  onRemove,
  onOpen,
}: {
  target: RelationshipEditorTarget
  all: WorkstreamRecord[]
  busy: boolean
  error: string
  onClose: () => void
  onSave: (relationship: CanvasRelationship) => void
  onRemove: () => void
  onOpen: (id: string) => void
}) {
  const phone = useMediaQuery('(max-width: 900px)') ?? false
  const [kind, setKind] = useState<CanvasRelationship['kind'] | null>(
    target.proposal && !target.proposal.relationKind && target.proposal.reason.startsWith('child:')
      ? null
      : (target.relationship?.kind ?? 'related'),
  )
  const [toId, setToId] = useState<string | null>(target.relationship?.toId ?? target.toId ?? null)
  const [reason, setReason] = useState(target.proposal?.reason ?? target.relationship?.reason ?? '')
  const [requiredResult, setRequiredResult] = useState(
    target.proposal
      ? (target.proposal.requiredResult ?? '')
      : target.relationship?.kind === 'prerequisite'
        ? target.relationship.reason
        : '',
  )
  const [activityId, setActivityId] = useState<string | null>(target.relationship?.activityId ?? null)
  const [requiredActivityId, setRequiredActivityId] = useState<string | null>(
    target.relationship?.requiredActivityId ?? null,
  )
  const other = all.find((work) => work.id === toId)
  const waiting = target.source.activities.find((activity) => activity.id === activityId)
  const required = other?.activities.find((activity) => activity.id === requiredActivityId)
  const ready = !!kind && !!other && (kind !== 'prerequisite' || (!!waiting && !!required && !!requiredResult.trim()))
  const title = target.proposal ? 'Review relationship' : target.relationship ? 'Relationship' : 'Relate workstreams'
  const existing = !!target.relationship && !target.proposal
  const content = (
    <div className="sky-workstream-relationship-editor">
      {target.proposal && (
        <div className="sky-workstream-relationship-suggestion">
          <strong>Sky suggests</strong>
          <p>{target.proposal.reason}</p>
        </div>
      )}
      <div className="sky-workstream-relationship-source">
        <span>This workstream</span>
        <strong>{target.source.title}</strong>
      </div>
      <Select
        label="Relationship"
        comboboxProps={{ withinPortal: !phone }}
        placeholder="Choose how these workstreams relate"
        data={Object.entries(relationshipLabels).map(([value, label]) => ({ value, label }))}
        value={kind}
        allowDeselect={false}
        onChange={(value) => setKind(value as CanvasRelationship['kind'])}
      />
      <Select
        label="Other workstream"
        comboboxProps={{ withinPortal: !phone }}
        placeholder="Find a workstream"
        searchable
        nothingFoundMessage="No matching workstreams"
        data={all.filter((work) => work.id !== target.source.id).map((work) => ({ value: work.id, label: work.title }))}
        value={toId}
        onChange={(value) => {
          setToId(value)
          setRequiredActivityId(null)
        }}
      />
      {kind === 'prerequisite' ? (
        <>
          <Select
            label="Which activity is waiting?"
            comboboxProps={{ withinPortal: !phone }}
            placeholder="Choose an activity in this workstream"
            searchable
            data={target.source.activities
              .filter((activity) => !activity.subworkstreamId)
              .map((activity) => ({
                value: activity.id,
                label: activity.title,
              }))}
            value={activityId}
            onChange={setActivityId}
          />
          <Select
            label="Which activity provides the result?"
            comboboxProps={{ withinPortal: !phone }}
            placeholder="Choose an activity in the other workstream"
            searchable
            disabled={!other}
            data={(other?.activities ?? [])
              .filter((activity) => !activity.subworkstreamId)
              .map((activity) => ({
                value: activity.id,
                label: activity.title,
              }))}
            value={requiredActivityId}
            onChange={setRequiredActivityId}
          />
          <Textarea
            label="What result is needed?"
            placeholder="Describe what must be true before this activity can proceed"
            autosize
            minRows={2}
            value={requiredResult}
            onChange={(event) => setRequiredResult(event.currentTarget.value)}
          />
          {waiting && required && (
            <p className="sky-workstream-relationship-explanation">
              “{waiting.title}” needs the result of “{required.title}”.{' '}
              {requiredResultAvailable(
                { workstreamId: other!.id, activityId: required.id, result: requiredResult },
                all,
              )
                ? 'That result is recorded as complete.'
                : 'That result is still pending.'}
            </p>
          )}
          {other && (!target.source.activities.length || !other.activities.length) && (
            <p className="sky-workstream-hint">
              Add the activities to their workstreams before setting a prerequisite.
            </p>
          )}
        </>
      ) : kind === 'parent' ? (
        <p className="sky-workstream-relationship-explanation">
          {other
            ? `“${target.source.title}” forms part of “${other.title}”.`
            : 'Choose the larger workstream this work belongs to.'}
        </p>
      ) : (
        <Textarea
          label="Why this matters"
          placeholder="Describe how this work relates"
          autosize
          minRows={2}
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
        />
      )}
      {other && (
        <div className="sky-workstream-relationship-links">
          <Button variant="primary-quiet" size="sm" onClick={() => onOpen(target.source.id)}>
            Open this workstream ↗
          </Button>
          <Button variant="primary-quiet" size="sm" onClick={() => onOpen(other.id)}>
            Open related work ↗
          </Button>
        </div>
      )}
      {error && (
        <p className="sky-workstreams-error" role="alert">
          {error}
        </p>
      )}
      <div className="sky-dialog-actions">
        {existing && (
          <Button variant="danger-quiet" disabled={busy} onClick={onRemove}>
            Remove relationship
          </Button>
        )}
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy || !ready}
          onClick={() => {
            if (toId && kind)
              onSave({
                fromId: target.source.id,
                toId,
                kind,
                reason: kind === 'prerequisite' ? requiredResult : reason,
                ...(kind === 'prerequisite'
                  ? { activityId: activityId!, requiredActivityId: requiredActivityId! }
                  : {}),
              })
          }}
        >
          {target.proposal ? 'Apply relationship' : existing ? 'Save relationship' : 'Add relationship'}
        </Button>
      </div>
    </div>
  )
  return phone ? (
    <Drawer opened onClose={onClose} title={title} position="bottom" size="auto">
      {content}
    </Drawer>
  ) : (
    <Modal opened onClose={onClose} title={title} size="lg">
      {content}
    </Modal>
  )
}
