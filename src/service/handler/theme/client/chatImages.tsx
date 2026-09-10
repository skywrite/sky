import { Button } from '@mantine/core'
import { useState } from 'react'
import { type ChatImage, imagePreviewUrl, imagesFromToolResult, splitChatImages } from '#universal/ai/chatImages.ts'

export function replyImages(text: string, outputs: readonly unknown[] = []): ChatImage[] {
  const images = new Map<string, ChatImage>()
  for (const image of [...splitChatImages(text).images, ...outputs.flatMap(imagesFromToolResult)]) {
    images.set(image.url, image)
  }
  return [...images.values()]
}

export function ChatImages({ images }: { images: readonly ChatImage[] }) {
  if (images.length === 0) return null
  return (
    <div className="sky-chat-images" aria-label="Generated images">
      {images.map((image) => (
        <ImageCard key={image.url} image={image} />
      ))}
    </div>
  )
}

function ImageCard({ image }: { image: ChatImage; key?: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <figure className="sky-chat-image">
      <a
        className="sky-chat-image-preview"
        href={imagePreviewUrl(image)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${image.name} at full size`}
      >
        {failed ? (
          <span className="sky-chat-image-error" role="status">
            The preview couldn’t load. Try opening or downloading the image.
          </span>
        ) : (
          <img src={imagePreviewUrl(image)} alt={image.name} onError={() => setFailed(true)} />
        )}
      </a>
      <figcaption>
        <span className="sky-chat-image-name" title={image.name}>
          {image.name}
        </span>
        <Button
          component="a"
          href={image.url}
          download={image.name}
          variant="primary-quiet"
          size="compact-sm"
          aria-label={`Download ${image.name}`}
        >
          Download
        </Button>
      </figcaption>
    </figure>
  )
}
