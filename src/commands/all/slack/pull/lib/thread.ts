import { missing } from '#lib/outbox/files.ts'
import { readDir } from '#shared/fs/mod.ts'
import { channelDayPath, readChannelDay, type CacheMessage } from './cache.ts'
import { dayOf, parseMessageId } from './entries.ts'
import { compareTs } from './ts.ts'

/** A thread as far as the cache holds it: the root, when its day is cached, and every reply in time order. */
export type CachedThread = { root?: CacheMessage; replies: CacheMessage[] }

const DAY_DIR = /^\d{4}-\d{2}-\d{2}$/

/** Every cached message of one channel from `fromDay` through `toDay` (both inclusive, each optional): oldest day first, file order within a day. */
export async function readChannelDays(
  root: string,
  fileName: string,
  fromDay?: string,
  toDay?: string,
): Promise<CacheMessage[]> {
  const days: string[] = []
  try {
    for await (const entry of readDir(root)) {
      if (!entry.isDirectory || !DAY_DIR.test(entry.name)) continue
      if ((!fromDay || entry.name >= fromDay) && (!toDay || entry.name <= toDay)) days.push(entry.name)
    }
  } catch (error) {
    if (!missing(error)) throw error
  }
  const messages: CacheMessage[] = []
  for (const day of days.sort()) messages.push(...(await readChannelDay(channelDayPath(root, day, fileName))))
  return messages
}

function tsOf(message: CacheMessage): string {
  return parseMessageId(message.id)?.ts ?? '0'
}

/** Pick one thread out of a channel's messages: the root by its id, the replies by their thread line. */
export function assembleThread(messages: readonly CacheMessage[], rootId: string): CachedThread {
  const root = messages.find((message) => message.id === rootId)
  const replies = messages
    .filter((message) => message.thread?.rootId === rootId)
    .sort((a, b) => compareTs(tsOf(a), tsOf(b)))
  return { ...(root ? { root } : {}), replies }
}

/**
 * The whole conversation behind a thread line, from the cache alone. The
 * cache is partitioned by UTC day and the root's UTC day follows from the
 * ts in its id, so the channel's files are read from that day on. A root
 * older than the cache is simply absent.
 */
export async function readThread(input: { root: string; fileName: string; rootId: string }): Promise<CachedThread> {
  const identity = parseMessageId(input.rootId)
  if (!identity) throw new Error(`Not a cache message id: ${input.rootId}`)
  return assembleThread(await readChannelDays(input.root, input.fileName, dayOf(identity.ts, 'UTC')), input.rootId)
}
