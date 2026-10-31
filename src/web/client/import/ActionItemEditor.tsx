import './ActionItemEditor.css'
import { useEffect, useId, useRef } from 'react'
import { mountEditor } from '../editor/wysiwyg/mod.ts'

export function ActionItemEditor({
  value,
  label,
  autoFocus = false,
  error,
  onChange,
}: {
  value: string
  label: string
  autoFocus?: boolean
  error?: string
  onChange: (value: string) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const initial = useRef({ value, autoFocus })
  const notify = useRef(onChange)
  notify.current = onChange
  const errorId = useId()

  useEffect(() => {
    if (!root.current) return
    const editor = mountEditor(
      root.current,
      { apiPath: '', content: initial.current.value, version: 0, local: true, hideFrontmatter: true },
      {
        onStatus: () => {},
        onConflict: () => {},
        onChange: (content) => notify.current(content.replace(/\n$/, '')),
      },
    )
    if (initial.current.autoFocus) editor.focusEnd()
    return () => editor.destroy()
  }, [])

  return (
    <div className="sky-action-text">
      <div
        ref={root}
        className="sky-doc-body sky-wysiwyg sky-action-input"
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        aria-placeholder="What needs to happen?"
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? errorId : undefined}
        data-empty={!value.trim() || undefined}
      />
      {error && (
        <div id={errorId} className="sky-action-error">
          {error}
        </div>
      )}
    </div>
  )
}
