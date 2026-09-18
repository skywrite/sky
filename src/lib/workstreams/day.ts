import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import { atomicWrite, readOptional, withLock } from '#lib/outbox/files.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import type { WorkstreamStore } from './store.ts'
import { WorkstreamError, type Activity, type WorkstreamRecord } from './types.ts'

const REFERENCE = /\]\(\/workstreams\/([a-zA-Z0-9_-]+)\?activity=([a-zA-Z0-9_-]+)\)/
const LIST = 'Workstream Todos'
const stamp = () => new ZonedDateTime().toUTC().normalize().plainDateTime.toString()

export function workstreamDayReference(raw: string): { workstreamId: string; activityId: string } | null {
  const match = REFERENCE.exec(raw)
  return match ? { workstreamId: match[1], activityId: match[2] } : null
}

function activityOf(record: WorkstreamRecord, activityId: string): Activity {
  const activity = record.activities.find((item) => item.id === activityId)
  if (!activity)
    throw new WorkstreamError('The linked activity is missing. Open its workstream to repair the link.', 404)
  return activity
}

function checkedDay(day: string): PlainDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new WorkstreamError('Expected a date in YYYY-MM-DD format.')
  return new PlainDate(day)
}

function row(record: WorkstreamRecord, activity: Activity, title: string, done: boolean): string {
  const label = title.replace(/[\[\]\r\n]/g, ' ').trim()
  const raw = `[${label}](/workstreams/${record.id}?activity=${activity.id})`
  return done ? `~~${raw}~~` : raw
}

export type WorkstreamDayOptions = { store: WorkstreamStore; timeDir: string; now?: () => string }

/** The canonical participation is saved first. Repeating a request repairs an interrupted day projection. */
export async function planWorkstreamDay(
  options: WorkstreamDayOptions,
  id: string,
  activityId: string,
  day: string,
  revision: string,
): Promise<WorkstreamRecord> {
  const date = checkedDay(day)
  let record = await options.store.get(id)
  if (!record) throw new WorkstreamError('No such workstream.', 404)
  let activity = activityOf(record, activityId)
  const previous = activity.participation.find((entry) => entry.day === day)
  if (!previous || previous.removed) {
    if (record.revision !== revision)
      throw new WorkstreamError('The workstream changed. Reload before planning it.', 409)
    const now = (options.now ?? stamp)()
    const entry = { day, title: activity.title, state: activity.state, operationId: randomUUID(), removed: false }
    const next = { ...activity, participation: [...activity.participation.filter((part) => part.day !== day), entry] }
    record = await options.store.put(
      {
        ...record,
        updated: now,
        activities: record.activities.map((item) => (item.id === activityId ? next : item)),
        history: [
          ...record.history,
          {
            id: randomUUID(),
            at: now,
            actor: 'human',
            kind: 'day_planned',
            activityId,
            operationId: entry.operationId,
            summary: `Planned “${activity.title}” for ${day}.`,
          },
        ],
      },
      record.revision,
    )
    activity = activityOf(record, activityId)
  }
  const participation = activity.participation.find((entry) => entry.day === day)!
  const file = path.join(options.timeDir, dayFile(date))
  await withLock(path.join(options.store.stateDir, `day-${day}.lock`), async () => {
    let content = (await readOptional(file)) ?? `---\ncreated: ${day}\nupdated: ${day}\n---\n\n# ${day}\n`
    const document = DayDocument.fromMarkdown(content)
    if (
      document.lists.some((list) =>
        list.items.some((raw) => {
          const ref = workstreamDayReference(raw)
          return ref?.workstreamId === id && ref.activityId === activityId
        }),
      )
    )
      return
    const raw = row(record, activity, participation.title, participation.state === 'done')
    const restored = DayDocument.restoreItem(content, LIST, raw, Number.MAX_SAFE_INTEGER)
    content =
      restored.kind === 'missing'
        ? `${content.trimEnd()}\n\n## ${LIST}\n\n- ${raw}\n`
        : restored.kind === 'written'
          ? restored.content
          : content
    await atomicWrite(file, content)
  })
  return record
}

/** Called by existing day checkbox/delete/undo routes; an ordinary day item returns false. */
export async function updateWorkstreamDay(
  options: WorkstreamDayOptions,
  input: { day: string; raw: string; action: 'done' | 'reopen' | 'remove' | 'restore'; at?: number },
): Promise<boolean> {
  const ref = workstreamDayReference(input.raw)
  if (!ref) return false
  checkedDay(input.day)
  const record = await options.store.get(ref.workstreamId)
  if (!record) throw new WorkstreamError('The linked workstream is missing. Its day history is preserved.', 404)
  const activity = activityOf(record, ref.activityId)
  const participation = activity.participation.find((part) => part.day === input.day)
  if (!participation)
    throw new WorkstreamError(
      'This day reference has no recorded participation. Plan it from the workstream first.',
      409,
    )
  if (activity.subworkstreamId && (input.action === 'done' || input.action === 'reopen')) {
    throw new WorkstreamError(
      'Open the sub-workstream to update its outcome. This day entry is a reference to that work.',
      409,
    )
  }
  if (input.action === 'done' && activity.kind === 'decision') {
    throw new WorkstreamError('Open the linked decision and record your decision before completing it.', 409)
  }
  const removed =
    input.action === 'remove' ? true : input.action === 'restore' ? false : (participation.removed ?? false)
  const state = input.action === 'done' ? 'done' : input.action === 'reopen' ? 'ready' : activity.state
  const dailyState = input.action === 'done' || input.action === 'reopen' ? state : participation.state
  if (state === activity.state && dailyState === participation.state && removed === (participation.removed ?? false))
    return true
  const now = (options.now ?? stamp)()
  const operationId = randomUUID()
  const next = {
    ...activity,
    state,
    result:
      input.action === 'done' && !activity.result
        ? 'Reported complete by the owner from the day view.'
        : activity.result,
    participation: activity.participation.map((part) =>
      part.day === input.day
        ? {
            ...part,
            state: dailyState,
            removed,
            reportedAt: now,
            operationId,
            ...(input.action === 'remove' && input.at !== undefined ? { removedAt: input.at } : {}),
          }
        : part,
    ),
  }
  await options.store.put(
    {
      ...record,
      updated: now,
      activities: record.activities.map((item) => (item.id === activity.id ? next : item)),
      history: [
        ...record.history,
        {
          id: randomUUID(),
          at: now,
          actor: 'human',
          kind: `day_${input.action}`,
          activityId: activity.id,
          operationId,
          summary: `${input.day}: ${input.action} “${activity.title}”.`,
        },
      ],
    },
    record.revision,
  )
  return true
}

/** A delete response lost after the write can be retried without losing its Undo placement. */
export async function workstreamDayRemoval(
  store: WorkstreamStore,
  day: string,
  raw: string,
): Promise<{ at: number } | null> {
  const ref = workstreamDayReference(raw)
  if (!ref) return null
  const work = await store.get(ref.workstreamId)
  const entry = work?.activities
    .find((activity) => activity.id === ref.activityId)
    ?.participation.find((entry) => entry.day === day)
  return entry?.removed && typeof entry.removedAt === 'number' ? { at: entry.removedAt } : null
}

type LinkedDayItem = {
  text: string
  done: boolean
  raw: string
  link: { title: string; path: string } | null
  workstream?: { id: string; activityId: string; kind: string; error?: string }
}

/** The open current day reflects canonical work; null keeps an ended day's recorded participation. */
export async function resolveWorkstreamDayItems<T extends LinkedDayItem>(
  store: WorkstreamStore,
  day: string,
  currentDay: string | null,
  items: T[],
): Promise<T[]> {
  const result: T[] = []
  const records = new Map<string, WorkstreamRecord | null>()
  for (const item of items) {
    const ref = workstreamDayReference(item.raw)
    if (!ref) {
      result.push(item)
      continue
    }
    try {
      if (!records.has(ref.workstreamId)) records.set(ref.workstreamId, await store.get(ref.workstreamId))
      const record = records.get(ref.workstreamId)
      if (!record) throw new Error('Linked workstream unavailable')
      const activity = activityOf(record, ref.activityId)
      const participation = activity.participation.find((part) => part.day === day)
      if (participation?.removed) continue
      if (activity.subworkstreamId) {
        const child = await store.get(activity.subworkstreamId)
        if (!child) throw new Error('Linked sub-workstream unavailable')
        const title = day === currentDay ? child.title : (participation?.title ?? item.text)
        result.push({
          ...item,
          text: title,
          done:
            day === currentDay
              ? child.state === 'completed'
              : participation
                ? participation.state === 'done'
                : item.done,
          link: { title, path: `/workstreams/${child.id}` },
          workstream: { id: record.id, activityId: activity.id, kind: 'subworkstream' },
        })
        continue
      }
      const title = day === currentDay ? activity.title : (participation?.title ?? item.text)
      const done =
        day === currentDay ? activity.state === 'done' : participation ? participation.state === 'done' : item.done
      result.push({
        ...item,
        text: title,
        done,
        link: { title, path: `/workstreams/${record.id}?activity=${activity.id}` },
        workstream: { id: record.id, activityId: activity.id, kind: activity.kind },
      })
    } catch (error) {
      result.push({
        ...item,
        workstream: {
          id: ref.workstreamId,
          activityId: ref.activityId,
          kind: 'action',
          error: error instanceof Error ? error.message : 'Linked work unavailable',
        },
      })
    }
  }
  return result
}
