/** Completeness is in the body, never the short YAML summary/title. */
export function videoContent(body: string): { summary: boolean; transcript: boolean; transcriptText: string } {
  const lines = body.split(/\r?\n/)
  const headings: { line: number; level: number; name: string }[] = []
  let fenced = false
  for (const [line, text] of lines.entries()) {
    if (/^\s*(?:```|~~~)/.test(text)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const match = text.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (match)
      headings.push({
        line,
        level: match[1].length,
        name: match[2]
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .trim(),
      })
  }
  let summary = false
  let transcriptText = ''
  for (const [i, heading] of headings.entries()) {
    const end = headings.slice(i + 1).find((next) => next.level <= heading.level)?.line ?? lines.length
    const text = lines
      .slice(heading.line + 1, end)
      .join('\n')
      .trim()
    if (!substantiveVideoText(text)) continue
    if (
      /^(?:(?:ai|imported|video|executive|meeting|conversation) )*(?:summary|overview|synopsis|recap|tl dr)\b/.test(
        heading.name,
      )
    )
      summary = true
    if (/\b(?:full )?transcript\b/.test(heading.name) && !/summary|notes|corrections/.test(heading.name))
      transcriptText ||= text
  }
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

/** Append only missing sections; every byte of the person's original body remains. */
export function completeVideoBody(body: string, generated: { body?: string; cleanedText?: string }): string {
  const current = videoContent(body)
  const additions: string[] = []
  if (!current.summary && generated.body) {
    if (!videoContent(generated.body).summary) throw new Error('The generated write-up has no substantive summary.')
    additions.push(`## Imported summary\n\n${generated.body.trim().replace(/^(#{1,5}) /gm, '#$1 ')}`)
  }
  if (!current.transcript && generated.cleanedText) {
    if (!substantiveVideoText(generated.cleanedText)) throw new Error('The transcript contains no usable words.')
    additions.push(`## Transcript\n\n${generated.cleanedText.trim()}`)
  }
  return additions.length
    ? `${body}${body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n'}${additions.join('\n\n')}\n`
    : body
}
