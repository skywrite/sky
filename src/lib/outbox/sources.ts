import { readdir, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import parseMessageLink from '#commands/all/slack/lib/parseMessageLink.ts'
import { threadIdFromDecimal } from '#lib/google/gmail.ts'
import Follow from '#shared/models/Follow/mod.ts'
import MessageDocument from '#shared/models/Message/document/mod.ts'
import { resolveTimeRef, toTimeRef } from '#shared/nbfs/timeRef.ts'
import { hash, missing, notebookFile, readOptional } from './files.ts'
import type { Conversation } from './types.ts'

export const InventorySchema = z.object({
  version: z.literal(1),
  files: z.record(z.string(), z.string()),
  pending: z.array(z.string()),
  handled: z.record(z.string(), z.string()),
})
export type Inventory = z.infer<typeof InventorySchema>

const MAX_MESSAGE_BYTES = 160_000
const MAX_CONTEXT_CHARS = 100_000
const MAX_CONTEXT_FILES = 30

export class SavedMessages {
  constructor(
    readonly root: string,
    readonly followDirs: Record<'Slack' | 'Email', string[]>,
  ) {}

  /** Baseline old files without reading their content. New captures can carry an older message date. */
  async discover(previous: Inventory | null, today: string): Promise<Inventory> {
    const files: Record<string, string> = {}
    const pending = new Set(previous?.pending ?? [])
    const walk = async (dir: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch (error) {
        if (missing(error)) return
        throw error
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(file)
        } else if (entry.isFile() && entry.name.endsWith('.md') && dir.endsWith('/actions/messages')) {
          const relative = path.relative(this.root, file)
          const ref = toTimeRef(relative)
          const info = await stat(file)
          const signature = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`
          files[ref] = signature
          if (previous ? previous.files[ref] !== signature : ref.startsWith(`${today}/`)) pending.add(ref)
        }
      }
    }
    await walk(path.join(this.root, 'time'))
    return { version: 1, files, pending: [...pending], handled: previous?.handled ?? {} }
  }

  private async read(ref: string): Promise<MessageDocument> {
    const relative = resolveTimeRef(ref)
    if (!/^time\/.*\/actions\/messages\/[^/]+\.md$/.test(relative)) throw new Error('Not a saved message reference.')
    const file = await notebookFile(this.root, relative)
    if ((await stat(file)).size > MAX_MESSAGE_BYTES)
      throw new Error('Saved message is too large to review automatically.')
    const doc = MessageDocument.fromMarkdown((await readOptional(file)) ?? '')
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

  async conversation(ref: string): Promise<Conversation | null> {
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
    if (followName && !follow)
      limitations.push('The follow record is unavailable; some conversation history may be missing.')
    if (follow?.merged.length) {
      target = null
      limitations.push('This capture joins several threads. Choose a destination in the native app.')
    }

    const docs = new Map<string, MessageDocument>([[ref, seed]])
    const queue = (follow?.messages ?? []).map((message) => toTimeRef(message.path)).reverse()
    if (seed.previous) queue.push(this.previous(ref, seed.previous))
    let chars = seed.markdown.length
    while (queue.length) {
      const next = queue.shift()!
      if (docs.has(next)) continue
      if (docs.size >= MAX_CONTEXT_FILES || chars >= MAX_CONTEXT_CHARS) {
        limitations.push('Earlier history exceeds the reading limit. Read the original conversation before approving.')
        break
      }
      try {
        const doc = await this.read(next)
        if (doc.medium !== medium) throw new Error('Conversation history points to another app.')
        docs.set(next, doc)
        chars += doc.markdown.length
        if (doc.previous) queue.push(this.previous(next, doc.previous))
      } catch {
        limitations.push('An earlier saved message could not be read. Check the original conversation.')
      }
    }
    const sources = [...docs]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sourceRef, doc]) => {
        const from = typeof doc.yaml.from === 'string' ? doc.yaml.from : JSON.stringify(doc.yaml.from ?? '')
        const to = typeof doc.yaml.to === 'string' ? doc.yaml.to : JSON.stringify(doc.yaml.to ?? '')
        const body = doc.markdown.trim()
        return { ref: sourceRef, hash: hash(JSON.stringify({ from, to, body })), from, to, body }
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
    return { key, version, medium, sources, target, limitations: uniqueLimitations }
  }

  async current(conversation: Conversation): Promise<Conversation> {
    const latest = await this.conversation(conversation.sources.at(-1)!.ref)
    if (!latest || latest.key !== conversation.key) throw new Error('The saved conversation changed identity.')
    return latest
  }
}
