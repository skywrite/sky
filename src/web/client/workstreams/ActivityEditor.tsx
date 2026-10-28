import { ActionIcon, Button, Modal, Select, Textarea, TextInput } from '@mantine/core'
import { useState } from 'react'
import type { Activity, WorkstreamRecord } from '#lib/workstreams/types.ts'

export function ActivityEditor({
  activity,
  all,
  busy,
  onClose,
  onSave,
}: {
  activity: Activity
  all: WorkstreamRecord[]
  busy: boolean
  onClose: () => void
  onSave: (activity: Activity) => void
}) {
  const [draft, setDraft] = useState(activity)
  const [dependency, setDependency] = useState<string | null>(null)
  const change = (patch: Partial<Activity>) => setDraft({ ...draft, ...patch })
  const dependencies = all.flatMap((item) =>
    item.activities
      .filter((value) => value.id !== draft.id)
      .map((value) => ({ value: `${item.id}:${value.id}`, label: `${item.title} · ${value.title}` })),
  )
  return (
    <Modal
      opened
      onClose={onClose}
      title={draft.kind === 'decision' ? 'A decision in the work' : 'An activity in the work'}
      size="lg"
    >
      <div className="sky-workstream-edit">
        <TextInput
          label={draft.kind === 'decision' ? 'What needs deciding?' : 'What needs doing?'}
          value={draft.title}
          onChange={(event) => change({ title: event.currentTarget.value })}
        />
        <div className="sky-workstream-form-grid">
          <Select
            label="Kind"
            value={draft.kind}
            data={[
              { value: 'action', label: 'Action' },
              { value: 'decision', label: 'Decision' },
              { value: 'report', label: 'Report' },
            ]}
            onChange={(kind) =>
              change({ kind: kind as Activity['kind'], ...(kind === 'decision' ? { executor: 'human' as const } : {}) })
            }
          />
          <Select
            label="Who carries it?"
            value={draft.executor}
            data={[
              { value: 'human', label: 'A person' },
              { value: 'sky', label: 'Sky' },
            ]}
            onChange={(executor) => change({ executor: executor as Activity['executor'] })}
          />
        </div>
        {draft.executor === 'human' && (
          <TextInput
            label="Person, if known"
            value={draft.person ?? ''}
            onChange={(event) => change({ person: event.currentTarget.value || undefined })}
          />
        )}
        <Textarea
          label="What needs to be true when this is done?"
          autosize
          minRows={2}
          value={draft.outcome}
          onChange={(event) => change({ outcome: event.currentTarget.value })}
        />
        <Textarea
          label="Context and instructions"
          autosize
          minRows={3}
          value={draft.notes}
          onChange={(event) => change({ notes: event.currentTarget.value })}
        />
        {draft.kind === 'decision' && (
          <Textarea
            label="Recommendation"
            autosize
            minRows={2}
            value={draft.recommendation}
            onChange={(event) => change({ recommendation: event.currentTarget.value })}
          />
        )}
        <div className="sky-workstream-form-grid">
          <Select
            label="State"
            value={draft.state}
            data={['proposed', 'ready', 'running', 'waiting', 'done', 'canceled']}
            onChange={(state) => change({ state: state as Activity['state'] })}
          />
          <TextInput
            label="Waiting for"
            value={draft.waitingFor}
            onChange={(event) => change({ waitingFor: event.currentTarget.value })}
          />
        </div>
        <div className="sky-workstream-form-grid">
          <TextInput
            type="date"
            label="Planned start"
            value={draft.start ?? ''}
            onChange={(event) => change({ start: event.currentTarget.value || undefined })}
          />
          <TextInput
            type="date"
            label="Planned end"
            value={draft.end ?? ''}
            onChange={(event) => change({ end: event.currentTarget.value || undefined })}
          />
          <TextInput
            type="date"
            label="Due, if known"
            value={draft.due ?? ''}
            onChange={(event) => change({ due: event.currentTarget.value || undefined })}
          />
        </div>
        <details className="sky-workstream-disclosure">
          <summary>Required results</summary>
          <p className="sky-workstream-hint">
            Only add a prerequisite when this activity needs a particular result before it can proceed.
          </p>
          {draft.requires.map((requirement, index) => (
            <div className="sky-workstream-row" key={`${requirement.workstreamId}:${requirement.activityId}`}>
              <TextInput
                aria-label="Required result"
                value={requirement.result}
                placeholder={
                  dependencies.find((value) => value.value === `${requirement.workstreamId}:${requirement.activityId}`)
                    ?.label ?? 'Required result'
                }
                onChange={(event) => {
                  const result = event.currentTarget.value
                  change({
                    requires: draft.requires.map((value, offset) => (offset === index ? { ...value, result } : value)),
                  })
                }}
              />
              <ActionIcon
                aria-label="Remove required result"
                onClick={() => change({ requires: draft.requires.filter((_, offset) => offset !== index) })}
              >
                ×
              </ActionIcon>
            </div>
          ))}
          <Select
            searchable
            label="Activity that provides the result"
            placeholder="Choose an activity"
            value={dependency}
            onChange={setDependency}
            data={dependencies}
          />
          <Button
            size="sm"
            disabled={!dependency}
            onClick={() => {
              if (!dependency) return
              const [workstreamId, activityId] = dependency.split(':')
              change({
                requires: [...draft.requires, { workstreamId: workstreamId!, activityId: activityId!, result: '' }],
              })
              setDependency(null)
            }}
          >
            Add prerequisite
          </Button>
        </details>
        <Button variant="primary" disabled={busy || !draft.title.trim()} onClick={() => onSave(draft)}>
          Save activity
        </Button>
      </div>
    </Modal>
  )
}
