import { actionKindRel } from '#shared/nbfs/mod.ts'
import type { PlainDateTime } from '#universal/dates/nbdt/mod.ts'

/**
 * Build the day-relative path for a message document.
 *
 * Named `HH-MM_<medium>_<slug>.md`, using the same time prefix that
 * the day's chats folder already uses, so the directory lists in the order the
 * day actually happened — the same order as the day file's Complete list.
 * Without the prefix the directory sorts by medium and then sender, which
 * says nothing about the shape of the day: on a thirty-message day the
 * clusters, gaps, and batch captures are all invisible.
 *
 * The prefix comes from the message's recorded `when`, not from the time of
 * writing, so a backfilled message still files in its own place in the day.
 */
export default function messageFileName(when: PlainDateTime, medium: string, slug: string): string {
  return `${actionKindRel('message')}/${when.time.replace(':', '-')}_${medium}_${slug}.md`
}
