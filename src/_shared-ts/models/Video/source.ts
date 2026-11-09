/** Provider identity is independent of the shape used by an older note's metadata. */
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

function strings(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value]
  return Array.isArray(value) ? value.flatMap(strings) : []
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function recordingUrls(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(recordingUrls)
  if (typeof value === 'string') return strings(value)
  const video = object(value)
  if (!video) return []
  const loom = object(video.loom)
  return [...strings(video.url), ...strings(video.urls), ...strings(loom ? loom.url : video.loom)]
}

function key(raw: string): string {
  try {
    return videoSource(raw).key
  } catch {
    // Keep malformed declarations visible so an importer can report the affected note.
    return raw.trim()
  }
}

function unique(urls: string[]): string[] {
  const seen = new Set<string>()
  return urls.filter((url) => {
    const identity = key(url)
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

export interface VideoSourceReferences {
  urls: string[]
  grouped: boolean
}

/**
 * An explicit alias identifies the same recording; a list of primary URLs identifies a collection.
 * Body links are deliberately outside this contract: a message mentioning a video is not its entry.
 */
export function videoSourceReferences(yaml: Record<string, unknown>): VideoSourceReferences {
  const recordings = recordingUrls(yaml.video)
  if (!recordings.length && typeof yaml.url === 'string') {
    try {
      if (/^(?:www\.)?loom\.com$/i.test(new URL(yaml.url).hostname)) recordings.push(yaml.url)
    } catch {
      // A different kind of note can have an unrelated or malformed top-level URL.
    }
  }
  const primary = unique(recordings)
  const aliases = primary.length <= 1 ? strings(object(yaml.video)?.aliases) : []
  return { urls: unique([...primary, ...aliases]), grouped: primary.length > 1 }
}
