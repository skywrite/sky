/**
 * Action items carried out of a transcript summary.
 *
 * The pipeline's metadata-extract call is the primary source — it returns the
 * summary's action-item bullets as structured entries and resolves relative due
 * phrases ("Friday", "in two weeks") to absolute dates. parseActionItemsSection
 * is the deterministic fallback when that call fails or omits the field: it can
 * read the bullets but never resolve a date, so fallback items come back
 * undated.
 */

export interface TranscriptActionItem {
  text: string
  /**
   * True when the item is the notebook owner's: under `## Action Items (me)`,
   * or marked "(me)" in a legacy single `## Action Items` section.
   */
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

// Ownership comes from which section a bullet sits in. The legacy single
// section carries no ownership itself — its "(me)" markers do — and a stray
// marker inside a split section still counts as a claim of ownership.
const SECTION_OWNERSHIP: Record<string, boolean> = {
  'action items (me)': true,
  'action items (others)': false,
  'action items': false,
}

function bulletToItem(bullet: string, sectionMine: boolean): TranscriptActionItem {
  const mine = sectionMine || /\(\s*me\s*[),]/i.test(bullet)
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
 * Fallback: read the bullets under the action-item sections straight from the
 * summary body — "## Action Items (me)" / "## Action Items (others)", or the
 * legacy single "## Action Items" section. A "(me)" marker is detected and
 * then stripped from the text either way.
 */
function actionItemBullets(body: string) {
  const bullets: { text: string; sectionMine: boolean; start: number; end: number }[] = []
  const lines = body.split('\n')
  const sections: { mine: boolean; legacy: boolean; start: number; end: number }[] = []
  let sectionMine: boolean | null = null
  let section: (typeof sections)[number] | null = null
  let fence: string | null = null

  for (const [index, line] of lines.entries()) {
    const code = line.match(/^\s*(`{3,}|~{3,})/)
    if (code) {
      if (fence === null) fence = code[1]
      else if (code[1][0] === fence[0] && code[1].length >= fence.length) fence = null
      continue
    }
    if (fence !== null) continue
    const header = line.match(/^#{1,6}\s+(.+?)\s*$/)
    if (header) {
      if (section) section.end = index
      section = null
      sectionMine = SECTION_OWNERSHIP[header[1].toLowerCase()] ?? null
      if (sectionMine !== null) {
        section = {
          mine: sectionMine,
          legacy: header[1].toLowerCase() === 'action items',
          start: index,
          end: lines.length,
        }
        sections.push(section)
      }
      continue
    }
    if (sectionMine === null) continue

    const bullet = line.match(/^[-*]\s+(.*\S)\s*$/)
    if (bullet) {
      bullets.push({ text: bullet[1], sectionMine, start: index, end: index + 1 })
    } else if (bullets.at(-1)?.end === index && /^\s+\S/.test(line)) {
      // Indented continuation of the previous bullet
      bullets[bullets.length - 1].text += ` ${line.trim()}`
      bullets[bullets.length - 1].end = index + 1
    }
  }

  return { bullets: bullets.filter((b) => bulletToItem(b.text, b.sectionMine).text.length > 0), sections }
}

export function parseActionItemsSection(body: string): TranscriptActionItem[] {
  return actionItemBullets(body).bullets.map((b) => bulletToItem(b.text, b.sectionMine))
}

/** Replace only edited bullets; keep the other notes, headings, and frontmatter verbatim. */
export function editActionItemsSection(
  body: string,
  edits: ReadonlyMap<number, string>,
  additions: TranscriptActionItem[],
): string {
  const lines = body.split('\n')
  const { bullets } = actionItemBullets(body)
  for (let i = bullets.length - 1; i >= 0; i--) {
    const text = edits.get(i)
    if (text === undefined) continue
    const b = bullets[i]
    const prefix = lines[b.start].match(/^[-*]\s+(?:\[[ xX]\]\s*)?/)?.[0] ?? '- '
    const marker = !b.sectionMine && bulletToItem(b.text, b.sectionMine).mine ? ' (me)' : ''
    lines.splice(b.start, b.end - b.start, `${prefix}${text}${marker}`)
  }
  for (const mine of [true, false]) {
    const added = additions.filter((item) => item.mine === mine)
    if (added.length === 0) continue
    const heading = `## Action Items (${mine ? 'me' : 'others'})`
    const { sections } = actionItemBullets(lines.join('\n'))
    const section =
      sections.find((entry) => !entry.legacy && entry.mine === mine) ?? sections.find((entry) => entry.legacy)
    const newLines = added.map((item) => `- ${item.text}${section?.legacy && mine ? ' (me)' : ''}`)
    if (!section) {
      while (lines.at(-1) === '') lines.pop()
      lines.push('', heading, '', ...newLines, '')
    } else {
      let end = section.end
      while (end > section.start + 1 && lines[end - 1].trim() === '') end--
      lines.splice(end, 0, ...newLines)
    }
  }
  return lines.join('\n')
}
