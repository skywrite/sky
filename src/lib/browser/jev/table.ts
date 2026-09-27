import { createHash } from 'node:crypto'

// The page as Jev sees it: a numbered table of the controls in view, each
// with its label, its value, and the text beside it, plus the page's own
// text. Built from the browser server's snapshot with bounding boxes. This
// is jev-ultrafast's action table, drawn from the accessibility snapshot
// instead of a page script, so frames come along.

export interface ActionRow {
  index: number
  ref: string
  role: string
  name: string
  /** A textbox's text, a combobox's chosen option */
  value?: string
  placeholder?: string
  /** State the snapshot marks: checked, expanded, selected … */
  flags: string[]
  /** The text just before the control, which tells lookalike controls apart */
  near?: string
  /** What this control takes */
  kind: 'click' | 'type' | 'select'
  /** A combobox's options, for select */
  options?: string[]
  /** A link's address, for a direct visit when a click is blocked */
  href?: string
  /** Reads like a password or a code — never typed by a model */
  secret: boolean
}

export interface ActionTable {
  url: string
  title: string
  rows: ActionRow[]
  /** The page's visible text, in order, trimmed */
  text: string
  /** Controls above and below the viewport */
  above: number
  below: number
  /** Controls in view left out past the cap */
  omitted: number
}

export interface Viewport {
  width: number
  height: number
}

/** Jev's choice takes 255 options; the table leaves room for the operations that are not rows. */
export const MAX_ROWS = 250
export const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 900 }
const TEXT_CHARS = 3000

const TYPE_ROLES = new Set(['textbox', 'searchbox', 'spinbutton'])
const CLICK_ROLES = new Set([
  'link',
  'button',
  'checkbox',
  'radio',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'switch',
  'slider',
  'treeitem',
])
const TEXT_ROLES = new Set([
  'text',
  'heading',
  'paragraph',
  'cell',
  'columnheader',
  'rowheader',
  'caption',
  'term',
  'definition',
])
const SECRET =
  /password|passcode|passphrase|\bpin\b|one[- ]time|verification code|security code|\botp\b|2fa|two[- ]step|two[- ]factor/i

interface Line {
  indent: number
  role: string
  name?: string
  flags: string[]
  ref?: string
  box?: { x: number; y: number; w: number; h: number }
  /** Text after the trailing colon */
  value?: string
  /** A property line: `/url: /docs`, `/placeholder: …` */
  property?: { key: string; value: string }
  /** A bare `text: …` line */
  text?: string
}

function parseLine(raw: string): Line | null {
  const match = raw.match(/^(\s*)- (.*)$/)
  if (!match) return null
  const indent = match[1].length / 2
  let rest = match[2]
  const property = rest.match(/^\/(\w+): ?(.*)$/)
  if (property) return { indent, role: 'property', flags: [], property: { key: property[1], value: property[2] } }
  const text = rest.match(/^text: ?(.*)$/)
  if (text) return { indent, role: 'text', flags: [], text: unquote(text[1]) }
  const role = rest.match(/^([a-z]+)/)?.[1]
  if (!role) return null
  rest = rest.slice(role.length)
  const line: Line = { indent, role, flags: [] }
  const name = rest.match(/^ "((?:[^"\\]|\\.)*)"/)
  if (name) {
    line.name = name[1].replace(/\\"/g, '"')
    rest = rest.slice(name[0].length)
  }
  for (const attr of rest.matchAll(/\[([^\]]*)\]/g)) {
    const [key, value] = attr[1].split('=', 2)
    if (key === 'ref') line.ref = value
    else if (key === 'box') {
      const [x, y, w, h] = value.split(',').map(Number)
      line.box = { x, y, w, h }
    } else if (key === 'cursor' || key === 'level') continue
    else line.flags.push(attr[1])
  }
  const tail = rest.replace(/\[[^\]]*\]/g, '').trim()
  if (tail.startsWith(':') && tail.length > 1) line.value = unquote(tail.slice(1).trim())
  return line
}

const unquote = (s: string): string => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s)

function inView(
  box: { x: number; y: number; w: number; h: number },
  viewport: Viewport,
): 'in' | 'above' | 'below' | 'none' {
  if (box.w <= 0 || box.h <= 0) return 'none'
  if (box.y + box.h <= 0) return 'above'
  if (box.y >= viewport.height) return 'below'
  if (box.x + box.w <= 0 || box.x >= viewport.width) return 'none'
  return 'in'
}

/** The table for one snapshot: the server's text result, boxes included. */
export function buildActionTable(snapshot: string, viewport: Viewport = DEFAULT_VIEWPORT): ActionTable {
  const url = snapshot.match(/^- Page URL: (\S+)/m)?.[1] ?? ''
  const title = snapshot.match(/^- Page Title: (.*)$/m)?.[1]?.trim() ?? ''
  const yaml = snapshot.match(/```yaml\n([\s\S]*?)\n```/)?.[1] ?? snapshot
  const rows: ActionRow[] = []
  const text: string[] = []
  let above = 0
  let below = 0
  let omitted = 0
  let near: string | undefined
  // Frames position their children from their own top-left corner.
  const frames: { indent: number; x: number; y: number }[] = []
  let lastRow: ActionRow | undefined
  let lastRowIndent = -1
  let lastCombobox: { row: ActionRow; indent: number } | undefined

  for (const raw of yaml.split('\n')) {
    const line = parseLine(raw)
    if (!line) continue
    while (frames.length > 0 && line.indent <= frames[frames.length - 1].indent) frames.pop()
    if (lastRow && line.indent <= lastRowIndent) lastRow = undefined
    if (lastCombobox && line.indent <= lastCombobox.indent) lastCombobox = undefined

    if (line.property) {
      if (lastRow && line.property.key === 'placeholder') lastRow.placeholder = line.property.value
      if (lastRow && line.property.key === 'url' && lastRow.role === 'link') lastRow.href = line.property.value
      continue
    }
    if (line.role === 'text') {
      if (line.text) {
        text.push(line.text)
        near = line.text.slice(0, 80)
      }
      continue
    }
    if (line.role === 'option' && lastCombobox) {
      if (line.name !== undefined) {
        lastCombobox.row.options ??= []
        lastCombobox.row.options.push(line.name)
        if (line.flags.includes('selected')) lastCombobox.row.value = line.name
      }
      continue
    }
    if (TEXT_ROLES.has(line.role)) {
      const content = line.name ?? line.value
      if (content) {
        text.push(content)
        near = content.slice(0, 80)
      }
      continue
    }
    if (line.role === 'iframe' && line.box) {
      const parent = frames[frames.length - 1]
      frames.push({ indent: line.indent, x: line.box.x + (parent?.x ?? 0), y: line.box.y + (parent?.y ?? 0) })
      continue
    }
    const interactive = TYPE_ROLES.has(line.role) || CLICK_ROLES.has(line.role) || line.role === 'combobox'
    if (!interactive || !line.ref || !line.box) {
      if (line.value) text.push(line.value)
      continue
    }
    if (line.flags.includes('disabled')) continue
    const frame = frames[frames.length - 1]
    const box = frame ? { ...line.box, x: line.box.x + frame.x, y: line.box.y + frame.y } : line.box
    const where = inView(box, viewport)
    if (where === 'above') above++
    if (where === 'below') below++
    if (where !== 'in') continue
    if (rows.length >= MAX_ROWS) {
      omitted++
      continue
    }
    const name = line.name ?? ''
    const row: ActionRow = {
      index: rows.length,
      ref: line.ref,
      role: line.role,
      name,
      flags: line.flags,
      kind: TYPE_ROLES.has(line.role) ? 'type' : line.role === 'combobox' ? 'select' : 'click',
      secret: SECRET.test(name) || SECRET.test(near ?? ''),
    }
    if (line.value) row.value = line.value
    if (near) row.near = near
    rows.push(row)
    lastRow = row
    lastRowIndent = line.indent
    if (line.role === 'combobox') lastCombobox = { row, indent: line.indent }
  }
  // A combobox without options is a text input wearing a combobox role.
  for (const row of rows) if (row.kind === 'select' && !row.options?.length) row.kind = 'type'
  return { url, title, rows, text: text.join(' ').slice(0, TEXT_CHARS), above, below, omitted }
}

/** One row as Jev reads it: `[4] link "Download" — near: Tax year 2025:` */
export function describeRow(row: ActionRow): string {
  const parts = [`[${row.index}] ${row.role}`]
  if (row.name) parts.push(`"${row.name}"`)
  if (row.value !== undefined) parts.push(`= "${row.value}"`)
  else if (row.placeholder) parts.push(`(placeholder: ${row.placeholder})`)
  if (row.flags.length > 0) parts.push(`[${row.flags.join(', ')}]`)
  if (row.options?.length) parts.push(`options: ${row.options.slice(0, 12).join(' / ')}`)
  if (row.near && row.near !== row.name) parts.push(`— near: ${row.near}`)
  return parts.join(' ')
}

/** Whether the page changed since a previous table: url, controls and text. */
export function fingerprint(table: ActionTable): string {
  const hash = createHash('sha256')
  hash.update(table.url)
  for (const row of table.rows)
    hash.update(`|${row.ref}|${row.role}|${row.name}|${row.value ?? ''}|${row.flags.join(',')}`)
  hash.update(`|${table.text}`)
  return hash.digest('hex').slice(0, 16)
}
