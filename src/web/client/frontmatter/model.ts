/**
 * The front matter as rows, and rows back to front matter. The YAML document is kept as parsed —
 * comments, key order and quoting included — and a change touches only the key it is about, in
 * the shape the notebook already writes: tags on one `;`-separated line, people comma-separated,
 * rel as a list, attachments as `{ file }` entries.
 */

import {
  type Document as YamlDocument,
  isMap,
  isScalar,
  isSeq,
  type Pair,
  parseDocument,
  Scalar,
  YAMLMap,
  YAMLSeq,
} from 'yaml'
import { CHIP_KINDS, kindOf, type RowKind } from './kinds.ts'

export type Shape = 'scalar' | 'seq' | 'map' | 'missing'

export interface Row {
  key: string
  kind: RowKind
  /** Chips for chip kinds, text otherwise; sub-rows for a map */
  value: string | string[]
  children?: Row[]
  shape: Shape
}

export interface Frontmatter {
  rows: Row[]
  /** Why the YAML could not be read as rows; the raw text stays editable */
  error?: string
}

const STRINGIFY = { lineWidth: 0, nullStr: '' } as const

function scalarText(node: unknown): string {
  if (isScalar(node)) return node.value == null ? '' : String(node.value)
  return ''
}

function shapeOf(node: unknown): Shape {
  if (isSeq(node)) return 'seq'
  if (isMap(node)) return 'map'
  return 'scalar'
}

/** Chips out of a written value: `;` for tags, commas for people, one per item for a list. */
export function splitChips(kind: RowKind, node: unknown): string[] {
  if (isSeq(node)) {
    return node.items
      .map((item) => (isMap(item) ? scalarText(item.get('file', true)) : scalarText(item)))
      .filter((s) => s.length > 0)
  }
  const text = scalarText(node)
  if (text.length === 0) return []
  const separator = kind === 'tags' ? (text.includes(';') ? ';' : ',') : ','
  return text
    .split(separator)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function rowOf(pair: Pair): Row {
  const key = scalarText(pair.key)
  const shape = pair.value == null ? 'scalar' : shapeOf(pair.value)
  const kind = kindOf(key, shape)
  if (kind === 'map' && isMap(pair.value)) {
    return { key, kind, value: '', shape, children: pair.value.items.map((child) => rowOf(child)) }
  }
  if (CHIP_KINDS.has(kind) || kind === 'files') return { key, kind, value: splitChips(kind, pair.value), shape }
  if (isSeq(pair.value) || isMap(pair.value)) {
    // A shape the kind did not expect: shown as its YAML, edited as text.
    return { key, kind: 'text', value: String(pair.value.toString()).trim(), shape }
  }
  return { key, kind, value: scalarText(pair.value), shape }
}

/** The rows of a front matter body (the text between the `---` lines). */
export function readFrontmatter(text: string): Frontmatter {
  const doc = parseDocument(text)
  if (doc.errors.length > 0) return { rows: [], error: doc.errors[0]?.message ?? 'The YAML could not be read' }
  if (doc.contents == null) return { rows: [] }
  if (!isMap(doc.contents)) return { rows: [], error: 'The front matter is not a map of keys' }
  return { rows: doc.contents.items.map((pair) => rowOf(pair)) }
}

function ensureMap(doc: YamlDocument): YAMLMap {
  if (isMap(doc.contents)) return doc.contents
  const map = new YAMLMap()
  doc.contents = map
  return map
}

function scalarOf(text: string): Scalar {
  return new Scalar(text.length === 0 ? null : text)
}

function seqOf(items: string[]): YAMLSeq {
  const seq = new YAMLSeq()
  for (const item of items) seq.items.push(new Scalar(item))
  return seq
}

/** Chips into the shape their key is written in, keeping the shape the document already had. */
function chipsNode(kind: RowKind, chips: string[], existing: unknown): Scalar | YAMLSeq {
  if (kind === 'tags') return scalarOf(chips.join('; '))
  if (kind === 'rel' || kind === 'list' || kind === 'places') {
    if (isScalar(existing) && chips.length <= 1) return scalarOf(chips[0] ?? '')
    return seqOf(chips)
  }
  if (kind === 'orgs') return scalarOf(chips.join(', '))
  // people: one line, unless the document already keeps a list
  if (isSeq(existing)) return seqOf(chips)
  return scalarOf(chips.join(', '))
}

/** The attachments list with the files given, entries the document already has kept as they are. */
function filesNode(files: string[], existing: unknown): YAMLSeq {
  const seq = new YAMLSeq()
  const kept = new Map<string, unknown>()
  if (isSeq(existing)) {
    for (const item of existing.items) if (isMap(item)) kept.set(scalarText(item.get('file', true)), item)
  }
  for (const file of files) {
    const entry = kept.get(file)
    if (entry) {
      seq.items.push(entry)
      continue
    }
    const map = new YAMLMap()
    map.flow = true
    const name = new Scalar(file)
    name.type = Scalar.QUOTE_DOUBLE
    map.set('file', name)
    seq.items.push(map)
  }
  return seq
}

/** The front matter text with one key set — chips or text — the rest of the document untouched. */
export function writeValue(text: string, key: string, kind: RowKind, value: string | string[]): string {
  const doc = parseDocument(text)
  const map = ensureMap(doc)
  const existing = map.get(key, true)
  let node: Scalar | YAMLSeq
  if (kind === 'files') node = filesNode(Array.isArray(value) ? value : [], existing)
  else if (Array.isArray(value)) node = chipsNode(kind, value, existing)
  else node = scalarOf(value)
  map.set(key, node)
  return doc.toString(STRINGIFY)
}

/** The front matter text with a sub-key of a map set, as text. */
export function writeChildValue(text: string, key: string, child: string, value: string): string {
  const doc = parseDocument(text)
  const map = ensureMap(doc)
  const parent = map.get(key, true)
  if (!isMap(parent)) return text
  parent.set(child, scalarOf(value))
  return doc.toString(STRINGIFY)
}

/** The front matter text without a key. */
export function removeKey(text: string, key: string): string {
  const doc = parseDocument(text)
  if (!isMap(doc.contents)) return text
  doc.contents.delete(key)
  return doc.toString(STRINGIFY)
}

/** The front matter text with a new, empty key at the end — or unchanged when the key is there. */
export function addKey(text: string, key: string, kind: RowKind): string {
  const doc = parseDocument(text)
  const map = ensureMap(doc)
  if (map.has(key)) return text
  map.set(key, kind === 'rel' || kind === 'files' || kind === 'list' ? new YAMLSeq() : new Scalar(null))
  return doc.toString(STRINGIFY)
}

/** Whether the text has any key at all. */
export function isEmptyFrontmatter(text: string): boolean {
  const doc = parseDocument(text)
  return doc.contents == null || (isMap(doc.contents) && doc.contents.items.length === 0)
}

/** Whether a row has nothing to show: no text, no chips, or a map whose children are all empty. */
export function isEmptyRow(row: Row): boolean {
  if (row.children) return row.children.every(isEmptyRow)
  return Array.isArray(row.value) ? row.value.length === 0 : row.value.trim().length === 0
}

const ATTACHMENTS = 'attachments'

/** The file names the attachments list holds. */
export function attachmentNames(text: string): string[] {
  const row = readFrontmatter(text).rows.find((r) => r.key === ATTACHMENTS)
  return row && Array.isArray(row.value) ? row.value : []
}

/** The front matter text with a file on the attachments list — unchanged when it is there already. */
export function addAttachment(text: string, name: string): string {
  const names = attachmentNames(text)
  return names.includes(name) ? text : writeValue(text, ATTACHMENTS, 'files', [...names, name])
}

/** The front matter text without a file on the attachments list. */
export function removeAttachment(text: string, name: string): string {
  const names = attachmentNames(text)
  if (!names.includes(name)) return text
  return writeValue(
    text,
    ATTACHMENTS,
    'files',
    names.filter((n) => n !== name),
  )
}
