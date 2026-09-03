import * as marked from 'marked'
import Document from '#shared/models/Markdown/Document/mod.ts'
import ItemList from '#shared/models/Markdown/ItemList/mod.ts'
import { type Link, mergeLinkMaps } from '#shared/models/Markdown/Link/mod.ts'
import splitYamlMarkdown from '#shared/models/Markdown/util/splitYamlMarkdown.ts'
import { parse as parseYAML } from '#shared/yaml/mod.ts'

type numOrStr = number | string

export type ModificationOptions = {
  links?: Map<string, Link>
  sort?: boolean
}

export default class ListDocument extends Document {
  protected _lists: ItemList[]

  constructor(yaml: Record<string, unknown> = {}, markdown = '') {
    super(yaml, markdown)
    this._lists = parseItemListsFromTokens(this.markdownTokens)
  }

  public get lists(): ItemList[] {
    return [...this._lists] // remember, this is immutable
  }

  // ## ITEM METHODS

  public addItem(listIndexOrTitle: number | string, item: string, opts?: ModificationOptions): this {
    return this.insertItem(listIndexOrTitle, item, -1, opts)
  }

  public insertItem(listIndexOrTitle: numOrStr, item: string, itemIndex: number, opts?: ModificationOptions): this {
    const list = this.findListFromIndexOrTitle(listIndexOrTitle)
    let newList = list.insert(item, itemIndex)

    if (opts?.sort) newList = newList.toSorted()

    let newDoc = this.replaceList(listIndexOrTitle, newList)

    if (opts?.links) {
      const links = new Map(newDoc._links)

      opts.links.forEach((link, refLabel) => {
        links.set(refLabel, { ...link })
      })

      newDoc = newDoc.updateLinks(links)
    }

    return newDoc
  }

  public removeItem(listIndexOrTitle: number | string, itemIndex: number, opts?: ModificationOptions): this {
    const list = this.findListFromIndexOrTitle(listIndexOrTitle)
    let newList = list.remove(itemIndex).newList

    if (opts?.sort) newList = newList.toSorted()

    return this.replaceList(listIndexOrTitle, newList)
  }

  // ## END ITEM METHODS

  // ## LIST METHODS

  public addList(list: string | ItemList): this {
    let listObj: ItemList

    if (typeof list === 'string') listObj = new ItemList(list)
    else if (typeof list === 'object') listObj = list
    else throw new Error(`List is not the correct type ${typeof list}`)

    // don't render links
    const newMarkdown = this.toMarkdown({ links: false }).trim() + '\n\n' + listObj.toMarkdown() + '\n'
    let newDoc = (this.constructor as typeof ListDocument).fromMarkdown(newMarkdown) as this

    // need to set the yaml
    newDoc._yaml = structuredClone(this.yaml)

    newDoc = newDoc.updateLinks(mergeLinkMaps([this.links, listObj.links])) as this
    return newDoc
  }

  public insertList(index: number, list: string | ItemList): this {
    let listObj: ItemList
    if (typeof list === 'string') listObj = new ItemList(list)
    else if (typeof list === 'object') listObj = list
    else throw new Error(`List is not the correct type ${typeof list}`)

    // Clamp index to valid range
    const clampedIndex = Math.max(0, Math.min(index, this._lists.length))

    // Splice into the document's own text — never rebuild it from its lists.
    // The rebuild dropped prose between and after lists, and lost the whole
    // header whenever the first list could not be string-matched.
    const lines = this.toMarkdown({ links: false }).split('\n')
    const titles = this._lists.map((l) => l.title)
    const listLines = listObj.toMarkdown().split('\n')

    let assembled: string[]
    if (this._lists.length === 0) {
      // No lists yet: the new list starts its block after the content.
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
      assembled = [...lines, '', ...listLines, '']
    } else if (clampedIndex < this._lists.length) {
      const region = locateList(lines, titles, clampedIndex)
      assembled = [...lines.slice(0, region.heading), ...listLines, '', ...lines.slice(region.heading)]
    } else {
      const region = locateList(lines, titles, this._lists.length - 1)
      assembled = [...lines.slice(0, region.last + 1), '', ...listLines, ...lines.slice(region.last + 1)]
    }

    let newDoc = (this.constructor as typeof ListDocument).fromMarkdown(assembled.join('\n')) as this
    newDoc._yaml = structuredClone(this.yaml)

    // Merge links
    newDoc = newDoc.updateLinks(mergeLinkMaps([this.links, listObj.links])) as this
    if (newDoc._lists.length !== this._lists.length + 1) {
      throw new Error(`insertList(): the document did not take the "${listObj.title}" list`)
    }
    return newDoc
  }

  public replaceList(listIndexOrTitle: number | string, newList: ItemList): this {
    const list = this.findListFromIndexOrTitle(listIndexOrTitle)
    const index = this._lists.indexOf(list)
    const titles = this._lists.map((l) => l.title)
    const newMarkdown = spliceList(this.toMarkdown(), titles, index, newList.toMarkdown())
    const doc = (this.constructor as typeof ListDocument).fromMarkdown(newMarkdown) as this

    // replace links
    const newLinks = new Map<string, Link>(Array.from(this.links.entries()))

    // remove links
    list.links.forEach((_, refLabel) => {
      if (!newList.links.has(refLabel)) newLinks.delete(refLabel)
    })

    // add links
    newList.links.forEach((link, refLabel) => {
      if (!list.links.has(refLabel)) newLinks.set(refLabel, link)
    })

    const replaced = doc.updateLinks(newLinks) as this

    // The swap must have taken: a miss that returns the document unchanged is
    // how a caller ends up reporting success over an unwritten file. (An
    // emptied list re-renders as the model's own bare `-` slot — that shape
    // passes without the item check.)
    if (newList.size > 0) {
      const applied = replaced._lists.at(index)
      const items = (l: ItemList) => l.items.map((item) => item.trim()).join('\n')
      if (!applied || applied.title.trim() !== newList.title.trim() || items(applied) !== items(newList)) {
        throw new Error(`replaceList(): the document did not take the new "${newList.title}" list`)
      }
    }
    return replaced
  }

  public removeList(index: number): this {
    const itemList = this._lists.at(index)
    if (!itemList) throw new Error(`Cannot find list with index ${index}.`)
    const at = index < 0 ? this._lists.length + index : index
    const titles = this._lists.map((l) => l.title)

    // Take the region out by structure (see locateList), along with one
    // adjacent blank line so the neighbours keep a single separator.
    const lines = this.toMarkdown().split('\n')
    const region = locateList(lines, titles, at)
    let from = region.heading
    let to = region.last
    if (to + 1 < lines.length && lines[to + 1].trim() === '') to++
    else if (from > 0 && lines[from - 1].trim() === '') from--

    const doc = (this.constructor as typeof ListDocument).fromMarkdown(
      [...lines.slice(0, from), ...lines.slice(to + 1)].join('\n'),
    ) as this
    if (doc._lists.length !== this._lists.length - 1) {
      throw new Error(`removeList(): the document did not drop the "${itemList.title}" list`)
    }
    return doc
  }

  public findListIndex(predicate: (list: ItemList) => boolean): number {
    return this._lists.findIndex(predicate)
  }

  public findLastListIndex(predicate: (list: ItemList) => boolean): number {
    return this._lists.findLastIndex(predicate)
  }

  protected findListFromIndexOrTitle(listIndexOrTitle: number | string): ItemList {
    let itemListVal: ItemList | undefined

    if (typeof listIndexOrTitle === 'number') {
      itemListVal = this._lists.at(listIndexOrTitle)
    } else if (typeof listIndexOrTitle === 'string') {
      itemListVal = this._lists.at(this._lists.findIndex((il) => il.title === listIndexOrTitle))
    }

    if (!itemListVal) {
      throw new Error(`findListFromIndexOrTitle(): Cannot find ItemList by ${listIndexOrTitle}`)
    }

    return itemListVal
  }

  static override fromMarkdown(contentsWithOptionalYamlHeader: string): ListDocument {
    const { yaml, markdown } = splitYamlMarkdown(contentsWithOptionalYamlHeader)
    const yamlData = parseYAML(yaml) ?? {}

    return new this(yamlData as Record<string, unknown>, markdown)
  }
}

const LIST_HEADING = /^##\s+(.+?)\s*$/
const BULLET_LINE = /^\s*[-*+](\s|$)/

interface ListRegion {
  /** Line index of the `##` heading */
  heading: number
  /** Line index of the first bullet */
  first: number
  /** Line index of the last bullet */
  last: number
}

/**
 * Locate the `index`-th list — its `##` heading line through its last
 * bullet — in rendered markdown, by structure rather than by string match.
 *
 * String-matching `ItemList.toMarkdown()` (which renders no blank line
 * after the heading) silently missed any file spelled the ordinary
 * hand-written way, and callers then reported success over an unchanged
 * document. The Nth heading-whose-next-content-is-a-bullet region is the
 * Nth parsed list; a blank run stays inside the region only when more
 * bullets follow (a hand-written loose list is one region); a list that
 * cannot be located is an error, never a no-op.
 */
function locateList(lines: string[], titles: string[], index: number): ListRegion {
  const isBlank = (line: string) => line.trim() === ''

  let ordinal = -1
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(LIST_HEADING)
    if (!heading) continue
    // A list heading is one whose next non-blank line is a bullet.
    let first = i + 1
    while (first < lines.length && isBlank(lines[first])) first++
    if (first >= lines.length || !BULLET_LINE.test(lines[first])) continue
    ordinal++
    if (ordinal < index) continue
    if (heading[1].trim() !== titles[index]?.trim()) break

    let last = first
    let probe = first + 1
    while (probe < lines.length) {
      if (BULLET_LINE.test(lines[probe])) {
        last = probe
        probe++
        continue
      }
      if (isBlank(lines[probe])) {
        let ahead = probe
        while (ahead < lines.length && isBlank(lines[ahead])) ahead++
        if (ahead < lines.length && BULLET_LINE.test(lines[ahead])) {
          probe = ahead
          continue
        }
      }
      break
    }
    return { heading: i, first, last }
  }
  throw new Error(`Cannot locate list ${index} ("${titles[index]}") in the document`)
}

/**
 * Swap one list's region for `replacement`, leaving every other byte of
 * the document alone — the file's own spelling between heading and first
 * bullet included.
 */
function spliceList(markdown: string, titles: string[], index: number, replacement: string): string {
  const lines = markdown.split('\n')
  const region = locateList(lines, titles, index)
  const gap = lines.slice(region.heading + 1, region.first)
  const [newHeading, ...newItems] = replacement.split('\n')
  return [...lines.slice(0, region.heading), newHeading, ...gap, ...newItems, ...lines.slice(region.last + 1)].join(
    '\n',
  )
}

function parseItemListsFromTokens(tokens: marked.TokensList): ItemList[] {
  const items: ItemList[] = []

  tokens.forEach((token, i) => {
    if (token.type === 'heading' && token.depth === 2 && tokens[i + 1]?.type === 'list') {
      const dic = ItemList.fromMarkdownTokens([token, tokens[i + 1]] as marked.TokensList)
      items.push(dic)
      return
    }
  })

  return items
}

// ## Design: Why `ListDocument` extends `Document`, not `SectionDocument`
//
// A list *is* a section conceptually — an `## H2` heading followed by `- items`.
// But the data structures don't align:
//
// - **`SectionDocument`** parses headings into a tree of `Section` objects with
//   rendered `content: string` fields.
// - **`ListDocument`** needs `ItemList` objects built from raw `marked.Token`
//   pairs (heading + list tokens).
//
// If `ListDocument` extended `SectionDocument`, it would still need its own
// `parseItemListsFromTokens()` — you can't build `ItemList`s from
// `Section.content` strings without re-parsing them. So you'd gain an unused
// section tree on every `DayDocument` instance and save zero lines.
//
// ```
// Document
// ├── SectionDocument   (heading tree)
// └── ListDocument      (named item lists)
//     └── DayDocument
// ```
//
// **Positions (line/char):** If `ItemList` ever needs source positions (e.g.,
// for VSCode CodeLens, gutter decorations, or document symbols), the heading
// tokens in `parseItemListsFromTokens()` already carry that data from
// `marked.lexer`. Extract it there — no need to go through a `SectionDocument`
// section tree to get back to the same token info.
//
// Revisit if something ever needs *both* section traversal and list
// manipulation on the same document.
