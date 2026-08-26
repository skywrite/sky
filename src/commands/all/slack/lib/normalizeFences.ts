const BLOCKQUOTE_PREFIX = /^(?:> ?)+/

/**
 * Split Slack-glued ``` fences onto their own lines.
 *
 * Slack mrkdwn allows a code block to open or close mid-line
 * (```like this``` or ```first line\nrest```), but markdown fences only
 * delimit a block when they sit alone on a line. Slack mrkdwn has no
 * language tags — anything after ``` is content — so a leading fence is
 * always split, never treated as ```lang.
 *
 * Blockquote prefixes ('> ') are preserved on every emitted line so a block
 * quoted inside a message stays inside the quote. Lines with interior ```
 * beyond the boundary fences are left untouched: pairing can't be inferred
 * line-locally, and a wrong split would unbalance the rest of the document.
 */
export default function normalizeFences(text: string): string {
  return text
    .split('\n')
    .flatMap((line) => splitFenceLine(line) ?? [line])
    .join('\n')
}

function splitFenceLine(line: string): string[] | undefined {
  const prefix = BLOCKQUOTE_PREFIX.exec(line)?.[0] ?? ''
  const body = line.slice(prefix.length)
  const stripped = body.trimEnd()
  if (/^`+$/.test(stripped)) return undefined // bare fence already on its own line
  const starts = stripped.startsWith('```') && !stripped.startsWith('````')
  const ends = stripped.length > 3 && stripped.endsWith('```') && !stripped.endsWith('````')
  if (!starts && !ends) return undefined
  let mid = stripped
  if (starts) mid = mid.slice(3)
  if (ends) mid = mid.slice(0, -3)
  if (mid.trim() === '' || mid.includes('```')) return undefined
  const out: string[] = []
  if (starts) out.push(`${prefix}\`\`\``)
  out.push(prefix + mid)
  if (ends) out.push(`${prefix}\`\`\``)
  return out
}
