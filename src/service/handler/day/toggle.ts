/**
 * One item, marked done or not done — the day view's checkbox, done as a
 * line edit. The item is addressed by its list heading and its text
 * (strike marks ignored), so a stale view misses (and reloads) instead
 * of striking a neighbour — and every other byte of the day file stays
 * untouched.
 *
 * The struck forms are Day.isItemDone's own: `~~task~~`, and for a timed
 * item `HH:MM > ~~task~~` — the time stays outside the strike, readable.
 *
 * A line edit rather than the ListDocument remove/insert dance on
 * purpose: `replaceList` swaps list markdown by string match, which
 * silently no-ops when the file spells a list differently than
 * `ItemList.toMarkdown` does (a blank line after the heading is enough).
 * A checkbox must never report "done" over an unchanged file.
 */

import DayDocument from '#shared/models/Day/mod.ts'

export type ToggleResult =
  | { kind: 'written'; content: string }
  /** Already in the asked-for state — nothing to write */
  | { kind: 'unchanged' }
  /** No such list, or no item with that text — the view is stale */
  | { kind: 'missing' }

const HEADING = /^##\s+(.+?)\s*$/
const BULLET = /^(\s*[-*+]\s+)(.*?)(\s*)$/
const TIMED = /^(\d{1,2}:\d{2}\s*>\s*)(.+)$/

/** The item's text with strike marks off — what names it across states. */
function plain(text: string): string {
  return text.replace(/~~/g, '').trim()
}

/** `09:30 > task` strikes as `09:30 > ~~task~~`; anything else wraps whole. */
function strike(stored: string): string {
  const timed = stored.match(TIMED)
  return timed ? `${timed[1]}~~${timed[2]}~~` : `~~${stored}~~`
}

export function toggleDayItem(content: string, listTitle: string, raw: string, done: boolean): ToggleResult {
  const lines = content.split('\n')
  const wantTitle = listTitle.trim()
  const wantText = plain(raw)

  let inList = false
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(HEADING)
    if (heading) {
      inList = heading[1].trim() === wantTitle
      continue
    }
    if (!inList) continue
    const bullet = lines[i].match(BULLET)
    if (!bullet || plain(bullet[2]) !== wantText) continue
    if (DayDocument.isItemDone(bullet[2]) === done) return { kind: 'unchanged' }
    const text = done ? strike(plain(bullet[2])) : plain(bullet[2])
    lines[i] = bullet[1] + text + bullet[3]
    return { kind: 'written', content: lines.join('\n') }
  }
  return { kind: 'missing' }
}
