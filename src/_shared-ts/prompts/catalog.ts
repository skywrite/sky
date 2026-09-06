import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import Handlebars from 'handlebars'
import { parseDocument as parseYamlDocument } from 'yaml'
import splitYamlMarkdown from '#shared/models/Markdown/util/splitYamlMarkdown.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { PromptDocument, PromptEntry, PromptPreview } from './catalogTypes.ts'
import { inspectVariables, previewContext } from './inspect.ts'
import { parsePromptFile } from './parse.ts'

export interface PromptRoots {
  sourceDir: string
  overrideDir: string
}
export class PromptError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message)
  }
}
const LIMIT = 512_000
const REFERENCE = /{{>\s*(?:"([^"\n]+)"|'([^'\n]+)'|([a-zA-Z0-9_./-]+))\s*}}/g
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const title = (id: string) =>
  path
    .basename(id, '.prompt.md')
    .replace(/[-_]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())

function validId(id: string): string {
  if (
    !id.endsWith('.prompt.md') ||
    id.startsWith('/') ||
    id.includes('\\') ||
    id.includes('\0') ||
    id.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new PromptError('Choose a prompt from the library.', 403)
  return id
}

/** Refuse symlinks at every component, including parents of an override that does not exist yet. */
async function safePath(root: string, id: string): Promise<string> {
  validId(id)
  const target = path.resolve(root, id)
  for (let cursor = target; ; cursor = path.dirname(cursor)) {
    try {
      if ((await lstat(cursor)).isSymbolicLink()) throw new PromptError('Prompt paths cannot use symbolic links.', 403)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (cursor === path.resolve(root)) break
  }
  return target
}
async function textOrNull(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
async function files(root: string, extension: string, dir = ''): Promise<string[]> {
  const result: string[] = []
  let entries
  try {
    entries = await readdir(path.join(root, dir), { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  for (const entry of entries) {
    if (
      entry.name.startsWith('.') ||
      ['node_modules', 'fixtures', 'dist'].includes(entry.name) ||
      entry.isSymbolicLink()
    )
      continue
    const id = path.posix.join(dir, entry.name)
    if (entry.isDirectory()) result.push(...(await files(root, extension, id)))
    else if (entry.isFile() && entry.name.endsWith(extension) && !entry.name.endsWith('_test.ts')) result.push(id)
  }
  return result
}
function referenceId(from: string, name: string): string {
  const relative = name.startsWith('/') ? name.slice(1) : path.posix.join(path.posix.dirname(from), name)
  return validId(relative.endsWith('.prompt.md') ? relative : `${relative}.prompt.md`)
}
export function promptReferences(content: string, id: string): Array<{ id: string; name: string }> {
  const body = splitYamlMarkdown(content).markdown
  return [
    ...new Set([...body.matchAll(REFERENCE)].map((match) => referenceId(id, (match[1] || match[2] || match[3])!))),
  ].map((ref) => ({ id: ref, name: title(ref) }))
}
function validate(content: string) {
  if (content.length > LIMIT) throw new PromptError('A prompt must be smaller than 512 KB.')
  const { yaml, markdown } = splitYamlMarkdown(content)
  if (yaml) {
    const parsed = parseYamlDocument(yaml)
    if (parsed.errors.length) throw new PromptError(`Invalid YAML: ${parsed.errors[0]!.message}`)
    const data: unknown = parsed.toJS()
    if (data !== null && (typeof data !== 'object' || Array.isArray(data)))
      throw new PromptError('Prompt metadata must be a YAML mapping.')
  }
  Handlebars.parse(markdown)
  // References use whole documents; context is shared with the containing prompt.
  const withoutSimpleReferences = markdown.replace(REFERENCE, '')
  if (/{{[~\s]*>/.test(withoutSimpleReferences))
    throw new PromptError('Use a named template reference, such as {{> email-template}}, without arguments.')
}

export class PromptCatalog {
  private readonly writes = new Map<string, Promise<unknown>>()
  constructor(readonly roots: PromptRoots) {}
  async read(id: string): Promise<{ content: string; version: string; customized: boolean; custom: boolean }> {
    const source = await textOrNull(await safePath(this.roots.sourceDir, id))
    const override = await textOrNull(await safePath(this.roots.overrideDir, id))
    if (source === null && (override === null || !id.startsWith('custom/')))
      throw new PromptError('Prompt not found.', 404)
    const content = override ?? source!
    if (content.length > LIMIT) throw new PromptError('A prompt must be smaller than 512 KB.')
    return {
      content,
      version: digest(`${override === null ? 'default' : 'override'}\0${content}`),
      customized: override !== null,
      custom: source === null,
    }
  }
  async list(): Promise<PromptEntry[]> {
    const ids = [
      ...new Set([
        ...(await files(this.roots.sourceDir, '.prompt.md')),
        ...(await files(this.roots.overrideDir, '.prompt.md')),
      ]),
    ]
    const entries: PromptEntry[] = []
    for (const id of ids) {
      try {
        const data = await this.read(id)
        let description = '',
          error: string | undefined
        let includes: PromptEntry['includes'] = []
        try {
          validate(data.content)
          description = parsePromptFile(data.content, path.basename(id)).frontmatter.description
          includes = promptReferences(data.content, id)
        } catch (err) {
          error = err instanceof Error ? err.message : 'Invalid prompt'
        }
        entries.push({
          id,
          name: title(id),
          description,
          customized: data.customized,
          custom: data.custom,
          uses: [],
          includes,
          ...(error ? { error } : {}),
        })
      } catch (error) {
        if (error instanceof PromptError && error.status === 404) continue
        throw error
      }
    }
    // Actual source references, resolved relative to the caller; duplicate basenames use the nearest owner.
    for (const file of await files(this.roots.sourceDir, '.ts')) {
      const source = await readFile(path.join(this.roots.sourceDir, file), 'utf8')
      for (const match of source.matchAll(/['"]([^'"\n]*\.prompt\.md)['"]/g)) {
        const literal = match[1]!
        let candidates = entries.filter(
          (entry) => entry.id === path.posix.normalize(path.posix.join(path.posix.dirname(file), literal)),
        )
        if (!candidates.length && !literal.includes('/')) {
          candidates = entries.filter((entry) => path.posix.basename(entry.id) === literal)
          const score = (id: string) => {
            const a = id.split('/'),
              b = file.split('/')
            let i = 0
            while (a[i] && a[i] === b[i]) i++
            return i
          }
          const best = Math.max(...candidates.map((entry) => score(entry.id)))
          candidates = candidates.filter((entry) => score(entry.id) === best)
        }
        if (candidates.length !== 1) continue
        const entry = candidates[0]!
        if (entry.uses.some((use) => use.file === file)) continue
        const command = file.startsWith('commands/all/')
          ? file
              .slice(13)
              .replace(/\.ts$/, '')
              .replace(/\/(?:_?lib)\/.*/, '')
              .replace(/\/mod$/, '')
              .replaceAll('/', ':')
          : null
        entry.uses.push({
          label: command
            ? `sky ${command}`
            : file.includes('/chat/')
              ? 'Chat'
              : file.includes('/voice/')
                ? 'Voice'
                : file.replace(/\.ts$/, ''),
          file,
          line: source.slice(0, match.index).split('\n').length,
        })
      }
    }
    for (const entry of entries)
      for (const included of entry.includes) {
        entries
          .find((other) => other.id === included.id)
          ?.uses.push({ label: entry.name, file: entry.id, promptId: entry.id })
      }
    return entries.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  }
  async get(id: string): Promise<PromptDocument> {
    const data = await this.read(id)
    const entry = (await this.list()).find((candidate) => candidate.id === id)
    if (!entry) throw new PromptError('Prompt not found.', 404)
    return { ...entry, ...data }
  }
  /** Expand saved included documents while retaining the root's frontmatter byte for byte. */
  async expand(id: string, content?: string, seen: string[] = []): Promise<string> {
    validId(id)
    if (seen.includes(id)) throw new PromptError(`Circular template reference: ${[...seen, id].map(title).join(' → ')}`)
    if (seen.length > 16) throw new PromptError('Template references are nested too deeply.')
    const raw = content ?? (await this.read(id)).content
    validate(raw)
    const body = splitYamlMarkdown(raw).markdown
    const prefix = raw.slice(0, raw.length - body.length)
    let output = prefix,
      cursor = 0
    for (const match of body.matchAll(REFERENCE)) {
      const ref = referenceId(id, (match[1] || match[2] || match[3])!)
      const expanded = await this.expand(ref, undefined, [...seen, id])
      output += body.slice(cursor, match.index) + splitYamlMarkdown(expanded).markdown
      cursor = match.index + match[0].length
      if (output.length > LIMIT) throw new PromptError('The combined prompt is too large.')
    }
    output += body.slice(cursor)
    if (output.length > LIMIT) throw new PromptError('The combined prompt is too large.')
    return output
  }
  async preview(id: string, content: string, values: Record<string, unknown>): Promise<PromptPreview> {
    await this.read(id)
    const expanded = await this.expand(id, content)
    const parsed = parsePromptFile(expanded, path.basename(id))
    const variables = inspectVariables(parsed.body)
    for (const field of variables)
      if (field.name.startsWith('prompt.')) {
        const key = field.name.slice(7)
        field.sample =
          key === 'name' ? parsed.slug : String(parsed.frontmatter[key as keyof typeof parsed.frontmatter] ?? '')
      }
    const context = previewContext(variables, values)
    const output = Handlebars.compile(parsed.body, { noEscape: true })(context)
    if (output.length > LIMIT * 4) throw new PromptError('Rendered output is too large. Use smaller sample values.')
    return {
      output,
      variables,
      empty: variables
        .filter(
          (field) =>
            !field.conditional && field.kind !== 'boolean' && String(values[field.name] ?? field.sample).trim() === '',
        )
        .map((field) => field.name),
      includes: promptReferences(content, id),
    }
  }
  private async locked<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.writes.get(id) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(work)
    this.writes.set(id, next)
    try {
      return await next
    } finally {
      if (this.writes.get(id) === next) this.writes.delete(id)
    }
  }
  async save(id: string, content: string, version: string): Promise<PromptDocument> {
    return this.locked(id, async () => {
      const before = await this.read(id)
      if (before.version !== version)
        throw new PromptError('This prompt changed since you opened it. Reload the saved version before saving.', 409)
      await this.expand(id, content)
      const target = await safePath(this.roots.overrideDir, id)
      await mkdir(path.dirname(target), { recursive: true })
      await safePath(this.roots.overrideDir, id)
      const temporary = `${target}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, content, { flag: 'wx', mode: 0o600 })
        await rename(temporary, target)
      } finally {
        await unlink(temporary).catch(() => {})
      }
      return this.get(id)
    })
  }
  async restore(id: string, version: string): Promise<PromptDocument> {
    return this.locked(id, async () => {
      const current = await this.read(id)
      if (current.custom) throw new PromptError('This prompt has no built-in version.')
      if (current.version !== version)
        throw new PromptError('This prompt changed since you opened it. Reload before restoring.', 409)
      if (current.customized) await unlink(await safePath(this.roots.overrideDir, id))
      return this.get(id)
    })
  }
  async create(name: string): Promise<PromptDocument> {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(name))
      throw new PromptError('Use a short name with lowercase letters, numbers, and dashes.')
    const id = `custom/${name}.prompt.md`
    return this.locked(id, async () => {
      const target = await safePath(this.roots.overrideDir, id)
      await mkdir(path.dirname(target), { recursive: true })
      await safePath(this.roots.overrideDir, id)
      const today = PlainDate.today().ymd
      try {
        await writeFile(
          target,
          `---\nschema: 0.2.0\ncreated: ${today}\nupdated: ${today}\ndescription: ""\n---\n\n# ${title(id)}\n`,
          { flag: 'wx', mode: 0o600 },
        )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          throw new PromptError('A prompt with that name already exists.', 409)
        throw error
      }
      return this.get(id)
    })
  }
}
