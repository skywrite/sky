import { PlainDate, When } from '#universal/dates/nbdt/mod.ts'

export const NOTE_DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.xlsx', '.md']

export function isNoteDocument(name: string): boolean {
  return NOTE_DOCUMENT_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension))
}

export function documentActivity(name: string): string {
  const title = name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
  return `Worked on ${title || 'the document'}`
}

/** The work's clock is stated by the person; document dates never supply it. */
export function documentWorkWhen(value: string): When {
  const normalized = value.trim().replace(/[–—]/g, '-')
  const match = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:[0-5]\d)(?:\s*-\s*(\d{1,2}:[0-5]\d))?$/.exec(normalized)
  if (!match) throw new Error('Enter a date and time, with an optional range: 2026-01-27 15:30 - 16:30.')
  if (new PlainDate(match[1]).toString() !== match[1]) throw new Error('Enter a valid date.')
  return When.fromYaml(normalized)
}

export function workDurationLabel(minutes: number | null): string | null {
  if (minutes === null) return null
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return [hours ? `${hours} hour${hours === 1 ? '' : 's'}` : '', rest ? `${rest} min` : ''].filter(Boolean).join(' ')
}
