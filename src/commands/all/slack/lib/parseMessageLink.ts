export type ParsedMessageLink = {
  channelId: string
  /** Message ts in dotted API form, e.g. "1739447467.000123" */
  messageTs: string
  /** Thread root ts — the thread_ts query param when the link carries one, else the message's own ts */
  rootTs: string
}

/** p-link digits are epoch seconds + 6 fractional digits; the API's dotted form splits before the last 6 */
function toDottedTs(digits: string): string {
  return `${digits.slice(0, -6)}.${digits.slice(-6)}`
}

/**
 * Parse channel + message identity out of a Slack message link without asking
 * Slack — archive URLs (workspace or app.slack.com host) and slack://
 * deeplinks. A reply link only names its thread root when it carries a
 * thread_ts param, so a bare reply p-link parses with rootTs equal to its own
 * ts. Links that don't name a message (client views, non-Slack URLs) return
 * undefined.
 */
export default function parseMessageLink(link: string): ParsedMessageLink | undefined {
  try {
    const url = new URL(link.trim())
    const threadTs = url.searchParams.get('thread_ts') ?? undefined

    const archive = url.pathname.match(/\/archives\/([A-Z0-9]+)\/p(\d{10,})$/)
    if (archive) {
      const messageTs = toDottedTs(archive[2])
      return { channelId: archive[1], messageTs, rootTs: threadTs ?? messageTs }
    }

    if (url.protocol === 'slack:') {
      const channelId = url.searchParams.get('id')
      const message = url.searchParams.get('message') ?? ''
      const messageTs = /^\d{10,}\.\d{6}$/.test(message)
        ? message
        : /^\d{10,}$/.test(message)
          ? toDottedTs(message)
          : undefined
      if (channelId && messageTs) return { channelId, messageTs, rootTs: threadTs ?? messageTs }
    }
  } catch {
    /* not a URL */
  }
  return undefined
}
