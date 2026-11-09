interface VideoSection {
  start: number
  end: number
  level: number
  name: string
  content: string
}

const SUMMARY_HEADING =
  /^(?:(?:ai|imported|video|executive|meeting|conversation) )*(?:summary|overview|synopsis|recap|tl dr)\b/

function transcriptHeading(name: string): boolean {
  return /\b(?:full )?transcript\b/.test(name) && !/\b(?:summary|notes?|corrections)\b/.test(name)
}

function videoSections(body: string): VideoSection[] {
  const headings: { start: number; contentStart: number; level: number; name: string }[] = []
  let fenced = false
  for (const line of body.matchAll(/[^\n]*(?:\n|$)/g)) {
    const text = line[0].replace(/\r?\n$/, '')
    if (/^\s*(?:```|~~~)/.test(text)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const match = text.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (match)
      headings.push({
        start: line.index,
        contentStart: line.index + line[0].length,
        level: match[1].length,
        name: match[2]
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .trim(),
      })
  }
  return headings.map((heading, index) => {
    const end = headings.slice(index + 1).find((next) => next.level <= heading.level)?.start ?? body.length
    return { ...heading, end, content: body.slice(heading.contentStart, end) }
  })
}

/** Completeness is in the body, never the short YAML summary/title. */
export function videoContent(body: string): { summary: boolean; transcript: boolean; transcriptText: string } {
  const sections = videoSections(body).filter((section) => substantiveVideoText(section.content))
  const summary = sections.some((section) => SUMMARY_HEADING.test(section.name))
  const transcripts = sections.filter((section) => transcriptHeading(section.name))
  const transcript = transcripts.find((section) => /^(?:full )?transcript$/.test(section.name)) ?? transcripts[0]
  const transcriptText = transcript?.content.trim().replace(/\r\n/g, '\n') ?? ''
  return { summary, transcript: Boolean(transcriptText), transcriptText }
}

export function substantiveVideoText(text: string): boolean {
  const plain = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*(?:```|~~~).*$/gm, '')
    .replace(/^\s*#{1,6}\s+.*$/gm, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .filter(
      (line) =>
        !/^\s*\(?\s*(?:(?:insert|add|paste|write).*?(?:summary|transcript).*|(?:summary|transcript) (?:here|goes here|pending)|tbd|todo|n\/?a)\s*\)?\s*$/i.test(
          line,
        ),
    )
    .join(' ')
  return (plain.match(/[\p{L}\p{N}]+/gu) ?? []).length >= 3
}

function placeholderSection(content: string): boolean {
  return content
    .split(/\r?\n/)
    .every(
      (line) =>
        !line.trim() ||
        /^\s*\(?\s*(?:(?:insert|add|paste|write) (?:summary|transcript) here|(?:summary|transcript) (?:here|goes here|pending)|tbd|todo|n\/?a)\s*\)?\s*$/i.test(
          line,
        ),
    )
}

function appendSection(body: string, section: string): string {
  const separator = !body || /\r?\n\r?\n$/.test(body) ? '' : /\r?\n$/.test(body) ? '\n' : '\n\n'
  return `${body}${separator}${section}\n`
}

/** Fill missing content before the transcript, preserving authored notes and existing transcript text. */
export function completeVideoBody(body: string, generated: { body?: string; cleanedText?: string }): string {
  const current = videoContent(body)
  let completed = body
  if (!current.summary && generated.body) {
    if (!videoContent(generated.body).summary) throw new Error('The generated write-up has no substantive summary.')
    const summary = `## Imported summary\n\n${generated.body.trim().replace(/^(#{1,5}) /gm, '#$1 ')}`
    const sections = videoSections(completed)
    const transcript = sections.find((section) => transcriptHeading(section.name))
    const placeholder = sections.find(
      (section) =>
        section.level === 2 &&
        SUMMARY_HEADING.test(section.name) &&
        placeholderSection(section.content) &&
        (!transcript || section.start < transcript.start),
    )
    const insertion = placeholder ?? transcript
    completed = insertion
      ? `${appendSection(completed.slice(0, insertion.start), summary)}\n${completed.slice(placeholder?.end ?? insertion.start)}`
      : appendSection(completed, summary)
  }
  if (!current.transcript && generated.cleanedText) {
    if (!substantiveVideoText(generated.cleanedText)) throw new Error('The transcript contains no usable words.')
    const placeholder = videoSections(completed).find(
      (section) => section.level === 2 && transcriptHeading(section.name) && placeholderSection(section.content),
    )
    if (placeholder) completed = completed.slice(0, placeholder.start) + completed.slice(placeholder.end)
    completed = appendSection(completed, `## Transcript\n\n${generated.cleanedText.trim()}`)
  }
  return completed
}
