/**
 * Shrink raw email HTML to its structural skeleton before it goes to the AI.
 *
 * Corporate mail (Word/Outlook, marketing ESPs) is routinely 40-100KB of HTML
 * for a few KB of visible text: <style> blocks, MSO conditionals, an inline
 * style= on every element, base64 inline images. emailToMarkdown caps what it
 * sends to the model, so without this pass the cap fills up with markup and
 * the tail of the message is silently lost. The markup that informs the
 * conversion survives: the tags themselves (blockquotes, lists, tables,
 * headings), link targets, image alt text, and Gmail's semantic classes
 * (gmail_quote / gmail_signature / gmail_attr) that mark quoted replies and
 * signatures for the prompt's strip rules.
 *
 * Regex-based on purpose: the output is consumed by an LLM, which tolerates
 * imperfect HTML — this is not a browser or a security boundary, and staying
 * dependency-free beats edge-case fidelity here.
 */

/** Attributes that inform the conversion; everything else is presentation. */
const KEPT_ATTRS = new Set(['href', 'alt'])

/** Gmail marks quoted replies, attribution lines, and signatures with these. */
const SEMANTIC_CLASS = /gmail_(?:quote|signature|attr)/

/** Formatting-only wrappers — Word nests several around every text run. */
const UNWRAP_TAGS = new Set(['span', 'font'])

/** Longer than any legitimate tracking link; keeps data: URI values out. */
const MAX_ATTR_LENGTH = 2000

// A tag token: optional close slash, a (possibly namespaced) name, then an
// attribute blob that may contain quoted '>' characters.
const TAG_RE = /<\s*(\/?)\s*([a-zA-Z][-a-zA-Z0-9]*(?::[-a-zA-Z0-9]+)?)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g

export function sanitizeEmailHtml(html: string): string {
  let out = html.replace(/\r\n?/g, '\n')

  // Comments — including Outlook's <!--[if mso]> ... <![endif]--> blocks —
  // then the dashless downlevel-revealed markers (<![if !supportLists]>).
  out = out.replace(/<!--[\s\S]*?-->/g, '')
  out = out.replace(/<!\[[^\]]*\]>/g, '')

  out = out.replace(/<!doctype[^>]*>/gi, '')
  out = out.replace(/<\?[\s\S]*?\?>/g, '')

  // Containers whose content is never prose.
  out = out.replace(/<(head|style|script|title|xml)(?:\s[^>]*)?>[\s\S]*?<\/\1\s*>/gi, '')

  // Void metadata tags that can sit outside <head>.
  out = out.replace(/<(?:meta|link|base)(?:\s[^>]*)?\/?>/gi, '')

  out = out.replace(TAG_RE, rebuildTag)

  // Outlook pads with &nbsp; runs and indents every line.
  out = out.replace(/&nbsp;|&#160;/gi, ' ')
  out = out.replace(/[ \t]+\n/g, '\n')
  out = out.replace(/\n[ \t]+/g, '\n')
  out = out.replace(/[ \t]{2,}/g, ' ')
  out = out.replace(/\n{3,}/g, '\n\n')

  return out.trim()
}

function rebuildTag(_match: string, close: string, rawName: string, attrBlob: string): string {
  const tag = rawName.toLowerCase()

  // Office namespace tags (<o:p>, <v:shape>) — drop the tag, keep its content.
  if (tag.includes(':')) return ''
  if (UNWRAP_TAGS.has(tag)) return ''
  if (close) return `</${tag}>`

  if (tag === 'img') {
    // Tracking pixels and data: URI images carry no alt — they vanish here.
    const alt = attrValue(attrBlob, 'alt')
    return alt ? `<img alt="${alt.replaceAll('"', '&quot;')}">` : ''
  }

  let kept = ''
  for (const match of attrBlob.matchAll(ATTR_RE)) {
    const name = match[1].toLowerCase()
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    if (value.length > MAX_ATTR_LENGTH) continue
    if (KEPT_ATTRS.has(name) || (name === 'class' && SEMANTIC_CLASS.test(value))) {
      kept += ` ${name}="${value.replaceAll('"', '&quot;')}"`
    }
  }
  return `<${tag}${kept}>`
}

function attrValue(attrBlob: string, name: string): string | undefined {
  for (const match of attrBlob.matchAll(ATTR_RE)) {
    if (match[1].toLowerCase() === name) return match[2] ?? match[3] ?? match[4] ?? ''
  }
  return undefined
}
