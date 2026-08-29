/**
 * Two escapes the editor needs: HTML on the way into a block's shell, and the unicode noise
 * (no-break spaces, zero-widths) out of what the browser hands back.
 */

export function normalizeText(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/[\u200b\u200c\u200d\ufeff]/g, '')
}

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
