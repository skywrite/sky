import * as marked from 'marked'
import { fetchLinksFromTokens, type Link } from '#shared/models/Markdown/Link/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'

export interface ItemListProps {
  title: string
  items?: string[]
}

export interface ItemListModifiedResult {
  newList: ItemList
  value: string | undefined
  links?: Map<string, Link>
}

export default class ItemList implements ItemListProps {
  private _items: string[]
  private _title = ''
  protected _links: Map<string, Link>

  // TODO
  // create custom equality method
  // create custom sorting method

  constructor(opts: string | ItemListProps) {
    if (typeof opts === 'string') {
      this._title = opts
      this._items = []
    } else if (typeof opts === 'object') {
      this._title = opts.title
      this._items = Array.isArray(opts?.items) ? [...opts.items] : []
    } else {
      throw new Error(`Unsupported type for ItemCollection constructor ${typeof opts}`)
    }

    this._links = new Map()
  }

  private _addItems(items: string[]): ItemList {
    const ic = this.clone()
    const newItems = [...this._items, ...items]
    ic['_items'] = this._arrayCreator(newItems)
    return ic
  }

  private _arrayCreator(items: string[]): string[] {
    // return this.sorted ? this._sort(items) : [...items]
    return [...items]
  }

  private _sort(items: string[]): string[] {
    return [...items].sort((a, b) => {
      return String(a).localeCompare(String(b))
    })
  }

  add(item: string | string[]): ItemList {
    if (Array.isArray(item)) return this._addItems(item)

    const ic = this.clone()
    ic['_items'] = this._arrayCreator([...this._items, item])
    return ic
  }

  at(index: number): string | undefined {
    return this._items.at(index)
  }

  clone(): ItemList {
    const ic = new ItemList({
      title: this.title,
    })

    ic['_items'] = [...this._items]
    ic['_links'] = structuredClone(this._links)

    return ic
  }

  concat(appendList: ItemList, opts?: ItemListProps): ItemList {
    const cloneList = this.clone()
    cloneList._items = [...cloneList._items, ...appendList._items]

    appendList.links.forEach((link, refLabel) => {
      if (!cloneList._links.has(refLabel)) cloneList._links.set(refLabel, { ...link })
    })

    if (opts) {
      if (opts.title) cloneList._title = opts.title
    }

    return cloneList
  }

  equals(otherCollection: ItemList): boolean {
    if (this.size != otherCollection.size) return false
    if (this.title != otherCollection.title) return false

    for (let i = 0; i < this._items.length; ++i) {
      const thisItem = this._items[i]
      const otherItem = otherCollection['_items'][i]

      if (String(thisItem).localeCompare(String(otherItem)) !== 0) return false
    }

    return true
  }

  filter(predicate: (value: string) => boolean): ItemList {
    const newList = this.clone()

    const newItems: string[] = []
    const newLinkMap = new Map<string, Link>()

    this._items.forEach((item) => {
      const shouldKeep = predicate(item)
      if (shouldKeep) {
        newItems.push(item)
        const refLabels = Document.extractReferenceLabels(item)
        refLabels.forEach((label) => {
          // A label with no definition (a dangling reference) has no link to keep
          const link = this.links.get(label)
          if (link) newLinkMap.set(label, link)
        })
      }
    })

    newList._items = newItems
    newList._links = newLinkMap

    return newList
  }

  insert(item: string, index = 0): ItemList {
    const items = [...this._items]
    let ndx = index
    if (index === -1) ndx = items.length

    items.splice(ndx, 0, item)

    const ic = this.clone()
    ic['_items'] = items
    return ic
  }

  remove(index: number): ItemListModifiedResult {
    const items = [...this._items]
    let ndx = index
    if (index === -1) ndx = items.length - 1

    const value = this.at(ndx)
    items.splice(ndx, 1)

    const newList = this.clone()

    newList['_items'] = items

    const resObject: ItemListModifiedResult = {
      newList,
      value,
    }

    if (value) {
      const refLabels = Document.extractReferenceLabels(value)
      // console.dir(refLabels)
      const links = new Map<string, Link>()
      if (refLabels.length > 0) {
        refLabels.forEach((refLabel) => {
          const link = this.links.get(refLabel)
          if (link) links.set(refLabel, link)
          newList._links.delete(refLabel)
        })
        resObject.links = links
      }
    }

    return resObject
  }

  // TODO: consider an option to include reference (label) links
  // this assumes if this class as links as a property
  toMarkdown(): string {
    const markdown = [`## ${this._title}`]

    if (this._items.length === 0) {
      markdown.push('-')
    } else {
      this._items.forEach((item) => {
        markdown.push(`- ${item}`.trim())
      })
    }

    return markdown.join('\n')
  }

  // TODO: pass in sorting function
  toSorted(predicate?: (a: string, b: string) => number): ItemList {
    if (!predicate) {
      predicate = (a, b) => {
        return String(a).localeCompare(String(b))
      }
    }

    const newItemCol = this.clone()

    const items = newItemCol._items
    const newItems = items.sort(predicate)

    newItemCol['_items'] = newItems

    return newItemCol
  }

  update(newProps: Partial<ItemListProps>): ItemList {
    const ic = new ItemList({ ...(this as ItemListProps), ...newProps })

    ic['_items'] = [...this._items]
    ic['_links'] = structuredClone(this._links)

    return ic
  }

  get items(): string[] {
    return [...this._items]
  }

  get links(): Map<string, Link> {
    return new Map(this._links)
  }

  get size(): number {
    return this._items.length
  }

  get title(): string {
    return this._title
  }

  get [Symbol.toStringTag]() {
    return 'ItemCollection'
  }

  [Symbol.iterator]() {
    return this._items.values()
  }

  static fromArray(opts: ItemListProps | string, items: string[]): ItemList {
    const ic = new ItemList(opts)
    ic['_items'] = [...items]
    return ic
  }

  static fromMarkdownTokens(tokens: marked.TokensList): ItemList {
    if (tokens.length !== 2) throw new Error('Expected a token array of length 2.')

    const headingToken = tokens[0] as marked.Tokens.Heading
    const listToken = tokens[1] as marked.Tokens.List

    const dic = new ItemList(headingToken.text)
    const linkMap = new Map<string, Link>()

    const items: string[] = []
    listToken.items.forEach((item: marked.Tokens.ListItem) => {
      // check for empty value "-"
      if (item.text.trim() === '') return

      items.push(item.text)

      fetchLinksFromTokens(item.tokens, linkMap)
    })

    dic['_items'] = items
    dic['_links'] = linkMap

    return dic
  }
}
