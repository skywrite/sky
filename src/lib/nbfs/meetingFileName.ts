import { actionKindRel } from '#shared/nbfs/mod.ts'
import type { PlainDateTime } from '#universal/dates/nbdt/mod.ts'

/**
 * Build the day-relative path for a meeting document.
 *
 * Named `HH-MM_<medium>_<who>_<summary>.md`, carrying the same time prefix
 * the messages and chats folders already use, so every action
 * directory in a day lists in the order the day happened. Without it
 * the meetings folder sorts by medium and then attendee — every Zoom ahead of
 * every phone call — which is the one ordering the day never happened in, and
 * it disagrees with the day file's Complete list, which is chronological.
 *
 * The prefix is the meeting's start time, taken from its recorded `when`
 * rather than the time of writing, so a meeting written up hours later — or a
 * recording transcribed the next morning — still files where it happened.
 *
 * Sibling of `messageFileName`: same convention, different directory.
 */
export default function meetingFileName(when: PlainDateTime, slug: string): string {
  return `${actionKindRel('meeting')}/${when.time.replace(':', '-')}_${slug}.md`
}
