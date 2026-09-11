import { normalizeDayTime, type DayPlanKind } from './planningTypes.ts'

export type DayEditKind = DayPlanKind | 'important'
export interface DayEditFields {
  text: string
  kind: DayEditKind
  category: string
  time: string
}

/** Keep inline Markdown intact; completion and scheduling belong to separate controls. */
export function itemEditFields(item: { raw: string; list: string }): DayEditFields {
  let text = item.raw.split(/\r?\n/)[0].replace(/^~~(.*)~~$/, '$1')
  const timed = /^(\d{1,2}:\d{2})\s*>?\s*(.*)$/.exec(text)
  if (timed) text = timed[2]
  text = text.replace(/^~~(.*)~~$/, '$1').replace(/^MI\/\S+(?:\s*(?:->|→))?\s*/i, '')
  const kind = /^most important$/i.test(item.list)
    ? 'important'
    : /^reminders$/i.test(item.list)
      ? 'reminders'
      : /commitments$/i.test(item.list)
        ? 'commitments'
        : 'todos'
  const category = item.list.replace(/\s*(?:todos|commitments|incomplete)$/i, '').trim()
  return {
    text,
    kind,
    category: ['important', 'reminders'].includes(kind) || !category ? 'Professional' : category,
    time: timed ? (normalizeDayTime(timed[1]) ?? timed[1]) : '',
  }
}
