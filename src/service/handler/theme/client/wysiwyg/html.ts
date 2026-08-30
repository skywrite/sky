/** HTML text and attribute escaping for the renderers. */

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function escapeAttr(text: string): string {
  return escapeHtml(text).replaceAll('"', '&quot;')
}
