import * as path from 'node:path'
import { missing, readOptional } from '#lib/outbox/files.ts'
import { readDir } from '#shared/fs/mod.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { type CacheMessage, channelDayPath, parseChannelDay } from './cache.ts'
import { parseMessageId } from './entries.ts'
import { compareTs } from './ts.ts'

/** One channel's messages of one notebook day, in time order. */
export type ChannelDayView = {
  /** The channel's file name in the cache */
  fileName: string
  /** The channel's name, without the hash */
  channel: string
  channelId?: string
  messages: CacheMessage[]
}

// The UTC days a notebook day's messages can sit in: the UTC day before
// (a zone ahead of UTC starts its day before UTC midnight) through the
// second UTC day after (a late night in a zone behind UTC).
const UTC_DAYS_BEFORE = 1
const UTC_DAYS_AFTER = 2

const MD = '.md'

/** The UTC day directories a notebook day's messages can sit in, oldest first. */
export function utcDaysOf(day: string): string[] {
  const date = PlainDate.fromString(day)
  const days: string[] = []
  for (let offset = -UTC_DAYS_BEFORE; offset <= UTC_DAYS_AFTER; offset++) days.push(date.addDays(offset).toString())
  return days
}

/**
 * The notebook day's view of the cache: every channel with a message whose
 * notebook time falls on the day, by channel name, each channel's messages
 * in time order. The cache is partitioned by UTC day and every message
 * carries its notebook day on its heading, so the view reads the UTC days
 * the notebook day can reach and keeps the messages stamped with it.
 */
export async function readNotebookDay(
  root: string,
  day: string,
  muted: ReadonlySet<string> = new Set(),
): Promise<ChannelDayView[]> {
  const views = new Map<string, ChannelDayView>()
  for (const utcDay of utcDaysOf(day)) {
    for (const fileName of await listChannelFiles(path.join(root, utcDay))) {
      const content = await readOptional(channelDayPath(root, utcDay, fileName))
      if (content === undefined) continue
      const identity = channelOf(content, fileName)
      if (identity.channelId && muted.has(identity.channelId)) continue
      const messages = parseChannelDay(content).filter((message) => message.timestamp.startsWith(day))
      if (messages.length === 0) continue
      const view = views.get(fileName) ?? { fileName, ...identity, messages: [] }
      view.messages.push(...messages)
      views.set(fileName, view)
    }
  }
  for (const view of views.values()) view.messages.sort((a, b) => compareTs(tsOf(a), tsOf(b)))
  return [...views.values()].sort((a, b) => a.fileName.localeCompare(b.fileName))
}

/** Whether a notebook day has any channel message at all. */
export async function hasNotebookDay(root: string, day: string, muted?: ReadonlySet<string>): Promise<boolean> {
  return (await readNotebookDay(root, day, muted)).length > 0
}

async function listChannelFiles(dir: string): Promise<string[]> {
  const names: string[] = []
  try {
    for await (const entry of readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(MD)) names.push(entry.name.slice(0, -MD.length))
    }
  } catch (error) {
    if (!missing(error)) throw error
  }
  return names.sort()
}

/** The channel's name and id as its file header records them; the file name when the header lacks the name. */
function channelOf(content: string, fileName: string): { channel: string; channelId?: string } {
  const yaml = Document.fromMarkdown(content).yaml
  const channel = yaml['channel']
  const channelId = yaml['channel_id']
  return {
    channel: typeof channel === 'string' && channel.startsWith('#') ? channel.slice(1) : fileName,
    ...(typeof channelId === 'string' ? { channelId } : {}),
  }
}

function tsOf(message: CacheMessage): string {
  return parseMessageId(message.id)?.ts ?? '0'
}
