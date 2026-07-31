// Image staging for placement into Docs and Slides. Both APIs fetch image
// bytes from a public URL at insert time and keep their own copy, so local
// files are staged in Drive with anyone-with-link access just long enough to
// be placed, then deleted when the mission ends.

/** Staged-upload ceiling; the Slides API itself rejects images over 50 MB. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif'

/** Detect PNG/JPEG/GIF — the only formats Docs and Slides accept — by magic bytes. */
export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  if (bytes.length < 4) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
  return null
}

/** Public fetch URL for a Drive file shared anyone-with-link — what createImage/insertInlineImage are given. */
export function driveImageUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`
}
