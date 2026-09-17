/**
 * Beeper hands message bodies over as Matrix HTML. The notebook keeps
 * markdown, so the few tags chat networks produce are folded back into it and
 * everything else is dropped. Plain text passes through untouched.
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const point =
        code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10)
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole
    }
    return ENTITIES[code.toLowerCase()] ?? whole
  })
}

/** A message body as markdown: links, emphasis, code and line breaks kept; other markup removed. */
export function beeperText(body: string | undefined): string {
  const raw = body ?? ''
  if (!/<[a-z!/]/i.test(raw)) return raw.replace(/\r\n/g, '\n').trim()
  let text = raw.replace(/\r\n/g, '\n')
  // The quoted fallback of a reply repeats the message it answers.
  text = text.replace(/<mx-reply>[\s\S]*?<\/mx-reply>/gi, '')
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/(?:p|div|h[1-6]|blockquote|tr|table)>/gi, '\n\n')
  text = text.replace(/<li[^>]*>/gi, '- ').replace(/<\/li>/gi, '\n')
  text = text.replace(/<(?:ul|ol)[^>]*>|<\/(?:ul|ol)>/gi, '\n')
  text = text.replace(
    /<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
    (_, code: string) => `\n\`\`\`\n${code}\n\`\`\`\n`,
  )
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code: string) => `\`${code}\``)
  text = text.replace(/<(?:b|strong)>([\s\S]*?)<\/(?:b|strong)>/gi, (_, inner: string) => `**${inner}**`)
  text = text.replace(/<(?:i|em)>([\s\S]*?)<\/(?:i|em)>/gi, (_, inner: string) => `_${inner}_`)
  text = text.replace(/<(?:s|del|strike)>([\s\S]*?)<\/(?:s|del|strike)>/gi, (_, inner: string) => `~~${inner}~~`)
  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner: string) =>
    inner
      .trim()
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n'),
  )
  text = text.replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
    const target = decodeEntities(href)
    const plain = decodeEntities(label.replace(/<[^>]+>/g, '')).trim()
    return plain && plain !== target ? `[${plain}](${target})` : target
  })
  text = text.replace(/<[^>]+>/g, '')
  text = decodeEntities(text)
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
