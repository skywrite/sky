import { readdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { missing } from '#lib/outbox/files.ts'
import { channelFileName } from './cache.ts'
import { type PullRun, readRoster } from './roster.ts'
import { readRules } from './rules.ts'
import { compareTs } from './ts.ts'

/** One joined channel as the Slack page lists it. */
export type SlackChannelRow = {
  id: string
  name: string
  /** Kept by the pull; false when the person switched it off */
  on: boolean
  /** Messages of this channel in the cache */
  kept: number
  /** When the newest message the pull saw was posted, in epoch seconds; only when something is kept */
  lastPostEpoch?: number
}

/** The channel cache as the Slack page reads it. */
export type SlackChannelsView = {
  joined: number
  muted: number
  /** Messages in the cache, every channel together */
  kept: number
  /** Days the cache holds */
  days: number
  /** Most recently active first */
  channels: SlackChannelRow[]
  /** The last few full pulls, newest first */
  runs: PullRun[]
}

const ANCHOR = /<a id="message-slack-/g
const DAY_DIR = /^\d{4}-\d{2}-\d{2}$/

/** How many messages the cache holds per channel file name, over every cached day, without parsing. */
export async function countCachedMessages(root: string): Promise<{ days: number; byFile: Map<string, number> }> {
  const byFile = new Map<string, number>()
  let days: string[] = []
  try {
    days = (await readdir(root)).filter((name) => DAY_DIR.test(name))
  } catch (error) {
    if (!missing(error)) throw error
  }
  for (const day of days) {
    for (const file of await readdir(path.join(root, day))) {
      if (!file.endsWith('.md')) continue
      const text = await readFile(path.join(root, day, file), 'utf8')
      const name = file.slice(0, -3)
      byFile.set(name, (byFile.get(name) ?? 0) + (text.match(ANCHOR)?.length ?? 0))
    }
  }
  return { days: days.length, byFile }
}

/** The roster, the rules and the cache, read together for the page. */
export async function describeSlackChannels(input: {
  roster: string
  rules: string
  days: string
}): Promise<SlackChannelsView> {
  const [roster, rules, cached] = await Promise.all([
    readRoster(input.roster),
    readRules(input.rules),
    countCachedMessages(input.days),
  ])
  const muted = new Set(rules.muted)
  const rows = roster.channels
    .map((channel) => {
      const kept = cached.byFile.get(channelFileName(channel, roster.channels)) ?? 0
      // A cursor with nothing kept marks where reading began, not a post
      const seconds = channel.cursor && kept > 0 ? Number(channel.cursor.split('.')[0]) : undefined
      return {
        row: {
          id: channel.id,
          name: channel.name,
          on: !muted.has(channel.id),
          kept,
          ...(seconds !== undefined && Number.isFinite(seconds) ? { lastPostEpoch: seconds } : {}),
        },
        cursor: channel.cursor ?? '0',
      }
    })
    .sort((a, b) => compareTs(b.cursor, a.cursor) || a.row.name.localeCompare(b.row.name))
    .map((entry) => entry.row)
  return {
    joined: roster.channels.length,
    muted: rows.filter((row) => !row.on).length,
    kept: [...cached.byFile.values()].reduce((sum, count) => sum + count, 0),
    days: cached.days,
    channels: rows,
    runs: roster.runs,
  }
}
