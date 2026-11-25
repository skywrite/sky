/**
 * Persistent notebook whiteboard (`time/whiteboard.md`) with two tabs:
 * - Rich text: Sky's shared WYSIWYG Markdown editor with formatting toolbar & `/` menu
 * - Raw: Markdown-highlighted native `<textarea>` for guaranteed plain-text copy/paste
 */

import '../notes/notes.css'
import './WhiteboardMain.css'
import { ActionIcon, Button, Menu, Modal } from '@mantine/core'
import { type CSSProperties, type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { EditorHandle } from '../editor/wysiwyg/mod.ts'
import { fileHref, useDocScale } from '../explorer/explorer.tsx'
import { FormatIcon } from '../notes/FormatIcon.tsx'
import { RawEditor } from './RawEditor.tsx'
import { RichEditor } from './RichEditor.tsx'
import { type WhiteboardTab, whiteboardHref, whiteboardTabOf } from './routes.ts'
import { useWhiteboardFile } from './useWhiteboardFile.ts'

const FRONTMATTER_PREFIX = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/
const UNDO_MS = 8000

function hasVisibleBody(content: string): boolean {
  return content.replace(FRONTMATTER_PREFIX, '').trim().length > 0
}

function attachApi(filePath: string): string {
  return `/docs/_api/attach/${filePath.split('/').map(encodeURIComponent).join('/')}`
}

export function WhiteboardMain({
  search,
  navigate,
}: {
  search: string
  navigate: (to: string, replace?: boolean) => void
}) {
  const tab = whiteboardTabOf(search)
  const file = useWhiteboardFile()
  const fileRef = useRef(file)
  fileRef.current = file

  const editorRef = useRef<EditorHandle | null>(null)
  const rawTextareaRef = useRef<HTMLTextAreaElement>(null)
  const richTabRef = useRef<HTMLButtonElement>(null)
  const rawTabRef = useRef<HTMLButtonElement>(null)
  const [scale] = useDocScale()

  const [rawText, setRawText] = useState('')
  const [blank, setBlank] = useState(true)
  const [richGeneration, setRichGeneration] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [undoSnapshot, setUndoSnapshot] = useState<string | null>(null)

  const noticeTimer = useRef<number | undefined>(undefined)
  const undoTimer = useRef<number | undefined>(undefined)

  const showNotice = useCallback((message: string) => {
    window.clearTimeout(noticeTimer.current)
    setNotice(message)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2600)
  }, [])

  useEffect(() => {
    return () => {
      window.clearTimeout(noticeTimer.current)
      window.clearTimeout(undoTimer.current)
    }
  }, [])

  // Keep page title synced with the active tab and loading/error states.
  useEffect(() => {
    document.title = tab === 'raw' ? 'sky · Whiteboard · Raw' : 'sky · Whiteboard'
  }, [tab])

  // Sync external loads, disk updates, conflict reloads, and Clear/Undo into both tabs.
  const shown = file.shown
  useEffect(() => {
    if (!shown) return
    setRawText(shown.text)
    setBlank(!hasVisibleBody(shown.text))
    setRichGeneration((value) => value + 1)
  }, [shown])

  const onEdit = useCallback((content: string) => {
    fileRef.current.changed(content)
    setBlank(!hasVisibleBody(content))
  }, [])

  const onRawChange = useCallback(
    (content: string) => {
      setRawText(content)
      onEdit(content)
    },
    [onEdit],
  )

  const switchTab = (next: WhiteboardTab) => {
    if (next === tab) return
    if (tab === 'rich') {
      const content = editorRef.current?.content() ?? file.current()
      onEdit(content)
      setRawText(content)
    } else {
      setRichGeneration((value) => value + 1)
    }
    navigate(whiteboardHref(next))
  }

  // Keep Raw textarea scrolled to top on tab switch so focus never jumps to the bottom.
  useEffect(() => {
    if (tab !== 'raw') return
    const textarea = rawTextareaRef.current
    if (!textarea) return
    textarea.setSelectionRange(0, 0)
    textarea.focus({ preventScroll: true })
  }, [tab])

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next: WhiteboardTab = tab === 'rich' ? 'raw' : 'rich'
    switchTab(next)
    ;(next === 'rich' ? richTabRef : rawTabRef).current?.focus()
  }

  const copyPlainText = async () => {
    const content = tab === 'rich' ? (editorRef.current?.content() ?? file.current()) : rawText
    try {
      await navigator.clipboard.writeText(content)
      showNotice('Copied plain text')
    } catch {
      showNotice('Could not copy to clipboard')
    }
  }

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(file.path)
      showNotice(`Path copied · ${file.path}`)
    } catch {
      showNotice(file.path)
    }
  }

  const attachFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    if (!fileRef.current.exists) {
      const created = await fileRef.current.replace(editorRef.current?.content() ?? fileRef.current.current())
      if (!created) return
    }
    editorRef.current?.attach(files, attachApi(fileRef.current.path))
  }, [])

  const executeClear = async () => {
    const previous = tab === 'rich' ? (editorRef.current?.content() ?? file.current()) : rawText
    setConfirmClear(false)
    if (!previous) return
    const ok = await file.replace('')
    if (!ok) return
    setUndoSnapshot(previous)
    window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => setUndoSnapshot(null), UNDO_MS)
  }

  const undoClear = async () => {
    const previous = undoSnapshot
    if (previous === null) return
    window.clearTimeout(undoTimer.current)
    setUndoSnapshot(null)
    await file.replace(previous)
    showNotice('Whiteboard restored')
  }

  const ready = shown !== null
  const hasContent = tab === 'rich' ? !blank || Boolean(file.current()) : Boolean(rawText)

  return (
    <main className="sky-main sky-wb" style={{ '--sky-doc-scale': scale } as CSSProperties}>
      <div className="sky-wb-chrome">
        <header className="sky-wb-head">
          <h1>Whiteboard</h1>
          <div className="sky-wb-head-right">
            {file.statusText && (
              <span className="sky-head-count" data-state={file.kind} role="status">
                {file.statusText}
              </span>
            )}
            {file.kind === 'conflict' && (
              <div className="sky-wb-conflict-actions">
                <Button size="compact-sm" variant="primary" onClick={() => void file.keepMine()}>
                  Keep mine
                </Button>
                <Button size="compact-sm" onClick={file.takeSaved}>
                  Use saved
                </Button>
              </div>
            )}
            <Menu position="bottom-end" shadow="md" width={220}>
              <Menu.Target>
                <ActionIcon size="lg" aria-label="More options">
                  ⋯
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item disabled={!ready || !hasContent} onClick={() => void copyPlainText()}>
                  Copy plain text
                </Menu.Item>
                <Menu.Item disabled={!file.exists} onClick={() => navigate(fileHref(file.path))}>
                  Open in Explorer
                </Menu.Item>
                <Menu.Item onClick={() => void copyPath()}>Copy file path</Menu.Item>
                <Menu.Divider />
                <Menu.Item color="red" disabled={!ready || !hasContent} onClick={() => setConfirmClear(true)}>
                  Clear whiteboard…
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </div>
        </header>

        <div className="sky-wb-tabs-row">
          <div className="sky-wb-tabs" role="tablist" aria-label="Whiteboard mode">
            <button
              ref={richTabRef}
              type="button"
              role="tab"
              id="sky-wb-tab-rich"
              className="sky-wb-tab"
              aria-selected={tab === 'rich'}
              aria-controls="sky-wb-panel"
              tabIndex={tab === 'rich' ? 0 : -1}
              onClick={() => switchTab('rich')}
              onKeyDown={onTabKeyDown}
            >
              Rich text
            </button>
            <button
              ref={rawTabRef}
              type="button"
              role="tab"
              id="sky-wb-tab-raw"
              className="sky-wb-tab"
              aria-selected={tab === 'raw'}
              aria-controls="sky-wb-panel"
              tabIndex={tab === 'raw' ? 0 : -1}
              onClick={() => switchTab('raw')}
              onKeyDown={onTabKeyDown}
            >
              Raw
              <span className="sky-wb-tab-badge">Plain text</span>
            </button>
          </div>

          <div className="sky-wb-tab-meta">
            <span className="sky-wb-file-chip" title={file.path}>
              <FormatIcon name="file" size={15} />
              <span>{file.path}</span>
            </span>
          </div>
        </div>

        {(file.problem || notice) && (
          <p className="sky-wb-notice" role={file.problem ? 'alert' : 'status'}>
            {file.problem ?? notice}
          </p>
        )}
      </div>

      {file.kind === 'error' && !ready ? (
        <div className="sky-blank">
          <p>{file.problem ?? 'Could not load the whiteboard.'}</p>
        </div>
      ) : !ready ? (
        <div className="sky-blank" role="status">
          <p>Loading whiteboard…</p>
        </div>
      ) : (
        <div
          id="sky-wb-panel"
          className="sky-wb-panel"
          role="tabpanel"
          aria-labelledby={tab === 'rich' ? 'sky-wb-tab-rich' : 'sky-wb-tab-raw'}
        >
          {tab === 'rich' ? (
            <RichEditor
              text={file.current()}
              generation={richGeneration}
              path={file.path}
              blank={blank}
              handle={editorRef}
              onChange={onEdit}
              onAttach={(files) => void attachFiles(files)}
              onError={showNotice}
            />
          ) : (
            <RawEditor
              text={rawText}
              textareaRef={rawTextareaRef}
              onChange={onRawChange}
              onClear={() => setConfirmClear(true)}
              onFeedback={showNotice}
            />
          )}
        </div>
      )}

      <Modal opened={confirmClear} onClose={() => setConfirmClear(false)} title="Clear whiteboard?" centered>
        <p className="sky-wb-dialog-copy">
          This clears everything in <code>{file.path}</code>. You can still undo right after clearing.
        </p>
        <div className="sky-dialog-actions">
          <Button onClick={() => setConfirmClear(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => void executeClear()}>
            Clear
          </Button>
        </div>
      </Modal>

      {undoSnapshot !== null && (
        <div className="sky-wb-undo" role="status" aria-live="polite">
          <span>Whiteboard cleared</span>
          <button type="button" onClick={() => void undoClear()}>
            Undo
          </button>
        </div>
      )}
    </main>
  )
}
