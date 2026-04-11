import { marked } from 'marked'

const RAW_PREVIEW_TYPES = new Set(['frontmatter', 'definition_cluster', 'raw_region', 'html_block', 'table'])

export async function renderBlockPreview(type: string, raw: string): Promise<string> {
  if (RAW_PREVIEW_TYPES.has(type)) {
    return `<pre>${escapeHtml(raw)}</pre>`
  }

  return await marked.parse(raw)
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
