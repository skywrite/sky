import * as path from 'node:path'
import { atomicWrite, hash, notebookFile, readOptional } from '#lib/outbox/files.ts'
import DecisionDocument from '#shared/models/Decision/document/mod.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { workstreamFile } from './files.ts'
import { ActivitySchema, WorkstreamError, type Workstream } from './types.ts'

/** A decision has one editable document. Embedded fields are the projection used by the canvas and Today. */
export async function readDecisions(
  contentRoot: string,
  work: Workstream,
): Promise<{ work: Workstream; digest: string }> {
  const versions: string[] = []
  const activities: Workstream['activities'] = []
  for (const activity of work.activities) {
    if (activity.kind !== 'decision' || !activity.decisionPath) {
      activities.push(activity)
      continue
    }
    const file = await notebookFile(contentRoot, activity.decisionPath)
    const text = await readOptional(file)
    if (!text)
      throw new WorkstreamError(
        'A linked decision document is missing. Restore it before editing this workstream.',
        409,
      )
    const document = Document.fromMarkdown(text)
    if (document.yamlError || document.yaml.activity !== activity.id || document.yaml.workstream !== work.id)
      throw new WorkstreamError('A linked decision document has invalid metadata or identity.', 409)
    const data = document.yaml
    activities.push(
      ActivitySchema.parse({
        ...activity,
        title: data.summary ?? activity.title,
        state: data.resolved ? 'done' : (data.state ?? 'ready'),
        result: data.result ?? '',
        recommendation: data.recommendation ?? '',
        decisionAssumptions: data.decisionAssumptions ?? activity.decisionAssumptions ?? [],
        decisionAnalysis: data.decisionAnalysis ?? activity.decisionAnalysis,
        decisionResolution: data.decisionResolution ?? activity.decisionResolution,
        decisionHistory: data.decisionHistory ?? activity.decisionHistory ?? [],
        notes: document.markdown,
      }),
    )
    versions.push(hash(text))
  }
  return { work: { ...work, activities }, digest: versions.join(':') }
}

/** Called under the workstream writer lock; a restart reads a written decision even if its brief projection is older. */
export async function writeDecisions(contentRoot: string, file: string, work: Workstream): Promise<Workstream> {
  const activities: Workstream['activities'] = []
  for (const activity of work.activities) {
    if (activity.kind !== 'decision') {
      activities.push(activity)
      continue
    }
    const relative =
      activity.decisionPath ??
      path.relative(contentRoot, path.join(path.dirname(file), 'decisions', `${activity.id}.md`))
    const existingPath = activity.decisionPath
      ? await notebookFile(contentRoot, relative)
      : await workstreamFile(contentRoot, path.join(contentRoot, relative))
    const oldText = await readOptional(existingPath)
    const previous = oldText ? Document.fromMarkdown(oldText) : null
    if (
      previous &&
      (previous.yamlError || previous.yaml.activity !== activity.id || previous.yaml.workstream !== work.id)
    )
      throw new WorkstreamError('This decision path belongs to different work.', 409)
    if (
      previous?.yaml.decisionResolution &&
      JSON.stringify(previous.yaml.decisionResolution) !== JSON.stringify(activity.decisionResolution)
    )
      throw new WorkstreamError(
        'A recorded delegated decision cannot be overwritten. Create a new decision to reconsider it.',
        409,
      )
    if (previous?.yaml.decisionResolution && previous.yaml.result !== activity.result)
      throw new WorkstreamError(
        'A recorded delegated result cannot be rewritten. Create a new decision to reconsider it.',
        409,
      )
    const previousHistory = Array.isArray(previous?.yaml.decisionHistory) ? previous.yaml.decisionHistory : []
    if (
      previousHistory.some(
        (entry, index) => JSON.stringify(entry) !== JSON.stringify(activity.decisionHistory?.[index]),
      )
    )
      throw new WorkstreamError('Decision attribution is append-only. Preserve the recorded decision history.', 409)
    const same =
      previous &&
      previous.yaml.summary === activity.title &&
      previous.yaml.state === activity.state &&
      (previous.yaml.result ?? '') === activity.result &&
      (previous.yaml.recommendation ?? '') === activity.recommendation &&
      JSON.stringify(previous.yaml.decisionAssumptions ?? []) === JSON.stringify(activity.decisionAssumptions ?? []) &&
      JSON.stringify(previous.yaml.decisionAnalysis) === JSON.stringify(activity.decisionAnalysis) &&
      JSON.stringify(previous.yaml.decisionResolution) === JSON.stringify(activity.decisionResolution) &&
      JSON.stringify(previous.yaml.decisionHistory ?? []) === JSON.stringify(activity.decisionHistory ?? []) &&
      previous.markdown === activity.notes
    if (!same) {
      const document = new DecisionDocument(
        {
          ...previous?.yaml,
          name: activity.id,
          summary: activity.title,
          created: previous?.yaml.created ?? work.created.slice(0, 10),
          updated: work.updated.slice(0, 10),
          identified: previous?.yaml.identified ?? `${work.updated} UTC`,
          resolved: activity.state === 'done' ? (previous?.yaml.resolved ?? `${work.updated} UTC`) : null,
          workstream: work.id,
          activity: activity.id,
          state: activity.state,
          result: activity.result,
          recommendation: activity.recommendation,
          decisionAssumptions: activity.decisionAssumptions ?? [],
          decisionAnalysis: activity.decisionAnalysis,
          decisionResolution: activity.decisionResolution,
          decisionHistory: activity.decisionHistory ?? [],
        },
        activity.notes,
      )
      await atomicWrite(existingPath, document.toMarkdown())
    }
    activities.push({ ...activity, decisionPath: relative })
  }
  return { ...work, activities }
}
