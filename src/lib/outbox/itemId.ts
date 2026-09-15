import { z } from 'zod'
import slugify from '#lib/string/slugify.ts'

const LEGACY_ID = /^[a-f0-9]{32}$/
// Minutes, not the seconds of the AGENTS.md default: the owner chose the shorter
// form on 2026-09-14. Saved messages are stamped to the minute, and a namesake
// in the same minute takes a numeric suffix.
const READABLE_ID = /^\d{4}-\d{2}-\d{2}_\d{4}_[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/
const SLUG = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/
const LOCAL_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/
const MAX_NAMESAKES = 999

/**
 * Two id shapes are valid everywhere an item id is accepted.
 * The legacy shape is a 32-character hash.
 * The readable shape is `YYYY-MM-DD_HHMM_Slug`, for example `2026-09-12_1705_Approve-the-Atlas-pilot-budget`.
 */
export function isOutboxItemId(id: string): boolean {
  return LEGACY_ID.test(id) || READABLE_ID.test(id)
}

export const OutboxItemId = z.string().refine(isOutboxItemId, { message: 'Invalid Outbox item id.' })

/** The shared writing draft names its Outbox item as `outbox:<id>`. */
export function outboxDraftItemId(source: string): string | undefined {
  if (!source.startsWith('outbox:')) return undefined
  const id = source.slice('outbox:'.length)
  return isOutboxItemId(id) ? id : undefined
}

/** Up to six title words, capitalization preserved. An unusable title falls back to `Reply`. */
export function outboxItemSlug(title: string): string {
  const slug = slugify(title, { preserveCase: true, suggestedWords: 6 })
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return SLUG.test(slug) ? slug : 'Reply'
}

/**
 * Allocate a readable id once, when a record is first written.
 * `at` is the notebook-local `YYYY-MM-DD HH:MM`; extended hours stay as written.
 * `taken` reports whether a candidate is already in use and drives the `-2`, `-3` suffix.
 */
export async function newOutboxItemId(input: {
  at: string
  title: string
  taken: (id: string) => Promise<boolean>
}): Promise<string> {
  const match = LOCAL_TIME.exec(input.at.trim())
  if (!match) throw new Error('An Outbox item id needs a notebook-local date and time.')
  const [, date, hours, minutes] = match
  const base = `${date}_${hours.padStart(2, '0')}${minutes}_${outboxItemSlug(input.title)}`
  for (let attempt = 1; attempt <= MAX_NAMESAKES; attempt++) {
    const id = attempt === 1 ? base : `${base}-${attempt}`
    if (!(await input.taken(id))) return id
  }
  throw new Error('Too many Outbox items share this name. Try again later.')
}
