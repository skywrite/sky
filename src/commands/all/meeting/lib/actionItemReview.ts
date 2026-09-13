import type { PlaceAnswer, PlacePrompt } from '#commands/lib/prompt/Prompter.ts'
import {
  editActionItemsSection,
  parseActionItemsSection,
  type TranscriptActionItem,
} from '#lib/notebook/actionItems.ts'
import MeetingDocument from '#shared/models/Meeting/mod.ts'
import type { DocumentIO, DocumentSnapshot } from '#shared/models/Person/write.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { normalizeClock, type PlaceWhen } from '#universal/dates/whenLabel/mod.ts'

export interface ActionItemReview {
  source: NonNullable<PlacePrompt['source']>
  snapshot: DocumentSnapshot
  items: TranscriptActionItem[]
}

/** Read the filed notes on fresh runs and resumes, so earlier corrections remain authoritative. */
export async function loadActionItemReview(
  file: string,
  extracted: TranscriptActionItem[],
  io: DocumentIO,
): Promise<ActionItemReview> {
  const snapshot = await io.read(file)
  if (!snapshot) throw new Error('The meeting notes could not be found.')
  const meeting = MeetingDocument.fromMarkdown(snapshot.content)
  const parsed = parseActionItemsSection(meeting.markdown)
  const remaining = [...extracted]
  const items = parsed.map((item) => {
    // Extraction can paraphrase a bullet. In that case keep the notes' words
    // and match dates in order within the same ownership group.
    let index = remaining.findIndex((entry) => entry.text === item.text && entry.mine === item.mine)
    if (index < 0) index = remaining.findIndex((entry) => entry.mine === item.mine)
    const timing = index < 0 ? undefined : remaining.splice(index, 1)[0]
    return { ...item, date: timing?.date ?? null, time: timing?.time ?? null }
  })
  return {
    snapshot,
    source: {
      title: meeting.summary || (meeting.who ? `Meeting with ${meeting.who}` : 'Meeting'),
      when: meeting.when.toYaml(),
      who: meeting.who,
      file,
    },
    items: parsed.length > 0 ? items : extracted,
  }
}

function validWhen(when: PlaceWhen): PlaceWhen {
  if (!when || (when.date !== null && typeof when.date !== 'string')) throw new Error('Choose a day for each item.')
  const date = when.date === null ? null : new PlainDate(when.date).ymd
  const time = when.time === null ? null : typeof when.time === 'string' ? normalizeClock(when.time) : null
  if (when.time !== null && time === null) throw new Error('Choose a valid time for each item.')
  return { date, time: date === null ? null : time }
}

/** Save every text edit, including unchecked rows, before returning the tasks to route. */
export async function saveActionItemReview(review: ActionItemReview, answer: PlaceAnswer, io: DocumentIO) {
  if (!Array.isArray(answer)) throw new Error('The action-item review is invalid.')
  const items = review.items.map((item) => ({ ...item }))
  const edits = new Map<number, string>()
  const additions: TranscriptActionItem[] = []
  const accepted: { index: number; text: string; when: PlaceWhen }[] = []
  const seen = new Set<string>()
  for (const row of answer) {
    if (!row || typeof row.value !== 'string' || seen.has(row.value))
      throw new Error('The action-item review is invalid.')
    seen.add(row.value)
    const added = /^new-\d+$/.test(row.value)
    const index = added ? items.length : Number(row.value)
    if (!added && (!/^\d+$/.test(row.value) || String(index) !== row.value || index >= review.items.length)) {
      throw new Error('An action item could not be found. Reopen the review.')
    }
    if (row.accepted !== undefined && typeof row.accepted !== 'boolean')
      throw new Error('Choose which items to accept.')
    if (row.label !== undefined && typeof row.label !== 'string')
      throw new Error('Each action item needs a description.')
    const text = (row.label === undefined ? items[index]?.text : row.label)?.replace(/\s*\r?\n\s*/g, ' ').trim()
    if (!text) throw new Error('Each action item needs a description.')
    const when = validWhen(row.when)
    if (added) {
      const item = { text, mine: true, date: when.date, time: when.time }
      items.push(item)
      additions.push(item)
    } else if (text !== items[index].text) {
      items[index].text = text
      edits.set(index, text)
    }
    if (row.accepted !== false) accepted.push({ index, text, when })
  }

  if (edits.size > 0 || additions.length > 0) {
    const baseline = parseActionItemsSection(review.snapshot.content)
    let current = await io.read(review.source.file)
    for (let attempt = 0; ; attempt++) {
      if (!current) throw new Error('The meeting notes could not be found. No tasks were created.')
      if (JSON.stringify(parseActionItemsSection(current.content)) !== JSON.stringify(baseline)) {
        throw new Error(
          'The meeting’s action items changed during review. Reopen the review to use the latest notes. No tasks were created.',
        )
      }
      const content = editActionItemsSection(current.content, edits, baseline.length > 0 ? additions : items)
      const result = await io.save(review.source.file, content, current.version)
      if (result.saved) break
      if (attempt >= 2)
        throw new Error('The meeting notes are still changing. Try the review again. No tasks were created.')
      current = result.current
    }
  }
  return { items, accepted: accepted.sort((a, b) => a.index - b.index) }
}

/** Notebook-root links survive moving a task between days, the schedule, and Next. */
export function actionItemWithSource(text: string, source: ActionItemReview['source']): string {
  const title = `${source.title} · ${source.when.slice(0, 10)}`.replace(/[\\[\]]/g, '\\$&')
  const href = `/${source.file
    .split('/')
    .map((part) => encodeURIComponent(part).replaceAll('(', '%28').replaceAll(')', '%29'))
    .join('/')}`
  return `${text} — [${title}](${href})`
}
