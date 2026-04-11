import React from 'react'
import { buildMarkdownPreviewPath } from '../request.ts'
import type { MarkdownPreviewTheme } from '../types.ts'

interface RawMarkdownEditorProps {
  relativePath: string
  theme: MarkdownPreviewTheme
  initialContent: string
  initialVersion: number
  apiPath: string
}

const EDITOR_SCRIPT = `
const stateNode = document.getElementById('markdown-editor-state')
const textarea = document.getElementById('markdown-editor')
const statusNode = document.getElementById('editor-status')
const saveButton = document.getElementById('editor-save')
const reloadButton = document.getElementById('editor-reload')
const overwriteButton = document.getElementById('editor-overwrite')

if (stateNode && textarea && statusNode && saveButton && reloadButton && overwriteButton) {
  const state = JSON.parse(stateNode.textContent || '{}')
  let currentVersion = state.initialVersion
  let remoteSnapshot = { content: state.initialContent, version: state.initialVersion }
  let dirty = false
  let saving = false
  let conflict = false
  let saveTimer = null

  const pollIntervalMs = 4000

  function setStatus(kind, text) {
    statusNode.textContent = text
    statusNode.dataset.state = kind
  }

  function setConflictVisible(visible) {
    reloadButton.hidden = !visible
    overwriteButton.hidden = !visible
    conflict = visible
  }

  function scheduleSave() {
    if (conflict) return
    if (saveTimer) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      void saveDocument(false)
    }, 1000)
  }

  async function fetchSnapshot(metaOnly) {
    const url = metaOnly ? state.apiPath + '?meta=1' : state.apiPath
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
    })

    if (!response.ok) {
      throw new Error('Failed to read markdown document')
    }

    return await response.json()
  }

  async function refreshRemoteSnapshot() {
    const snapshot = await fetchSnapshot(false)
    remoteSnapshot = {
      content: snapshot.content,
      version: snapshot.version,
    }
    return remoteSnapshot
  }

  async function saveDocument(force) {
    if (saving) return
    if (!dirty && !force) return

    saving = true
    saveButton.disabled = true
    setStatus('saving', 'Saving…')

    try {
      const response = await fetch(state.apiPath, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: textarea.value,
          version: currentVersion,
          force,
        }),
      })

      if (response.status === 409) {
        const snapshot = await response.json()
        remoteSnapshot = {
          content: snapshot.content,
          version: snapshot.version,
        }
        setConflictVisible(true)
        setStatus('conflict', 'Changed on disk. Reload or overwrite.')
        return
      }

      if (!response.ok) {
        throw new Error('Failed to save markdown document')
      }

      const saved = await response.json()
      currentVersion = saved.version
      remoteSnapshot = {
        content: textarea.value,
        version: saved.version,
      }
      dirty = false
      setConflictVisible(false)
      setStatus('saved', 'Saved')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save markdown document'
      setStatus('error', message)
    } finally {
      saving = false
      saveButton.disabled = false
    }
  }

  async function pollForExternalChanges() {
    try {
      const snapshot = await fetchSnapshot(true)
      if (snapshot.version === currentVersion) return

      if (!dirty && !saving) {
        const fresh = await refreshRemoteSnapshot()
        textarea.value = fresh.content
        currentVersion = fresh.version
        setConflictVisible(false)
        setStatus('saved', 'Reloaded external change')
        return
      }

      await refreshRemoteSnapshot()
      setConflictVisible(true)
      setStatus('conflict', 'Changed on disk. Reload or overwrite.')
    } catch (_) {
      if (!saving) {
        setStatus('error', 'Polling failed')
      }
    }
  }

  textarea.addEventListener('input', () => {
    dirty = true
    setStatus('dirty', 'Unsaved changes')
    scheduleSave()
  })

  saveButton.addEventListener('click', () => {
    void saveDocument(false)
  })

  reloadButton.addEventListener('click', () => {
    textarea.value = remoteSnapshot.content
    currentVersion = remoteSnapshot.version
    dirty = false
    setConflictVisible(false)
    setStatus('saved', 'Reloaded disk version')
  })

  overwriteButton.addEventListener('click', () => {
    void saveDocument(true)
  })

  document.addEventListener('keydown', (event) => {
    const wantsSave = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's'
    if (!wantsSave) return
    event.preventDefault()
    void saveDocument(false)
  })

  setStatus('saved', 'Saved')
  setConflictVisible(false)
  window.setInterval(() => {
    void pollForExternalChanges()
  }, pollIntervalMs)
}
`

export function RawMarkdownEditor(props: RawMarkdownEditorProps) {
  const { relativePath, theme, initialContent, initialVersion, apiPath } = props
  const editorState = serializeEditorState({
    apiPath,
    initialContent,
    initialVersion,
  })

  return (
    <section className="editor-shell">
      <div className="editor-toolbar">
        <div className="editor-toolbar-copy">
          <p className="editor-label">Raw Markdown</p>
          <p id="editor-status" className="editor-status" data-state="saved">
            Saved
          </p>
        </div>
        <div className="editor-actions">
          <a className="editor-action-link" href={buildMarkdownPreviewPath(relativePath, { theme, mode: 'preview' })}>
            Rendered view
          </a>
          <button id="editor-save" className="editor-action-button" type="button">
            Save now
          </button>
          <button id="editor-reload" className="editor-action-button" type="button" hidden>
            Reload disk version
          </button>
          <button id="editor-overwrite" className="editor-action-button" type="button" hidden>
            Overwrite disk version
          </button>
        </div>
      </div>
      <textarea
        id="markdown-editor"
        className="markdown-editor"
        defaultValue={initialContent}
        spellCheck={false}
        aria-label="Markdown editor"
      />
      <script id="markdown-editor-state" type="application/json" dangerouslySetInnerHTML={{ __html: editorState }} />
      <script type="module" dangerouslySetInnerHTML={{ __html: EDITOR_SCRIPT }} />
    </section>
  )
}

function serializeEditorState(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
