import { ActionIcon, Button, SegmentedControl, Select, TextInput } from '@mantine/core'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkstreamDraft } from '#lib/workstreams/ai.ts'
import type { WorkstreamColor } from '#lib/workstreams/colors.ts'
import { defaultWorkstreamPosition } from '#lib/workstreams/layout.ts'
import { relationshipProposal } from '#lib/workstreams/relationships.ts'
import {
  ActivitySchema,
  type Activity,
  type Workstream,
  type WorkstreamDeletionReceipt,
  type WorkstreamRecord,
  type WorkstreamReport,
  type WorkstreamRun,
} from '#lib/workstreams/types.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { WorkstreamsBrowse } from './workstreamsBrowse.tsx'
import type { Point } from './workstreamsCamera.ts'
import {
  WorkstreamsCanvas,
  type CanvasRelationship,
  type CanvasWorkstream,
  type WorkstreamView,
} from './workstreamsCanvas.tsx'
import { WorkstreamCapture } from './workstreamsCapture.tsx'
import { DeletedWorkDialog, type DeletedWorkView, useHiddenWorkstreamDeletions } from './workstreamsDeleted.tsx'
import { type WorkstreamCommunication, WorkstreamDetail } from './workstreamsDetail.tsx'
import { WorkstreamsMenu, type WorkstreamMenuTarget } from './workstreamsMenu.tsx'
import { laneOrderChanges } from './workstreamsOrder.ts'
import { proposalRelationship, relationshipChanges } from './workstreamsRelationshipModel.ts'
import { WorkstreamRelationshipEditor, type RelationshipEditorTarget } from './workstreamsRelationships.tsx'
import { workstreamRequest } from './workstreamsRequest.ts'
import './workstreams.css'

export { workstreamRequest } from './workstreamsRequest.ts'

function initialView(): WorkstreamView {
  try {
    return localStorage.getItem('sky-workstreams-view') === 'timeline' ? 'timeline' : 'map'
  } catch {
    return 'map'
  }
}

export function WorkstreamsMain({ id, navigate }: { id: string | null; navigate: (path: string) => void }) {
  const [report, setReport] = useState<WorkstreamReport | null>(null)
  const [runs, setRuns] = useState<WorkstreamRun[]>([])
  const [communications, setCommunications] = useState<WorkstreamCommunication[]>([])
  const readSequence = useRef(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [captureIntent, setCaptureIntent] = useState('')
  const [parentId, setParentId] = useState<string | undefined>()
  const [view, setView] = useState<WorkstreamView>(initialView)
  const [filter, setFilter] = useState('active')
  const [person, setPerson] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [menu, setMenu] = useState<{ target: WorkstreamMenuTarget; item: WorkstreamRecord } | null>(null)
  const [relationshipEditor, setRelationshipEditor] = useState<RelationshipEditorTarget | null>(null)
  const [latestDeletionId, setLatestDeletionId] = useState<string | null>(null)
  const [deletedView, setDeletedView] = useState<DeletedWorkView>(null)
  const { hidden: hiddenDeletions, hide: hideDeletions } = useHiddenWorkstreamDeletions()
  const deleted = report?.deleted ?? []
  const visibleDeletions = deleted.filter((receipt) => hiddenDeletions[receipt.id] !== receipt.revision)
  const primaryDeletion = visibleDeletions.find((receipt) => receipt.id === latestDeletionId) ?? visibleDeletions[0]
  const refresh = useCallback(async () => {
    const sequence = ++readSequence.current
    const next = await workstreamRequest<WorkstreamReport>('/status')
    if (sequence !== readSequence.current) return
    setReport(next)
    if (id && next.items.some((item) => item.id === id)) {
      const detail = await workstreamRequest<{
        workstream: WorkstreamRecord
        runs: WorkstreamRun[]
        communications?: WorkstreamCommunication[]
      }>(`/${encodeURIComponent(id)}`)
      if (sequence !== readSequence.current) return
      setRuns(detail.runs)
      setCommunications(detail.communications ?? [])
    } else {
      setRuns([])
      setCommunications([])
    }
  }, [id])
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    let alive = true
    const read = () => {
      if (alive)
        void refresh().catch((problem: Error) => {
          if (alive) setError(problem.message)
        })
    }
    read()
    const timer = setInterval(read, 10_000)
    window.addEventListener('focus', read)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', read)
    }
  }, [refresh])
  const act = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      await refresh()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Sky could not complete this step.')
      await refresh().catch(() => {})
    } finally {
      setBusy(false)
    }
  }
  const selected = report?.items.find((item) => item.id === id)
  const openMenu = (target: WorkstreamMenuTarget) => {
    const item = report?.items.find((candidate) => candidate.id === target.workstreamId)
    if (!busy && item) setMenu({ target, item })
  }
  const deleteWorkstream = (workstreamId: string) => {
    const item = menu?.item
    if (!item || item.id !== workstreamId) return
    setMenu(null)
    void act(async () => {
      await workstreamRequest<WorkstreamDeletionReceipt>(`/${encodeURIComponent(item.id)}/delete`, 'POST', {
        revision: item.revision,
      })
      setLatestDeletionId(item.id)
      if (id === item.id) navigate('/workstreams')
    })
  }
  const restoreWorkstream = (receipt: WorkstreamDeletionReceipt) =>
    void act(async () => {
      const restored = await workstreamRequest<WorkstreamRecord>(`/${encodeURIComponent(receipt.id)}/restore`, 'POST', {
        revision: receipt.revision,
      })
      setSearch('')
      setPerson(null)
      setFilter('all')
      setDeletedView(null)
      navigate(`/workstreams/${encodeURIComponent(restored.id)}`)
      setNotice(`Restored “${restored.title}”. Ongoing Sky help is off.`)
    })
  const purgeWorkstream = (receipt: WorkstreamDeletionReceipt) =>
    void act(async () => {
      await workstreamRequest(`/${encodeURIComponent(receipt.id)}/purge`, 'POST', { revision: receipt.revision })
      setDeletedView(null)
      if (id === receipt.id) navigate('/workstreams')
    })
  const patch = (item: WorkstreamRecord, changes: Partial<Workstream>) => {
    const fields: Record<string, unknown> = { ...changes }
    for (const key of ['start', 'due', 'parentId'] as const)
      if (key in changes && changes[key] === undefined) fields[key] = null
    return workstreamRequest<WorkstreamRecord>(`/${item.id}`, 'PUT', { revision: item.revision, patch: fields })
  }
  const relate = (fromId: string, toId?: string) => {
    const source = report?.items.find((work) => work.id === fromId)
    if (!source || busy) return
    setError('')
    setMenu(null)
    setRelationshipEditor({ source, toId })
  }
  const reviewRelationship = (fromId: string, proposalId: string) => {
    const source = report?.items.find((work) => work.id === fromId)
    const proposal = source?.proposals.find((value) => value.id === proposalId)
    if (!source || !proposal || busy) return
    setError('')
    setRelationshipEditor({
      source,
      proposal,
      toId: proposal.targetId,
      relationship: proposalRelationship(source, proposal) ?? undefined,
    })
  }
  const inspectRelationship = (relationship: CanvasRelationship) => {
    if (relationship.proposalId) return reviewRelationship(relationship.fromId, relationship.proposalId)
    const source = report?.items.find((work) => work.id === relationship.fromId)
    if (!source || busy) return
    setError('')
    setRelationshipEditor({ source, relationship })
  }
  const saveRelationship = (relationship: CanvasRelationship | null) =>
    void act(async () => {
      if (!relationshipEditor) return
      const { source, proposal, relationship: previous } = relationshipEditor
      if (proposal && relationship)
        await workstreamRequest(`/${source.id}/proposals/${proposal.id}/accept`, 'POST', {
          revision: source.revision,
          relation: {
            kind: relationship.kind === 'parent' ? 'part-of' : relationship.kind,
            targetId: relationship.toId,
            reason: relationship.kind === 'prerequisite' ? proposal.reason : relationship.reason,
            activityId: relationship.activityId,
            requiredActivityId: relationship.requiredActivityId,
            requiredResult: relationship.kind === 'prerequisite' ? relationship.reason : undefined,
          },
        })
      else await patch(source, relationshipChanges(source, relationship, previous))
      setRelationshipEditor(null)
      setNotice(relationship ? 'Relationship saved.' : 'Relationship removed.')
    })
  const move = (workstreamId: string, point: Point) =>
    act(async () => {
      await workstreamRequest('/layout', 'PUT', {
        id: workstreamId,
        ...point,
        order: report?.layout[workstreamId]?.order,
      })
    })
  const schedule = (workstreamId: string, activityId: string, days: number) => {
    if (!days) return
    const item = report?.items.find((candidate) => candidate.id === workstreamId)
    if (!item) return
    return act(async () => {
      await patch(item, {
        activities: item.activities.map((activity) =>
          activity.id !== activityId
            ? activity
            : {
                ...activity,
                ...(activity.start ? { start: PlainDate.from(activity.start).addDays(days).ymd } : {}),
                ...(activity.end ? { end: PlainDate.from(activity.end).addDays(days).ymd } : {}),
                ...(activity.due ? { due: PlainDate.from(activity.due).addDays(days).ymd } : {}),
              },
        ),
      })
      setNotice('Planned dates updated.')
    })
  }
  const createdOrder = useMemo(
    () => [...(report?.items ?? [])].sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id)),
    [report],
  )
  const ranks = Object.fromEntries(
    createdOrder.map((item, index) => [item.id, report?.layout[item.id]?.order ?? index]),
  )
  const ordered = [...createdOrder].sort(
    (a, b) => ranks[a.id]! - ranks[b.id]! || a.created.localeCompare(b.created) || a.id.localeCompare(b.id),
  )
  const defaultPositions = new Map(createdOrder.map((item, index) => [item.id, defaultWorkstreamPosition(index)]))
  const changeColor = (workstreamId: string, color: WorkstreamColor) =>
    void act(async () => {
      const saved = report?.layout[workstreamId]
      const position = saved ?? defaultPositions.get(workstreamId)
      if (!position) return
      await workstreamRequest('/layout', 'PUT', {
        id: workstreamId,
        color,
        ...(!saved ? { x: position.x, y: position.y } : {}),
      })
    })
  const reorder = (workstreamId: string, beforeId: string | null) => {
    const changes = laneOrderChanges(
      ordered.map((item) => item.id),
      workstreamId,
      beforeId,
      ranks,
    )
    if (!Object.keys(changes).length) return
    return act(async () => {
      for (const [id, order] of Object.entries(changes)) {
        const position = report?.layout[id] ?? defaultPositions.get(id)!
        await workstreamRequest('/layout', 'PUT', { id, x: position.x, y: position.y, order })
      }
      setNotice('Timeline order updated.')
    })
  }
  const visible = useMemo(
    () =>
      ordered.filter(
        (item) =>
          (filter === 'all' || (item.state !== 'completed' && item.state !== 'canceled')) &&
          (!person || item.stakeholders.some((stakeholder) => stakeholder.name === person)) &&
          (!search || `${item.title} ${item.outcome}`.toLowerCase().includes(search.toLowerCase())),
      ),
    [ordered, filter, person, search],
  )
  const canvasItems: CanvasWorkstream[] = visible.map((item) => {
    const needsDecision = item.activities.some(
      (activity) =>
        activity.kind === 'decision' &&
        activity.state !== 'done' &&
        activity.state !== 'canceled' &&
        (item.sky.decisionPolicies[activity.id]?.mode !== 'delegate' ||
          activity.decisionAnalysis?.outcome === 'escalated'),
    )
    return {
      id: item.id,
      title: item.title,
      outcome: item.outcome,
      status: item.state,
      assistance: item.sky.mode,
      needsAttention: needsDecision || !!item.sky.error,
      attention: needsDecision
        ? 'A decision needs you'
        : item.sky.error
          ? 'Sky needs attention'
          : item.proposals.some((proposal) => proposal.kind === 'relation')
            ? 'Sky suggests a relationship'
            : '',
      position: report?.layout[item.id] ?? defaultPositions.get(item.id),
      color: report?.layout[item.id]?.color ?? 'blue',
      parentId: item.parentId,
      relations: item.relations,
      activities: item.activities
        .filter((activity) => activity.state !== 'canceled' && !activity.subworkstreamId)
        .map((activity) => ({
          id: activity.id,
          title: activity.title,
          kind: activity.kind === 'decision' ? 'decision' : 'action',
          status: activity.state,
          start: activity.start ?? activity.due,
          end: activity.end ?? activity.due,
          requires: activity.requires,
        })),
    }
  })
  const people = [
    ...new Set(report?.items.flatMap((item) => item.stakeholders.map((stakeholder) => stakeholder.name)) ?? []),
  ]
  const start = (parent?: string, intent = '') => {
    setParentId(parent)
    setCaptureIntent(intent)
    setCreating(true)
  }
  const deletionNotice = (receipt: WorkstreamDeletionReceipt) => (
    <div className="sky-workstreams-notice sky-workstreams-delete-notice" role="status" key={receipt.revision}>
      <span>
        {receipt.purging ? 'Finish deleting' : 'Deleted'} “{receipt.title}”.
      </span>
      <Button
        size="sm"
        variant="primary-quiet"
        disabled={busy || receipt.purging}
        aria-label={`Undo delete ${receipt.title}`}
        onClick={() => restoreWorkstream(receipt)}
      >
        Undo
      </Button>
      <Button
        size="sm"
        variant="danger-quiet"
        disabled={busy}
        aria-label={`Delete permanently ${receipt.title}`}
        onClick={() => {
          setError('')
          setDeletedView(receipt)
        }}
      >
        Delete permanently…
      </Button>
      <Button size="sm" disabled={busy} aria-label="Hide deletion notices" onClick={() => hideDeletions(deleted)}>
        Hide
      </Button>
    </div>
  )

  return (
    <main className="sky-main sky-workstreams" data-detail-open={!!selected}>
      <header className="sky-workstreams-header">
        <div>
          <h1>Workstreams</h1>
          <span className="sky-workstreams-subtitle">See the whole picture. Move the work forward.</span>
        </div>
        <SegmentedControl
          value={view}
          onChange={(value) => {
            setView(value as WorkstreamView)
            try {
              localStorage.setItem('sky-workstreams-view', value)
            } catch {
              /* Optional preference. */
            }
          }}
          data={[
            { value: 'map', label: 'Map' },
            { value: 'timeline', label: 'Timeline' },
          ]}
        />
        {deleted.length > 0 && (
          <Button
            size="sm"
            aria-label="View deleted work"
            onClick={() => {
              setError('')
              setDeletedView('list')
            }}
          >
            Deleted work ({deleted.length})
          </Button>
        )}
        {(report?.items.length ?? 0) > 0 && (
          <Button variant="primary" onClick={() => start()}>
            ＋ Add
          </Button>
        )}
      </header>
      {(report?.items.length ?? 0) > 0 && (
        <div className="sky-workstreams-toolbar">
          <TextInput
            aria-label="Find a workstream"
            placeholder="Find a workstream"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            size="sm"
          />
          <Select
            aria-label="Workstream status filter"
            value={filter}
            onChange={(value) => setFilter(value ?? 'active')}
            data={[
              { value: 'active', label: 'Active work' },
              { value: 'all', label: 'All work' },
            ]}
            size="sm"
          />
          {people.length > 0 && (
            <Select
              aria-label="Filter by stakeholder"
              placeholder="Everyone"
              clearable
              value={person}
              onChange={setPerson}
              data={people}
              size="sm"
            />
          )}
          <span className="sky-workstreams-count">
            {visible.length} workstream{visible.length === 1 ? '' : 's'}
          </span>
          <WorkstreamsBrowse items={visible} navigate={navigate} onMenu={openMenu} busy={busy} />
        </div>
      )}
      {error && (
        <div className="sky-workstreams-alert sky-workstreams-operation-error" role="alert">
          <span>{error}</span>
          <ActionIcon aria-label="Dismiss error" onClick={() => setError('')}>
            ×
          </ActionIcon>
        </div>
      )}
      {notice && (
        <div className="sky-workstreams-notice sky-workstreams-notice-dismissable" role="status">
          <span>{notice}</span>
          <ActionIcon aria-label="Dismiss notice" onClick={() => setNotice('')}>
            ×
          </ActionIcon>
        </div>
      )}
      {primaryDeletion && deletionNotice(primaryDeletion)}
      {!!report?.errors.length && (
        <details className="sky-workstreams-alert">
          <summary>
            {report.errors.length} workstream file{report.errors.length === 1 ? '' : 's'} could not be read
          </summary>
          {report.errors.map((problem) => (
            <p key={problem.path}>
              {problem.path}: {problem.message}
            </p>
          ))}
        </details>
      )}
      <div className="sky-workstreams-body">
        {!report ? (
          <div className="sky-workstreams-loading">Loading your workstreams…</div>
        ) : (
          <WorkstreamsCanvas
            items={canvasItems}
            view={view}
            selected={relationshipEditor?.source.id ?? id}
            today={report.today}
            onSelect={(workstreamId) => navigate(`/workstreams/${encodeURIComponent(workstreamId)}`)}
            onMenu={openMenu}
            onRelate={relate}
            onInspectRelationship={inspectRelationship}
            relationshipPreviews={(report?.items ?? []).flatMap((work) =>
              work.proposals.flatMap((proposal) => {
                const relationship = proposalRelationship(work, proposal)
                return relationship &&
                  (relationship.fromId === (relationshipEditor?.source.id ?? id) || relationship.toId === id)
                  ? [relationship]
                  : []
              }),
            )}
            onMove={move}
            onSchedule={schedule}
            onReorder={reorder}
            onAdd={(intent) => start(undefined, intent)}
            hasWorkstreams={report.items.length > 0}
            onClearFilters={() => {
              setSearch('')
              setPerson(null)
              setFilter('all')
            }}
            disabled={busy}
          />
        )}
        {selected && (
          <Fragment key={selected.id}>
            <WorkstreamDetail
              item={selected}
              all={report?.items ?? []}
              runs={runs}
              communications={communications}
              busy={busy}
              act={act}
              patch={patch}
              onClose={() => navigate('/workstreams')}
              onSelect={(workstreamId) => navigate(`/workstreams/${encodeURIComponent(workstreamId)}`)}
              onSubstream={() => start(selected.id)}
              onMenu={openMenu}
              onRelate={relate}
              onReviewRelationship={reviewRelationship}
              onInspectRelationship={inspectRelationship}
              navigate={navigate}
              notice={setNotice}
            />
          </Fragment>
        )}
        {id && report && !selected && (
          <aside className="sky-workstream-detail">
            <Button onClick={() => navigate('/workstreams')}>‹ All workstreams</Button>
            <p>This workstream is unavailable.</p>
          </aside>
        )}
      </div>
      <WorkstreamsMenu
        target={menu?.target ?? null}
        onClose={() => setMenu(null)}
        onOpen={(workstreamId) => {
          setMenu(null)
          navigate(`/workstreams/${encodeURIComponent(workstreamId)}`)
        }}
        onDelete={deleteWorkstream}
        onRelate={relate}
        color={menu ? report?.layout[menu.target.workstreamId]?.color : undefined}
        onColor={changeColor}
        busy={busy}
      />
      <DeletedWorkDialog
        view={deletedView}
        receipts={deleted}
        busy={busy}
        error={error}
        onView={setDeletedView}
        onRestore={restoreWorkstream}
        onPurge={purgeWorkstream}
      />
      {relationshipEditor && (
        <WorkstreamRelationshipEditor
          target={relationshipEditor}
          all={report?.items ?? []}
          busy={busy}
          error={error}
          onClose={() => setRelationshipEditor(null)}
          onSave={saveRelationship}
          onRemove={() => saveRelationship(null)}
          onOpen={(workstreamId) => {
            setRelationshipEditor(null)
            navigate(`/workstreams/${encodeURIComponent(workstreamId)}`)
          }}
        />
      )}
      <WorkstreamCapture
        opened={creating}
        initialIntent={captureIntent}
        parentId={parentId}
        busy={busy}
        onClose={() => setCreating(false)}
        onOpenWeek={(weekId) => {
          setCreating(false)
          navigate(`/week/${weekId}`)
        }}
        onCreate={async (input) => {
          const { position, ...item } = await workstreamRequest<
            WorkstreamRecord & { position?: WorkstreamReport['layout'][string] }
          >('/create', 'POST', input)
          // Publish the durable result before navigation or any longer Sky run.
          // A status read started before creation must not hide it again.
          ++readSequence.current
          setReport((current) => {
            if (!current) return current
            const layout = { ...current.layout }
            if (position) {
              // Match the server's saved legacy positions before insertion changes any fallback indexes.
              const peers = [...current.items].sort(
                (a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id),
              )
              peers.forEach((peer, index) => {
                layout[peer.id] ??= defaultWorkstreamPosition(index)
              })
              layout[item.id] = position
            }
            return {
              ...current,
              items: [...current.items.filter((existing) => existing.id !== item.id), item],
              layout,
            }
          })
          setSearch('')
          setPerson(null)
          setFilter('active')
          setCreating(false)
          navigate(`/workstreams/${item.id}`)
          if (item.sky.mode !== 'off') {
            setNotice('Sky is starting with the context you shared.')
            void workstreamRequest(`/${item.id}/run`, 'POST', {})
              .then(() => refreshRef.current())
              .catch((problem: Error) => setError(problem.message))
              .finally(() =>
                setNotice((current) => (current === 'Sky is starting with the context you shared.' ? '' : current)),
              )
          }
        }}
      />
    </main>
  )
}

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
