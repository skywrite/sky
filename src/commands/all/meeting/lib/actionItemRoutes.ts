import { dayFileExists, writeDayItems } from '#lib/nbfs/mod.ts'
import type { TranscriptActionItem } from '#lib/notebook/actionItems.ts'
import { exists, readTextFile } from '#shared/fs/mod.ts'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { normalizeClock, placeDestination, type PlaceWhen } from '#universal/dates/whenLabel/mod.ts'

/**
 * Where an accepted action item lands, and how it gets there.
 *
 * An item is placed on a day or on no day. A day with a clock time is a
 * Commitment; without one it is a Todo. A day whose file exists takes the
 * item directly; a day whose week is not made yet parks it in the schedule
 * file under its date, time kept, and `day:schedule:update` files it on
 * that morning by the same split. No day means the Next list.
 */

export type ActionItemRoute =
  | { kind: 'next'; task: string; destination: string }
  | { kind: 'commitments'; task: string; when: PlainDate; destination: string }
  | { kind: 'todo'; task: string; when: PlainDate; destination: string }

/**
 * The when an item arrives with: the day and time its words named, when
 * that day is still ahead — else the fallback. A past date cannot be
 * scheduled; what was overdue is simply next work.
 */
export function proposedWhen(item: TranscriptActionItem, today: string, fallback: PlaceWhen): PlaceWhen {
  if (item.date !== null && item.date >= today) return { date: item.date, time: item.time }
  return fallback
}

/**
 * The last day, from today on, whose day file exists — null when today's
 * own is missing. Looks a fortnight ahead at most: a week is made whole, so
 * the first gap is the end of what is created.
 */
export async function lastCreatedDay(today: PlainDate, dayExists = dayFileExists): Promise<string | null> {
  let last: string | null = null
  for (let offset = 0; offset < 14; offset++) {
    const day = today.addDays(offset)
    if (!(await dayExists(day))) break
    last = day.ymd
  }
  return last
}

/** How many items wait under `## Next` in a next-* file's markdown. */
export function countWaitingIn(markdown: string): number {
  return ListDocument.fromMarkdown(markdown).lists.find((list) => list.title === 'Next')?.items.length ?? 0
}

/** The same, read from disk; 0 when there is no file. */
export async function countWaiting(file: string): Promise<number> {
  if (!(await exists(file))) return 0
  return countWaitingIn(await readTextFile(file))
}

/**
 * Decide where a placed item goes. Decided before it is written so the
 * ledger can say it in the person's words: "Tomorrow · Todos",
 * "Fri 13 Mar · Commitments", "Mon 16 Mar · schedule", "Next".
 */
export async function planActionItemRoute(
  item: { text: string; when: PlaceWhen },
  today: string,
  dayExists = dayFileExists,
): Promise<ActionItemRoute> {
  const date = item.when.date !== null && item.when.date >= today ? item.when.date : null
  if (date === null) return { kind: 'next', task: item.text, destination: 'Next' }

  // The HH:MM prefix is the day-item convention, and how day:schedule:update
  // recognizes a Commitment when it drains the schedule file on the morning.
  const time = item.when.time !== null ? normalizeClock(item.when.time) : null
  const task = time !== null ? `${time} > ${item.text}` : item.text
  const when = new PlainDate(date)
  const created = await dayExists(when)
  const destination = placeDestination({ date, time }, today, created ? date : null)

  if (created && time !== null) return { kind: 'commitments', task, when, destination }
  return { kind: 'todo', task, when, destination }
}

/** What runs the list commands: `tasks` in a command, a recorder in a test. */
export interface RouteRunner {
  run(name: string, args?: Record<string, unknown>): Promise<{ ok: boolean; message?: string }>
}

/**
 * Write the item where the route says. The list is named on every call: a
 * composed command inherits its caller's arguments, and meeting:new's
 * category — "Professional Complete", the list a meeting is filed under —
 * would otherwise reach next:add and day:todo:add as theirs, which have no
 * list by that name.
 */
export async function executeActionItemRoute(route: ActionItemRoute, tasks: RouteRunner): Promise<void> {
  if (route.kind === 'commitments') {
    await writeDayItems(route.when, 'Professional Commitments', route.task)
    return
  }
  // day:todo:add itself forks on whether the day file exists yet: into its
  // Todos list when it does, into the schedule file's date entry when not.
  const result =
    route.kind === 'next'
      ? await tasks.run('next:add', { task: route.task, category: 'Next' })
      : await tasks.run('day:todo:add', { task: route.task, when: route.when, category: 'Professional Todos' })
  if (!result.ok) {
    throw new Error(result.message ?? `${route.kind === 'next' ? 'next:add' : 'day:todo:add'} failed`)
  }
}
