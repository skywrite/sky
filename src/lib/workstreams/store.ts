import { randomUUID } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { atomicWrite, hash, missing, readOptional, withLock } from '#lib/outbox/files.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import type { DecisionAssumption } from './decisionPolicy.ts'
import { readDecisions, writeDecisions } from './decisions.ts'
import { resolveWorkstreamFile, workstreamFile, workstreamPathRoot } from './files.ts'
import { collidingWorkstreamId, readableWorkstreamId, workstreamIdentityTime } from './identities.ts'
import { finishWorkstreamPurge, planWorkstreamPurge, readWorkstreamPurges, writeWorkstreamPurge } from './purge.ts'
import {
  ArtifactSchema,
  CreationOperationId,
  Id,
  RunSchema,
  SkySchema,
  WorkstreamError,
  WorkstreamSchema,
  type Artifact,
  type SkyGrant,
  type SkySettings,
  type Workstream,
  type WorkstreamRecord,
  type WorkstreamDeletionReceipt,
  type WorkstreamRun,
} from './types.ts'

export const workstreamNow = (): string => ZonedDateTime.now().toUTC().normalize().plainDateTime.toString()

export type WorkstreamCreationOptions = { operationId?: string; identityTime?: string }

/** Files remain authoritative; discovery also handles folders renamed outside Sky. */
export class WorkstreamStore {
  readonly notebookRoot: string
  readonly contentRoot: string

  constructor(
    readonly dir: string,
    readonly stateDir: string,
    notebookRoot?: string,
    readonly today: () => string = () => PlainDate.today().ymd,
    contentRoot?: string,
    readonly initialize: () => Promise<void> = async () => {},
  ) {
    this.notebookRoot = notebookRoot ?? path.dirname(dir)
    this.contentRoot = contentRoot ?? this.notebookRoot
  }

  async resolveFile(relative: string): Promise<string> {
    await this.initialize()
    return resolveWorkstreamFile(this.notebookRoot, this.contentRoot, relative)
  }

  private async paths(dir = this.dir): Promise<string[]> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (missing(error)) return []
      throw error
    }
    const files: string[] = []
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue
      const file = path.join(dir, entry.name)
      if (entry.isFile() && entry.name === 'workstream.md') files.push(file)
      else if (entry.isDirectory() && !['artifacts', 'runs', 'decisions', 'deliveries'].includes(entry.name))
        files.push(...(await this.paths(file)))
    }
    return files
  }

  private async read(file: string): Promise<WorkstreamRecord> {
    await workstreamFile(this.contentRoot, file)
    const text = await readOptional(file)
    if (text === undefined) throw new WorkstreamError('This workstream could not be found.', 404)
    const doc = Document.fromMarkdown(text)
    if (doc.yamlError) throw new WorkstreamError('This workstream has invalid YAML frontmatter.')
    const parsed = WorkstreamSchema.parse({ ...doc.yaml, notes: doc.markdown })
    if (new Set(parsed.activities.map((activity) => activity.id)).size !== parsed.activities.length)
      throw new WorkstreamError(
        'This workstream has duplicate activity identities. Repair them before continuing.',
        409,
      )
    // Tombstones retain their last projection. Removed work must remain discoverable even if a linked decision later moves.
    const { work, digest } = parsed.deletion
      ? { work: parsed, digest: '' }
      : await readDecisions(this.contentRoot, parsed)
    return { ...work, revision: hash(`${text}${digest}`), path: path.relative(this.contentRoot, file) }
  }

  private async records(): Promise<{ items: WorkstreamRecord[]; errors: { path: string; message: string }[] }> {
    await this.initialize()
    const items: WorkstreamRecord[] = [],
      errors: { path: string; message: string }[] = []
    const duplicate = new Set<string>()
    const duplicateOperations = new Set<string>()
    const purged = new Set((await readWorkstreamPurges(this.contentRoot, this.dir)).map((entry) => entry.id))
    for (const file of await this.paths()) {
      try {
        const item = await this.read(file)
        if (purged.has(item.id)) continue
        if (items.some((other) => other.id === item.id)) duplicate.add(item.id)
        if (item.creationOperationId && items.some((other) => other.creationOperationId === item.creationOperationId))
          duplicateOperations.add(item.creationOperationId)
        items.push(item)
      } catch (error) {
        errors.push({
          path: path.relative(this.contentRoot, file),
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    for (const item of items.filter((item) => duplicate.has(item.id)))
      errors.push({
        path: item.path,
        message: `Duplicate workstream identity: ${item.id}. Give the copied workstream a new id.`,
      })
    for (const item of items.filter((item) => duplicateOperations.has(item.creationOperationId ?? '')))
      errors.push({
        path: item.path,
        message: `Duplicate workstream creation operation: ${item.creationOperationId}. Repair the copied record before retrying.`,
      })
    return {
      items: items.filter((item) => !duplicate.has(item.id)).sort((a, b) => b.updated.localeCompare(a.updated)),
      errors,
    }
  }

  async report(): Promise<{
    items: WorkstreamRecord[]
    deleted: WorkstreamDeletionReceipt[]
    errors: { path: string; message: string }[]
  }> {
    const report = await this.records()
    const pending = (await readWorkstreamPurges(this.contentRoot, this.dir)).filter((entry) => entry.pending)
    return {
      ...report,
      items: report.items.filter((item) => !item.deletion),
      deleted: [
        ...pending.map((entry) => ({
          id: entry.id,
          title: entry.pending!.title,
          revision: entry.revision,
          purging: true,
        })),
        ...report.items
          .filter((item) => item.deletion)
          .map((item) => ({ id: item.id, title: item.title, revision: item.deletion!.id })),
      ],
    }
  }

  async list(): Promise<WorkstreamRecord[]> {
    return (await this.report()).items
  }

  private async getAny(id: string): Promise<WorkstreamRecord | null> {
    if (!Id.safeParse(id).success) throw new WorkstreamError('Invalid workstream identity.', 404)
    const report = await this.records()
    if (report.errors.some((error) => error.message.includes(`Duplicate workstream identity: ${id}.`)))
      throw new WorkstreamError(
        'More than one file has this workstream identity. Repair the duplicate before continuing.',
        409,
      )
    return report.items.find((item) => item.id === id) ?? null
  }

  async get(id: string): Promise<WorkstreamRecord | null> {
    const item = await this.getAny(id)
    return item?.deletion ? null : item
  }

  /** A retry finds the accepted work even after title edits, folder moves, or a restart. */
  async getByCreationOperation(operationId: string): Promise<WorkstreamRecord | null> {
    await this.initialize()
    const key = CreationOperationId.parse(operationId)
    if (
      (await readWorkstreamPurges(this.contentRoot, this.dir)).some(
        (entry) => entry.creationOperationHash === hash(key),
      )
    )
      throw new WorkstreamError(
        'The workstream created by this request was permanently deleted. Start a new request.',
        409,
      )
    const report = await this.records()
    if (report.errors.some((error) => error.message.includes(`Duplicate workstream creation operation: ${key}.`)))
      throw new WorkstreamError(
        'More than one workstream records this creation. Repair the duplicate before retrying.',
        409,
      )
    const work = report.items.find((item) => item.creationOperationId === key)
    if (work?.deletion)
      throw new WorkstreamError(
        'The workstream created by this request was deleted. Restore it instead of retrying creation.',
        409,
      )
    return work ?? null
  }

  private async validate(work: Workstream, peers: WorkstreamRecord[], previous?: Workstream): Promise<void> {
    const purged = new Set((await readWorkstreamPurges(this.contentRoot, this.dir)).map((entry) => entry.id))
    const ids = new Set<string>()
    for (const item of work.activities) {
      if (ids.has(item.id)) throw new WorkstreamError('Each activity must have a unique identity.')
      ids.add(item.id)
    }
    const checkDate = (value: string | undefined) => {
      if (value !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new PlainDate(value).ymd !== value))
        throw new WorkstreamError('Use YYYY-MM-DD for work dates.')
    }
    checkDate(work.start)
    checkDate(work.due)
    for (const item of work.activities) {
      checkDate(item.start)
      checkDate(item.end)
      checkDate(item.due)
      if (item.start && item.end && item.end < item.start)
        throw new WorkstreamError('An activity cannot end before it starts.')
      for (const entry of item.participation) checkDate(entry.day)
    }
    for (const source of work.sources) {
      workstreamPathRoot(this.notebookRoot, this.contentRoot, source.path)
    }
    const all = new Map(peers.filter((peer) => peer.id !== work.id).map((peer) => [peer.id, peer as Workstream]))
    all.set(work.id, work)
    if (work.parentId) {
      if ((all.get(work.parentId)?.deletion || purged.has(work.parentId)) && previous?.parentId !== work.parentId)
        throw new WorkstreamError('Restore that workstream before adding work beneath it.')
      const seen = new Set([work.id])
      let parent: string | undefined = work.parentId
      while (parent) {
        if (seen.has(parent))
          throw new WorkstreamError('A workstream cannot contain itself, even through another workstream.')
        seen.add(parent)
        const ancestor = all.get(parent)
        if (!ancestor && purged.has(parent)) break
        if (!ancestor) throw new WorkstreamError('The parent workstream could not be found.')
        parent = ancestor.parentId
      }
    }
    for (const relation of work.relations) {
      if (
        (all.get(relation.targetId)?.deletion || purged.has(relation.targetId)) &&
        !previous?.relations.some((entry) => entry.targetId === relation.targetId)
      )
        throw new WorkstreamError('Restore that workstream before adding a relationship to it.')
      if (relation.targetId === work.id || (!all.has(relation.targetId) && !purged.has(relation.targetId)))
        throw new WorkstreamError('Choose another existing workstream for this relationship.')
    }
    for (const activity of work.activities) {
      for (const dependency of activity.requires) {
        const prior = previous?.activities
          .find((entry) => entry.id === activity.id)
          ?.requires.find(
            (entry) => entry.workstreamId === dependency.workstreamId && entry.activityId === dependency.activityId,
          )
        if (!dependency.result.trim() && (!prior || prior.result.trim()))
          throw new WorkstreamError('Describe the result this activity needs before adding a prerequisite.')
        if ((all.get(dependency.workstreamId)?.deletion || purged.has(dependency.workstreamId)) && !prior)
          throw new WorkstreamError('Restore that workstream before adding it as a prerequisite.')
      }
    }
    for (const peer of peers) {
      if (peer.id === work.id) continue
      for (const activity of peer.activities)
        if (
          activity.requires.some(
            (requirement) => requirement.workstreamId === work.id && !ids.has(requirement.activityId),
          )
        )
          throw new WorkstreamError('Another activity needs this result. Remove or change its prerequisite first.')
    }
    const visited = new Set<string>(),
      visiting = new Set<string>()
    const visit = (wid: string, aid: string) => {
      const key = `${wid}/${aid}`
      if (visiting.has(key))
        throw new WorkstreamError('These prerequisites form a cycle. Each required result must be able to happen.')
      if (visited.has(key)) return
      if (purged.has(wid)) return
      const activity = all.get(wid)?.activities.find((item) => item.id === aid)
      if (!activity) throw new WorkstreamError('A required activity could not be found.')
      visiting.add(key)
      for (const dependency of activity.requires) visit(dependency.workstreamId, dependency.activityId)
      visiting.delete(key)
      visited.add(key)
    }
    for (const item of work.activities) visit(work.id, item.id)
  }

  private async save(file: string, work: Workstream, updateDecisions = true): Promise<WorkstreamRecord> {
    await workstreamFile(this.contentRoot, file)
    // Strip transport fields while retaining unknown notebook frontmatter and human prose.
    const document = updateDecisions ? await writeDecisions(this.contentRoot, file, work) : work
    const { notes, revision: _revision, path: _path, ...yaml } = document
    await atomicWrite(file, new Document(yaml, notes).toMarkdown())
    return this.read(file)
  }

  async create(
    input: Partial<Workstream>,
    now?: string,
    options: WorkstreamCreationOptions = {},
  ): Promise<WorkstreamRecord> {
    await this.initialize()
    return withLock(path.join(this.stateDir, 'write.lock'), async () => {
      if (input.deletion !== undefined) throw new WorkstreamError('New work cannot be created with deletion metadata.')
      if (input.creationOperationId !== undefined)
        throw new WorkstreamError('Creation operation identity must come from the creation request.')
      const operationId = options.operationId === undefined ? undefined : CreationOperationId.parse(options.operationId)
      if (operationId) {
        const accepted = await this.getByCreationOperation(operationId)
        if (accepted) return accepted
      }
      const report = await this.records()
      const purged = new Set((await readWorkstreamPurges(this.contentRoot, this.dir)).map((entry) => entry.id))
      const base = input.id ?? readableWorkstreamId(input, options.identityTime ?? now ?? workstreamIdentityTime())
      Id.parse(base)
      let id = base
      for (let collision = 2; ; collision++) {
        const existing =
          purged.has(id) ||
          report.items.some((item) => item.id === id) ||
          report.errors.some((error) => error.message.includes(`Duplicate workstream identity: ${id}.`))
        let occupied = existing
        try {
          await lstat(path.join(this.dir, id))
          occupied = true
        } catch (error) {
          if (!missing(error)) throw error
        }
        if (!occupied) break
        if (input.id)
          throw new WorkstreamError(
            'This workstream identity or folder already exists. Choose another identity or restore deleted work.',
            409,
          )
        id = collidingWorkstreamId(base, collision)
      }
      const created = now ?? workstreamNow()
      const work = WorkstreamSchema.parse({
        ...input,
        id,
        created,
        updated: created,
        creationOperationId: operationId,
        sky: SkySchema.parse({}),
      })
      await this.validate(work, report.items)
      const folder = path.join(this.dir, work.id)
      return this.save(path.join(folder, 'workstream.md'), work)
    })
  }

  async put(input: Workstream, revision: string): Promise<WorkstreamRecord> {
    await this.initialize()
    return withLock(path.join(this.stateDir, 'write.lock'), async () => {
      if (input.deletion !== undefined)
        throw new WorkstreamError('Use the delete or restore operation to change deletion state.')
      const current = await this.get(input.id)
      if (!current) throw new WorkstreamError('The workstream could not be found.', 404)
      if (current.revision !== revision)
        throw new WorkstreamError(
          'This workstream changed. Reload it before saving; your changes have not been applied.',
          409,
        )
      const work = this.syncParticipation(
        WorkstreamSchema.parse({
          ...current,
          ...input,
          created: current.created,
          creationOperationId: current.creationOperationId,
        }),
        current,
      )
      await this.validate(work, (await this.records()).items, current)
      return this.save(path.join(this.contentRoot, current.path), work)
    })
  }

  private async revokeForRemoval(work: Workstream): Promise<void> {
    const settings = SkySchema.parse({ ...work.sky, mode: 'off' })
    await atomicWrite(path.join(this.stateDir, 'permissions', `${work.id}.json`), JSON.stringify(settings))
  }

  /** Removal keeps every notebook file and link; the receipt identifies one reversible deletion event. */
  async delete(id: string, revision: string, now = workstreamNow()): Promise<WorkstreamDeletionReceipt> {
    await this.initialize()
    return withLock(path.join(this.stateDir, 'write.lock'), async () => {
      const current = await this.getAny(id)
      if (!current) throw new WorkstreamError('The workstream could not be found.', 404)
      if (current.deletion) {
        if (revision !== current.deletion.previousRevision && revision !== current.deletion.id)
          throw new WorkstreamError('This workstream was deleted by a different change. Reload before continuing.', 409)
        return { id, title: current.title, revision: current.deletion.id }
      }
      if (current.revision !== revision)
        throw new WorkstreamError('This workstream changed. Reload it before deleting.', 409)
      const deletion = { id: randomUUID(), at: now, previousRevision: revision }
      // Revoke first: a failed tombstone write must not leave a previous execution grant active.
      await this.revokeForRemoval(current)
      const removed = await this.save(
        path.join(this.contentRoot, current.path),
        {
          ...current,
          deletion,
          updated: now,
          sky: { ...current.sky, mode: 'off' },
          history: [
            ...current.history,
            {
              id: randomUUID(),
              at: now,
              actor: 'human',
              kind: 'deleted',
              operationId: `delete:${deletion.id}`,
              summary: 'Deleted this workstream. Its records remain available for Undo.',
            },
          ],
        },
        false,
      )
      return { id, title: removed.title, revision: deletion.id }
    })
  }

  async restore(id: string, revision: string, now = workstreamNow()): Promise<WorkstreamRecord> {
    await this.initialize()
    return withLock(path.join(this.stateDir, 'write.lock'), async () => {
      if ((await readWorkstreamPurges(this.contentRoot, this.dir)).some((entry) => entry.id === id))
        throw new WorkstreamError('This workstream was permanently deleted and cannot be restored.', 409)
      const current = await this.getAny(id)
      if (!current) throw new WorkstreamError('The deleted workstream could not be found.', 404)
      if (!current.deletion) {
        const latest = current.history.findLast((entry) => entry.kind === 'deleted' || entry.kind === 'restored')
        if (latest?.kind === 'restored' && latest.operationId === `restore:${revision}`) return current
        throw new WorkstreamError('This deletion is no longer current. Reload before restoring.', 409)
      }
      if (current.deletion.id !== revision)
        throw new WorkstreamError('This workstream was deleted again. Use its latest Undo action.', 409)
      // Read current canonical decisions so edits made while hidden survive restoration.
      const { work } = await readDecisions(this.contentRoot, current)
      const restored = WorkstreamSchema.parse({
        ...work,
        deletion: undefined,
        updated: now,
        sky: { ...work.sky, mode: 'off' },
        history: [
          ...work.history,
          {
            id: randomUUID(),
            at: now,
            actor: 'human',
            kind: 'restored',
            operationId: `restore:${revision}`,
            summary: 'Restored this workstream. Ongoing Sky responsibility remains off.',
          },
        ],
      })
      await this.validate(restored, (await this.records()).items, current)
      await this.revokeForRemoval(restored)
      return this.save(path.join(this.contentRoot, current.path), restored, false)
    })
  }

  /** Only the current deletion receipt authorizes irreversible removal of this work's owned files. */
  async purge(id: string, revision: string): Promise<{ id: string; revision: string }> {
    Id.parse(id)
    await this.initialize()
    return withLock(path.join(this.stateDir, `${id}.run.lock`), () =>
      withLock(path.join(this.stateDir, `report-${id}.lock`), () =>
        withLock(path.join(this.stateDir, 'write.lock'), () =>
          withLock(path.join(this.stateDir, 'report-deliveries-write.lock'), async () => {
            const prior = (await readWorkstreamPurges(this.contentRoot, this.dir)).find((entry) => entry.id === id)
            if (prior) {
              if (prior.revision !== revision)
                throw new WorkstreamError(
                  'This permanent deletion belongs to a different change. Reload before continuing.',
                  409,
                )
              if (!prior.pending) return { id, revision }
              const peers = await this.records()
              if (peers.errors.length)
                throw new WorkstreamError(
                  'Repair the reported workstream file errors before permanent deletion so shared files can be checked.',
                  409,
                )
              await finishWorkstreamPurge(
                this.contentRoot,
                this.dir,
                this.stateDir,
                prior,
                peers.items,
                this.notebookRoot,
              )
              return { id, revision }
            }
            const current = await this.getAny(id)
            if (!current) throw new WorkstreamError('The deleted workstream could not be found.', 404)
            if (!current.deletion || current.deletion.id !== revision)
              throw new WorkstreamError('This deletion is no longer current. Reload before permanently deleting.', 409)
            const peers = await this.records()
            if (peers.errors.length)
              throw new WorkstreamError(
                'Repair the reported workstream file errors before permanent deletion so shared files can be checked.',
                409,
              )
            await this.revokeForRemoval(current)
            const plan = await planWorkstreamPurge(
              this.contentRoot,
              this.stateDir,
              current,
              peers.items,
              this.notebookRoot,
            )
            // Reserve identity before touching content: a partial cleanup must never enable Undo or creation replay.
            await writeWorkstreamPurge(this.contentRoot, this.dir, plan)
            await finishWorkstreamPurge(
              this.contentRoot,
              this.dir,
              this.stateDir,
              plan,
              (await this.records()).items,
              this.notebookRoot,
            )
            return { id, revision }
          }),
        ),
      ),
    )
  }

  private syncParticipation(next: Workstream, previous: Workstream): Workstream {
    const day = this.today()
    return {
      ...next,
      activities: next.activities.map((activity) => {
        const old = previous.activities.find((entry) => entry.id === activity.id)
        if (!old || (old.state === activity.state && old.result === activity.result)) return activity
        return {
          ...activity,
          participation: activity.participation.map((entry) =>
            entry.day === day && !entry.removed ? { ...entry, state: activity.state, reportedAt: next.updated } : entry,
          ),
        }
      }),
    }
  }

  async getGrant(id: string): Promise<SkyGrant> {
    await this.initialize()
    Id.parse(id)
    const raw = await readOptional(path.join(this.stateDir, 'permissions', `${id}.json`))
    const settings = SkySchema.parse(raw ? JSON.parse(raw) : {})
    return {
      mode: settings.mode,
      instruction: settings.instruction,
      reviewEveryHours: settings.reviewEveryHours,
      maxRunsPerDay: settings.maxRunsPerDay,
      maxRunsTotal: settings.maxRunsTotal,
      decisionPolicies: settings.decisionPolicies,
      actionPolicies: settings.actionPolicies,
      revision: hash(raw ?? ''),
    }
  }

  /** Only an explicit user operation can write authority; the execution loop never calls this method. */
  async configureSky(
    id: string,
    input: SkySettings,
    revision: string,
    decision?: { activityId: string; assumptions: DecisionAssumption[] },
  ): Promise<WorkstreamRecord> {
    await this.initialize()
    return withLock(path.join(this.stateDir, 'write.lock'), async () => {
      let current = await this.get(id)
      if (!current) throw new WorkstreamError('The workstream could not be found.', 404)
      if (current.revision !== revision)
        throw new WorkstreamError('The workstream changed. Reload before changing Sky’s responsibility.', 409)
      const settings = SkySchema.parse(input)
      const previousGrant = await this.getGrant(id)
      if (decision) {
        const policy = settings.decisionPolicies[decision.activityId]
        const activity = current.activities.find((entry) => entry.id === decision.activityId)
        if (!activity || activity.kind !== 'decision' || !policy)
          throw new WorkstreamError('Choose an existing decision to configure its responsibility.')
        const assumptions = structuredClone(decision.assumptions)
        for (const assumption of assumptions) {
          if (assumption.status !== 'confirmed') continue
          const previous = activity.decisionAssumptions?.find((entry) => entry.id === assumption.id)
          if (previous && JSON.stringify(previous) === JSON.stringify(assumption)) continue
          assumption.confirmedBy = 'owner'
          assumption.sourceVersions = {}
          for (const sourceId of assumption.sourceIds) {
            const source = current.sources.find((entry) => entry.id === sourceId)
            if (!source) throw new WorkstreamError('Choose an existing source for this assumption.')
            const text = await readOptional(await this.resolveFile(source.path))
            if (text === undefined)
              throw new WorkstreamError('An assumption source is missing; restore it before confirming.')
            assumption.sourceVersions[sourceId] = hash(text)
          }
        }
        current = {
          ...current,
          activities: current.activities.map((entry) =>
            entry.id === activity.id
              ? {
                  ...entry,
                  decisionAssumptions: assumptions,
                  executor: policy.mode === 'delegate' ? 'sky' : 'human',
                  state: entry.state === 'proposed' ? 'ready' : entry.state,
                }
              : entry,
          ),
        }
      }
      for (const [activityId, policy] of Object.entries(settings.actionPolicies)) {
        const activity = current.activities.find((entry) => entry.id === activityId)
        if (!activity || activity.kind !== 'action' || activity.subworkstreamId)
          throw new WorkstreamError('Deliverable completion must refer to an existing action.')
        if (policy.requiredSourceIds.some((sourceId) => !current.sources.some((source) => source.id === sourceId)))
          throw new WorkstreamError('Select existing workstream sources for deliverable verification.')
        if (
          !policy.activityTitle ||
          JSON.stringify(policy) !== JSON.stringify(previousGrant.actionPolicies[activityId])
        )
          policy.activityTitle = activity.title
      }
      for (const [activityId, policy] of Object.entries(settings.decisionPolicies)) {
        const activity = current.activities.find((entry) => entry.id === activityId)
        if (!activity || activity.kind !== 'decision' || activity.subworkstreamId)
          throw new WorkstreamError('Decision authority must refer to an existing decision.')
        if (
          decision?.activityId === activityId ||
          !policy.activityTitle ||
          JSON.stringify(policy) !== JSON.stringify(previousGrant.decisionPolicies[activityId])
        )
          policy.activityTitle = activity.title
        if (policy.requiredSourceIds.some((sourceId) => !current.sources.some((source) => source.id === sourceId)))
          throw new WorkstreamError('Select existing workstream sources for decision evidence.')
        if (
          policy.requiredStakeholderIds.some(
            (stakeholderId) => !current.stakeholders.some((person) => person.id === stakeholderId),
          )
        )
          throw new WorkstreamError('Select existing workstream stakeholders for decision input.')
        if (
          policy.requiredAssumptionIds.some(
            (assumptionId) => !activity.decisionAssumptions?.some((assumption) => assumption.id === assumptionId),
          )
        )
          throw new WorkstreamError('Select existing decision assumptions before delegating the choice.')
      }
      // Revoke first. If the record write fails, no old grant can keep executing.
      const file = path.join(this.stateDir, 'permissions', `${id}.json`)
      await atomicWrite(file, JSON.stringify({ ...settings, mode: 'off' }))
      const saved = await this.save(path.join(this.contentRoot, current.path), {
        ...current,
        sky: settings,
        updated: workstreamNow(),
      })
      await atomicWrite(
        file,
        JSON.stringify({
          mode: settings.mode,
          instruction: settings.instruction,
          reviewEveryHours: settings.reviewEveryHours,
          maxRunsPerDay: settings.maxRunsPerDay,
          maxRunsTotal: settings.maxRunsTotal,
          decisionPolicies: settings.decisionPolicies,
          actionPolicies: settings.actionPolicies,
        }),
      )
      return saved
    })
  }

  /** The final permission and revision check shares the writer lock with the local effect. */
  async commitRunEffect(
    next: Workstream,
    expectedRevision: string,
    expectedGrantRevision: string,
    artifact?: Artifact,
    content?: string,
    allowManual = false,
  ): Promise<WorkstreamRecord> {
    await this.initialize()
    return withLock(path.join(this.stateDir, 'write.lock'), async () => {
      if (next.deletion !== undefined)
        throw new WorkstreamError('Sky cannot delete a workstream through an execution update.')
      const current = await this.get(next.id)
      if (!current) throw new WorkstreamError('This workstream could not be found.', 404)
      const grant = await this.getGrant(next.id)
      if (grant.revision !== expectedGrantRevision || (grant.mode === 'off' && !allowManual))
        throw new WorkstreamError('Sky’s responsibility changed while this work was being prepared.', 409)
      if (
        current.revision !== expectedRevision ||
        (current.state !== 'active' && !(allowManual && current.state === 'proposed'))
      )
        throw new WorkstreamError('This workstream changed while Sky was preparing its next step.', 409)
      const work = this.syncParticipation(
        WorkstreamSchema.parse({ ...next, creationOperationId: current.creationOperationId }),
        current,
      )
      await this.validate(work, (await this.records()).items, current)
      if (artifact && content !== undefined) await this.saveArtifact(work.id, artifact, content)
      return this.save(path.join(this.contentRoot, current.path), work)
    })
  }

  async putRun(input: WorkstreamRun): Promise<void> {
    await this.initialize()
    return withLock(path.join(this.stateDir, 'write.lock'), () => this.saveRun(input))
  }

  private async saveRun(input: WorkstreamRun): Promise<void> {
    const run = RunSchema.parse(input)
    const work = await this.get(run.workstreamId)
    if (!work) throw new WorkstreamError('The workstream could not be found.', 404)
    const file = await workstreamFile(
      this.contentRoot,
      path.join(this.contentRoot, path.dirname(work.path), 'runs', `${run.id}.md`),
    )
    await atomicWrite(file, new Document(run, `${run.summary}\n`).toMarkdown())
  }

  async runs(id: string): Promise<WorkstreamRun[]> {
    const work = await this.get(id)
    if (!work) return []
    const folder = await workstreamFile(this.contentRoot, path.join(this.contentRoot, path.dirname(work.path), 'runs'))
    let entries
    try {
      entries = await readdir(folder, { withFileTypes: true })
    } catch (error) {
      if (missing(error)) return []
      throw error
    }
    const result: WorkstreamRun[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const text = await readOptional(await workstreamFile(this.contentRoot, path.join(folder, entry.name)))
      if (text) result.push(RunSchema.parse(Document.fromMarkdown(text).yaml))
    }
    return result.sort((a, b) => b.started.localeCompare(a.started))
  }

  async writeArtifact(id: string, value: Artifact, content: string): Promise<void> {
    await this.initialize()
    return withLock(path.join(this.stateDir, 'write.lock'), () => this.saveArtifact(id, value, content))
  }

  private async saveArtifact(id: string, value: Artifact, content: string): Promise<void> {
    const artifact = ArtifactSchema.parse(value)
    const work = await this.get(id)
    if (!work) throw new WorkstreamError('The workstream could not be found.', 404)
    const file = await workstreamFile(
      this.contentRoot,
      path.join(this.contentRoot, path.dirname(work.path), 'artifacts', `${artifact.id}.md`),
    )
    const text = new Document(
      {
        id: artifact.id,
        title: artifact.title,
        created: artifact.created,
        updated: artifact.created,
        workstream: id,
        activity: artifact.activityId,
        kind: artifact.kind,
      },
      content,
    ).toMarkdown()
    const existing = await readOptional(file)
    if (existing !== undefined && existing !== text)
      throw new WorkstreamError(
        'This artifact already exists with different content. Your existing work has been preserved.',
        409,
      )
    if (existing === undefined) await atomicWrite(file, text)
  }

  async readArtifact(id: string, artifactId: string): Promise<{ artifact: Artifact; content: string }> {
    Id.parse(artifactId)
    const work = await this.get(id)
    const artifact = work?.artifacts.find((item) => item.id === artifactId)
    if (!work || !artifact) throw new WorkstreamError('This artifact could not be found.', 404)
    const file = await workstreamFile(
      this.contentRoot,
      path.join(this.contentRoot, path.dirname(work.path), 'artifacts', `${artifactId}.md`),
    )
    const text = await readOptional(file)
    if (text === undefined) throw new WorkstreamError('The artifact file is missing.', 404)
    return { artifact, content: Document.fromMarkdown(text).markdown }
  }
}
