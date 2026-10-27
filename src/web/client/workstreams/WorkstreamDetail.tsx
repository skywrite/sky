import {
  ActionIcon,
  Button,
  Checkbox,
  Modal,
  NumberInput,
  Select,
  Switch,
  Tabs,
  Textarea,
  TextInput,
} from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import {
  ReportingSchema,
  SourceSchema,
  type Activity,
  type Artifact,
  type SkySettings,
  type Workstream,
  type WorkstreamRecord,
  type WorkstreamRun,
} from '#lib/workstreams/types.ts'
import { fileHref } from '../explorer/explorer.tsx'
import { outboxHref } from '../outbox/outboxRoutes.ts'
import { ActionCompletionEditor } from './ActionCompletionEditor.tsx'
import { BriefTab } from './BriefTab.tsx'
import { DecisionAuthorityEditor } from './DecisionAuthorityEditor.tsx'
import { DetailsTab } from './DetailsTab.tsx'
import { Prose } from './Prose.tsx'
import { workstreamRequest } from './request.ts'
import {
  complete,
  WorkstreamDetailContext,
  type ActivityActions,
  type WorkstreamCommunication,
} from './WorkstreamDetailContext.ts'
import { WorkstreamMenuButton } from './WorkstreamMenuButton.tsx'
import type { CanvasRelationship } from './WorkstreamsCanvas.tsx'
import { openWorkstreamMenu, type WorkstreamMenuTarget } from './WorkstreamsMenu.tsx'
import { WorkTab } from './WorkTab.tsx'
import './WorkstreamDetail.css'

export type { WorkstreamCommunication } from './WorkstreamDetailContext.ts'

type Props = {
  item: WorkstreamRecord
  all: WorkstreamRecord[]
  runs: WorkstreamRun[]
  communications: WorkstreamCommunication[]
  busy: boolean
  act: (action: () => Promise<void>) => Promise<void>
  patch: (item: WorkstreamRecord, patch: Partial<Workstream>) => Promise<WorkstreamRecord>
  onClose: () => void
  onSelect: (id: string) => void
  onSubstream: () => void
  onRelate: (id: string) => void
  onReviewRelationship: (id: string, proposalId: string) => void
  onInspectRelationship: (relationship: CanvasRelationship) => void
  onMenu: (target: WorkstreamMenuTarget) => void
  navigate: (path: string) => void
  notice: (message: string) => void
}
type Editor = 'overview' | 'details' | 'sky' | null

export function WorkstreamDetail({
  item,
  all,
  runs,
  communications,
  busy,
  act,
  patch,
  onClose,
  onSelect,
  onSubstream,
  onRelate,
  onReviewRelationship,
  onInspectRelationship,
  onMenu,
  navigate,
  notice,
}: Props) {
  const [editor, setEditor] = useState<Editor>(null)
  const [editBase, setEditBase] = useState(item)
  const [activityEdit, setActivityEdit] = useState<Activity | null>(null)
  const [resolution, setResolution] = useState<Activity | null>(null)
  const [communication, setCommunication] = useState<Activity | null>(null)
  const [decisionAuthority, setDecisionAuthority] = useState<Activity | null>(null)
  const [actionCompletion, setActionCompletion] = useState<Activity | null>(null)
  const [result, setResult] = useState('')
  const [request, setRequest] = useState('')
  const [savedRequest, setSavedRequest] = useState('')
  const contextOperation = useRef<{ text: string; id: string } | null>(null)
  const [view, setView] = useState('brief')
  const [expandedActivity, setExpandedActivity] = useState<string | null>(null)
  const [artifact, setArtifact] = useState<{ artifact: Artifact; content: string } | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)
  const highlightedActivity = new URLSearchParams(window.location.search).get('activity')
  useEffect(() => {
    if (!highlightedActivity) return
    setView('work')
    setExpandedActivity(highlightedActivity)
    setShowCompleted(true)
    const frame = requestAnimationFrame(() => {
      const row = document.getElementById(`activity-${highlightedActivity}`)
      row?.scrollIntoView({ block: 'center', inline: 'nearest' })
      row?.querySelector<HTMLButtonElement>('.sky-workstream-activity-title')?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [item.id, highlightedActivity])
  const openEditor = (next: Editor) => {
    setEditBase(item)
    setEditor(next)
  }
  const openActivity = (activity: Activity) => {
    setEditBase(item)
    setActivityEdit(activity)
  }
  const openCommunication = (activity: Activity) => {
    setEditBase(item)
    setCommunication(activity)
  }
  const openResolution = (activity: Activity) => {
    setEditBase(item)
    setResult(activity.result)
    setResolution(activity)
  }
  const openDecisions = item.activities.filter(
    (activity) => activity.kind === 'decision' && !complete(activity) && !activity.subworkstreamId,
  )
  const delegatedDecisions = openDecisions.filter(
    (activity) =>
      item.sky.decisionPolicies[activity.id]?.mode === 'delegate' && activity.decisionAnalysis?.outcome !== 'escalated',
  )
  const decisions = openDecisions.filter((activity) => !delegatedDecisions.includes(activity))
  const saveActivity = (value: Activity) =>
    void act(async () => {
      await patch(editBase, {
        activities: editBase.activities.some((candidate) => candidate.id === value.id)
          ? editBase.activities.map((candidate) => (candidate.id === value.id ? value : candidate))
          : [...editBase.activities, value],
      })
      setActivityEdit(null)
    })
  const changeRequest = (text: string) => {
    if (contextOperation.current?.text !== text.trim()) contextOperation.current = null
    setRequest(text)
  }
  const review = (noteOnly = false) =>
    void act(async () => {
      const text = request.trim()
      if (text && text !== savedRequest) {
        if (contextOperation.current?.text !== text) contextOperation.current = { text, id: crypto.randomUUID() }
        await workstreamRequest(`/${item.id}/context`, 'POST', {
          revision: item.revision,
          text,
          operationId: contextOperation.current.id,
        })
        // Keep a successful note write across a failed run so retrying cannot append it again.
        setSavedRequest(text)
      }
      if (noteOnly) {
        setRequest('')
        setSavedRequest('')
        contextOperation.current = null
        notice('Note saved to this workstream.')
        return
      }
      const run = await workstreamRequest<WorkstreamRun>(`/${item.id}/run`, 'POST', {
        request: text || undefined,
      })
      notice(
        run.status === 'running'
          ? 'Sky has started reviewing this workstream.'
          : run.status === 'failed'
            ? (run.error ?? 'Sky could not finish this review.')
            : run.summary || 'Sky finished reviewing this workstream.',
      )
      if (run.status !== 'failed') {
        setRequest('')
        setSavedRequest('')
        contextOperation.current = null
      }
    })
  const today = (activity: Activity) =>
    void act(async () => {
      await workstreamRequest(`/${item.id}/activities/${activity.id}/today`, 'POST', { revision: item.revision })
      notice('Added to Today. Changes there stay connected to this workstream.')
    })
  const promote = (activity: Activity) =>
    void act(async () => {
      const value = await workstreamRequest<{ child: WorkstreamRecord }>(
        `/${item.id}/activities/${activity.id}/promote`,
        'POST',
        { revision: item.revision },
      )
      onSelect(value.child.id)
    })
  const reviewActivity = (activity: Activity) =>
    void act(async () => {
      const run = await workstreamRequest<WorkstreamRun>(`/${item.id}/run`, 'POST', {
        request: `Help move forward the activity “${activity.title}”, using its current context and authority.`,
      })
      notice(run.error || run.summary || 'Sky is reviewing this activity.')
    })
  const acceptActivity = (activity: Activity) =>
    void act(async () => {
      await patch(item, {
        activities: item.activities.map((value) => (value.id === activity.id ? { ...value, state: 'ready' } : value)),
      })
    })
  const openArtifact = (value: Artifact) =>
    void act(async () => {
      setArtifact(await workstreamRequest<{ artifact: Artifact; content: string }>(`/${item.id}/artifacts/${value.id}`))
    })
  const activityActions: ActivityActions = {
    accept: acceptActivity,
    reopen: acceptActivity,
    advance: reviewActivity,
    planToday: today,
    edit: openActivity,
    chooseDecider: (activity) => {
      setEditBase(item)
      setDecisionAuthority(activity)
    },
    defineDone: (activity) => {
      setEditBase(item)
      setActionCompletion(activity)
    },
    prepareMessage: openCommunication,
    expand: promote,
    record: openResolution,
  }

  return (
    <WorkstreamDetailContext.Provider
      value={{
        item,
        all,
        runs,
        communications,
        busy,
        act,
        navigate,
        onSelect,
        onRelate,
        onSubstream,
        onInspectRelationship,
        onReviewRelationship,
        openEditor,
        openArtifact,
        showView: setView,
        expandedActivity,
        expandActivity: setExpandedActivity,
        highlightedActivity,
        activityActions,
      }}
    >
      <aside className="sky-workstream-detail sky-workstream-brief" aria-label={item.title}>
        <DetailHeader
          item={item}
          parent={all.find((candidate) => candidate.id === item.parentId)}
          busy={busy}
          onSelect={onSelect}
          onMenu={onMenu}
          onClose={onClose}
        />
        <Tabs
          value={view}
          onChange={(value) => setView(value ?? 'brief')}
          keepMounted={false}
          className="sky-workstream-brief-tabs"
        >
          <Tabs.List aria-label="Workstream views" className="sky-workstream-brief-tab-list">
            <Tabs.Tab value="brief">Brief</Tabs.Tab>
            <Tabs.Tab value="work">
              Work{' '}
              <span className="sky-workstream-tab-count">
                {item.activities.filter((activity) => !complete(activity)).length || ''}
              </span>
            </Tabs.Tab>
            <Tabs.Tab value="details">Details</Tabs.Tab>
          </Tabs.List>
          <div className="sky-workstream-detail-scroll">
            <Tabs.Panel value="brief">
              <BriefTab
                decisions={decisions}
                request={request}
                savedRequest={savedRequest}
                onRequestChange={changeRequest}
                onReview={review}
              />
            </Tabs.Panel>
            <Tabs.Panel value="work">
              <WorkTab
                decisions={decisions}
                delegatedDecisions={delegatedDecisions}
                showCompleted={showCompleted}
                onShowCompletedChange={setShowCompleted}
              />
            </Tabs.Panel>
            <Tabs.Panel value="details">
              <DetailsTab />
            </Tabs.Panel>
            <footer className="sky-workstream-footer">
              <a href={fileHref(item.path)}>Open workstream file ↗</a>
              <Button size="xs" onClick={() => navigate('/')}>
                Today
              </Button>
              <Button size="xs" onClick={() => navigate('/outbox')}>
                Outbox
              </Button>
            </footer>
          </div>
        </Tabs>
        {editor === 'overview' && (
          <OverviewEditor
            item={editBase}
            busy={busy}
            onClose={() => setEditor(null)}
            onSave={(changes) =>
              void act(async () => {
                await patch(editBase, changes)
                setEditor(null)
              })
            }
          />
        )}
        {editor === 'details' && (
          <DetailsEditor
            item={editBase}
            busy={busy}
            onClose={() => setEditor(null)}
            onSave={(changes) =>
              void act(async () => {
                await patch(editBase, changes)
                setEditor(null)
              })
            }
          />
        )}
        {editor === 'sky' && (
          <SkyEditor
            item={editBase}
            busy={busy}
            onClose={() => setEditor(null)}
            onSave={(settings) =>
              void act(async () => {
                await workstreamRequest(`/${item.id}/sky`, 'POST', { revision: editBase.revision, settings })
                setEditor(null)
              })
            }
          />
        )}
        {activityEdit && (
          <ActivityEditor
            activity={activityEdit}
            all={all}
            busy={busy}
            onClose={() => setActivityEdit(null)}
            onSave={saveActivity}
          />
        )}
        {decisionAuthority && (
          <DecisionAuthorityEditor
            item={editBase}
            activity={decisionAuthority}
            policy={editBase.sky.decisionPolicies[decisionAuthority.id]}
            busy={busy}
            onClose={() => setDecisionAuthority(null)}
            onSave={(policy, assumptions) =>
              void act(async () => {
                await workstreamRequest(`/${item.id}/activities/${decisionAuthority.id}/decision-policy`, 'POST', {
                  revision: editBase.revision,
                  policy,
                  assumptions,
                })
                setDecisionAuthority(null)
                notice(
                  policy.mode === 'delegate'
                    ? 'Decision delegated within the boundaries you set.'
                    : 'Decision responsibility updated.',
                )
                if (item.sky.mode !== 'off')
                  await workstreamRequest(`/${item.id}/run`, 'POST', {
                    request: `Review the decision “${decisionAuthority.title}” using its current responsibility and evidence requirements.`,
                  })
              })
            }
          />
        )}
        {actionCompletion && (
          <ActionCompletionEditor
            item={editBase}
            activity={actionCompletion}
            policy={editBase.sky.actionPolicies[actionCompletion.id]}
            busy={busy}
            onClose={() => setActionCompletion(null)}
            onSave={(policy) =>
              void act(async () => {
                const actionPolicies = { ...editBase.sky.actionPolicies }
                if (policy) actionPolicies[actionCompletion.id] = policy
                else delete actionPolicies[actionCompletion.id]
                await workstreamRequest(`/${item.id}/sky`, 'POST', {
                  revision: editBase.revision,
                  settings: { ...editBase.sky, actionPolicies },
                })
                setActionCompletion(null)
                notice(
                  policy
                    ? 'Sky can verify completion against the agreed deliverable.'
                    : 'Sky will bring this result to you for review.',
                )
              })
            }
          />
        )}
        <ResolutionDialog
          resolution={resolution}
          result={result}
          busy={busy}
          onResultChange={setResult}
          onClose={() => setResolution(null)}
          onSave={() =>
            void act(async () => {
              if (!resolution) return
              await workstreamRequest(`/${item.id}/activities/${resolution.id}/resolve`, 'POST', {
                revision: editBase.revision,
                result,
              })
              setResolution(null)
            })
          }
        />
        {communication && (
          <CommunicationEditor
            item={editBase}
            activity={communication}
            busy={busy}
            onClose={() => setCommunication(null)}
            onSave={(payload) =>
              void act(async () => {
                const response = await workstreamRequest<{ item?: { id: string } }>(
                  `/${item.id}/activities/${communication.id}/outbox`,
                  'POST',
                  { revision: editBase.revision, ...payload },
                )
                setCommunication(null)
                notice('Message prepared in Outbox for review.')
                if (response.item) navigate(outboxHref(response.item.id))
              })
            }
          />
        )}
        <ArtifactReader artifact={artifact} onClose={() => setArtifact(null)} />
      </aside>
    </WorkstreamDetailContext.Provider>
  )
}

function DetailHeader({
  item,
  parent,
  busy,
  onSelect,
  onMenu,
  onClose,
}: {
  item: WorkstreamRecord
  parent?: WorkstreamRecord
  busy: boolean
  onSelect: (id: string) => void
  onMenu: (target: WorkstreamMenuTarget) => void
  onClose: () => void
}) {
  return (
    <header
      className="sky-workstream-detail-header"
      onContextMenu={(event) => {
        if (!busy) openWorkstreamMenu(event, item.id, item.title, onMenu)
      }}
    >
      <div>
        {parent ? (
          <button type="button" className="sky-workstream-parent" onClick={() => onSelect(parent.id)}>
            ↳ {parent.title}
          </button>
        ) : (
          <span className="sky-workstreams-eyebrow">Workstream</span>
        )}
        <h2>{item.title}</h2>
      </div>
      <div className="sky-workstream-header-actions">
        <WorkstreamMenuButton workstreamId={item.id} title={item.title} onMenu={onMenu} disabled={busy} />
        <ActionIcon aria-label="Close workstream" onClick={onClose}>
          ×
        </ActionIcon>
      </div>
    </header>
  )
}

function ResolutionDialog({
  resolution,
  result,
  busy,
  onResultChange,
  onClose,
  onSave,
}: {
  resolution: Activity | null
  result: string
  busy: boolean
  onResultChange: (result: string) => void
  onClose: () => void
  onSave: () => void
}) {
  return (
    <Modal
      opened={!!resolution}
      onClose={onClose}
      title={resolution?.kind === 'decision' ? 'Record the decision' : 'Record the result'}
      size="lg"
    >
      <div className="sky-workstream-edit">
        <strong>{resolution?.title}</strong>
        {resolution?.recommendation && <p>{resolution.recommendation}</p>}
        <Textarea
          label={resolution?.kind === 'decision' ? 'What did you decide?' : 'What happened?'}
          description="This result becomes part of the workstream’s understanding."
          autosize
          minRows={4}
          value={result}
          onChange={(event) => onResultChange(event.currentTarget.value)}
        />
        <Button variant="primary" disabled={busy || !result.trim()} onClick={() => onSave()}>
          Save {resolution?.kind === 'decision' ? 'decision' : 'result'}
        </Button>
      </div>
    </Modal>
  )
}

function ArtifactReader({
  artifact,
  onClose,
}: {
  artifact: { artifact: Artifact; content: string } | null
  onClose: () => void
}) {
  return (
    <Modal opened={!!artifact} onClose={onClose} title={artifact?.artifact.title ?? 'Prepared work'} size="xl">
      {artifact && (
        <div className="sky-workstream-artifact-reader">
          <Prose text={artifact.content} />
          <a href={fileHref(artifact.artifact.path)}>Open document ↗</a>
        </div>
      )}
    </Modal>
  )
}

function OverviewEditor({
  item,
  busy,
  onClose,
  onSave,
}: {
  item: WorkstreamRecord
  busy: boolean
  onClose: () => void
  onSave: (patch: Partial<Workstream>) => void
}) {
  const [draft, setDraft] = useState({
    title: item.title,
    outcome: item.outcome,
    understanding: item.understanding,
    unknowns: item.unknowns.join('\n'),
    state: item.state,
    start: item.start ?? '',
    due: item.due ?? '',
  })
  return (
    <Modal opened onClose={onClose} title="Shape this workstream" size="lg">
      <div className="sky-workstream-edit">
        <TextInput
          label="Name"
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })}
        />
        <Textarea
          label="Desired outcome"
          description="What would make this work successful?"
          autosize
          minRows={3}
          value={draft.outcome}
          onChange={(event) => setDraft({ ...draft, outcome: event.currentTarget.value })}
        />
        <Textarea
          label="Current understanding"
          autosize
          minRows={4}
          value={draft.understanding}
          onChange={(event) => setDraft({ ...draft, understanding: event.currentTarget.value })}
        />
        <Textarea
          label="Still to understand"
          description="One question per line."
          autosize
          minRows={2}
          value={draft.unknowns}
          onChange={(event) => setDraft({ ...draft, unknowns: event.currentTarget.value })}
        />
        <div className="sky-workstream-form-grid">
          <TextInput
            type="date"
            label="Start, if useful"
            value={draft.start}
            onChange={(event) => setDraft({ ...draft, start: event.currentTarget.value })}
          />
          <TextInput
            type="date"
            label="By when, if known"
            value={draft.due}
            onChange={(event) => setDraft({ ...draft, due: event.currentTarget.value })}
          />
        </div>
        <Select
          label="State"
          data={['proposed', 'active', 'paused', 'completed', 'canceled']}
          value={draft.state}
          onChange={(state) => setDraft({ ...draft, state: state as Workstream['state'] })}
        />
        <Button
          variant="primary"
          disabled={busy || !draft.title.trim()}
          onClick={() =>
            onSave({
              ...draft,
              unknowns: draft.unknowns
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
              start: draft.start || undefined,
              due: draft.due || undefined,
            })
          }
        >
          Save understanding
        </Button>
      </div>
    </Modal>
  )
}

function ActivityEditor({
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

function SkyEditor({
  item,
  busy,
  onClose,
  onSave,
}: {
  item: WorkstreamRecord
  busy: boolean
  onClose: () => void
  onSave: (settings: SkySettings) => void
}) {
  const [draft, setDraft] = useState(item.sky)
  return (
    <Modal opened onClose={onClose} title="Sky’s responsibility" size="lg">
      <div className="sky-workstream-edit">
        <p>Give Sky an ongoing responsibility to help develop the understanding and move this work forward.</p>
        <Select
          label="How should Sky participate?"
          value={draft.mode}
          data={[
            { value: 'off', label: 'I’ll lead · ask for help when useful' },
            { value: 'assist', label: 'Assist · review, propose, and prepare useful work' },
            { value: 'drive', label: 'Carry it · advance authorized work and surface decisions' },
          ]}
          onChange={(mode) => setDraft({ ...draft, mode: mode as SkySettings['mode'] })}
        />
        <Textarea
          label="Responsibility and boundaries"
          autosize
          minRows={4}
          value={draft.instruction}
          onChange={(event) => setDraft({ ...draft, instruction: event.currentTarget.value })}
        />
        <div className="sky-workstream-form-grid">
          <NumberInput
            label="Review every (hours)"
            min={0.25}
            max={720}
            value={draft.reviewEveryHours}
            onChange={(value) => setDraft({ ...draft, reviewEveryHours: Number(value) || 24 })}
          />
          <NumberInput
            label="Maximum reviews per day"
            min={1}
            max={96}
            value={draft.maxRunsPerDay}
            onChange={(value) => setDraft({ ...draft, maxRunsPerDay: Number(value) || 8 })}
          />
        </div>
        <NumberInput
          label="Total review cap, if useful"
          description="Leave empty for ongoing responsibility without a lifetime cap. Daily limits still apply."
          min={1}
          max={10000}
          value={draft.maxRunsTotal ?? ''}
          onChange={(value) => setDraft({ ...draft, maxRunsTotal: value === '' ? undefined : Number(value) })}
        />
        <p className="sky-workstream-hint">
          Sky can develop the work, prepare deliverables, evaluate decisions, and keep stakeholders informed. Decisions,
          completion criteria, and recurring report delivery follow the specific responsibilities you set for them.
        </p>
        <Button variant="primary" disabled={busy} onClick={() => onSave(draft)}>
          {draft.mode === 'off' ? 'Save responsibility' : 'Enable ongoing help'}
        </Button>
      </div>
    </Modal>
  )
}

function DetailsEditor({
  item,
  busy,
  onClose,
  onSave,
}: {
  item: WorkstreamRecord
  busy: boolean
  onClose: () => void
  onSave: (patch: Partial<Workstream>) => void
}) {
  const [people, setPeople] = useState(item.stakeholders)
  const [metrics, setMetrics] = useState(item.metrics)
  const [sources, setSources] = useState(item.sources)
  const [reporting, setReporting] = useState(item.reporting)
  const [artifactText, setArtifactText] = useState<Record<string, string>>(() =>
    Object.fromEntries(item.reporting.map((report) => [report.id, report.artifacts.join(', ')])),
  )
  return (
    <Modal opened onClose={onClose} title="Details that help the work" size="xl">
      <div className="sky-workstream-edit">
        <p>Add what is useful now. These details can develop over time.</p>
        <section>
          <h3>Stakeholders</h3>
          {people.map((person, index) => (
            <div className="sky-workstream-edit-card" key={person.id}>
              <div className="sky-workstream-row">
                <TextInput
                  label="Name"
                  value={person.name}
                  onChange={(event) => {
                    const name = event.currentTarget.value
                    setPeople(people.map((value, offset) => (offset === index ? { ...value, name } : value)))
                  }}
                />
                <ActionIcon
                  aria-label="Remove stakeholder"
                  onClick={() => setPeople(people.filter((_, offset) => offset !== index))}
                >
                  ×
                </ActionIcon>
              </div>
              <div className="sky-workstream-form-grid">
                <TextInput
                  label="Role"
                  placeholder="Approver, contributor, informed…"
                  value={person.role}
                  onChange={(event) => {
                    const role = event.currentTarget.value
                    setPeople(people.map((value, offset) => (offset === index ? { ...value, role } : value)))
                  }}
                />
                <TextInput
                  label="Contact, if useful"
                  value={person.contact}
                  onChange={(event) => {
                    const contact = event.currentTarget.value
                    setPeople(people.map((value, offset) => (offset === index ? { ...value, contact } : value)))
                  }}
                />
              </div>
            </div>
          ))}
          <Button
            size="sm"
            onClick={() => setPeople([...people, { id: crypto.randomUUID(), name: '', role: '', contact: '' }])}
          >
            ＋ Stakeholder
          </Button>
        </section>
        <section>
          <h3>Metrics</h3>
          {metrics.map((metric, index) => (
            <div className="sky-workstream-edit-card" key={metric.id}>
              <div className="sky-workstream-row">
                <TextInput
                  label="What are you measuring?"
                  value={metric.name}
                  onChange={(event) => {
                    const name = event.currentTarget.value
                    setMetrics(metrics.map((value, offset) => (offset === index ? { ...value, name } : value)))
                  }}
                />
                <ActionIcon
                  aria-label="Remove metric"
                  onClick={() => setMetrics(metrics.filter((_, offset) => offset !== index))}
                >
                  ×
                </ActionIcon>
              </div>
              <div className="sky-workstream-form-grid">
                {(['current', 'target', 'unit'] as const).map((field) => (
                  <TextInput
                    key={field}
                    label={field === 'current' ? 'Current' : field === 'target' ? 'Target' : 'Unit'}
                    value={metric[field]}
                    onChange={(event) => {
                      const text = event.currentTarget.value
                      setMetrics(
                        metrics.map((value, offset) => (offset === index ? { ...value, [field]: text } : value)),
                      )
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
          <Button
            size="sm"
            onClick={() =>
              setMetrics([...metrics, { id: crypto.randomUUID(), name: '', target: '', current: '', unit: '' }])
            }
          >
            ＋ Metric
          </Button>
        </section>
        <section>
          <h3>Sources for Sky</h3>
          <p className="sky-workstream-hint">Link notebook documents that give Sky the context it needs.</p>
          {sources.map((source, index) => (
            <div className="sky-workstream-edit-card" key={source.id}>
              <div className="sky-workstream-row">
                <TextInput
                  label="Notebook file"
                  value={source.path}
                  placeholder="Path to a document in your notebook"
                  onChange={(event) => {
                    const path = event.currentTarget.value
                    setSources(sources.map((value, offset) => (offset === index ? { ...value, path } : value)))
                  }}
                />
                <ActionIcon
                  aria-label="Remove source"
                  onClick={() => setSources(sources.filter((_, offset) => offset !== index))}
                >
                  ×
                </ActionIcon>
              </div>
              <TextInput
                label="Label"
                value={source.label}
                onChange={(event) => {
                  const label = event.currentTarget.value
                  setSources(sources.map((value, offset) => (offset === index ? { ...value, label } : value)))
                }}
              />
              <Switch
                label="Contains sensitive information"
                checked={source.sensitive}
                onChange={(event) => {
                  const sensitive = event.currentTarget.checked
                  setSources(sources.map((value, offset) => (offset === index ? { ...value, sensitive } : value)))
                }}
              />
              {people.some((person) => person.name.trim()) && (
                <div className="sky-workstream-source-permissions">
                  <strong>Whose input is in this source?</strong>
                  {people
                    .filter((person) => person.name.trim())
                    .map((person) => (
                      <Checkbox
                        key={person.id}
                        label={person.name}
                        checked={(source.stakeholderIds ?? []).includes(person.id)}
                        onChange={(event) => {
                          const stakeholderIds = event.currentTarget.checked
                            ? [...(source.stakeholderIds ?? []), person.id]
                            : (source.stakeholderIds ?? []).filter((id) => id !== person.id)
                          setSources(
                            sources.map((value, offset) => (offset === index ? { ...value, stakeholderIds } : value)),
                          )
                        }}
                      />
                    ))}
                </div>
              )}
            </div>
          ))}
          <Button
            size="sm"
            onClick={() => setSources([...sources, SourceSchema.parse({ id: crypto.randomUUID(), path: ' ' })])}
          >
            ＋ Source
          </Button>
        </section>
        <section>
          <h3>Reporting</h3>
          <p className="sky-workstream-hint">
            Each audience can have its own cadence, medium, level of detail, and permitted sources.
          </p>
          {reporting.map((report, index) => {
            const change = (patch: Partial<typeof report>) =>
              setReporting(reporting.map((value, offset) => (offset === index ? { ...value, ...patch } : value)))
            return (
              <div className="sky-workstream-edit-card" key={report.id}>
                <div className="sky-workstream-row">
                  <TextInput
                    label="Audience"
                    value={report.audience}
                    onChange={(event) => change({ audience: event.currentTarget.value })}
                  />
                  <ActionIcon
                    aria-label="Remove reporting arrangement"
                    onClick={() => setReporting(reporting.filter((_, offset) => offset !== index))}
                  >
                    ×
                  </ActionIcon>
                </div>
                <div className="sky-workstream-form-grid">
                  <Select
                    label="Medium"
                    value={report.medium}
                    data={['email', 'slack', 'document', 'other']}
                    onChange={(medium) => change({ medium: medium as typeof report.medium })}
                  />
                  <NumberInput
                    label="Every (days)"
                    min={1}
                    max={365}
                    value={report.cadenceDays}
                    onChange={(value) => change({ cadenceDays: Number(value) || 7 })}
                  />
                </div>
                <Select
                  label="Level of detail"
                  value={report.detail}
                  data={[
                    { value: 'summary', label: 'High-level summary' },
                    { value: 'operational', label: 'Operational detail' },
                  ]}
                  onChange={(detail) => change({ detail: detail as typeof report.detail })}
                />
                <TextInput
                  label="Destination"
                  placeholder="A person, channel, or email audience"
                  value={report.destination}
                  onChange={(event) => change({ destination: event.currentTarget.value })}
                />
                <Textarea
                  label="What should this audience receive?"
                  description="Describe the useful level of detail and what should stay out."
                  autosize
                  minRows={3}
                  value={report.instructions}
                  onChange={(event) => change({ instructions: event.currentTarget.value })}
                />
                <TextInput
                  label="Desired artifacts"
                  description="Optional artifacts alongside the written report, separated with commas, such as presentation, Loom video."
                  value={artifactText[report.id] ?? report.artifacts.join(', ')}
                  onChange={(event) => {
                    const text = event.currentTarget.value
                    setArtifactText({ ...artifactText, [report.id]: text })
                    change({
                      artifacts: text
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }}
                />
                {report.artifacts.map((name) => (
                  <TextInput
                    key={name}
                    label={`${name} link`}
                    description="An actual HTTPS link is needed before this artifact can be delivered."
                    type="url"
                    value={
                      report.attachments?.find((attachment) => attachment.name.toLowerCase() === name.toLowerCase())
                        ?.url ?? ''
                    }
                    onChange={(event) => {
                      const url = event.currentTarget.value
                      change({
                        attachments: [
                          ...(report.attachments ?? []).filter(
                            (attachment) => attachment.name.toLowerCase() !== name.toLowerCase(),
                          ),
                          ...(url ? [{ name, url }] : []),
                        ],
                      })
                    }}
                  />
                ))}
                <div className="sky-workstream-source-permissions">
                  <strong>Sources this audience may see</strong>
                  <Checkbox
                    label="Include this workstream · Sensitive"
                    description="Its outcome, progress, decisions, and working notes. The brief may contain mixed private context."
                    checked={sources.some(
                      (source) => source.path === item.path && report.permittedSourceIds.includes(source.id),
                    )}
                    onChange={(event) => {
                      const existing = sources.find((source) => source.path === item.path)
                      if (!event.currentTarget.checked) {
                        if (existing)
                          change({ permittedSourceIds: report.permittedSourceIds.filter((id) => id !== existing.id) })
                        return
                      }
                      const source = existing
                        ? { ...existing, sensitive: true }
                        : SourceSchema.parse({
                            id: crypto.randomUUID(),
                            path: item.path,
                            label: 'This workstream',
                            sensitive: true,
                          })
                      setSources(
                        existing
                          ? sources.map((value) => (value.id === source.id ? source : value))
                          : [...sources, source],
                      )
                      change({ permittedSourceIds: [...new Set([...report.permittedSourceIds, source.id])] })
                    }}
                  />
                  {sources
                    .filter((source) => source.path.trim() && source.path !== item.path)
                    .map((source) => (
                      <Checkbox
                        key={source.id}
                        label={`${source.label || source.path}${source.sensitive ? ' · Sensitive' : ''}`}
                        checked={report.permittedSourceIds.includes(source.id)}
                        onChange={(event) =>
                          change({
                            permittedSourceIds: event.currentTarget.checked
                              ? [...report.permittedSourceIds, source.id]
                              : report.permittedSourceIds.filter((id) => id !== source.id),
                          })
                        }
                      />
                    ))}
                  {!report.allowSensitive &&
                    sources.some((source) => source.sensitive && report.permittedSourceIds.includes(source.id)) && (
                      <p className="sky-workstream-hint">
                        Selected sensitive sources stay excluded until this audience is allowed to receive sensitive
                        information below.
                      </p>
                    )}
                </div>
                <Switch
                  label="This audience may receive sensitive information"
                  checked={report.allowSensitive === true}
                  onChange={(event) => change({ allowSensitive: event.currentTarget.checked })}
                />
              </div>
            )
          })}
          <Button
            size="sm"
            onClick={() =>
              setReporting([...reporting, ReportingSchema.parse({ id: crypto.randomUUID(), audience: ' ' })])
            }
          >
            ＋ Reporting audience
          </Button>
        </section>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            onSave({
              stakeholders: people.filter((value) => value.name.trim()),
              metrics: metrics.filter((value) => value.name.trim()),
              sources: sources.filter((value) => value.path.trim()),
              reporting: reporting.filter((value) => value.audience.trim()),
            })
          }
        >
          Save details
        </Button>
      </div>
    </Modal>
  )
}

function CommunicationEditor({
  item,
  activity,
  busy,
  onClose,
  onSave,
}: {
  item: WorkstreamRecord
  activity: Activity
  busy: boolean
  onClose: () => void
  onSave: (payload: Record<string, unknown>) => void
}) {
  const [title, setTitle] = useState(activity.title)
  const [medium, setMedium] = useState('Email')
  const [destination, setDestination] = useState('')
  const [sourceRef, setSourceRef] = useState('')
  const [draft, setDraft] = useState('')
  const [decisions, setDecisions] = useState<string[]>([])
  return (
    <Modal opened onClose={onClose} title="Prepare a message in Outbox" size="lg">
      <div className="sky-workstream-edit">
        <p>Prepare the communication with its workstream context. Review and placement happen in Outbox.</p>
        <TextInput label="Title" value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
        <div className="sky-workstream-form-grid">
          <Select
            label="Medium"
            value={medium}
            data={['Email', 'Slack']}
            onChange={(value) => setMedium(value ?? 'Email')}
          />
          <TextInput label="To" value={destination} onChange={(event) => setDestination(event.currentTarget.value)} />
        </div>
        <TextInput
          label="Saved conversation, if replying"
          description="A notebook reference to the captured message identifies its verified destination."
          value={sourceRef}
          onChange={(event) => setSourceRef(event.currentTarget.value)}
        />
        <Textarea
          label="Draft"
          autosize
          minRows={7}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        {item.activities.some((value) => value.kind === 'decision') && (
          <div className="sky-workstream-source-permissions">
            <strong>Decisions this message depends on</strong>
            {item.activities
              .filter((value) => value.kind === 'decision')
              .map((value) => (
                <Checkbox
                  key={value.id}
                  label={value.title}
                  checked={decisions.includes(value.id)}
                  onChange={(event) =>
                    setDecisions(
                      event.currentTarget.checked
                        ? [...decisions, value.id]
                        : decisions.filter((id) => id !== value.id),
                    )
                  }
                />
              ))}
          </div>
        )}
        <Button
          variant="primary"
          disabled={busy || !draft.trim() || !title.trim()}
          onClick={() =>
            onSave({
              title,
              medium,
              destination,
              sourceRef: sourceRef.trim() || undefined,
              draft,
              decisionIds: decisions,
            })
          }
        >
          Prepare for review
        </Button>
      </div>
    </Modal>
  )
}
