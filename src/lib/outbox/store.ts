import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { atomicWrite, hash, missing, readOptional, withLock } from './files.ts'
import { dayRange, ScanRangeSchema, type SavedScanRange, type ScanRange } from './range.ts'
import { ItemSchema, OutboxError, type OutboxItem, type OutboxRecord } from './types.ts'

export const DEFAULT_PREFERENCES = `Be brief, direct, empathetic, and humble. Use natural language, without AI filler.
Do not invent facts, commitments, availability, or certainty.
Do not propose a meeting unless I explicitly ask you to. Prefer resolving things in writing.
`

export class OutboxStore {
  constructor(
    readonly dir: string,
    readonly stateDir: string,
  ) {}

  private file(id: string): string {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new OutboxError('Invalid Outbox item.', 404)
    return path.join(this.dir, 'items', `${id}.md`)
  }

  async get(id: string): Promise<OutboxRecord | null> {
    const text = await readOptional(this.file(id))
    if (text === undefined) return null
    const doc = Document.fromMarkdown(text)
    if (doc.yamlError) throw new OutboxError('An Outbox item has invalid frontmatter.')
    const item = ItemSchema.parse({ ...doc.yaml, draft: doc.markdown.trim() })
    if (item.id !== id) throw new OutboxError('The Outbox item does not match its file.')
    return { ...item, revision: hash(text) }
  }

  async list(): Promise<OutboxRecord[]> {
    let files: string[]
    try {
      files = await readdir(path.join(this.dir, 'items'))
    } catch (error) {
      if (missing(error)) return []
      throw error
    }
    const items: OutboxRecord[] = []
    for (const name of files.filter((name) => /^[a-f0-9]{32}\.md$/.test(name))) {
      const item = await this.get(name.slice(0, -3))
      if (item) items.push(item)
    }
    return items.sort((a, b) => b.updated.localeCompare(a.updated))
  }

  async put(item: OutboxItem, revision: string | null): Promise<OutboxRecord> {
    return withLock(path.join(this.stateDir, 'write.lock'), async () => {
      const current = await this.get(item.id)
      if ((current?.revision ?? null) !== revision) {
        throw new OutboxError('This decision changed. Reload it before saving; your text is still here.', 409)
      }
      const { draft, ...yaml } = ItemSchema.parse(item)
      await atomicWrite(this.file(item.id), new Document(yaml, `${draft.trim()}\n`).toMarkdown())
      return (await this.get(item.id))!
    })
  }

  async preferences(): Promise<{ text: string; revision: string }> {
    const text = await readOptional(path.join(this.dir, 'preferences.md'))
    const doc = text === undefined ? null : Document.fromMarkdown(text)
    if (doc?.yamlError) throw new OutboxError('Communication preferences have invalid frontmatter.')
    return { text: doc?.markdown.trim() ?? DEFAULT_PREFERENCES, revision: hash(text ?? '') }
  }

  async scanRange(today: string): Promise<SavedScanRange> {
    const text = await readOptional(path.join(this.dir, 'search.md'))
    if (text === undefined) return { value: dayRange(today), revision: hash('') }
    const doc = Document.fromMarkdown(text)
    if (doc.yamlError) throw new OutboxError('The saved Outbox search range has invalid frontmatter.')
    return { value: ScanRangeSchema.parse(doc.yaml.range), revision: hash(text) }
  }

  async saveScanRange(value: ScanRange, revision: string, today: string): Promise<void> {
    const range = ScanRangeSchema.parse(value)
    await withLock(path.join(this.stateDir, 'write.lock'), async () => {
      if ((await this.scanRange(today)).revision !== revision)
        throw new OutboxError('The search range changed in another window. Reload before checking.', 409)
      await atomicWrite(
        path.join(this.dir, 'search.md'),
        new Document(
          { range, updated: today },
          'Dates and times follow saved message timestamps. This range stays fixed until you change it.\n',
        ).toMarkdown(),
      )
    })
  }

  async savePreferences(text: string, revision: string): Promise<void> {
    if (text.length > 20_000) throw new OutboxError('Keep preferences under 20,000 characters.')
    await withLock(path.join(this.stateDir, 'write.lock'), async () => {
      if ((await this.preferences()).revision !== revision)
        throw new OutboxError('Preferences changed. Reload first.', 409)
      const file = path.join(this.dir, 'preferences.md')
      const previous = Document.fromMarkdown((await readOptional(file)) ?? '')
      const today = PlainDate.today().ymd
      await atomicWrite(
        file,
        new Document({ ...previous.yaml, created: previous.yaml.created ?? today, updated: today }, text).toMarkdown(),
      )
    })
  }
}
