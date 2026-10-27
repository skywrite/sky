import type { DecisionAssumption, DecisionRecord } from '#lib/workstreams/decisionPolicy.ts'
import type { Activity, WorkstreamRecord } from '#lib/workstreams/types.ts'

export type DecisionWork = Activity & {
  decisionAssumptions?: DecisionAssumption[]
  decisionAnalysis?: DecisionRecord
  decisionResolution?: DecisionRecord
}

export const readableReason = (item: WorkstreamRecord, text: string) =>
  [
    ...item.sources.map((source) => [source.id, source.label || source.path]),
    ...item.stakeholders.map((stakeholder) => [stakeholder.id, stakeholder.name]),
  ].reduce((result, [id, label]) => result.replaceAll(id!, label!), text)
