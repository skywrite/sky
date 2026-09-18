import { lstat, readdir, rmdir, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import { atomicWrite, hash, missing, readOptional } from '#lib/outbox/files.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { workstreamFile, workstreamPathRoot } from './files.ts'
import { Id, WorkstreamError, type WorkstreamRecord } from './types.ts'

const PurgeSchema = z.object({
  id: Id,
  revision: Id,
  creationOperationHash: z.string().optional(),
  pending: z
    .object({
      title: z.string(),
      files: z.array(
        z.object({ area: z.enum(['content', 'notebook', 'state']), path: z.string(), digest: z.string() }),
      ),
      directories: z.array(z.string()),
    })
    .optional(),
})
export type WorkstreamPurge = z.infer<typeof PurgeSchema>

function sharedFiles(root: string, notebookRoot: string, id: string, peers: WorkstreamRecord[]): Set<string> {
  return new Set(
    peers
      .filter((peer) => peer.id !== id)
      .flatMap((peer) => [
        ...peer.sources.map((source) => source.path),
        ...peer.artifacts.map((artifact) => artifact.path),
        ...peer.activities.flatMap((activity) => (activity.decisionPath ? [activity.decisionPath] : [])),
      ])
      .map((file) => path.resolve(workstreamPathRoot(notebookRoot, root, file), file)),
  )
}

/** Only identity and retry protection remain after content cleanup completes. */
export async function readWorkstreamPurges(root: string, dir: string): Promise<WorkstreamPurge[]> {
  const folder = await workstreamFile(root, path.join(dir, '.purged'))
  let entries
  try {
    entries = await readdir(folder, { withFileTypes: true })
  } catch (error) {
    if (missing(error)) return []
    throw error
  }
  const result: WorkstreamPurge[] = []
  for (const entry of entries) {
    if (!entry.name.endsWith('.json')) continue
    const file = await workstreamFile(root, path.join(folder, entry.name))
    const value = PurgeSchema.parse(JSON.parse((await readOptional(file))!))
    if (entry.name !== `${value.id}.json`) throw new WorkstreamError('A permanent deletion has invalid identity.', 409)
    result.push(value)
  }
  return result
}

export async function writeWorkstreamPurge(root: string, dir: string, value: WorkstreamPurge): Promise<void> {
  const file = await workstreamFile(root, path.join(dir, '.purged', `${Id.parse(value.id)}.json`))
  await atomicWrite(file, JSON.stringify(PurgeSchema.parse(value)))
}

export async function planWorkstreamPurge(
  root: string,
  stateDir: string,
  work: WorkstreamRecord,
  peers: WorkstreamRecord[],
  notebookRoot = root,
): Promise<WorkstreamPurge> {
  const files: NonNullable<WorkstreamPurge['pending']>['files'] = []
  const directories: string[] = []
  const folder = path.dirname(path.join(root, work.path))
  const shared = sharedFiles(root, notebookRoot, work.id, peers)
  const add = async (area: 'content' | 'state', file: string) => {
    const base = area === 'content' ? root : stateDir
    await workstreamFile(base, file)
    const text = await readOptional(file)
    if (text !== undefined) files.push({ area, path: path.relative(base, file), digest: hash(text) })
  }
  for (const kind of ['decisions', 'artifacts', 'runs', 'deliveries']) {
    const directory = path.join(folder, kind)
    try {
      if (!(await lstat(directory)).isDirectory()) continue
    } catch (error) {
      if (missing(error)) continue
      throw error
    }
    await workstreamFile(root, directory)
    // Ownership metadata, not the folder name, establishes which files can be removed.
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const file = path.join(directory, entry.name)
      if (shared.has(file)) continue
      const text = await readOptional(await workstreamFile(root, file))
      if (!text) continue
      const document = Document.fromMarkdown(text)
      const owner = kind === 'runs' || kind === 'deliveries' ? document.yaml.workstreamId : document.yaml.workstream
      if (!document.yamlError && owner === work.id) await add('content', file)
    }
    directories.push(path.relative(root, directory))
  }
  await add('state', path.join(stateDir, 'permissions', `${work.id}.json`))
  await add('state', path.join(stateDir, `${work.id}.review.json`))
  const permissions = path.join(stateDir, 'permissions')
  await workstreamFile(stateDir, path.join(permissions, 'probe'))
  for (const entry of await readdir(permissions, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(`report-${work.id}-`) || !entry.name.endsWith('.json')) continue
    const file = path.join(permissions, entry.name)
    const text = await readOptional(await workstreamFile(stateDir, file))
    if (text && JSON.parse(text).workstreamId === work.id) await add('state', file)
  }
  // Keep the tombstone until all positively owned content has been removed.
  await add('content', path.join(root, work.path))
  directories.push(path.relative(root, folder))
  return {
    id: work.id,
    revision: work.deletion!.id,
    creationOperationHash: work.creationOperationId ? hash(work.creationOperationId) : undefined,
    pending: { title: work.title, files, directories },
  }
}

export async function finishWorkstreamPurge(
  root: string,
  dir: string,
  stateDir: string,
  value: WorkstreamPurge,
  peers: WorkstreamRecord[] = [],
  notebookRoot = root,
): Promise<void> {
  if (!value.pending) return
  const shared = sharedFiles(root, notebookRoot, value.id, peers)
  const files = value.pending.files.filter(
    (file) =>
      file.area === 'state' ||
      path.basename(file.path) === 'workstream.md' ||
      !shared.has(path.resolve(root, file.path)),
  )
  const check = async (file: NonNullable<WorkstreamPurge['pending']>['files'][number]) => {
    // Old pending plans called owned content "notebook"; migration keeps their logical paths intact.
    const base = file.area === 'state' ? stateDir : root
    const absolute = await workstreamFile(base, path.resolve(base, file.path))
    const text = await readOptional(absolute)
    if (text !== undefined && hash(text) !== file.digest)
      throw new WorkstreamError(
        'A file changed during permanent deletion. Its newer contents have been preserved.',
        409,
      )
    return absolute
  }
  for (const file of files) await check(file)
  for (const file of files)
    await unlink(await check(file)).catch((error: unknown) => {
      if (!missing(error)) throw error
    })
  for (const relative of value.pending.directories) {
    const absolute = path.resolve(root, relative)
    if (absolute === path.resolve(dir) || absolute === path.resolve(root)) continue
    await workstreamFile(root, absolute)
    await rmdir(absolute).catch((error: unknown) => {
      if (!missing(error) && (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error
    })
  }
  await writeWorkstreamPurge(root, dir, { ...value, pending: undefined })
}
