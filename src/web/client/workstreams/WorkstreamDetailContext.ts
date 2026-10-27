import { createContext, useContext } from 'react'
import type { Activity, Artifact, WorkstreamRecord, WorkstreamRun } from '#lib/workstreams/types.ts'
import type { CanvasRelationship } from './WorkstreamsCanvas.tsx'

export type WorkstreamCommunication = {
  id: string
  status: 'needs_review' | 'placing' | 'ready' | 'placement_unknown' | 'dismissed'
  native?: unknown
  delivery?: { at: string; evidence: string; kind: 'owner_report' }
  stale: boolean
}

export type ActivityActions = {
  accept: (activity: Activity) => void
  reopen: (activity: Activity) => void
  advance: (activity: Activity) => void
  planToday: (activity: Activity) => void
  edit: (activity: Activity) => void
  chooseDecider: (activity: Activity) => void
  defineDone: (activity: Activity) => void
  prepareMessage: (activity: Activity) => void
  expand: (activity: Activity) => void
  record: (activity: Activity) => void
}

// What the open workstream's tabs and rows share, provided by WorkstreamDetail.
export type WorkstreamDetailState = {
  item: WorkstreamRecord
  all: WorkstreamRecord[]
  runs: WorkstreamRun[]
  communications: WorkstreamCommunication[]
  busy: boolean
  act: (action: () => Promise<void>) => Promise<void>
  navigate: (path: string) => void
  onSelect: (id: string) => void
  onRelate: (id: string) => void
  onSubstream: () => void
  onInspectRelationship: (relationship: CanvasRelationship) => void
  onReviewRelationship: (id: string, proposalId: string) => void
  openEditor: (editor: 'overview' | 'details' | 'sky') => void
  openArtifact: (artifact: Artifact) => void
  showView: (view: 'brief' | 'work' | 'details') => void
  expandedActivity: string | null
  expandActivity: (id: string | null) => void
  highlightedActivity: string | null
  activityActions: ActivityActions
}

export const WorkstreamDetailContext = createContext<WorkstreamDetailState | null>(null)
export const useWorkstreamDetail = () => useContext(WorkstreamDetailContext)! as WorkstreamDetailState

export function complete(activity: Activity) {
  return activity.state === 'done' || activity.state === 'canceled'
}
export function moment(value?: string) {
  return value ? value.replace('T', ' ').slice(0, 16) : ''
}
