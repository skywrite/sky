import { readdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'
import { nameToFileStem } from '#commands/all/org/lib/document.ts'
import { generatePersonHierarchyPath, personFileStem } from '#commands/all/person/lib/create.ts'
import { hash } from '#lib/outbox/files.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { normalizeName } from '#shared/models/Store/normalize.ts'
import { backlinksOf, documentsOf } from '../vocabulary/mod.ts'
import {
  ProfileError,
  type ProfileType,
  type ReferenceFile,
  type ReferencePreview,
  type ReferenceResult,
  type SpellingUse,
} from './types.ts'

/**
 * Updating references, as an IDE renames a symbol: the profile's file takes its current name,
 * files that name the profile by another spelling in their frontmatter name it by its current
 * name, and every place a file writes out the old file path points at the new one. What files
 * say is never edited; only those characters change.
 */

/** Frontmatter fields that name people and organizations. */
const NAME_FIELDS = new Set(['rel', 'who', 'from', 'to', 'cc', 'org'])

/** How one line of a field separates names: `rel` with `;`, participants with `,`, `org` names one. */
function separatorOf(field: string): string | undefined {
  if (field === 'rel') return ';'
  if (field === 'who' || field === 'from' || field === 'to' || field === 'cc') return ','
  return undefined
}

/** One name in a file's frontmatter, as characters of the file. */
export interface NameToken {
  field: string
  /** The name as written */
  text: string
  start: number
  end: number
  /** The quote around its value, when quoted */
  quote?: '"' | "'"
}

/** The frontmatter text and where it starts in the file. */
function frontmatter(raw: string): { text: string; offset: number } | undefined {
  const open = /^---[ \t]*\r?\n/.exec(raw)
  if (!open) return undefined
  const rest = raw.slice(open[0].length)
  const close = /^(?:---|\.\.\.)[ \t]*$/m.exec(rest)
  return close ? { text: rest.slice(0, close.index), offset: open[0].length } : undefined
}

/**
 * Every name the frontmatter's name fields hold, as exact character ranges. A person's
 * organization lists (`orgs`) count only for organizations. A field written in a form that cannot be
 * edited exactly — across lines, or with escapes — is reported instead of read.
 */
export function scanNames(raw: string, kind: ProfileType): { tokens: NameToken[]; unreadable: string[] } {
  const tokens: NameToken[] = []
  const unreadable: string[] = []
  const front = frontmatter(raw)
  if (!front) return { tokens, unreadable }
  const doc = parseDocument(front.text)
  if (doc.errors.length || !isMap(doc.contents)) return { tokens, unreadable: ['frontmatter'] }
  const read = (node: unknown, field: string, separator?: string) => {
    if (isSeq(node)) {
      for (const item of node.items) read(item, field)
      return
    }
    if (!isScalar(node) || typeof node.value !== 'string' || !node.range) return
    const [start, end] = node.range
    const source = front.text.slice(start, end)
    const quoted = node.type === 'QUOTE_DOUBLE' || node.type === 'QUOTE_SINGLE'
    const inner = quoted ? source.slice(1, -1) : source
    if ((!quoted && node.type !== 'PLAIN') || inner !== node.value) {
      unreadable.push(field)
      return
    }
    let offset = front.offset + start + (quoted ? 1 : 0)
    for (const part of separator ? inner.split(separator) : [inner]) {
      const text = part.trim()
      if (text) {
        const at = offset + part.length - part.trimStart().length
        tokens.push({
          field,
          text,
          start: at,
          end: at + text.length,
          ...(quoted ? { quote: source[0] as '"' | "'" } : {}),
        })
      }
      offset += part.length + (separator?.length ?? 0)
    }
  }
  for (const pair of doc.contents.items) {
    const field = isScalar(pair.key) ? String(pair.key.value) : ''
    if (NAME_FIELDS.has(field)) read(pair.value, field, separatorOf(field))
    else if (kind === 'org' && field === 'orgs' && isMap(pair.value)) {
      for (const list of pair.value.items) read(list.value, 'orgs')
    }
  }
  return { tokens, unreadable }
}

/** Characters a plain YAML value can hold without changing its meaning; anything else needs quotes. */
const PLAIN_NAME = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .'’&()/-]*$/u

/** A character that belongs to a path, so a path starting right after it is part of a longer one. */
const PATH_CHAR = /[\w./-]/
/** A path ends at `.md` or at anything that cannot continue a file name. */
const PATH_END = /(?:\.md)?(?:[^\w.-]|\.(?![\w-])|$)/y

/**
 * Every place `from`, a notebook path without `.md`, is written as a whole path: it starts at a
 * path boundary or right after one of `roots` (the notebook's own folder, a Sky link), and ends
 * there or at `.md`. So `people/2026/ja/Jane-Doe` matches neither `Jane-Doe-2.md` nor
 * `archive/people/2026/ja/Jane-Doe.md`.
 */
export function pathOccurrences(text: string, from: string, roots: string[]): Array<{ start: number; end: number }> {
  const found: Array<{ start: number; end: number }> = []
  for (let at = text.indexOf(from); at >= 0; at = text.indexOf(from, at + from.length)) {
    const starts =
      at === 0 || !PATH_CHAR.test(text[at - 1]!) || roots.some((root) => text.startsWith(root, at - root.length))
    PATH_END.lastIndex = at + from.length
    if (starts && PATH_END.test(text)) found.push({ start: at, end: at + from.length })
  }
  return found
}

/**
 * The edits updating references makes to one file: each chosen name in its frontmatter, and each
 * whole occurrence of the profile's old file path anywhere in it. Only those characters change;
 * everything else stays byte for byte. What cannot be written in place is a problem, not a guess.
 */
function editReferences(
  raw: string,
  kind: ProfileType,
  matches: (token: NameToken) => boolean,
  name: string,
  paths?: { from: string; to: string; roots: string[] },
): { contents: string; changes: ReferenceFile['changes']; problem?: string } {
  const hits = scanNames(raw, kind).tokens.filter(matches)
  for (const hit of hits) {
    const fits =
      hit.quote === '"' ? !/["\\]/.test(name) : hit.quote === "'" ? !name.includes("'") : PLAIN_NAME.test(name)
    const separator = separatorOf(hit.field)
    if (!fits || (separator && name.includes(separator)))
      return { contents: raw, changes: [], problem: `${name} cannot be written into ${hit.field} here as it stands.` }
  }
  const edits = hits.map((hit) => ({ start: hit.start, end: hit.end, text: name }))
  const changes: ReferenceFile['changes'] = hits.map((hit) => ({ field: hit.field, before: hit.text, after: name }))
  if (paths) {
    const found = pathOccurrences(raw, paths.from, paths.roots)
    edits.push(...found.map((range) => ({ ...range, text: paths.to })))
    if (found.length)
      changes.push({ field: 'path', before: `${paths.from}.md`, after: `${paths.to}.md`, count: found.length })
  }
  edits.sort((a, b) => a.start - b.start)
  for (let i = 1; i < edits.length; i++)
    if (edits[i]!.start < edits[i - 1]!.end) return { contents: raw, changes: [], problem: 'Two changes here overlap.' }
  let contents = raw
  for (const edit of edits.reverse()) contents = contents.slice(0, edit.start) + edit.text + contents.slice(edit.end)
  return { contents, changes }
}

/** Replace each name `matches` picks with `name`, changing only those characters. */
export function renameNames(
  raw: string,
  kind: ProfileType,
  matches: (token: NameToken) => boolean,
  name: string,
): { contents: string; changes: ReferenceFile['changes']; problem?: string } {
  return editReferences(raw, kind, matches, name)
}

/** The names a document's frontmatter holds, by the same rules as `scanNames`, from its parsed fields. */
function namesIn(yaml: Record<string, unknown>, kind: ProfileType): Array<{ text: string }> {
  const out: Array<{ text: string }> = []
  const add = (value: unknown, separator?: string) => {
    for (const item of Array.isArray(value) ? value : [value])
      if (typeof item === 'string')
        for (const text of Array.isArray(value) || !separator ? [item] : item.split(separator))
          if (text.trim()) out.push({ text: text.trim() })
  }
  for (const field of NAME_FIELDS) add(yaml[field], separatorOf(field))
  if (kind === 'org') {
    const orgs = yaml['orgs']
    if (orgs && typeof orgs === 'object') for (const list of Object.values(orgs)) add(list)
  }
  return out
}

export interface RenameProfile {
  type: ProfileType
  /** Notebook-relative file */
  id: string
  /** The name references will use */
  name: string
  aliases: string[]
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A notebook path without `.md`. */
const stemOf = (file: string) => file.replace(/\.md$/i, '')
/** Where a notebook path may be written in full: under the notebook's own folder, or in a Sky link. */
const rootsOf = (base: string) => [`${path.resolve(base)}/`, '/explorer/', '/docs/']

/**
 * Where the profile's file goes to carry its current name, as person:new and org:new name files:
 * the same folder (a person's letters folder follows a new first name), with `-2`, `-3`… past
 * other files. Undefined when the file already carries it, a namesake's number included.
 */
export async function plannedFile(
  base: string,
  profile: Pick<RenameProfile, 'type' | 'id' | 'name'>,
): Promise<string | undefined> {
  const stem = profile.type === 'person' ? personFileStem(profile.name) : nameToFileStem(profile.name)
  const parts = profile.id.split('/')
  const file = parts.pop()!
  if (!stem || new RegExp(`^${escape(stem)}(?:-\\d+)?\\.md$`).test(file)) return undefined
  if (
    profile.type === 'person' &&
    parts.length === 3 &&
    parts[0] === 'people' &&
    /^\d{4}$/.test(parts[1]!) &&
    /^[a-z_]{2}$/.test(parts[2]!)
  )
    parts.splice(1, 2, ...generatePersonHierarchyPath(profile.name, Number(parts[1])).split(path.sep))
  const dir = parts.join('/')
  const taken = new Set(
    (await readdir(path.join(base, dir)).catch(() => [] as string[])).map((name) => name.toLowerCase()),
  )
  for (let n = 1; n < 10_000; n++) {
    const id = `${dir}/${stem}${n === 1 ? '' : `-${n}`}.md`
    // A change of case alone renames the file onto itself
    if (id.toLowerCase() === profile.id.toLowerCase()) return id === profile.id ? undefined : id
    if (!taken.has(path.posix.basename(id).toLowerCase())) return id
  }
  return undefined
}

/** The day a notebook path belongs to, for captures filed under a day. */
function dayOf(id: string): string | undefined {
  const day = /^time\/(\d{4})\/W\d{2}\/(\d{2})-(\d{2})\//.exec(id)
  return day ? `${day[1]}-${day[2]}-${day[3]}` : undefined
}

/**
 * Where each file this may change is, by notebook-relative path, with its label and date: the
 * files that name the profile, and, when its file is renamed, every file writing out its path.
 */
function candidates(store: MarkdownStore, base: string, profile: RenameProfile, oldPath?: string) {
  const files = new Map<string, { label: string; date?: string }>()
  for (const link of backlinksOf(store, base, profile.id)) files.set(link.path, { label: link.label, date: link.date })
  if (profile.type === 'org')
    for (const { doc, path: file } of store.people.getAll().toArray())
      if (doc.yaml['orgs']) files.set(path.relative(base, file).split(path.sep).join('/'), { label: doc.name })
  if (oldPath)
    for (const { path: id, doc } of documentsOf(store, base)) {
      if (files.has(id) || !(doc.markdown.includes(oldPath) || JSON.stringify(doc.yaml).includes(oldPath))) continue
      const title = [doc.yaml['title'], doc.yaml['summary'], doc.yaml['name']].find(
        (value) => typeof value === 'string',
      )
      const date = dayOf(id)
      files.set(id, {
        label: (title as string | undefined) ?? path.posix.basename(stemOf(id)),
        ...(date ? { date } : {}),
      })
    }
  files.delete(profile.id)
  return files
}

/** Whether a token names this profile: spelled as one of `spellings`, and pointing at its file. */
function naming(store: MarkdownStore, base: string, profile: RenameProfile, spellings: Set<string>) {
  const target = path.join(base, profile.id)
  return (token: { text: string }) => {
    if (!spellings.has(normalizeName(token.text))) return false
    const ref = store.resolve(token.text)
    return ref.type === profile.type && 'path' in ref && ref.path === target
  }
}

/** The profile's other spellings that other files still use, most used first. */
export function spellingUses(store: MarkdownStore, base: string, profile: RenameProfile): SpellingUse[] {
  const own = normalizeName(profile.name)
  const others = new Map(
    profile.aliases.map((alias) => [normalizeName(alias), alias] as const).filter(([key]) => key && key !== own),
  )
  if (!others.size) return []
  const names = naming(store, base, profile, new Set(others.keys()))
  const files = new Map<string, Set<string>>()
  for (const id of candidates(store, base, profile).keys()) {
    const doc = store.findByPath(path.join(base, id))?.doc
    if (!doc) continue
    for (const token of namesIn(doc.yaml, profile.type)) {
      if (!names(token)) continue
      const key = normalizeName(token.text)
      files.set(key, (files.get(key) ?? new Set()).add(id))
    }
  }
  return [...files]
    .map(([key, ids]) => ({ name: others.get(key)!, files: ids.size }))
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name))
}

/** What kind of record a file is, from where it lives: a capture's kind, a day, a summary, or its folder. */
function kindOf(id: string): string {
  const parts = id.split('/')
  const actions = parts.indexOf('actions')
  if (actions >= 0 && parts[actions + 1]) return parts[actions + 1]!
  if (parts[0] === 'time') return parts.at(-1) === 'day.md' ? 'days' : 'summaries'
  return parts[0] ?? 'notes'
}

/** The rename's plan: the file's new name, and the old and new paths other files write out. */
async function plan(base: string, profile: RenameProfile) {
  const file = await plannedFile(base, profile)
  const paths = file ? { from: stemOf(profile.id), to: stemOf(file), roots: rootsOf(base) } : undefined
  return { file, paths }
}

/** The changes updating references would make, file by file, from the files as they are now. */
export async function previewRename(
  store: MarkdownStore,
  base: string,
  profile: RenameProfile,
  spellings: string[],
): Promise<ReferencePreview> {
  const { file, paths } = await plan(base, profile)
  const names = naming(store, base, profile, new Set(spellings.map(normalizeName)))
  const lowered = spellings.map((spelling) => spelling.toLowerCase())
  const preview: ReferencePreview = {
    name: profile.name,
    ...(file ? { file: { from: profile.id, to: file } } : {}),
    files: [],
    skipped: [],
  }
  for (const [id, { label, date }] of candidates(store, base, profile, paths?.from)) {
    let raw: string
    try {
      raw = await readFile(path.join(base, id), 'utf8')
    } catch {
      continue
    }
    const edit = editReferences(raw, profile.type, names, profile.name, paths)
    const { unreadable } = scanNames(raw, profile.type)
    const unclear =
      unreadable.length && lowered.some((spelling) => raw.split(/\n---/)[0]!.toLowerCase().includes(spelling))
    if (edit.problem || unclear)
      preview.skipped.push({
        id,
        label,
        reason: edit.problem ?? 'A name here is written in a form Sky cannot edit exactly.',
      })
    else if (edit.changes.length)
      preview.files.push({
        id,
        label,
        kind: kindOf(id),
        ...(date ? { date } : {}),
        revision: hash(raw),
        changes: edit.changes,
      })
  }
  preview.files.sort((a, b) => a.kind.localeCompare(b.kind) || (b.date ?? '').localeCompare(a.date ?? ''))
  return preview
}

/**
 * Make the previewed changes. A file is written only when it is still exactly as previewed; any
 * other file is left as it is and listed. The profile's own file moves last, so a stop partway
 * leaves it where the remaining references still point, and the update can simply run again.
 */
export async function applyRename(
  store: MarkdownStore,
  base: string,
  profile: RenameProfile,
  spellings: string[],
  request: { files: Array<{ id: string; revision: string }>; file?: string },
  io: { write: (file: string, contents: string) => Promise<void>; move: (from: string, to: string) => Promise<void> },
): Promise<ReferenceResult> {
  const { file, paths } = await plan(base, profile)
  if ((request.file ?? undefined) !== file)
    throw new ProfileError("The file's new name changed since the preview. Review the update again.", 409)
  const known = candidates(store, base, profile, paths?.from)
  const names = naming(store, base, profile, new Set(spellings.map(normalizeName)))
  const result: ReferenceResult = { updated: 0, skipped: [] }
  for (const { id, revision } of request.files) {
    const label = known.get(id)?.label ?? id
    if (!known.has(id)) {
      result.skipped.push({ id, label, reason: 'It no longer names this profile.' })
      continue
    }
    const target = path.join(base, id)
    const raw = await readFile(target, 'utf8').catch(() => undefined)
    if (raw === undefined || hash(raw) !== revision) {
      result.skipped.push({ id, label, reason: 'It changed after the preview.' })
      continue
    }
    const edit = editReferences(raw, profile.type, names, profile.name, paths)
    if (edit.problem) {
      result.skipped.push({ id, label, reason: edit.problem })
      continue
    }
    if (!edit.changes.length) continue
    await io.write(target, edit.contents)
    result.updated++
  }
  if (file) {
    await io.move(profile.id, file)
    result.file = file
  }
  return result
}
