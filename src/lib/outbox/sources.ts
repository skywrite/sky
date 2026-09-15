import { readdir, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import parseMessageLink from '#commands/all/slack/lib/parseMessageLink.ts'
import type * as Config from '#config'
import { threadIdFromDecimal } from '#lib/google/gmail.ts'
import Follow from '#shared/models/Follow/mod.ts'
import MessageDocument from '#shared/models/Message/document/mod.ts'
import { parseSlackConversation } from '#shared/models/Message/slack/parse.ts'
import { resolveTimeRef, toTimeRef } from '#shared/nbfs/timeRef.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { hash, missing, notebookFile, readOptional } from './files.ts'
import { dayRange, inRange, rangeKey, ScanRangeSchema, type ScanRange } from './range.ts'
import type { Conversation } from './types.ts'

export const SCAN_POLICY = 'range-responses-v5'

export type SavedMessagesConfig = Pick<
  typeof Config,
  | 'DIR_BASE'
  | 'DIR_STATE_FOLLOW_SLACK_ACTIVE'
  | 'DIR_STATE_FOLLOW_SLACK_ARCHIVE'
  | 'DIR_STATE_FOLLOW_EMAIL_ACTIVE'
  | 'DIR_STATE_FOLLOW_EMAIL_ARCHIVE'
>

export function createSavedMessages(config: SavedMessagesConfig): SavedMessages {
  return new SavedMessages(config.DIR_BASE, {
    Slack: [config.DIR_STATE_FOLLOW_SLACK_ACTIVE, config.DIR_STATE_FOLLOW_SLACK_ARCHIVE],
    Email: [config.DIR_STATE_FOLLOW_EMAIL_ACTIVE, config.DIR_STATE_FOLLOW_EMAIL_ARCHIVE],
  })
}

const IndexedSource = z.object({
  stamp: z.string(),
  times: z.array(z.string()),
  identities: z.array(z.string()),
  medium: z.string(),
  error: z.boolean().optional(),
  parserVersion: z.number().optional(),
})

export const InventorySchema = z.object({
  version: z.literal(1),
  files: z.record(z.string(), z.string()),
  pending: z.array(z.string()),
  handled: z.record(z.string(), z.string()),
  day: z.string().optional(),
  policy: z.string().optional(),
  rangeKey: z.string().optional(),
  entries: z.record(z.string(), IndexedSource).optional(),
})
export type Inventory = z.infer<typeof InventorySchema>

const MESSAGE_PARSER_VERSION = 1

function messageTimes(doc: MessageDocument): string[] {
  const timestamps =
    doc.medium === 'Slack'
      ? parseSlackConversation(doc.markdown).messages.map((message) => message.timestamp)
      : [...doc.markdown.matchAll(/^## (\d{4}-\d{2}-\d{2} \d{1,2}:\d{2})[^\n]*\*\*/gm)].map((match) => match[1])
  if (timestamps.length)
    return [...new Set(timestamps.map((timestamp) => PlainDateTime.fromString(timestamp).normalize().toString()))]
  if (doc.yaml.when) return [doc.when.datetime.normalize().toString()]
  return []
}

function identities(doc: MessageDocument): string[] {
  const keys: string[] = []
  if (typeof doc.yaml.follow === 'string') keys.push(`${doc.medium}:follow:${doc.yaml.follow}`)
  if (doc.medium === 'Slack' && typeof doc.yaml.link === 'string') {
    const link = parseMessageLink(doc.yaml.link)
    if (link) keys.push(`Slack:link:${new URL(doc.yaml.link).origin}:${link.channelId}:${link.rootTs}`)
  }
  return keys
}

export class SavedMessages {
  private related = new Map<string, string[]>()
  constructor(
    readonly root: string,
    readonly followDirs: Record<'Slack' | 'Email', string[]>,
  ) {}

  /** Index message timestamps, including captures filed on another day. Only matching activity seeds review. */
  async discover(previous: Inventory | null, selected: string | ScanRange): Promise<Inventory> {
    const range = typeof selected === 'string' ? dayRange(selected) : ScanRangeSchema.parse(selected)
    const files: Record<string, string> = {}
    const entries: NonNullable<Inventory['entries']> = {}
    const pending: string[] = []
    this.related.clear()
    const visit = async (dir: string): Promise<void> => {
      let children
      try {
        children = await readdir(dir, { withFileTypes: true })
      } catch (error) {
        if (!missing(error)) throw error
        return
      }
      for (const child of children) {
        const file = path.join(dir, child.name)
        if (child.isDirectory()) {
          // Visit only the notebook's date hierarchy and message collections.
          if (/^(?:\d{2,4}|x\d{2}|\d{2}-\d{2}|(?:\d{2}-)?W\d{2}|actions|messages)$/.test(child.name)) await visit(file)
          continue
        }
        if (
          !child.isFile() ||
          !child.name.endsWith('.md') ||
          path.basename(dir) !== 'messages' ||
          path.basename(path.dirname(dir)) !== 'actions'
        )
          continue
        const ref = toTimeRef(path.relative(this.root, file))
        const info = await stat(await notebookFile(this.root, path.relative(this.root, file)))
        const stamp = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`
        files[ref] = stamp
        let indexed = previous?.policy === SCAN_POLICY ? previous.entries?.[ref] : undefined
        if (!indexed || indexed.stamp !== stamp || indexed.error || indexed.parserVersion !== MESSAGE_PARSER_VERSION) {
          try {
            const doc = await this.read(ref)
            indexed = {
              stamp,
              times: messageTimes(doc),
              identities: identities(doc),
              medium: doc.medium,
              parserVersion: MESSAGE_PARSER_VERSION,
            }
          } catch {
            indexed = { stamp, times: [], identities: [], medium: '', error: true }
          }
        }
        entries[ref] = indexed
        for (const key of indexed.identities) {
          const refs = this.related.get(key) ?? []
          refs.push(ref)
          this.related.set(key, refs)
        }
        if (!indexed.error && indexed.medium !== 'Slack' && indexed.medium !== 'Email') continue
        if (
          indexed.error ||
          (indexed.times.length
            ? indexed.times.some((time) => inRange(time, range))
            : ref.slice(0, 10) >= range.start.slice(0, 10) && ref.slice(0, 10) <= range.end.slice(0, 10))
        )
          pending.push(ref)
      }
    }
    await visit(path.join(this.root, 'time'))
    // Revisit the inventory, including unchanged seeds: linked history may have changed.
    // Conversation versions below avoid repeating model work. Legacy skips must be reassessed.
    return {
      version: 1,
      day: range.start.slice(0, 10),
      policy: SCAN_POLICY,
      files,
      entries,
      rangeKey: rangeKey(range),
      pending: pending.sort(),
      handled: previous?.rangeKey === rangeKey(range) && previous.policy === SCAN_POLICY ? previous.handled : {},
    }
  }

  private async read(ref: string): Promise<MessageDocument> {
    const relative = resolveTimeRef(ref)
    if (!/^time\/.*\/actions\/messages\/[^/]+\.md$/.test(relative)) throw new Error('Not a saved message reference.')
    const file = await notebookFile(this.root, relative)
    const text = await readOptional(file)
    if (text === undefined) throw new Error('A saved message could not be read.')
    const doc = MessageDocument.fromMarkdown(text)
    if (doc.yamlError) throw new Error('A saved message has invalid frontmatter.')
    return doc
  }

  private previous(ref: string, previous: string): string {
    const [date] = ref.split('/')
    let full = previous
    if (/^\d{2}\//.test(full)) full = `${date.slice(0, 8)}${full}`
    else if (/^\d{2}-\d{2}\//.test(full)) full = `${date.slice(0, 5)}${full}`
    if (!full.endsWith('.md')) full += '.md'
    return toTimeRef(full)
  }

  async conversation(ref: string, contextRefs: string[] = []): Promise<Conversation | null> {
    const seed = await this.read(ref)
    if (seed.medium !== 'Slack' && seed.medium !== 'Email') return null
    const medium = seed.medium
    const followName = typeof seed.yaml.follow === 'string' ? seed.yaml.follow : ''
    let follow: Follow | undefined
    if (followName && /^[^/\\.][^/\\]*$/.test(followName)) {
      for (const dir of this.followDirs[medium]) {
        const text = await readOptional(path.join(dir, `${followName.replace(/\.yaml$/, '')}.yaml`))
        if (text !== undefined) {
          follow = Follow.fromYaml(text)
          if (follow.source !== medium) throw new Error('Follow and saved message refer to different apps.')
          break
        }
      }
    }

    let target: Conversation['target'] = null
    let key = `${medium}:follow:${followName}`
    const limitations: string[] = []
    let incomplete = false
    const link = follow?.ref.link ?? (typeof seed.yaml.link === 'string' ? seed.yaml.link : undefined)
    const parsed = link ? parseMessageLink(link) : undefined
    if (medium === 'Slack' && parsed && link) {
      const url = new URL(link)
      const rootTs = follow?.ref.thread_ts ?? parsed.rootTs
      if (url.protocol === 'https:' && url.hostname.endsWith('.slack.com') && /^\d+\.\d+$/.test(rootTs)) {
        target = { medium, link: `${url.origin}/archives/${parsed.channelId}/p${rootTs.replace('.', '')}` }
        key = `Slack:${url.origin}:${parsed.channelId}:${rootTs}`
      }
    } else if (medium === 'Email' && follow?.ref.account && follow.ref.threadId) {
      target = { medium, account: follow.ref.account, thread: threadIdFromDecimal(follow.ref.threadId) }
      key = `Email:${target.account.toLowerCase()}:${target.thread}`
    }
    if (!target) limitations.push('The saved conversation has no verified destination for a native reply draft.')
    if (followName && !follow) {
      limitations.push('The follow record is unavailable; some conversation history may be missing.')
      incomplete = true
    }
    if (follow?.merged.length) {
      target = null
      limitations.push('This capture joins several threads. Choose a destination in the native app.')
    }

    const docs = new Map<string, MessageDocument>([[ref, seed]])
    const queue = [
      ...new Set([
        ...(follow?.messages ?? []).map((message) => toTimeRef(message.path)),
        ...identities(seed).flatMap((key) => this.related.get(key) ?? []),
        ...contextRefs,
      ]),
    ]
      .sort()
      .reverse()
    if (seed.previous) queue.push(this.previous(ref, seed.previous))
    // Keep the complete evidence for freshness and reply verification. Model
    // input is bounded separately in history.ts, without dropping saved files.
    const visited = new Set([ref])
    while (queue.length) {
      const next = queue.shift()!
      if (visited.has(next)) continue
      visited.add(next)
      try {
        const doc = await this.read(next)
        if (doc.medium !== medium) throw new Error('Conversation history points to another app.')
        docs.set(next, doc)
        if (doc.previous) queue.push(this.previous(next, doc.previous))
      } catch {
        limitations.push('An earlier saved message could not be read. Check the original conversation.')
        incomplete = true
      }
    }
    const sources = [...docs]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sourceRef, doc]) => {
        // A capture without a plain participant yields an empty string, never serialized YAML.
        const from = typeof doc.yaml.from === 'string' ? doc.yaml.from : ''
        const to = typeof doc.yaml.to === 'string' ? doc.yaml.to : ''
        const body = doc.markdown.trim()
        const times = messageTimes(doc)
        return {
          ref: sourceRef,
          hash: hash(JSON.stringify({ from, to, body, ...(times.length ? { times } : {}) })),
          from,
          to,
          body,
          ...(times.length ? { times } : {}),
        }
      })
    if (!target && !followName) key = `${medium}:saved:${sources[0].ref}`
    const uniqueLimitations = [...new Set(limitations)]
    const version = hash(
      JSON.stringify({
        sources: sources.map(({ ref, hash }) => ({ ref, hash })),
        target,
        limitations: uniqueLimitations,
      }),
    )
    return {
      key,
      version,
      medium,
      sources,
      target,
      limitations: uniqueLimitations,
      ...(incomplete ? { incomplete } : {}),
    }
  }

  async current(conversation: Conversation): Promise<Conversation> {
    const latest = await this.conversation(
      conversation.sources.at(-1)!.ref,
      conversation.sources.map(({ ref }) => ref),
    )
    if (!latest || latest.key !== conversation.key) throw new Error('The saved conversation changed identity.')
    return latest
  }
}
