/**
 * Action items carried out of a transcript summary.
 *
 * The pipeline's metadata-extract call is the primary source — it returns the
 * `## Action Items` bullets as structured entries and resolves relative due
 * phrases ("Friday", "in two weeks") to absolute dates. parseActionItemsSection
 * is the deterministic fallback when that call fails or omits the field: it can
 * read the bullets but never resolve a date, so fallback items come back
 * undated.
 */

export interface TranscriptActionItem {
  text: string
  /** True when the summary marks the item as the notebook owner's ("(me)"). */
  mine: boolean
  /** Committed day (YYYY-MM-DD), or null when the item is undated. */
  date: string | null
  /** Clock time (HH:MM) when the commitment names one, else null. */
  time: string | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^(\d{1,2}):(\d{2})$/

function normalizeEntry(raw: unknown): TranscriptActionItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const entry = raw as Record<string, unknown>
  const text = typeof entry.text === 'string' ? entry.text.trim() : ''
  if (!text) return null

  const date = typeof entry.date === 'string' && DATE_RE.test(entry.date) ? entry.date : null

  // A time is only usable anchored to a day, so it rides along with a date.
  let time: string | null = null
  if (date !== null && typeof entry.time === 'string') {
    const match = entry.time.match(TIME_RE)
    if (match) time = `${match[1].padStart(2, '0')}:${match[2]}`
  }

  return { text, mine: entry.mine === true, date, time }
}

/** Normalize the extract call's actionItems payload, tolerating any malformed shape. */
export function normalizeActionItems(raw: unknown): TranscriptActionItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeEntry).filter((item): item is TranscriptActionItem => item !== null)
}

const ME_MARKER_RE = /\(\s*me\s*\)/gi
const ME_IN_PAREN_RE = /\(\s*me\s*,\s*/gi

function bulletToItem(bullet: string): TranscriptActionItem {
  const mine = /\(\s*me\s*[),]/i.test(bullet)
  const text = bullet
    .replace(/^\[[ xX]\]\s*/, '')
    .replace(ME_MARKER_RE, '')
    .replace(ME_IN_PAREN_RE, '(')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim()
    .replace(/^[-–—:,]\s*/, '')
    .replace(/[\s,;:–—-]+$/, '')
  return { text, mine, date: null, time: null }
}

/**
 * Fallback: read the bullets under "## Action Items" straight from the summary
 * body. The "(me)" marker is detected and then stripped from the text.
 */
export function parseActionItemsSection(body: string): TranscriptActionItem[] {
  const bullets: string[] = []
  let inSection = false

  for (const line of body.split('\n')) {
    const header = line.match(/^#{1,6}\s+(.+?)\s*$/)
    if (header) {
      inSection = header[1].toLowerCase() === 'action items'
      continue
    }
    if (!inSection) continue

    const bullet = line.match(/^[-*]\s+(.*\S)\s*$/)
    if (bullet) {
      bullets.push(bullet[1])
    } else if (bullets.length > 0 && /^\s+\S/.test(line)) {
      // Indented continuation of the previous bullet
      bullets[bullets.length - 1] += ` ${line.trim()}`
    }
  }

  return bullets.map(bulletToItem).filter((item) => item.text.length > 0)
}
