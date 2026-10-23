import * as path from 'node:path'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import { dayStamp } from '#shared/models/Chat/ChatContext/dayLabel.ts'
import { Collection } from '#shared/models/Markdown/mod.ts'
import { dayActionDir } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { dayLabel } from './clock.ts'
import type { SlackDayDocs, SlackDocEntry } from './slackDay.ts'

export const SLACK_APP = 'slack'
export const SLACK_WHAT = 'Chat - Slack channels'

/** The day's channel documents, the earlier threads first, each stamped with its day and kind, for the model. */
export function renderSlackInput(input: {
  day: PlainDate
  root: string
  channels: SlackDocEntry[]
  threads: SlackDocEntry[]
  messages: number
}): string {
  const { day } = input
  const labels = new Map<string, string>([
    ...input.threads.map((t) => [t.path, `${dayStamp(PlainDate.fromString(t.day), day)} | THREAD`] as const),
    ...input.channels.map((c) => [c.path, `${dayStamp(day, day)} | CHANNEL`] as const),
  ])
  const section = (entries: SlackDocEntry[]) =>
    Collection.from(entries.map((e) => ({ doc: e.doc, path: e.path }))).toMarkdown({
      relativeTo: input.root,
      delimited: true,
      sorted: false,
      label: (p) => labels.get(p),
    })
  return [
    `# Slack channels for ${day.ymd} (${day.dayShort})`,
    '',
    `${plural(input.channels.length, 'channel')} · ${plural(input.messages, 'message')} · ${plural(input.threads.length, 'earlier thread')}`,
    '',
    'Below are the earlier parts of threads replied to on this day (THREAD), then every channel with messages on this day (CHANNEL). Write the Slack recap.',
    '',
    ...[section(input.threads), section(input.channels)].filter((s) => s.length > 0),
  ].join('\n')
}

/** The recap's title and counts line; the model writes what follows. */
export function slackRecapHeader(day: PlainDate, docs: SlackDayDocs, threads: number): string {
  return [
    `# Slack — ${dayLabel(day)}`,
    '',
    `${plural(docs.channels.length, 'channel')} · ${plural(docs.messages, 'message')} · ${plural(threads, 'earlier thread')} read`,
    '',
  ].join('\n')
}

/** `when:` for the recap: the day's first and last channel message, on the notebook clock. */
export function slackRecapWhen(day: PlainDate, span: { first: string; last: string }): { when: string; first: string } {
  const first = span.first.slice(11)
  const last = span.last.slice(11)
  return { when: first === last ? `${day.ymd} ${first}` : `${day.ymd} ${first} - ${last}`, first }
}

/** The day's captures, read whole: their anchors say which threads the notebook already holds. */
export async function readDayCaptures(timeDir: string, day: PlainDate): Promise<string[]> {
  const dir = path.join(timeDir, dayActionDir('message', day))
  const captures: string[] = []
  try {
    for await (const entry of walk(dir, { includeDirs: false, exts: ['.md'] })) {
      captures.push(await readTextFile(entry.path))
    }
  } catch {
    // No captures for the day
  }
  return captures
}

/**
 * The day due for a recap, newest first: a day whose successor has started
 * (its messages are all in), that has channel messages, and no recap yet.
 */
export async function dueSlackDay(input: {
  candidates: PlainDate[]
  started: (day: PlainDate) => Promise<boolean>
  hasRecap: (day: PlainDate) => Promise<boolean>
  hasMessages: (day: PlainDate) => Promise<boolean>
}): Promise<PlainDate | undefined> {
  const newestFirst = [...input.candidates].sort((a, b) => PlainDate.compare(b, a))
  for (const day of newestFirst) {
    if (!(await input.started(day.addDays(1)))) continue
    if (await input.hasRecap(day)) continue
    if (!(await input.hasMessages(day))) continue
    return day
  }
  return undefined
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
