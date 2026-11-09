import slugify from '#lib/string/slugify.ts'

export interface VideoFileName {
  medium?: string
  from?: string
  to?: string
  summary?: string
}

/** Videos use medium/person/summary names; the day folder and metadata carry their timing. */
export function videoFileStem(input: VideoFileName): string {
  const medium = input.medium?.replace(/[\\/]/g, '-').trim() || 'Video'
  const who = slugify(input.from || input.to || '', { preserveCase: true })
  const summary = slugify(input.summary || '', { preserveCase: true, suggestedLength: 40 })
  const description = who && summary ? `${who}_${summary}` : who || summary || 'Recording'
  return `${medium}_${description}`
}

export function videoAttachmentName(date: string, stem: string, extension: string): string {
  const dated = /^\d{4}-\d{2}-\d{2}_/.test(stem) ? stem : `${date}_${stem}`
  return `${dated}${extension}`
}
