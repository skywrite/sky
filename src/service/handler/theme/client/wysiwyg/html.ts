/** HTML text and attribute escaping for the renderers. */

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function escapeAttr(text: string): string {
  return escapeHtml(text).replaceAll('"', '&quot;')
}

/** Prose entities are decoded once by the browser; code and editing still use literal escaping. */
export function escapeMarkdownText(text: string): string {
  return text
    .replace(/&(?!(?:#\d{1,7}|#[xX][\da-fA-F]{1,6}|[a-zA-Z][a-zA-Z\d]*);)/g, '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
