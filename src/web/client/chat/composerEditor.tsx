import { type Ref, useEffect, useImperativeHandle, useRef } from 'react'
import { type EditorHandle, mountEditor } from '../editor/wysiwyg/mod.ts'

/** A message is the text as written: the document's closing newline is not part of it. */
const asMessage = (markdown: string) => markdown.replace(/\n+$/, '')

export interface ComposerEditorHandle {
  /** The Markdown as written, read from the editor rather than from the last change it reported */
  content(): string
  /** The caret after the last word, with the last line in view */
  focusEnd(): void
}

/**
 * The composer's text field is the editor the explorer and the journal use, so Markdown reads
 * while it is written the way it will once sent. Enter sends; Shift+Enter is the editor's Enter.
 * The draft keeps the text: when it changes from outside — another thread, a restored draft, a
 * sent message cleared — the editor is mounted again over it.
 */
export function ComposerEditor({
  ref,
  text,
  placeholder,
  disabled,
  onText,
  onSubmit,
  onFiles,
}: {
  ref?: Ref<ComposerEditorHandle>
  text: string
  placeholder: string
  disabled: boolean
  onText: (text: string) => void
  onSubmit: () => void
  /** Files pasted in; a dropped file is left to the page's drop target */
  onFiles?: (files: File[]) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorHandle | null>(null)
  /** What the editor shows: the text it was mounted with, or the last it reported */
  const shown = useRef<string | null>(null)
  const hooks = useRef({ onText, onSubmit, onFiles })
  hooks.current = { onText, onSubmit, onFiles }

  useEffect(() => {
    const element = root.current
    if (!element || (editor.current && shown.current === text)) return
    const focused = element.contains(document.activeElement)
    editor.current?.destroy()
    shown.current = text
    editor.current = mountEditor(
      element,
      { apiPath: '', content: text, version: 0, local: true, roomBelow: true },
      {
        onChange: (content) => {
          shown.current = asMessage(content)
          hooks.current.onText(shown.current)
        },
        onStatus: () => {},
        onConflict: () => {},
        onSubmit: () => hooks.current.onSubmit(),
        onFiles: (files) => hooks.current.onFiles?.(files),
      },
    )
    if (focused) editor.current.focusEnd()
  }, [text])

  useEffect(
    () => () => {
      editor.current?.destroy()
      editor.current = null
    },
    [],
  )

  useImperativeHandle(
    ref,
    () => ({
      content: () => (editor.current ? asMessage(editor.current.content()) : (shown.current ?? '')),
      focusEnd: () => {
        editor.current?.focusEnd()
        if (root.current) root.current.scrollTop = root.current.scrollHeight
      },
    }),
    [],
  )

  return (
    <div
      className="sky-composer-editor"
      data-empty={text.trim() ? undefined : ''}
      data-placeholder={placeholder}
      inert={disabled}
    >
      <div
        ref={root}
        className="sky-doc-body sky-wysiwyg sky-composer-text"
        role="textbox"
        aria-label={placeholder}
        aria-placeholder={placeholder}
        aria-multiline="true"
        aria-disabled={disabled || undefined}
      />
    </div>
  )
}
