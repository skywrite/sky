/**
 * Slack's mrkdwn as markdown, so a message bound for Slack reads on the
 * page the way it will read there: bold, italic, strike, code, quotes,
 * bullets, and labelled links. Code spans and fences pass through
 * untouched; every other line break is a real one, as Slack shows it.
 */

export function slackToMarkdown(text: string): string {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/)
  const converted = parts.map((part, i) => (i % 2 === 1 ? part : prose(part))).join('')
  return breaks(converted)
}

function prose(text: string): string {
  return text
    .replace(/<(https?:\/\/[^|>\s]+)\|([^>]+)>/g, '[$2]($1)')
    .replace(/<(https?:\/\/[^>\s]+)>/g, '[$1]($1)')
    .replace(/<@([A-Z0-9]+)>/g, '@$1')
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![*\w])/g, '$1**$2**')
    .replace(/(^|[^_\w])_(?!\s)([^_\n]+?)(?<!\s)_(?![_\w])/g, '$1*$2*')
    .replace(/(^|[^~\w])~(?!\s)([^~\n]+?)(?<!\s)~(?![~\w])/g, '$1~~$2~~')
    .replace(/^(\s*)•\s+/gm, '$1- ')
}

/** A line followed by another line breaks there; a quote ends where the quoting stops. */
function breaks(text: string): string {
  const lines = text.split('\n')
  let inFence = false
  return lines
    .map((line, i) => {
      if (line.trim().startsWith('```')) {
        inFence = !inFence
        return line
      }
      if (inFence) return line
      const next = lines[i + 1]
      if (line.trim() === '' || next === undefined || next.trim() === '') return line
      if (line.startsWith('>') && !next.startsWith('>')) return `${line}\n`
      return `${line.replace(/\s+$/, '')}  `
    })
    .join('\n')
}
