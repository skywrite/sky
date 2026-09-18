import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readFile, readdir, rmdir, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { hash, missing, withLock } from '#lib/outbox/files.ts'
import { loadAutomationDir } from '#shared/models/Automation/loadAutomationDir.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { workstreamFile } from './files.ts'
import { workstreamStoragePaths, type WorkstreamStorageConfig } from './storagePaths.ts'
import { WorkstreamError } from './types.ts'

export function createWorkstreamStorage(config: WorkstreamStorageConfig) {
  const paths = workstreamStoragePaths(config)
  let ready: Promise<void> | undefined
  return {
    ...paths,
    initialize: () =>
      (ready ??= migrate(config, paths).catch((error: unknown) => {
        ready = undefined
        throw error
      })),
  }
}

async function statOptional(file: string) {
  try {
    return await lstat(file)
  } catch (error) {
    if (missing(error)) return undefined
    throw error
  }
}

async function inventory(dir: string, relative = ''): Promise<{ files: string[]; directories: string[] }> {
  const files: string[] = []
  const directories: string[] = []
  for (const entry of await readdir(path.join(dir, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name)
    if (entry.isDirectory()) {
      const child = await inventory(dir, name)
      files.push(...child.files)
      directories.push(...child.directories)
    } else if (entry.isFile()) files.push(name)
    else throw new WorkstreamError('Workstream migration requires ordinary files and directories.')
  }
  directories.push(relative)
  return { files, directories }
}

async function destination(root: string, name: string): Promise<Buffer | undefined> {
  await workstreamFile(root, path.join(root, name))
  const rootStat = await statOptional(root)
  if (rootStat && !rootStat.isDirectory()) throw new WorkstreamError('Workstream state must be an ordinary directory.')
  const file = path.join(root, name)
  const stat = await statOptional(file)
  if (!stat) return undefined
  if (!stat.isFile()) throw new WorkstreamError('Workstream migration cannot replace a directory or symbolic link.')
  return readFile(file)
}

function conflict(): WorkstreamError {
  return new WorkstreamError(
    'Workstream migration found different copies in the notebook and state directory. Both copies were kept.',
    409,
  )
}

async function publish(root: string, name: string, content: Buffer): Promise<void> {
  if (await destination(root, name)) return
  const file = path.join(root, name)
  const temp = `${file}.${randomUUID()}.tmp`
  await mkdir(path.dirname(file), { recursive: true })
  const handle = await open(temp, 'wx', 0o600)
  try {
    await handle.writeFile(content)
    await handle.sync()
    await handle.close()
    // Publish on the destination volume without replacing a concurrent copy.
    await link(temp, file).catch(async (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (!(await destination(root, name))?.equals(content)) throw conflict()
    })
    const directory = await open(path.dirname(file), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } finally {
    await handle.close()
    await unlink(temp)
  }
}

async function migrate(config: WorkstreamStorageConfig, paths: ReturnType<typeof workstreamStoragePaths>) {
  const relative = path.relative(paths.legacyDir, paths.stateDir)
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)))
    throw new WorkstreamError('Workstream state cannot live inside the legacy workstream directory.')

  // Initialization must finish before callers acquire the writer lock for normal work.
  await withLock(path.join(paths.stateDir, 'storage.lock'), () =>
    withLock(path.join(paths.stateDir, 'write.lock'), () =>
      withLock(path.join(paths.stateDir, 'report-deliveries-write.lock'), async () => {
        const legacy = await statOptional(paths.legacyDir)
        if (legacy && !legacy.isDirectory())
          throw new WorkstreamError('The legacy workstream path must be a directory.')
        const tree = legacy ? await inventory(paths.legacyDir) : { files: [], directories: [] }
        const plan = tree.files.map((name) => ({
          source: path.join(paths.legacyDir, name),
          target: path.join('content', 'workstreams', name),
          digest: '',
        }))
        const automationDir = path.join(config.DIR_BASE, 'automations')
        const { byName, errors } = await loadAutomationDir(automationDir)
        for (const error of errors) {
          const file = await workstreamFile(config.DIR_BASE, error.path)
          const document = Document.fromMarkdown(await readFile(file, 'utf8'))
          if (document.yaml.run === 'workstreams:scan')
            throw new WorkstreamError(
              'Repair conflicting Workstreams automation names before migrating. Originals were kept.',
              409,
            )
        }
        for (const { automation, path: file } of byName.values()) {
          if (automation.run !== 'workstreams:scan') continue
          await workstreamFile(config.DIR_BASE, file)
          plan.push({ source: file, target: path.join('automations', path.relative(automationDir, file)), digest: '' })
        }
        // Preflight every conflict before publishing or removing any original.
        for (const entry of plan) {
          const source = await readFile(entry.source)
          if (path.basename(entry.source) === 'workstream.md') {
            const document = Document.fromMarkdown(source.toString('utf8'))
            const activities = document.yaml.activities
            if (
              !document.yamlError &&
              Array.isArray(activities) &&
              activities.some((activity) => {
                const relative = activity?.decisionPath
                return (
                  typeof relative === 'string' &&
                  (!relative.startsWith('workstreams/') ||
                    relative.includes('\\') ||
                    relative.split('/').includes('..'))
                )
              })
            )
              throw new WorkstreamError(
                'A workstream decision was moved outside its workstream folder. Move it back and update its decisionPath before migrating. Originals were kept.',
                409,
              )
          }
          const target = await destination(paths.stateDir, entry.target)
          if (target && !target.equals(source)) throw conflict()
          entry.digest = hash(source)
        }
        for (const entry of plan) {
          const source = await readFile(entry.source)
          if (hash(source) !== entry.digest)
            throw new WorkstreamError('Workstreams changed during migration. Try again.', 409)
          await publish(paths.stateDir, entry.target, source)
        }
        // Verify the complete destination before removing originals; interrupted moves resume by content.
        for (const entry of plan) {
          const target = await destination(paths.stateDir, entry.target)
          if (!target || hash(target) !== entry.digest || hash(await readFile(entry.source)) !== entry.digest)
            throw new WorkstreamError('Workstream migration could not verify the saved copy. Originals were kept.')
        }
        for (const entry of plan) {
          if (hash(await readFile(entry.source)) !== entry.digest)
            throw new WorkstreamError('Workstreams changed during migration. The changed original was kept.', 409)
          await unlink(entry.source)
        }
        for (const name of tree.directories) await rmdir(path.join(paths.legacyDir, name))
      }),
    ),
  )
}
