import slugify from '#lib/string/slugify.ts'
import { Instant, instantNow, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { WorkstreamError } from './types.ts'

/** Display creation time in the owner's timezone while keeping record timestamps in UTC. */
export function workstreamIdentityTime(timezone = ZonedDateTime.now().timezone, instant = instantNow()): string {
  return Instant.from(instant).toZonedDateTimeISO(timezone).toPlainDateTime().toString({ smallestUnit: 'second' })
}

function boundedSlug(words: string[], limit: number): string {
  const selected = words.slice(0, 6)
  while (selected.length > 1 && selected.join('-').length > limit) selected.pop()
  return selected.join('-').slice(0, limit)
}

/** The creation name is descriptive; later title edits never change the identity. */
export function readableWorkstreamId(
  input: { title?: string; intent?: string; outcome?: string },
  identityTime: string,
): string {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::([0-5]\d))?$/.exec(identityTime)
  if (!match) throw new WorkstreamError('Use a local creation time in YYYY-MM-DD HH:mm:ss format.')
  const [, date, hour, minute, second = '00'] = match
  const local = new PlainDateTime(`${date} ${hour}:${minute}`).normalize()
  if (local.toString() !== `${date} ${hour}:${minute}`)
    throw new WorkstreamError('Use a valid local creation date and time.')
  const timestamp = `${date}_${hour}-${minute}-${second}`
  const words = [input.title, input.intent, input.outcome, 'Workstream']
    .map((value) =>
      slugify((value ?? '').replace(/[_\s]+/g, ' ').trim(), { preserveCase: true })
        .split(/[-_]+/)
        .filter(Boolean),
    )
    .find((parts) => parts.length)!
  return `${timestamp}_${boundedSlug(words, 96 - timestamp.length - 1)}`
}

/** Reserve space for a suffix only after a real identity or folder collision. */
export function collidingWorkstreamId(base: string, collision: number): string {
  const suffix = `-${collision}`
  const [date, time, slug] = base.split('_')
  const timestamp = `${date}_${time}_`
  return `${timestamp}${boundedSlug(slug.split('-'), 96 - timestamp.length - suffix.length)}${suffix}`
}
