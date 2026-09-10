import type { ChatFileRef } from './chatFiles.ts'

export type ChatImage = ChatFileRef

const IMAGE_URL = /^\/chat\/files\/\d{4}-\d{2}-\d{2}\/[^\s/()?#]+$/

export function isChatImage(value: unknown): value is ChatImage {
  if (!value || typeof value !== 'object') return false
  const image = value as Record<string, unknown>
  return (
    typeof image.name === 'string' &&
    image.name.length > 0 &&
    typeof image.url === 'string' &&
    IMAGE_URL.test(image.url)
  )
}

export function imagePreviewUrl(image: ChatImage): string {
  return `${image.url}?preview=1`
}

/** Real Markdown keeps generated images in filed conversations without a second image database. */
export function withChatImages(text: string, images: readonly ChatImage[]): string {
  const existing = new Set(splitChatImages(text).images.map((image) => image.url))
  const links: string[] = []
  for (const image of images) {
    if (!isChatImage(image) || existing.has(image.url)) continue
    existing.add(image.url)
    const label = image.name.replace(/[\\[\]]/g, '\\$&').replace(/[\r\n]+/g, ' ')
    links.push(`![${label}](${imagePreviewUrl(image)})`)
  }
  return links.length ? [text.trimEnd(), ...links].filter(Boolean).join('\n\n') : text
}

/** Only Sky's image links become cards; other Markdown keeps its normal rendering. */
export function splitChatImages(text: string): { text: string; images: ChatImage[] } {
  const images = new Map<string, ChatImage>()
  const body = text.replace(
    /^!\[((?:\\.|[^\]\\\r\n])*)\]\((\/chat\/files\/\d{4}-\d{2}-\d{2}\/[^\s/()?#]+)\?preview=1\)[ \t]*$/gm,
    (_match, name: string, url: string) => {
      images.set(url, { name: name.replace(/\\([\\[\]])/g, '$1'), url })
      return ''
    },
  )
  return { text: images.size ? body.trim() : text, images: [...images.values()] }
}

/** Completed tool results show the image while the final reply is still being written. */
export function imagesFromToolResult(output: unknown): ChatImage[] {
  if (!output || typeof output !== 'object') return []
  const result = output as Record<string, unknown>
  if (result.success !== true || !Array.isArray(result.imageArtifacts)) return []
  return result.imageArtifacts.filter(isChatImage)
}
