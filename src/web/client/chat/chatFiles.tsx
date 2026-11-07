import { ActionIcon } from '@mantine/core'
import { type DragEvent, useEffect, useId, useRef, useState } from 'react'
import { chatFileError, type ChatFileRef } from '#universal/ai/chatFiles.ts'
import { imagePreviewUrl, isChatImage } from '#universal/ai/chatImages.ts'
import type { ImageMarkup } from '#universal/ai/imageMarkup.ts'
import type { ChatDraft } from './chatDraft.ts'
import { ChatFileIcon } from './chatFileIcon.tsx'
import { ImageMarkupOverlay } from './ImageMarkupOverlay.tsx'

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

function FileThumbnail({
  file,
  markup,
}: {
  file: { name: string; url?: string; type?: string }
  markup?: ImageMarkup
}) {
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
  const saved = isChatImage(file) && /\.(png|jpe?g|webp|gif)$/i.test(file.name) ? imagePreviewUrl(file) : undefined
  const src = saved ?? (preview?.file === image ? preview?.url : undefined)
  if (!src || src === failed) return <ChatFileIcon file={file} />
  return (
    <span className="sky-chat-markup-thumb">
      <img
        className="sky-chat-file-thumbnail"
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(src)}
      />
      {markup && <ImageMarkupOverlay markup={markup} aria-hidden="true" />}
    </span>
  )
}

export function FileClips({
  files,
  onRemove,
  disabled = false,
  pending = false,
  markups,
  onMarkup,
}: {
  files: readonly { name: string; url?: string; size?: number; type?: string; markup?: ChatFileRef['markup'] }[]
  onRemove?: (index: number) => void
  disabled?: boolean
  pending?: boolean
  markups?: ReadonlyMap<File, ImageMarkup>
  onMarkup?: (file: File) => void
}) {
  const listId = useId()
  const [expanded, setExpanded] = useState(true)
  useEffect(() => setExpanded(true), [files.length])
  if (files.length === 0) return null
  const totalBytes = files.every((file) => file.size !== undefined)
    ? files.reduce((total, file) => total + file.size!, 0)
    : undefined
  return (
    <div className="sky-chat-attachments" data-pending={pending || undefined} data-many={files.length > 5 || undefined}>
      {(pending || files.length > 1) && (
        <div className="sky-chat-attachments-head">
          <span role={pending ? 'status' : undefined}>
            <strong>
              {files.length} {files.length === 1 ? 'file' : 'files'} attached
            </strong>
            {totalBytes !== undefined && <span className="sky-chat-attachments-size"> · {fileSize(totalBytes)}</span>}
          </span>
          {pending && (
            <button
              type="button"
              className="sky-chat-attachments-toggle"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Hide files' : 'Show files'}
            </button>
          )}
        </div>
      )}
      <div id={listId} className="sky-chat-files" role="list" aria-label="Attached files" hidden={pending && !expanded}>
        {files.map((file, index) => {
          const markup = file instanceof File ? markups?.get(file) : undefined
          const count = markup?.marks.length ?? file.markup?.count ?? 0
          const type = file.name.includes('.') ? file.name.split('.').at(-1)!.toUpperCase() : 'File'
          const size = file.size === undefined ? '' : ` · ${fileSize(file.size)}`
          const label = (
            <>
              <FileThumbnail file={file} markup={markup} />
              <span className="sky-chat-file-label">
                <span className="sky-chat-file-name" title={file.name}>
                  {file.name}
                </span>
                <span className="sky-chat-file-meta">
                  {type}
                  {size}
                  {count > 0 && (
                    <span className="sky-chat-markup-count">
                      {' '}
                      · {count} {count === 1 ? 'mark' : 'marks'}
                    </span>
                  )}
                </span>
              </span>
            </>
          )
          return (
            <div className="sky-chat-file" role="listitem" key={`${file.name}-${index}`}>
              {file.url ? (
                <a href={file.url} target="_blank" rel="noopener noreferrer" title={`Download ${file.name}`}>
                  {label}
                </a>
              ) : (
                <span className="sky-chat-file-content">{label}</span>
              )}
              {onMarkup && file instanceof File && /\.(png|jpe?g|webp)$/i.test(file.name) && (
                <button
                  type="button"
                  className="sky-chat-markup-button"
                  disabled={disabled}
                  onClick={() => onMarkup(file)}
                  aria-label={`${markup ? 'Edit markup for' : 'Mark up'} ${file.name}`}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    aria-hidden="true"
                  >
                    <path d="m16 3 5 5L8 21H3v-5L16 3Z M13 6l5 5" />
                  </svg>
                  {markup ? 'Edit markup' : 'Mark up'}
                </button>
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
    </div>
  )
}

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function useChatFiles(id: string, disabled: boolean, draft: ChatDraft) {
  const { files } = draft
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  useEffect(() => {
    setError(null)
    setDragging(false)
    depth.current = 0
  }, [id])
  const add = (added: File[]) => {
    if (disabled || draft.loading) return
    draft.setFiles((prior) => {
      const next = [...prior, ...added]
      const refusal = chatFileError(next)
      setError(refusal)
      return refusal ? prior : next
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
        draft.setFiles((prior) => prior.filter((_, i) => i !== index))
        setError(null)
      },
    },
  }
}

export type PendingChatFile = Omit<ChatFileRef, 'url'> & { url?: string }
