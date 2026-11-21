/** Containers a screen or camera recording plausibly arrives in. */
export const VIDEO_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
}
export const VIDEO_EXTENSIONS = Object.keys(VIDEO_CONTENT_TYPES)
