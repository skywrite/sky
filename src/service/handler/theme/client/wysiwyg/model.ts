/**
 * The document model: a tree of nodes. Each node carries its type, its text when it is a leaf,
 * the attributes its type needs, and the spelling the author used — marker, indent, blank lines —
 * so a save reproduces the file that was opened. Inline formatting is not modelled: a paragraph's
 * text IS its markdown, and the inline lexer runs on demand (architecture §3).
 */

export type NodeType =
  | 'document'
  | 'paragraph'
  | 'heading'
  | 'blockquote'
  | 'list'
  | 'list_item'
  | 'fence'
  | 'html'
  | 'hr'
  | 'table'
  | 'table_row'
  | 'table_cell'
  | 'definition'
  | 'frontmatter'

export type Alignment = 'left' | 'center' | 'right' | null

export type ListStyle = 'ul' | 'ol'

/** Everything a node may carry beyond its type, text and tree links. */
export interface NodeAttrs {
  /** heading: 1–6 */
  depth: number
  /** fence: the info string as written (`js`, `mermaid title`) */
  lang: string
  /** list: bullet or numbered */
  style: ListStyle
  /** list: `-`, `*` or `+` */
  bullet: string
  /** list: `.` or `)` */
  delimiter: string
  /** list: the first item's number */
  start: number
  /** list: every item was written with the same number — keep it that way */
  isFixed: boolean
  /** list: items separated by blank lines */
  loose: boolean
  /** list item: a task item's state; null when it is not a task */
  checked: boolean | null
  /** list item: the task mark as written (`[x]`, `[X]`, `[ ]`) */
  taskMark: string
  /** definition: label, target and title */
  ref: string
  href: string
  title: string | null
  /** table: one entry per column */
  align: Alignment[]
  /** table row: the header row */
  header: boolean
  /** table row: outer pipes as written */
  pipeStart: boolean
  pipeEnd: boolean
  /** table: the source lines, emitted verbatim until a cell or the structure changes */
  userText: string[]
  /** the block's marker line with `{0}` where the content goes (`## {0}`, `1. `, "```{0}") */
  pattern: string
  /** the closing line where one exists (a fence's closer, front matter's closer) */
  patternEnd: string
  /** fence: the file had no closing marker — do not invent one */
  noCloseTag: boolean
  /** fence: written as four-space indented code */
  indented: boolean
  /** fence, front matter: zero body lines (as opposed to one empty line) */
  empty: boolean
  /** blank lines before the block, inside its container; undefined = the default spacing */
  ahead: number
  /** those blank lines verbatim, when any of them held whitespace */
  aheadLines: string[]
  /** container: blank lines after its last child */
  tail: number
  tailLines: string[]
  /** container, indented code: the prefix stripped from every source line, in order */
  userIndent: string[]
  /** list item: spaces before the marker */
  prespace: string
  /** list item: the marker as written (`-`, `3.`) */
  markerText: string
  /** list item: the spaces between the marker and the content */
  markerSpacing: string
  /** list item: the column its continuation lines are indented to */
  subindent: number
}

export type NodeJson = {
  id: string
  type: NodeType
  text?: string
  attrs?: Partial<NodeAttrs>
  parent?: string | null
  before?: string | null
  after?: string | null
  children?: NodeJson[]
}

const LEAF_TYPES: ReadonlySet<NodeType> = new Set([
  'paragraph',
  'heading',
  'fence',
  'html',
  'hr',
  'table_cell',
  'definition',
  'frontmatter',
])

const BLOCK_CONTAINER_TYPES: ReadonlySet<NodeType> = new Set(['document', 'blockquote', 'list_item'])

/** Blocks edited as their source text, with no inline rendering. */
const VERBATIM_TYPES: ReadonlySet<NodeType> = new Set(['fence', 'html', 'definition', 'frontmatter'])

const ATTR_KEYS: ReadonlyArray<keyof NodeAttrs> = [
  'depth',
  'lang',
  'style',
  'bullet',
  'delimiter',
  'start',
  'isFixed',
  'loose',
  'checked',
  'taskMark',
  'ref',
  'href',
  'title',
  'align',
  'header',
  'pipeStart',
  'pipeEnd',
  'userText',
  'pattern',
  'patternEnd',
  'noCloseTag',
  'indented',
  'empty',
  'ahead',
  'aheadLines',
  'tail',
  'tailLines',
  'userIndent',
  'prespace',
  'markerText',
  'markerSpacing',
  'subindent',
]

export class Node implements Partial<NodeAttrs> {
  readonly id: string
  type: NodeType
  text = ''

  depth?: number
  lang?: string
  style?: ListStyle
  bullet?: string
  delimiter?: string
  start?: number
  isFixed?: boolean
  loose?: boolean
  checked?: boolean | null
  taskMark?: string
  ref?: string
  href?: string
  title?: string | null
  align?: Alignment[]
  header?: boolean
  pipeStart?: boolean
  pipeEnd?: boolean
  userText?: string[]
  pattern?: string
  patternEnd?: string
  noCloseTag?: boolean
  indented?: boolean
  empty?: boolean
  ahead?: number
  aheadLines?: string[]
  tail?: number
  tailLines?: string[]
  userIndent?: string[]
  prespace?: string
  markerText?: string
  markerSpacing?: string
  subindent?: number

  parent: Node | null = null
  before: Node | null = null
  after: Node | null = null
  firstChild: Node | null = null
  lastChild: Node | null = null

  constructor(id: string, type: NodeType) {
    this.id = id
    this.type = type
  }

  get children(): Node[] {
    const out: Node[] = []
    for (let child = this.firstChild; child; child = child.after) out.push(child)
    return out
  }

  get childCount(): number {
    let n = 0
    for (let child = this.firstChild; child; child = child.after) n++
    return n
  }

  get index(): number {
    let n = 0
    for (let node = this.before; node; node = node.before) n++
    return n
  }

  isLeaf(): boolean {
    return LEAF_TYPES.has(this.type)
  }

  /** Can hold block children (the document, a quote, a list item). */
  canContainBlock(): boolean {
    return BLOCK_CONTAINER_TYPES.has(this.type)
  }

  isContainer(): boolean {
    return !LEAF_TYPES.has(this.type)
  }

  /** Edited as source text: no inline rendering, Enter inserts a newline. */
  isVerbatim(): boolean {
    return VERBATIM_TYPES.has(this.type)
  }

  /** Selected as a whole, never entered. */
  isAtomic(): boolean {
    return this.type === 'hr'
  }

  /** Holds inline-rendered markdown text. */
  isInline(): boolean {
    return this.type === 'paragraph' || this.type === 'heading' || this.type === 'table_cell'
  }

  /** The nearest ancestor of a type, or null. */
  closest(type: NodeType): Node | null {
    for (let node: Node | null = this; node; node = node.parent) {
      if (node.type === type) return node
    }
    return null
  }

  /** The first leaf in document order under (or at) this node. */
  firstLeaf(): Node {
    let node: Node = this
    while (node.firstChild) node = node.firstChild
    return node
  }

  lastLeaf(): Node {
    let node: Node = this
    while (node.lastChild) node = node.lastChild
    return node
  }

  /** The block under the document that holds this node (itself when top-level), or null when detached. */
  topLevel(): Node | null {
    let node: Node = this
    while (node.parent && node.parent.type !== 'document') node = node.parent
    return node.parent ? node : null
  }

  /** The leaf before this node in document order, or null at the document start. */
  previousLeaf(): Node | null {
    let node: Node = this
    while (!node.before) {
      if (!node.parent || node.parent.type === 'document') return null
      node = node.parent
    }
    return node.before.lastLeaf()
  }

  /** The leaf after this node in document order, or null at the document end. */
  nextLeaf(): Node | null {
    let node: Node = this
    while (!node.after) {
      if (!node.parent || node.parent.type === 'document') return null
      node = node.parent
    }
    return node.after.firstLeaf()
  }

  appendChild(node: Node): Node {
    node.detach()
    node.parent = this
    node.before = this.lastChild
    node.after = null
    if (this.lastChild) this.lastChild.after = node
    else this.firstChild = node
    this.lastChild = node
    return node
  }

  prependChild(node: Node): Node {
    node.detach()
    node.parent = this
    node.after = this.firstChild
    node.before = null
    if (this.firstChild) this.firstChild.before = node
    else this.lastChild = node
    this.firstChild = node
    return node
  }

  /** Links `node` as this node's next sibling. */
  addAfter(node: Node): Node {
    if (!this.parent) throw new Error(`Cannot add a sibling to a detached ${this.type}`)
    node.detach()
    node.parent = this.parent
    node.before = this
    node.after = this.after
    if (this.after) this.after.before = node
    else this.parent.lastChild = node
    this.after = node
    return node
  }

  /** Links `node` as this node's previous sibling. */
  addBefore(node: Node): Node {
    if (!this.parent) throw new Error(`Cannot add a sibling to a detached ${this.type}`)
    node.detach()
    node.parent = this.parent
    node.after = this
    node.before = this.before
    if (this.before) this.before.after = node
    else this.parent.firstChild = node
    this.before = node
    return node
  }

  /** Unlinks from the tree; the node and its subtree stay registered. */
  detach(): Node {
    const parent = this.parent
    if (!parent) return this
    if (this.before) this.before.after = this.after
    else parent.firstChild = this.after
    if (this.after) this.after.before = this.before
    else parent.lastChild = this.before
    this.parent = null
    this.before = null
    this.after = null
    return this
  }

  /** Every node in the subtree, this one first, document order. */
  *walk(): IterableIterator<Node> {
    yield this
    for (let child = this.firstChild; child; child = child.after) yield* child.walk()
  }

  attrs(): Partial<NodeAttrs> {
    const out: Partial<NodeAttrs> = {}
    for (const key of ATTR_KEYS) {
      const value = this[key]
      if (value !== undefined) (out as Record<string, unknown>)[key] = cloneAttr(value)
    }
    return out
  }

  setAttrs(attrs: Partial<NodeAttrs>) {
    for (const key of ATTR_KEYS) {
      const value = attrs[key]
      if (value !== undefined) (this as Record<string, unknown>)[key] = cloneAttr(value)
    }
  }

  /** Drops every attribute; the type and text stay. */
  clearAttrs() {
    for (const key of ATTR_KEYS) (this as Record<string, unknown>)[key] = undefined
  }

  toJSON(): NodeJson {
    const json: NodeJson = { id: this.id, type: this.type }
    if (this.isLeaf()) json.text = this.text
    const attrs = this.attrs()
    if (Object.keys(attrs).length > 0) json.attrs = attrs
    json.parent = this.parent?.id ?? null
    json.before = this.before?.id ?? null
    json.after = this.after?.id ?? null
    if (this.firstChild) json.children = this.children.map((child) => child.toJSON())
    return json
  }
}

function cloneAttr<T>(value: T): T {
  return Array.isArray(value) ? ([...value] as T) : value
}

export type LineEnding = '\n' | '\r\n'

/** The document: the root node, the id registry, and the file's line conventions. */
export class MarkdownDocument {
  readonly root: Node
  readonly nodesById = new Map<string, Node>()
  lineEnding: LineEnding = '\n'
  finalNewline = true
  private nextId = 1

  constructor() {
    this.root = new Node('root', 'document')
    this.nodesById.set(this.root.id, this.root)
  }

  get blocks(): Node[] {
    return this.root.children
  }

  createNode(type: NodeType, init: Partial<NodeAttrs> & { text?: string } = {}): Node {
    const node = new Node(`n${this.nextId++}`, type)
    const { text, ...attrs } = init
    if (text !== undefined) node.text = text
    node.setAttrs(attrs)
    this.nodesById.set(node.id, node)
    return node
  }

  getNode(id: string): Node | undefined {
    return this.nodesById.get(id)
  }

  /** Unlinks a node and forgets its subtree; late access to a removed node fails loudly. */
  removeNode(node: Node) {
    node.detach()
    for (const each of node.walk()) {
      this.nodesById.delete(each.id)
      each.clearAttrs()
      each.text = ''
    }
    node.firstChild = null
    node.lastChild = null
  }

  /**
   * Removes a node, then every container left empty above it — never the document itself. A
   * following sibling of a removed first child takes over its blank-line count.
   */
  removeWithEmptyAncestors(node: Node) {
    let parent = node.parent
    if (!node.before && node.after) {
      node.after.ahead = node.ahead
      node.after.aheadLines = node.aheadLines
    }
    this.removeNode(node)
    while (parent && parent.type !== 'document' && !parent.firstChild) {
      const next: Node | null = parent.parent
      this.removeNode(parent)
      parent = next
    }
  }

  /** The reference definition for a label, matched case-insensitively, or null. */
  findDefinition(label: string): Node | null {
    const wanted = normalizeLabel(label)
    for (const node of this.root.walk()) {
      if (node.type === 'definition' && normalizeLabel(node.ref ?? '') === wanted) return node
    }
    return null
  }

  /** Rebuilds a subtree from JSON, reusing its ids. The result is detached. */
  fromJSON(json: NodeJson): Node {
    const node = new Node(json.id, json.type)
    if (json.text !== undefined) node.text = json.text
    if (json.attrs) node.setAttrs(json.attrs)
    this.nodesById.set(node.id, node)
    this.bumpIdCounter(json.id)
    for (const child of json.children ?? []) node.appendChild(this.fromJSON(child))
    return node
  }

  toJSON(): NodeJson {
    return this.root.toJSON()
  }

  private bumpIdCounter(id: string) {
    const n = Number(id.slice(1))
    if (id.startsWith('n') && Number.isInteger(n) && n >= this.nextId) this.nextId = n + 1
  }
}

export function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}
