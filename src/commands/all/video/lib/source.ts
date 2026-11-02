/** The provider-assigned Loom ID is shared by share/embed URLs and survives query-string changes. */
export function videoSource(raw: string): { url: string; key: string; loomId: string | null } {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS video URL.')
  if (/^(?:www\.)?loom\.com$/i.test(url.hostname)) {
    const id = url.pathname
      .match(/^\/(?:share|embed)\/([a-f\d-]+)\/?$/i)?.[1]
      .replaceAll('-', '')
      .toLowerCase()
    if (!id || !/^[a-f\d]{32}$/.test(id)) throw new Error('The Loom URL must contain its recording ID.')
    return { url: `https://www.loom.com/share/${id}`, key: `loom:${id}`, loomId: id }
  }
  url.hash = ''
  return { url: url.href, key: url.href, loomId: null }
}
