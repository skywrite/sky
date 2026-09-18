import { randomUUID } from 'node:crypto'
import { CoordinationProposalSchema, type CoordinationProposal } from './coordination.ts'
import { ReportingSchema, WorkstreamError, type Workstream } from './types.ts'

const normalized = (value: string): string => value.trim().toLowerCase()

/** Called only when the owner accepts the proposal; metadata never grants execution or disclosure. */
export function acceptCoordination(work: Workstream, input: CoordinationProposal): Partial<Workstream> {
  const proposal = CoordinationProposalSchema.parse(input)
  if (proposal.timeline) {
    const start = proposal.timeline.start ?? work.start
    const due = proposal.timeline.due ?? work.due
    if (start && due && start > due)
      throw new WorkstreamError(
        'The proposed start is after the current deadline. Review the dates together before accepting this plan.',
      )
  }
  const stakeholders = [...work.stakeholders]
  for (const person of proposal.stakeholders ?? []) {
    const index = stakeholders.findIndex((entry) => normalized(entry.name) === normalized(person.name))
    const previous = stakeholders[index]
    const next = {
      id: previous?.id ?? randomUUID(),
      name: person.name,
      role: person.role || previous?.role || '',
      contact: person.contact ?? previous?.contact ?? '',
    }
    if (index < 0) stakeholders.push(next)
    else stakeholders[index] = next
  }
  const reporting = [...work.reporting]
  for (const report of proposal.reporting ?? []) {
    const index = reporting.findIndex(
      (entry) => normalized(entry.audience) === normalized(report.audience) && entry.medium === report.medium,
    )
    const previous = reporting[index]
    const next = ReportingSchema.parse({
      ...previous,
      id: previous?.id ?? randomUUID(),
      audience: report.audience,
      medium: report.medium,
      destination: report.destination ?? previous?.destination ?? '',
      cadenceDays: report.cadenceDays,
      instructions: report.instructions,
      detail: report.detail,
      artifacts: report.artifacts,
      // Reusing an audience retains its scope. A new audience starts with no source permissions.
      allowSensitive: previous?.allowSensitive ?? false,
      permittedSourceIds: previous?.permittedSourceIds ?? [],
    })
    if (index < 0) reporting.push(next)
    else reporting[index] = next
  }
  const metrics = [...work.metrics]
  for (const metric of proposal.metrics ?? []) {
    const index = metrics.findIndex((entry) => normalized(entry.name) === normalized(metric.name))
    const previous = metrics[index]
    const next = {
      id: previous?.id ?? randomUUID(),
      name: metric.name,
      target: metric.target,
      current: metric.current ?? previous?.current ?? '',
      unit: metric.unit ?? previous?.unit ?? '',
    }
    if (index < 0) metrics.push(next)
    else metrics[index] = next
  }
  return {
    stakeholders,
    reporting,
    metrics,
    ...(proposal.timeline?.start ? { start: proposal.timeline.start } : {}),
    ...(proposal.timeline?.due ? { due: proposal.timeline.due } : {}),
  }
}
