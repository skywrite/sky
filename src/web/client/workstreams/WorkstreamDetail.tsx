import { ActionIcon, Button, Modal, Tabs, Textarea } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import type { Activity, Artifact, Workstream, WorkstreamRecord, WorkstreamRun } from '#lib/workstreams/types.ts'
import { fileHref } from '../explorer/explorer.tsx'
import { outboxHref } from '../outbox/outboxRoutes.ts'
import { ActionCompletionEditor } from './ActionCompletionEditor.tsx'
import { ActivityEditor } from './ActivityEditor.tsx'
import { BriefTab } from './BriefTab.tsx'
import { CommunicationEditor } from './CommunicationEditor.tsx'
import { DecisionAuthorityEditor } from './DecisionAuthorityEditor.tsx'
import { DetailsEditor } from './DetailsEditor.tsx'
import { DetailsTab } from './DetailsTab.tsx'
import { OverviewEditor } from './OverviewEditor.tsx'
import { Prose } from './Prose.tsx'
import { workstreamRequest } from './request.ts'
import { SkyEditor } from './SkyEditor.tsx'
import './WorkstreamDetail.css'
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
