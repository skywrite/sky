import type { Document } from '#shared/models/Markdown/mod.ts'
import {
  type CollectionEntityType,
  type CollectionItem,
  detectTypeFromPath,
  ENTITY_TYPE_PRIORITY,
} from './entityTypes.ts'

export type { CollectionEntityType, CollectionItem } from './entityTypes.ts'

/** Options for markdown output */
export interface MarkdownOutputOptions {
  /** Separator between documents (default: '\n\n' if delimited, '\n---\n' otherwise) */
  separator?: string
  /** Whether to include file path comments (default: true) */
  includePath?: boolean
  /** Base path to make paths relative to */
  relativeTo?: string
  /** Add <!-- START FILE --> / <!-- END FILE --> markers (default: true) */
  delimited?: boolean
  /** Sort by type priority (default: true) */
  sorted?: boolean
}

/**
 * A typed collection of markdown documents.
 *
 * Returned from store queries, supports filtering, merging, and markdown output.
 * Generic type preserves document type information through operations.
 */
export default class MarkdownCollection<T extends Document = Document> {
  private items: Map<string, CollectionItem<T>>

  private constructor(items?: Map<string, CollectionItem<T>>) {
    this.items = items ?? new Map()
  }

  /**
   * Create an empty collection.
   */
  static empty<T extends Document = Document>(): MarkdownCollection<T> {
    return new MarkdownCollection<T>()
  }

  /**
   * Create a collection from a pre-built Map of items.
   * Used by DomainCollection.fromStore() to avoid O(n²) immutable add() calls.
   */
  static fromMap<T extends Document>(items: Map<string, CollectionItem<T>>): MarkdownCollection<T> {
    return new MarkdownCollection<T>(items)
  }

  /**
   * Create a collection from an array of documents with paths.
   */
  static from<T extends Document>(
    docs: Array<{ doc: T; path: string; depth?: number }>,
    typeHint?: CollectionEntityType,
  ): MarkdownCollection<T> {
    const collection = new MarkdownCollection<T>()
    for (const { doc, path, depth } of docs) {
      const type = typeHint ?? detectTypeFromPath(path)
      collection.items.set(path, { doc, path, type, depth: depth ?? 0 })
    }
    return collection
  }

  /**
   * Create a collection from a single document.
   */
  static of<T extends Document>(doc: T, path: string, typeHint?: CollectionEntityType): MarkdownCollection<T> {
    return MarkdownCollection.from([{ doc, path }], typeHint)
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** Number of documents in the collection */
  get size(): number {
    return this.items.size
  }

  /** Whether the collection is empty */
  get isEmpty(): boolean {
    return this.items.size === 0
  }

  /** All file paths in the collection */
  get paths(): string[] {
    return Array.from(this.items.keys())
  }

  /** Get all documents */
  getAll(): T[] {
    return Array.from(this.items.values()).map((item) => item.doc)
  }

  /** Get all items (includes path and type) */
  getAllItems(): CollectionItem<T>[] {
    return Array.from(this.items.values())
  }

  /** Get first document (undefined if empty) */
  first(): T | undefined {
    const first = this.items.values().next()
    return first.done ? undefined : first.value.doc
  }

  /** Get document by path */
  get(path: string): T | undefined {
    return this.items.get(path)?.doc
  }

  /** Check if path exists in collection */
  has(path: string): boolean {
    return this.items.has(path)
  }

  // ---------------------------------------------------------------------------
  // Transformations (return new collections)
  // ---------------------------------------------------------------------------

  /**
   * Filter documents by predicate.
   * Returns a new collection with matching documents.
   */
  filter(predicate: (doc: T, path: string) => boolean): MarkdownCollection<T> {
    const filtered = new Map<string, CollectionItem<T>>()
    for (const [path, item] of this.items) {
      if (predicate(item.doc, path)) {
        filtered.set(path, item)
      }
    }
    return new MarkdownCollection<T>(filtered)
  }

  /**
   * Map documents to new values.
   * Returns a new collection with transformed documents.
   */
  map<U extends Document>(fn: (doc: T, path: string) => U): MarkdownCollection<U> {
    const mapped = new Map<string, CollectionItem<U>>()
    for (const [path, item] of this.items) {
      mapped.set(path, { doc: fn(item.doc, path), path, type: item.type, depth: item.depth })
    }
    return new MarkdownCollection<U>(mapped)
  }

  /**
   * Find first document matching predicate.
   */
  find(predicate: (doc: T, path: string) => boolean): T | undefined {
    for (const [path, item] of this.items) {
      if (predicate(item.doc, path)) {
        return item.doc
      }
    }
    return undefined
  }

  /**
   * Merge with another collection.
   * On duplicate paths, keeps the item with the lower depth (closer to root).
   */
  merge<U extends Document>(other: MarkdownCollection<U>): MarkdownCollection<T | U> {
    const merged = new Map<string, CollectionItem<T | U>>()

    // Add items from this collection
    for (const [path, item] of this.items) {
      merged.set(path, item)
    }

    // Add items from other collection; on duplicate, keep lower depth
    for (const [path, item] of other.items) {
      const existing = merged.get(path)
      if (!existing || item.depth < existing.depth) {
        merged.set(path, item)
      }
    }

    return new MarkdownCollection<T | U>(merged)
  }

  /**
   * Add a single document to the collection.
   * Returns a new collection.
   */
  add(doc: T, path: string, typeHint?: CollectionEntityType, depth = 0): MarkdownCollection<T> {
    const existing = this.items.get(path)
    if (existing && depth >= existing.depth) {
      return this // Already exists at same or lower depth
    }
    const newItems = new Map(this.items)
    const type = typeHint ?? existing?.type ?? detectTypeFromPath(path)
    newItems.set(path, { doc, path, type, depth })
    return new MarkdownCollection<T>(newItems)
  }

  /**
   * Remove a document by path.
   * Returns a new collection.
   */
  remove(path: string): MarkdownCollection<T> {
    if (!this.items.has(path)) {
      return this // Doesn't exist, return same collection
    }
    const newItems = new Map(this.items)
    newItems.delete(path)
    return new MarkdownCollection<T>(newItems)
  }

  // ---------------------------------------------------------------------------
  // Iteration
  // ---------------------------------------------------------------------------

  /**
   * Iterate over documents.
   */
  forEach(fn: (doc: T, path: string) => void): void {
    for (const [path, item] of this.items) {
      fn(item.doc, path)
    }
  }

  /**
   * Make the collection iterable.
   */
  *[Symbol.iterator](): Iterator<CollectionItem<T>> {
    yield* this.items.values()
  }

  // ---------------------------------------------------------------------------
  // Output
  // ---------------------------------------------------------------------------

  /**
   * Output the collection as markdown.
   */
  toMarkdown(opts: MarkdownOutputOptions = {}): string {
    const { includePath = true, relativeTo, delimited = true, sorted = true } = opts
    const separator = opts.separator ?? (delimited ? '\n\n' : '\n---\n')

    let items = Array.from(this.items.values())

    // Sort by type priority if requested
    if (sorted) {
      items = items.sort((a, b) => ENTITY_TYPE_PRIORITY[a.type] - ENTITY_TYPE_PRIORITY[b.type])
    }

    const parts: string[] = []

    for (const item of items) {
      const content = formatItem(item, includePath, relativeTo, delimited)
      parts.push(content)
    }

    return parts.join(separator)
  }

  /**
   * Convert to array of { doc, path } for interop.
   */
  toArray(): Array<{ doc: T; path: string }> {
    return Array.from(this.items.values()).map(({ doc, path }) => ({ doc, path }))
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Format a single item for markdown output.
 */
function formatItem<T extends Document>(
  item: CollectionItem<T>,
  includePath: boolean,
  relativeTo?: string,
  delimited?: boolean,
): string {
  const parts: string[] = []

  // Compute display path
  let displayPath = item.path
  if (relativeTo && displayPath.startsWith(relativeTo)) {
    displayPath = displayPath.slice(relativeTo.length)
    if (displayPath.startsWith('/')) {
      displayPath = displayPath.slice(1)
    }
  }

  if (delimited) {
    parts.push('<!-- START FILE -->')
    if (includePath) {
      parts.push(`<!-- ${displayPath} -->`)
    }
    parts.push(item.doc.toMarkdown())
    parts.push('<!-- END FILE -->')
  } else {
    if (includePath) {
      parts.push(`<!-- ${displayPath} -->`)
    }
    parts.push(item.doc.toMarkdown())
  }

  return parts.join('\n')
}
