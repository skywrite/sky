import { parse as parseYAML } from '#shared/yaml/mod.ts'
import * as marked from 'marked'
import ItemList from '#shared/models/Markdown/ItemList/mod.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import splitYamlMarkdown from '#shared/models/Markdown/util/splitYamlMarkdown.ts'
import { type Link, mergeLinkMaps } from '#shared/models/Markdown/Link/mod.ts'

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

    // Build new lists array with insertion
    const newLists = [...this._lists.slice(0, clampedIndex), listObj, ...this._lists.slice(clampedIndex)]

    // Get the document header (everything before the first list)
    let headerMarkdown: string
    const fullMarkdown = this.toMarkdown({ links: false })

    if (this._lists.length > 0) {
      const firstListMarkdown = this._lists[0].toMarkdown()
      const firstListIndex = fullMarkdown.indexOf(firstListMarkdown)
      if (firstListIndex > 0) {
        headerMarkdown = fullMarkdown.substring(0, firstListIndex).trim()
      } else {
        headerMarkdown = ''
      }
    } else {
      headerMarkdown = fullMarkdown.trim()
    }

    // Rebuild markdown with all lists in new order
    let newMarkdown = headerMarkdown
    for (const l of newLists) {
      newMarkdown = newMarkdown + '\n\n' + l.toMarkdown()
    }
    newMarkdown = newMarkdown + '\n'

    let newDoc = (this.constructor as typeof ListDocument).fromMarkdown(newMarkdown) as this
    newDoc._yaml = structuredClone(this.yaml)

    // Merge links
    newDoc = newDoc.updateLinks(mergeLinkMaps([this.links, listObj.links])) as this
    return newDoc
  }

  public replaceList(listIndexOrTitle: number | string, newList: ItemList): this {
    const list = this.findListFromIndexOrTitle(listIndexOrTitle)
    const newMarkdown = this.toMarkdown().replace(list.toMarkdown(), newList.toMarkdown())
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

    return doc.updateLinks(newLinks) as this
  }

  public removeList(index: number): this {
    const itemList = this._lists.at(index)
    if (!itemList) throw new Error(`Cannot find list with index ${index}.`)

    const itemListMarkdown = itemList.toMarkdown()

    const markdownWithYaml = this.toMarkdown().replace('\n' + itemListMarkdown + '\n', '')
    return (this.constructor as typeof ListDocument).fromMarkdown(markdownWithYaml) as this
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
