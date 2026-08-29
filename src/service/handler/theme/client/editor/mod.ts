import { type DocumentState, fetchDocument, fetchSnapshot, renderBlock, saveDocument } from './api.ts'
import { type ClickContext, placeCaretAtPoint, resolveCursorOffset } from './caret.ts'
import { placeCaretAtElementEnd } from './dom.ts'
import { type EditorOps, attachBlockHandlers } from './handlers.ts'
import { clearInlineFocusMarkers, refreshInlineFocusMarkers, setInlineRevealEnabled } from './inline.ts'
import { normalizeVisualSaveRaw, normalizeVisualSaveSuffix, serializeVisualBlock } from './serialize.ts'
import { isVisualBlock, renderBlockListHtml, resizeTextarea } from './shell.ts'
import { countTopLevelBlockElements, normalizeVisualBlockType } from './shortcuts.ts'
import type { EditableBlock } from './types.ts'

/**
 * The block editor, in the column. A file is its blocks — paragraphs, headings, lists and
 * quotes edited in place as rendered text, everything else (fences, tables, raw HTML) as its
 * markdown in a textarea — and a save rewrites only the edited block's source range. It
 * autosaves after a second's idle, watches the file for outside changes, and on a conflict
 * offers the disk version or an overwrite.
 *
 * `mountBlockEditor` renders into `root` and owns everything inside it; the page keeps the
 * chrome — status, the conflict choice, done — and drives it through the handle and hooks.
 * This file holds the document's state and the moves on it; the listeners are in handlers,
 * the commands they call in keys / shortcuts / lists / inline / paste, the markdown in
 * serialize, the DOM helpers in dom and caret, the HTML of a block in shell, the calls in api.
 */

export type { EditableBlock } from './types.ts'

export interface BlockEditorState {
  /** GET reads the file (`?meta=1` its version alone); PUT saves it */
  apiPath: string
  /** GET rebuilds the blocks — after a reload, or a save that changed how many there are */
  documentApiPath: string
  /** POST { type, raw } renders one block to HTML */
  renderBlockApiPath: string
  initialContent: string
  initialVersion: number
  frontmatter: string
  blocks: EditableBlock[]
}

export type BlockEditorStatusKind = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error'

export interface BlockEditorHooks {
  /** Where the document stands: saved, unsaved, saving, changed on disk, failed */
  onStatus(kind: BlockEditorStatusKind, text: string): void
  /** Whether the reload-or-overwrite choice is on the table */
  onConflict(visible: boolean): void
}

export interface BlockEditorHandle {
  /** Drop what is here and read the disk again */
  reload(): void
  /** Save the open block over whatever is on disk */
  overwrite(): void
  /** Save an open, changed block on the way out, then let go of the document and its timers */
  destroy(): void
}

export function mountBlockEditor(
  root: HTMLElement,
  state: BlockEditorState,
  hooks: BlockEditorHooks,
): BlockEditorHandle {
  let blockOrder = state.blocks.map((block) => block.cid)
  let blockMap = new Map(state.blocks.map((block) => [block.cid, { ...block }]))
  let currentContent = state.initialContent
  let currentVersion = state.initialVersion
  let currentFrontmatter = state.frontmatter || ''
  let activeCid: string | null = null
  let dirty = false
  let saving = false
  let saveTimer: number | null = null
  let pendingCloseCid: string | null = null
  let pollFailed = false
  const pollIntervalMs = 4000

  // What the listeners on the blocks may do; the state itself stays here.
  const ops: EditorOps = {
    renderBlockApiPath: state.renderBlockApiPath,
    block: (cid) => blockMap.get(cid),
    activeCid: () => activeCid,
    isDirty: () => dirty,
    open: openEditor,
    close: closeEditor,
    closeAfterSave: (cid) => {
      pendingCloseCid = cid
      void saveActiveBlock(false)
    },
    cancel: (cid) => {
      closeEditor(cid)
      if (activeCid === cid) activeCid = null
      dirty = false
      setStatus('saved', 'Saved')
    },
    save: (force) => {
      void saveActiveBlock(force)
    },
    reload: () => {
      void reloadDocumentState('Reloaded disk version')
    },
    markDirty: markDirtyState,
  }

  function setStatus(kind: BlockEditorStatusKind, text: string) {
    hooks.onStatus(kind, text)
  }

  function setOverwriteVisible(visible: boolean) {
    hooks.onConflict(visible)
  }

  function getBlockList(): HTMLElement | null {
    return root.querySelector<HTMLElement>('.editable-block-list')
  }

  function getFrontmatterPanel(): HTMLDetailsElement | null {
    return root.querySelector<HTMLDetailsElement>('.sky-doc-meta')
  }

  function getFrontmatterContent(): HTMLPreElement | null {
    return root.querySelector<HTMLPreElement>('.sky-doc-meta pre')
  }

  function getBlockShell(cid: string): HTMLElement | null {
    return root.querySelector<HTMLElement>('.editable-block[data-cid="' + cid + '"]')
  }

  /** The pieces of a block's shell — each null when the block, or that piece, is not on the page. */
  function blockParts(cid: string) {
    const shell = getBlockShell(cid)
    const part = <T extends Element>(selector: string): T | null => shell?.querySelector<T>(selector) ?? null
    return {
      shell,
      preview: part<HTMLElement>('.editable-block-preview-shell'),
      article: part<HTMLElement>('.editable-block-preview'),
      form: part<HTMLElement>('.editable-block-form'),
      textarea: part<HTMLTextAreaElement>('.editable-block-textarea'),
      reload: part<HTMLButtonElement>('.editable-block-reload'),
      overwrite: part<HTMLButtonElement>('.editable-block-overwrite'),
    }
  }

  function setConflictVisible(cid: string, visible: boolean) {
    const { reload, overwrite } = blockParts(cid)
    if (reload) reload.hidden = !visible
    if (overwrite) overwrite.hidden = !visible
  }

  function clearSaveTimer() {
    if (saveTimer) {
      window.clearTimeout(saveTimer)
      saveTimer = null
    }
  }

  function ensureFrontmatterPanel(frontmatter: string) {
    let panel = getFrontmatterPanel()
    let content = getFrontmatterContent()

    if (frontmatter.length === 0) {
      if (panel) {
        panel.remove()
      }
      return
    }

    if (!panel || !content) {
      panel = document.createElement('details')
      panel.className = 'sky-doc-meta'
      const summary = document.createElement('summary')
      summary.textContent = 'Frontmatter'
      content = document.createElement('pre')
      panel.appendChild(summary)
      panel.appendChild(content)
      root.insertBefore(panel, root.firstChild)
    }

    content.textContent = frontmatter
  }

  function applyDocumentState(nextState: DocumentState, statusText: string) {
    currentContent = nextState.content
    currentVersion = nextState.version
    currentFrontmatter = nextState.frontmatter || ''
    blockOrder = nextState.blocks.map((block) => block.cid)
    blockMap = new Map(nextState.blocks.map((block) => [block.cid, { ...block }]))
    activeCid = null
    dirty = false
    pendingCloseCid = null
    clearSaveTimer()
    setOverwriteVisible(false)
    ensureFrontmatterPanel(currentFrontmatter)

    const blockList = getBlockList()
    if (blockList) {
      blockList.innerHTML = renderBlockListHtml(nextState.blocks)
    }

    attachBlockHandlers(root, ops)
    setStatus('saved', statusText)
  }

  async function reloadDocumentState(statusText: string) {
    const nextState = await fetchDocument(state.documentApiPath)
    applyDocumentState(nextState, statusText)
  }

  function setEditorBusy(cid: string, busy: boolean) {
    const block = blockMap.get(cid)
    const shell = getBlockShell(cid)
    if (!shell) return

    shell
      .querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>(
        '.editable-block-save, .editable-block-cancel, .editable-block-textarea',
      )
      .forEach((node) => {
        node.disabled = busy
      })

    const { article } = blockParts(cid)
    if (article && block && isVisualBlock(block)) {
      article.contentEditable = busy ? 'false' : 'true'
    }
  }

  function setBlockActive(cid: string, active: boolean) {
    const shell = getBlockShell(cid)
    if (!shell) return
    shell.dataset.active = active ? 'true' : 'false'
  }

  function closeEditor(cid: string) {
    const block = blockMap.get(cid)
    const { preview, article: previewArticle, form, textarea } = blockParts(cid)
    const visual = block && isVisualBlock(block)
    if (preview) preview.hidden = false
    if (preview) preview.dataset.editing = 'false'
    if (previewArticle && block) {
      previewArticle.contentEditable = 'false'
      previewArticle.removeAttribute('data-inline-reveal')
      clearInlineFocusMarkers(previewArticle)
      previewArticle.innerHTML = block.previewHtml
    }
    if (form) form.hidden = true
    if (block && textarea) {
      textarea.value = block.raw
      resizeTextarea(textarea)
    }
    setConflictVisible(cid, false)
    setBlockActive(cid, false)
    setOverwriteVisible(false)
    clearSaveTimer()
    if (pendingCloseCid === cid) pendingCloseCid = null
    if (activeCid === cid) {
      activeCid = null
      dirty = false
      setStatus('saved', 'Saved')
    }
  }

  function openEditor(cid: string, clickContext: ClickContext | null) {
    if (activeCid === cid) return

    if (dirty && activeCid && !window.confirm('Discard unsaved changes in the current block?')) {
      return
    }

    if (activeCid) {
      closeEditor(activeCid)
    }

    const block = blockMap.get(cid)
    const { preview, article: previewArticle, form, textarea } = blockParts(cid)
    const visual = block && isVisualBlock(block)

    if (!block || !preview || !form) return

    preview.hidden = false
    preview.dataset.editing = 'true'
    form.hidden = false
    setBlockActive(cid, true)

    if (visual && previewArticle) {
      previewArticle.contentEditable = 'true'
      previewArticle.focus()
      if (!placeCaretAtPoint(previewArticle, clickContext)) {
        placeCaretAtElementEnd(previewArticle)
      }
      setInlineRevealEnabled(previewArticle, true)
      refreshInlineFocusMarkers(previewArticle)
    } else if (textarea) {
      preview.hidden = true
      textarea.value = block.raw
      resizeTextarea(textarea)
      textarea.focus()
      const cursorOffset = resolveCursorOffset(block, clickContext)
      textarea.setSelectionRange(cursorOffset, cursorOffset)
      textarea.scrollTop = 0
    }

    activeCid = cid
    dirty = false
    clearSaveTimer()
    setConflictVisible(cid, false)
    setOverwriteVisible(false)
    setStatus('saved', visual ? 'Visual editing' : 'Editing block')
  }

  function scheduleSave(delayMs = 1000) {
    clearSaveTimer()
    if (!activeCid) return
    saveTimer = window.setTimeout(() => {
      void saveActiveBlock(false)
    }, delayMs)
  }

  async function pollForExternalChanges() {
    try {
      const snapshot = await fetchSnapshot(state.apiPath, true)
      if (pollFailed) {
        pollFailed = false
        if (!dirty && !saving) {
          setStatus('saved', 'Reconnected')
        }
      }

      if (snapshot.version === currentVersion) {
        return
      }

      if (!dirty && !saving && !activeCid) {
        await reloadDocumentState('Reloaded external change')
        return
      }

      if (activeCid) {
        setConflictVisible(activeCid, true)
      }
      setOverwriteVisible(Boolean(activeCid))
      setStatus('conflict', 'Changed on disk. Reload disk version.')
    } catch (_) {
      pollFailed = true
      if (!dirty && !saving) {
        setStatus('error', 'Disconnected. Retrying…')
      }
    }
  }

  function markDirtyState() {
    dirty = true
    setStatus('dirty', 'Unsaved changes')
    scheduleSave()
  }

  function applySavedBlock(block: EditableBlock, nextRaw: string, previewHtml: string) {
    const previousLength = block.endOffset - block.startOffset
    const delta = nextRaw.length - previousLength
    const blockIndex = blockOrder.indexOf(block.cid)

    currentContent = currentContent.slice(0, block.startOffset) + nextRaw + currentContent.slice(block.endOffset)

    block.raw = nextRaw
    block.previewHtml = previewHtml
    block.endOffset = block.startOffset + nextRaw.length

    for (let index = blockIndex + 1; index < blockOrder.length; index += 1) {
      const nextBlock = blockMap.get(blockOrder[index])
      if (!nextBlock) continue
      nextBlock.startOffset += delta
      nextBlock.endOffset += delta
    }

    const { article: previewArticle } = blockParts(block.cid)
    if (
      previewArticle &&
      !(activeCid === block.cid && isVisualBlock(block) && previewArticle.contentEditable === 'true')
    ) {
      previewArticle.innerHTML = previewHtml
    }
  }

  async function saveActiveBlock(force: boolean) {
    if (!activeCid || saving) return

    const cid = activeCid
    const block = blockMap.get(cid)
    const { textarea, article: previewArticle } = blockParts(cid)
    if (!block) return

    if (isVisualBlock(block) && previewArticle) {
      block.type = normalizeVisualBlockType(previewArticle)
    }

    const shouldRefreshDocument =
      isVisualBlock(block) && previewArticle ? countTopLevelBlockElements(previewArticle) > 1 : false

    const visualBlock = isVisualBlock(block) && previewArticle
    const rawFromEditor = visualBlock ? serializeVisualBlock(block, previewArticle) : textarea?.value
    if (typeof rawFromEditor !== 'string') return
    const nextRaw = visualBlock ? normalizeVisualSaveRaw(rawFromEditor) : rawFromEditor
    if (!force && nextRaw === block.raw && !dirty) {
      setStatus('saved', 'Saved')
      return
    }

    const prefixContent = currentContent.slice(0, block.startOffset)
    const suffixContent = visualBlock
      ? normalizeVisualSaveSuffix(currentContent.slice(block.endOffset))
      : currentContent.slice(block.endOffset)
    const nextContent = prefixContent + nextRaw + suffixContent

    saving = true
    clearSaveTimer()
    setEditorBusy(cid, true)
    setStatus('saving', 'Saving…')

    try {
      const saved = await saveDocument(state.apiPath, nextContent, currentVersion, force)

      if (saved.status === 'conflict') {
        pendingCloseCid = null
        setConflictVisible(cid, true)
        setOverwriteVisible(true)
        setStatus('conflict', 'Changed on disk. Reload or overwrite.')
        return
      }

      const previewHtml = await renderBlock(state.renderBlockApiPath, block.type, nextRaw)
      currentVersion = saved.version
      applySavedBlock(block, nextRaw, previewHtml)
      dirty = false
      setConflictVisible(cid, false)
      setOverwriteVisible(false)
      setStatus('saved', 'Saved')
      if (shouldRefreshDocument) {
        await reloadDocumentState('Saved')
        return
      }
      if (pendingCloseCid === cid) {
        closeEditor(cid)
      }
    } catch (error) {
      pendingCloseCid = null
      const message = error instanceof Error ? error.message : 'Failed to save markdown document'
      setStatus('error', dirty ? message + ' Retrying…' : message)
      if (dirty && activeCid === cid) {
        scheduleSave(2000)
      }
    } finally {
      saving = false
      setEditorBusy(cid, false)
    }
  }

  // The first render: the blocks as shells, the frontmatter above them, the handlers on both.
  const blockList = document.createElement('div')
  blockList.className = 'editable-block-list'
  blockList.innerHTML = renderBlockListHtml(state.blocks)
  root.replaceChildren(blockList)
  ensureFrontmatterPanel(currentFrontmatter)
  attachBlockHandlers(root, ops)

  const onKeydown = (event: KeyboardEvent) => {
    const wantsSave = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's'
    if (!wantsSave) return
    if (!activeCid) return
    event.preventDefault()
    void saveActiveBlock(false)
  }

  const onSelectionChange = () => {
    if (!activeCid) {
      return
    }

    const block = blockMap.get(activeCid)
    if (!block || !isVisualBlock(block)) {
      return
    }

    const { article: previewArticle } = blockParts(activeCid)
    if (!previewArticle || previewArticle.contentEditable !== 'true') {
      return
    }

    refreshInlineFocusMarkers(previewArticle)
  }

  document.addEventListener('keydown', onKeydown)
  document.addEventListener('selectionchange', onSelectionChange)

  setStatus('saved', 'Saved')
  setOverwriteVisible(false)
  const pollTimer = window.setInterval(() => {
    void pollForExternalChanges()
  }, pollIntervalMs)

  return {
    reload() {
      void reloadDocumentState('Reloaded disk version')
    },
    overwrite() {
      void saveActiveBlock(true)
    },
    destroy() {
      // Leaving mid-edit saves the open block, as leaving the block would have.
      if (dirty && activeCid && !saving) void saveActiveBlock(false)
      clearSaveTimer()
      window.clearInterval(pollTimer)
      document.removeEventListener('keydown', onKeydown)
      document.removeEventListener('selectionchange', onSelectionChange)
    },
  }
}
