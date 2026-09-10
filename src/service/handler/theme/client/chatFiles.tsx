import { ActionIcon } from '@mantine/core'
import { type DragEvent, useEffect, useRef, useState } from 'react'
import { chatFileError, type ChatFileRef } from '#universal/ai/chatFiles.ts'
import { imagePreviewUrl, isChatImage } from '#universal/ai/chatImages.ts'

export function Paperclip() {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m21 11-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8L15 6" />
    </svg>
  )
}

function FileThumbnail({ file }: { file: { name: string; url?: string } }) {
  const image =
    file instanceof File &&
    (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|bmp|ico|heic|heif)$/i.test(file.name))
      ? file
      : null
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    if (!image) return
    const url = URL.createObjectURL(image)
    setPreview({ file: image, url })
    return () => URL.revokeObjectURL(url)
  }, [image])
  const saved = isChatImage(file) && /\.(png|jpe?g|webp)$/i.test(file.name) ? imagePreviewUrl(file) : undefined
  const src = saved ?? (preview?.file === image ? preview?.url : undefined)
  if (!src || src === failed) return <Paperclip />
  return (
    <img
      className="sky-chat-file-thumbnail"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(src)}
    />
  )
}

export function FileClips({
  files,
  onRemove,
  disabled = false,
}: {
  files: readonly { name: string; url?: string; size?: number }[]
  onRemove?: (index: number) => void
  disabled?: boolean
}) {
  if (files.length === 0) return null
  return (
    <div className="sky-chat-files" aria-label="Attached files">
      {files.map((file, index) => {
        const type = file.name.includes('.') ? file.name.split('.').at(-1)!.toUpperCase() : 'File'
        const size =
          file.size === undefined
            ? ''
            : file.size < 1024 * 1024
              ? ` · ${Math.max(1, Math.ceil(file.size / 1024))} KB`
              : ` · ${(file.size / (1024 * 1024)).toFixed(1)} MB`
        const label = (
          <>
            <FileThumbnail file={file} />
            <span className="sky-chat-file-label">
              <span className="sky-chat-file-name" title={file.name}>
                {file.name}
              </span>
              <span className="sky-chat-file-meta">
                {type}
                {size}
              </span>
            </span>
          </>
        )
        return (
          <div className="sky-chat-file" key={`${file.name}-${index}`}>
            {file.url ? (
              <a href={file.url} target="_blank" rel="noopener noreferrer" title={`Download ${file.name}`}>
                {label}
              </a>
            ) : (
              <span className="sky-chat-file-content">{label}</span>
            )}
            {onRemove && (
              <ActionIcon
                size="sm"
                variant="secondary"
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                onClick={() => onRemove(index)}
              >
                ×
              </ActionIcon>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function useChatFiles(id: string, disabled: boolean) {
  const [{ files, error }, setSelection] = useState<{ files: File[]; error: string | null }>({ files: [], error: null })
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  useEffect(() => {
    setSelection({ files: [], error: null })
    setDragging(false)
    depth.current = 0
  }, [id])
  const add = (added: File[]) => {
    if (disabled) return
    setSelection((prior) => {
      const next = [...prior.files, ...added]
      const refusal = chatFileError(next)
      return { files: refusal ? prior.files : next, error: refusal }
    })
  }
  const isFileDrag = (event: DragEvent) => event.dataTransfer.types.includes('Files')
  const drop = {
    onDragEnter: (event: DragEvent) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      depth.current++
      if (!disabled) setDragging(true)
    },
    onDragOver: (event: DragEvent) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
    },
    onDragLeave: (event: DragEvent) => {
      if (!isFileDrag(event)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    },
    onDrop: (event: DragEvent) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      depth.current = 0
      setDragging(false)
      add(Array.from(event.dataTransfer.files))
    },
  }
  return {
    files,
    error,
    dragging,
    drop,
    attach: {
      files,
      onFiles: add,
      onRemove: (index: number) => {
        setSelection((prior) => ({ files: prior.files.filter((_, i) => i !== index), error: null }))
      },
      onSent: (sent: File[]) =>
        setSelection((prior) => ({ files: prior.files.filter((file) => !sent.includes(file)), error: null })),
    },
  }
}

export type PendingChatFile = Omit<ChatFileRef, 'url'> & { url?: string }
