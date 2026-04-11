import React from 'react'
import { PAGE_CSS } from '../pageCss.ts'
import { buildMarkdownPreviewPath } from '../request.ts'
import type { MarkdownExplorerDirectory, MarkdownPreviewMode, MarkdownPreviewTheme } from '../types.ts'
import { BlockMarkdownEditor, type EditableBlockDescriptor } from './BlockMarkdownEditor.tsx'
import { ExplorerSidebar } from './ExplorerSidebar.tsx'
import { FrontmatterPanel } from './FrontmatterPanel.tsx'
import { PreviewHero } from './PreviewHero.tsx'

const PREVIEW_SYNC_SCRIPT = `
const stateNode = document.getElementById('preview-sync-state')

if (stateNode) {
  const state = JSON.parse(stateNode.textContent || '{}')
  const pollIntervalMs = 4000
  let currentVersion = state.initialVersion

  async function pollForExternalChanges() {
    try {
      const response = await fetch(state.apiPath + '?meta=1', {
        headers: { accept: 'application/json' },
      })

      if (!response.ok) {
        return
      }

      const snapshot = await response.json()
      if (snapshot.version === currentVersion) {
        return
      }

      currentVersion = snapshot.version
      window.location.reload()
    } catch (_) {
      // Preview mode can fail quietly; the next poll or refresh will recover.
    }
  }

  window.setInterval(() => {
    void pollForExternalChanges()
  }, pollIntervalMs)
}
`

const FONT_SCALE_SCRIPT = `
const storageKey = 'markdown-preview-font-scale'
const minScale = 0.85
const maxScale = 1.4
const step = 0.1

function clampScale(value) {
  return Math.min(maxScale, Math.max(minScale, value))
}

function applyFontScale(value) {
  const normalized = clampScale(value)
  document.documentElement.style.setProperty('--content-scale', String(normalized))
  document.querySelectorAll('[data-font-scale-label]').forEach((node) => {
    node.textContent = Math.round(normalized * 100) + '%'
  })
  return normalized
}

let currentScale = applyFontScale(Number.parseFloat(window.localStorage.getItem(storageKey) || '1') || 1)

document.querySelectorAll('[data-font-scale-action]').forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.fontScaleAction
    if (action === 'decrease') {
      currentScale = applyFontScale(currentScale - step)
    } else if (action === 'increase') {
      currentScale = applyFontScale(currentScale + step)
    } else {
      currentScale = applyFontScale(1)
    }

    window.localStorage.setItem(storageKey, String(currentScale))
  })
})

document.querySelectorAll('[data-pdf-export-path]').forEach((button) => {
  button.addEventListener('click', async () => {
    const exportPath = button.dataset.pdfExportPath
    const statusNode = document.querySelector('[data-pdf-export-status]')
    if (!exportPath || !(statusNode instanceof HTMLElement)) {
      return
    }

    statusNode.textContent = 'Exporting…'
    button.disabled = true

    try {
      const response = await fetch(exportPath, { method: 'POST' })
      const payload = await response.json()

      if (!response.ok || typeof payload.pdfPath !== 'string') {
        throw new Error(payload.message || 'Failed to export PDF')
      }

      statusNode.textContent = 'Saved to Desktop'
      statusNode.title = payload.pdfPath
    } catch (error) {
      statusNode.textContent = error instanceof Error ? error.message : 'Export failed'
    } finally {
      button.disabled = false
    }
  })
})

const uiStateNode = document.getElementById('document-ui-state')
const contextMenu = document.getElementById('docs-context-menu')

if (uiStateNode && contextMenu) {
  const uiState = JSON.parse(uiStateNode.textContent || '{}')
  const statusNode = contextMenu.querySelector('[data-context-menu-status]')

  function hideContextMenu() {
    contextMenu.hidden = true
    if (statusNode instanceof HTMLElement) {
      statusNode.textContent = ''
    }
  }

  document.addEventListener('click', () => {
    hideContextMenu()
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideContextMenu()
    }
  })

  document.addEventListener('contextmenu', (event) => {
    const target = event.target
    if (!(target instanceof Element)) {
      return
    }

    if (target.closest('textarea, input, [contenteditable="true"]')) {
      return
    }

    if (!target.closest('.article-shell, .editable-block-preview-shell, .frontmatter')) {
      return
    }

    event.preventDefault()
    contextMenu.hidden = false
    contextMenu.style.left = event.clientX + 'px'
    contextMenu.style.top = event.clientY + 'px'
  })

  contextMenu.querySelectorAll('[data-context-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.contextAction
      hideContextMenu()

      if (action === 'preview') {
        window.location.href = uiState.previewPath
        return
      }

      if (action === 'edit') {
        window.location.href = uiState.editPath
        return
      }

      if (action === 'reload') {
        window.location.reload()
        return
      }

      if (action === 'copy-path') {
        try {
          await navigator.clipboard.writeText(uiState.relativePath)
          if (statusNode instanceof HTMLElement) {
            statusNode.textContent = 'Path copied'
          }
        } catch (_) {
          if (statusNode instanceof HTMLElement) {
            statusNode.textContent = uiState.relativePath
          }
        }
      }
    })
  })
}
`

interface MarkdownPreviewDocumentProps {
  eyebrow: string
  title: string
  description: string
  metaLabel: string
  metaValue: string
  themePath: string
  pdfExportPath?: string
  mode: MarkdownPreviewMode
  canEdit: boolean
  theme: MarkdownPreviewTheme
  bodyHtml: string
  frontmatter: string
  themeCss: string
  explorerRoots: MarkdownExplorerDirectory[]
  previewState?: {
    apiPath: string
    initialVersion: number
  }
  editorState?: {
    relativePath: string
    initialContent: string
    initialVersion: number
    apiPath: string
    documentApiPath: string
    renderBlockApiPath: string
    blocks: EditableBlockDescriptor[]
  }
}

export function MarkdownPreviewDocument(props: MarkdownPreviewDocumentProps) {
  const {
    eyebrow,
    title,
    description,
    metaLabel,
    metaValue,
    themePath,
    pdfExportPath,
    mode,
    canEdit,
    theme,
    bodyHtml,
    frontmatter,
    themeCss,
    explorerRoots,
    previewState,
    editorState,
  } = props
  const documentUiState = canEdit
    ? {
        relativePath: themePath,
        previewPath: buildMarkdownPreviewPath(themePath, { theme, mode: 'preview' }),
        editPath: buildMarkdownPreviewPath(themePath, { theme, mode: 'edit' }),
      }
    : null

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${title} · Markdown Preview`}</title>
        <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />
        <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      </head>
      <body>
        <div className="app-shell">
          <ExplorerSidebar explorerRoots={explorerRoots} theme={theme} mode={mode} />

          <main className="page-column">
            <div className="page-shell">
              <PreviewHero
                eyebrow={eyebrow}
                title={title}
                description={description}
                metaLabel={metaLabel}
                metaValue={metaValue}
                themePath={themePath}
                pdfExportPath={pdfExportPath}
                mode={mode}
                canEdit={canEdit}
                theme={theme}
              />
              {mode === 'edit' && editorState ? (
                <>
                  <FrontmatterPanel frontmatter={frontmatter} />
                  <BlockMarkdownEditor
                    relativePath={editorState.relativePath}
                    theme={theme}
                    initialContent={editorState.initialContent}
                    initialVersion={editorState.initialVersion}
                    apiPath={editorState.apiPath}
                    documentApiPath={editorState.documentApiPath}
                    renderBlockApiPath={editorState.renderBlockApiPath}
                    blocks={editorState.blocks}
                  />
                </>
              ) : (
                <>
                  <FrontmatterPanel frontmatter={frontmatter} />
                  <section className="article-shell">
                    <article className="markdown-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
                  </section>
                  {previewState ? (
                    <>
                      <script
                        id="preview-sync-state"
                        type="application/json"
                        dangerouslySetInnerHTML={{ __html: serializeState(previewState) }}
                      />
                      <script type="module" dangerouslySetInnerHTML={{ __html: PREVIEW_SYNC_SCRIPT }} />
                    </>
                  ) : null}
                </>
              )}
            </div>
          </main>
        </div>
        {documentUiState ? (
          <>
            <div id="docs-context-menu" className="docs-context-menu" hidden>
              <button className="docs-context-button" type="button" data-context-action="preview">
                Preview
              </button>
              <button className="docs-context-button" type="button" data-context-action="edit">
                Edit
              </button>
              <button className="docs-context-button" type="button" data-context-action="reload">
                Reload disk version
              </button>
              <button className="docs-context-button" type="button" data-context-action="copy-path">
                Copy notebook path
              </button>
              <p className="docs-context-status" data-context-menu-status />
            </div>
            <script
              id="document-ui-state"
              type="application/json"
              dangerouslySetInnerHTML={{ __html: serializeState(documentUiState) }}
            />
          </>
        ) : null}
        <script type="module" dangerouslySetInnerHTML={{ __html: FONT_SCALE_SCRIPT }} />
      </body>
    </html>
  )
}

function serializeState(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
