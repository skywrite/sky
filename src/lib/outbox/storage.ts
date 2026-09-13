import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readFile, readdir, rmdir, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { hash, missing, withLock } from './files.ts'
import { OutboxError } from './types.ts'

type StorageConfig = { DIR_BASE: string; DIR_STATE: string }

export const outboxStateDir = (config: StorageConfig): string =>
  path.join(config.DIR_STATE, 'outbox', hash(config.DIR_BASE).slice(0, 16))

export function draftLink(itemsDir: string, notebook: string, id: string): string {
  const relative = path.relative(itemsDir, path.join(notebook, 'me', 'voice', 'drafts', `${id}.md`))
  return `[Draft](${relative.split(path.sep).map(encodeURIComponent).join('/')})`
}

export function createOutboxStorage(config: StorageConfig): { dir: string; initialize: () => Promise<void> } {
  const dir = outboxStateDir(config)
  let ready: Promise<void> | undefined
  return {
    dir,
    initialize: () =>
      (ready ??= migrate(config.DIR_BASE, dir).catch((error: unknown) => {
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
  const entries = await readdir(path.join(dir, relative), { withFileTypes: true })
  const files: string[] = []
  const directories: string[] = []
  for (const entry of entries) {
    const name = path.join(relative, entry.name)
    if (entry.isDirectory()) {
      const child = await inventory(dir, name)
      files.push(...child.files)
      directories.push(...child.directories)
    } else if (entry.isFile()) files.push(name)
    else throw new OutboxError(`Outbox migration requires an ordinary file or directory: ${name}.`)
  }
  directories.push(relative)
  return { files, directories }
}

async function destination(dir: string, name: string): Promise<Buffer | undefined> {
  let cursor = dir
  for (const segment of [
    '',
    ...path
      .dirname(name)
      .split(path.sep)
      .filter((part) => part !== '.'),
  ]) {
    cursor = path.join(cursor, segment)
    const stat = await statOptional(cursor)
    if (stat && !stat.isDirectory()) throw new OutboxError('The Outbox state path must contain ordinary directories.')
  }
  const file = path.join(dir, name)
  const stat = await statOptional(file)
  if (!stat) return undefined
  if (!stat.isFile()) throw new OutboxError(`Outbox migration cannot replace a directory or symbolic link: ${name}.`)
  return readFile(file)
}

function relocated(content: Buffer, name: string, notebook: string, dir: string): Buffer {
  if (!/^items\/[a-f0-9]{32}\.md$/.test(name)) return content
  const text = content.toString('utf8')
  const doc = Document.fromMarkdown(text)
  const id = doc.yaml.draftId
  if (doc.yamlError || typeof id !== 'string') return content
  const original = `[Draft](../../me/voice/drafts/${id}.md)`
  if (doc.markdown.trim() !== original) return content
  // Only the physical backlink changes; preserve all frontmatter, including unknown fields.
  const at = text.lastIndexOf(original)
  return Buffer.from(
    text.slice(0, at) + draftLink(path.join(dir, 'items'), notebook, id) + text.slice(at + original.length),
  )
}

function conflict(name: string): OutboxError {
  return new OutboxError(
    `Outbox migration found different copies of ${name} in the notebook and data state. Both copies were kept.`,
    409,
  )
}

async function publish(dir: string, name: string, content: Buffer): Promise<void> {
  const file = path.join(dir, name)
  const temp = `${file}.${randomUUID()}.tmp`
  await mkdir(path.dirname(file), { recursive: true })
  const handle = await open(temp, 'wx', 0o600)
  try {
    await handle.writeFile(content)
    await handle.sync()
    await handle.close()
    // Stage on the destination volume, then publish the complete file without replacing another copy.
    await link(temp, file).catch(async (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (!(await destination(dir, name))?.equals(content)) throw conflict(name)
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

async function migrate(notebook: string, dir: string): Promise<void> {
  const legacy = path.join(notebook, 'outbox')
  const stat = await statOptional(legacy)
  if (!stat) return
  if (!stat.isDirectory()) throw new OutboxError('The legacy Outbox path must be an ordinary directory.')
  const relative = path.relative(legacy, dir)
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)))
    throw new OutboxError('Outbox state cannot be stored inside the legacy Outbox directory.')

  // Old scanners share these locks. Finish migration before acquiring either lock for normal work.
  await withLock(path.join(dir, 'scan.lock'), () =>
    withLock(path.join(dir, 'write.lock'), async () => {
      if (!(await statOptional(legacy))) return
      const { files, directories } = await inventory(legacy)
      const plan: { name: string; sourceHash: string; targetHash: string }[] = []
      for (const name of files) {
        const source = await readFile(path.join(legacy, name))
        const content = relocated(source, name, notebook, dir)
        const target = await destination(dir, name)
        if (target && !target.equals(content)) throw conflict(name)
        plan.push({ name, sourceHash: hash(source), targetHash: hash(content) })
      }
      for (const { name, sourceHash, targetHash } of plan) {
        const file = path.join(legacy, name)
        const source = await readFile(file)
        if (hash(source) !== sourceHash)
          throw new OutboxError('The legacy Outbox changed during migration. Try again.', 409)
        await publish(dir, name, relocated(source, name, notebook, dir))
        const saved = await destination(dir, name)
        if (!saved || hash(saved) !== targetHash || hash(await readFile(file)) !== sourceHash)
          throw new OutboxError('Outbox migration could not verify the saved copy. The original was kept.')
        await unlink(file)
      }
      // Remove only empty directories. An interrupted move resumes from the remaining originals.
      for (const name of directories) await rmdir(path.join(legacy, name))
    }),
  )
}
