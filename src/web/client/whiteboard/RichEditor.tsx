import { type DragEvent, type RefObject, useEffect, useRef } from 'react'
import { type EditorHandle, mountEditor } from '../editor/wysiwyg/mod.ts'
import { resolveImageSrc } from '../explorer/explorer.tsx'
import { InsertMenu } from '../notes/InsertMenu.tsx'
import { NoteToolbar } from '../notes/NoteToolbar.tsx'

/**
 * Rich-text Markdown tab for the Whiteboard. Mounts Sky's shared WYSIWYG editor
 * in local mode with the standard formatting toolbar, `/` block menu, and
 * drag-and-drop file/image attachments.
 */
export function RichEditor({
  text,
  generation,
  path,
  blank,
  handle,
  onChange,
  onAttach,
  onError,
}: {
  text: string
  generation: number
  path: string
  blank: boolean
  handle: RefObject<EditorHandle | null>
  onChange: (content: string) => void
  onAttach: (files: File[]) => void
  onError: (message: string) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hooks = useRef({ onChange, onAttach, onError, path })
  hooks.current = { onChange, onAttach, onError, path }

  useEffect(() => {
    const element = rootRef.current
    if (!element) return
    const mounted = mountEditor(
      element,
      {
        apiPath: '',
        content: text,
        version: 0,
        local: true,
        hideFrontmatter: true,
        resolveImage: (src) => resolveImageSrc(hooks.current.path, src),
      },
      {
        onStatus: (kind, words) => {
          if (kind === 'error') hooks.current.onError(words)
        },
        onConflict: () => {},
        onChange: (content) => hooks.current.onChange(content),
        onFiles: (files) => hooks.current.onAttach(files),
      },
    )
    handle.current = mounted
    return () => {
      handle.current = null
      mounted.destroy()
    }
    // Remounts only when `generation` changes (initial load, external update, Clear/Undo, tab switch).
  }, [generation, handle]) // eslint-disable-line react-hooks/exhaustive-deps

  const onImage = () => fileInputRef.current?.click()

  const handleDrop = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    if (event.type === 'drop') onAttach([...event.dataTransfer.files])
  }

  return (
    <>
      <div className="sky-wb-tools-wrap">
        <NoteToolbar editor={handle} root={rootRef} onImage={onImage} />
      </div>
      <div className="sky-scroll" onDragOver={handleDrop} onDrop={handleDrop}>
        <article className="sky-doc sky-wb-body">
          <div
            ref={rootRef}
            className="sky-doc-body sky-wysiwyg sky-wb-rich"
            role="textbox"
            aria-label="Whiteboard rich text"
            aria-multiline="true"
            data-blank={blank || undefined}
          />
        </article>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])]
          event.currentTarget.value = ''
          if (files.length > 0) onAttach(files)
        }}
      />
      <InsertMenu editor={handle} root={rootRef} onImage={onImage} />
    </>
  )
}
