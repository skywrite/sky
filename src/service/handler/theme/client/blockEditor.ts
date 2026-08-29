// @ts-nocheck
// The block editor as it was: the old /docs page's inline script, moved here whole and typed at
// its seam only. The redo replaces it; until then it reads as the vanilla JS it is.

/**
 * The block editor, in the column. A file is its blocks — paragraphs, headings, lists and
 * quotes edited in place as rendered text, everything else (fences, tables, raw HTML) as its
 * markdown in a textarea — and a save rewrites only the edited block's source range. It
 * autosaves after a second's idle, watches the file for outside changes, and on a conflict
 * offers the disk version or an overwrite.
 *
 * `mountBlockEditor` renders into `root` and owns everything inside it; the page keeps the
 * chrome — status, the conflict choice, done — and drives it through the handle and hooks.
 */

export interface EditableBlock {
  cid: string
  type: string
  label: string
  raw: string
  previewHtml: string
  startOffset: number
  endOffset: number
  protected: boolean
  cursorMap?: number[]
  listItemCursorMaps?: number[][]
}

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
  let activeCid = null
  let dirty = false
  let saving = false
  let saveTimer = null
  let pendingCloseCid = null
  let pollFailed = false
  const pollIntervalMs = 4000

  function setStatus(kind, text) {
    hooks.onStatus(kind, text)
  }

  function setOverwriteVisible(visible) {
    hooks.onConflict(visible)
  }

  function getBlockList() {
    return root.querySelector('.editable-block-list')
  }

  function getFrontmatterPanel() {
    return root.querySelector('.sky-doc-meta')
  }

  function getFrontmatterContent() {
    return root.querySelector('.sky-doc-meta pre')
  }

  function getBlockShell(cid) {
    return root.querySelector('.editable-block[data-cid="' + cid + '"]')
  }

  function getTextarea(cid) {
    const shell = getBlockShell(cid)
    return shell ? shell.querySelector('.editable-block-textarea') : null
  }

  function getPreview(cid) {
    const shell = getBlockShell(cid)
    return shell ? shell.querySelector('.editable-block-preview-shell') : null
  }

  function getPreviewArticle(cid) {
    const preview = getPreview(cid)
    return preview ? preview.querySelector('.editable-block-preview') : null
  }

  function getForm(cid) {
    const shell = getBlockShell(cid)
    return shell ? shell.querySelector('.editable-block-form') : null
  }

  function getConflictControls(cid) {
    const shell = getBlockShell(cid)
    if (!shell) return { reload: null, overwrite: null }
    return {
      reload: shell.querySelector('.editable-block-reload'),
      overwrite: shell.querySelector('.editable-block-overwrite'),
    }
  }

  function setConflictVisible(cid, visible) {
    const controls = getConflictControls(cid)
    if (controls.reload) controls.reload.hidden = !visible
    if (controls.overwrite) controls.overwrite.hidden = !visible
  }

  function clearSaveTimer() {
    if (saveTimer) {
      window.clearTimeout(saveTimer)
      saveTimer = null
    }
  }

  function isVisualBlock(block) {
    return !block.protected && ['paragraph', 'heading', 'blockquote', 'list'].includes(block.type)
  }

  function isChromelessBlock(block) {
    return !block.protected && ['paragraph', 'heading', 'blockquote', 'list', 'hr'].includes(block.type)
  }

  function isInteractiveBlock(block) {
    return isVisualBlock(block) || block.protected
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function renderBlockShellHtml(block) {
    const visual = isVisualBlock(block)
    const chromeless = isChromelessBlock(block)
    const interactive = isInteractiveBlock(block)

    return `
      <section
        id="${escapeHtml(block.cid)}"
        class="editable-block"
        data-cid="${escapeHtml(block.cid)}"
        data-active="false"
        data-protected="${block.protected ? 'true' : 'false'}"
        data-visual="${visual ? 'true' : 'false'}"
        data-chromeless="${chromeless ? 'true' : 'false'}"
        data-interactive="${interactive ? 'true' : 'false'}"
      >
        ${
          !chromeless
            ? `<div class="editable-block-header">
              <div>
                <p class="editable-block-label">${escapeHtml(block.label)}</p>
                <p class="editable-block-meta">Raw-preserved block</p>
              </div>
            </div>`
            : ''
        }
        <div
          class="editable-block-preview-shell"
          data-editing="false"
          ${interactive ? 'role="button" tabindex="0"' : ''}
        >
          <article class="editable-block-preview sky-doc-body">${block.previewHtml}</article>
        </div>
        ${
          visual || !interactive
            ? '<div class="editable-block-form" hidden></div>'
            : `<div class="editable-block-form" hidden>
              <textarea
                class="editable-block-textarea"
                data-cid="${escapeHtml(block.cid)}"
                spellcheck="false"
                aria-label="${escapeHtml(block.label)} markdown"
              >${escapeHtml(block.raw)}</textarea>
              <div class="editable-block-actions">
                <button class="editor-action-button editable-block-save" type="button" data-cid="${escapeHtml(block.cid)}">
                  Save now
                </button>
                <button class="editor-action-button editable-block-cancel" type="button" data-cid="${escapeHtml(block.cid)}">
                  Revert
                </button>
                <button class="editor-action-button editable-block-reload" type="button" data-cid="${escapeHtml(block.cid)}" hidden>
                  Reload disk version
                </button>
                <button class="editor-action-button editable-block-overwrite" type="button" data-cid="${escapeHtml(block.cid)}" hidden>
                  Overwrite disk version
                </button>
              </div>
              <p class="editable-block-help">
                Only this block&apos;s source range is rewritten. Press <kbd>Cmd/Ctrl+S</kbd>
                to save immediately or <kbd>Esc</kbd> to revert.
              </p>
            </div>`
        }
      </section>
    `
  }

  function renderBlockListHtml(blocks) {
    return blocks.map((block) => renderBlockShellHtml(block)).join('')
  }

  function ensureFrontmatterPanel(frontmatter) {
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

  async function fetchDocumentState() {
    const response = await fetch(state.documentApiPath, {
      headers: { accept: 'application/json' },
    })

    if (!response.ok) {
      throw new Error('Failed to rebuild markdown document state')
    }

    return await response.json()
  }

  function applyDocumentState(nextState, statusText) {
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

    attachBlockEventHandlers()
    setStatus('saved', statusText)
  }

  async function reloadDocumentState(statusText) {
    const nextState = await fetchDocumentState()
    applyDocumentState(nextState, statusText)
  }

  function resizeTextarea(textarea) {
    const shell = textarea.closest('.editable-block')
    const minHeight = shell && shell.dataset.protected === 'true' ? 120 : 52
    textarea.style.height = '0px'
    textarea.style.height = Math.max(textarea.scrollHeight, minHeight) + 'px'
  }

  function preferredCursorOffset(raw) {
    const trimmedLength = raw.replace(/[\s\u00a0]+$/u, '').length
    return trimmedLength > 0 ? trimmedLength : 0
  }

  function findVisibleTextCursorOffset(raw, textOffset, blockPrefixPattern) {
    const lines = raw.split('\n')
    let remaining = textOffset
    let offset = 0

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex]
      const prefixMatch = blockPrefixPattern ? line.match(blockPrefixPattern) : null
      const prefixLength = prefixMatch ? prefixMatch[0].length : 0
      const visibleLength = Math.max(line.length - prefixLength, 0)

      if (remaining <= visibleLength) {
        return offset + prefixLength + remaining
      }

      remaining -= visibleLength
      offset += line.length
      if (lineIndex < lines.length - 1) {
        offset += 1
      }
    }

    return preferredCursorOffset(raw)
  }

  function findHeadingCursorOffset(raw, textOffset) {
    const firstLine = raw.split('\n')[0] || ''
    const prefixMatch = firstLine.match(/^(\s*#{1,6}\s+)/)
    const prefixLength = prefixMatch ? prefixMatch[0].length : 0
    return prefixLength + Math.min(textOffset, Math.max(firstLine.length - prefixLength, 0))
  }

  function findListItemCursorOffset(raw, listItemIndex, textOffset) {
    const lines = raw.split('\n')
    let currentIndex = 0
    let offset = 0

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex]
      const markerMatch = line.match(/^(\s*)(?:[-+*]|\d+[.)])(?:\s+\[[ xX]\])?\s+/)
      if (markerMatch) {
        if (currentIndex === listItemIndex) {
          const markerLength = markerMatch[0].length
          const visibleLength = Math.max(line.length - markerLength, 0)
          return offset + markerLength + Math.min(textOffset, visibleLength)
        }
        currentIndex += 1
      }

      offset += line.length
      if (lineIndex < lines.length - 1) {
        offset += 1
      }
    }

    return preferredCursorOffset(raw)
  }

  function resolveCursorOffset(block, clickContext) {
    function resolveMappedOffset(cursorMap, visibleOffset) {
      if (!Array.isArray(cursorMap) || cursorMap.length === 0) {
        return null
      }

      const clampedOffset = Math.max(0, Math.min(visibleOffset, cursorMap.length - 1))
      return cursorMap[clampedOffset]
    }

    if (clickContext && typeof clickContext.listItemIndex === 'number' && block.type === 'list') {
      const mappedOffset = resolveMappedOffset(
        block.listItemCursorMaps && block.listItemCursorMaps[clickContext.listItemIndex],
        clickContext.textOffset || 0,
      )
      if (typeof mappedOffset === 'number') {
        return mappedOffset
      }
      return findListItemCursorOffset(block.raw, clickContext.listItemIndex, clickContext.textOffset || 0)
    }

    if (clickContext && typeof clickContext.textOffset === 'number') {
      const mappedOffset = resolveMappedOffset(block.cursorMap, clickContext.textOffset)
      if (typeof mappedOffset === 'number') {
        return mappedOffset
      }

      switch (block.type) {
        case 'heading':
          return findHeadingCursorOffset(block.raw, clickContext.textOffset)
        case 'paragraph':
          return findVisibleTextCursorOffset(block.raw, clickContext.textOffset, null)
        case 'blockquote':
          return findVisibleTextCursorOffset(block.raw, clickContext.textOffset, /^(\s*>+\s*)/)
      }
    }

    return preferredCursorOffset(block.raw)
  }

  function getPointRange(documentRef, clientX, clientY) {
    if (typeof documentRef.caretPositionFromPoint === 'function') {
      const caretPosition = documentRef.caretPositionFromPoint(clientX, clientY)
      if (caretPosition) {
        const range = documentRef.createRange()
        range.setStart(caretPosition.offsetNode, caretPosition.offset)
        range.collapse(true)
        return range
      }
    }

    if (typeof documentRef.caretRangeFromPoint === 'function') {
      const range = documentRef.caretRangeFromPoint(clientX, clientY)
      if (range) {
        range.collapse(true)
        return range
      }
    }

    return null
  }

  function getTextOffsetWithinElement(element, event) {
    const documentRef = element.ownerDocument
    const pointRange = getPointRange(documentRef, event.clientX, event.clientY)
    if (!pointRange || !element.contains(pointRange.startContainer)) {
      return null
    }

    const prefixRange = documentRef.createRange()
    prefixRange.selectNodeContents(element)
    prefixRange.setEnd(pointRange.startContainer, pointRange.startOffset)
    return prefixRange.toString().length
  }

  function resolveClickContext(preview, event) {
    const target = event.target
    if (!(target instanceof Node)) {
      return null
    }

    const previewArticle = preview.querySelector('.editable-block-preview')
    if (!(previewArticle instanceof Element)) {
      return null
    }

    const targetElement = target instanceof Element ? target : target.parentElement
    if (!targetElement) {
      return null
    }

    const textContainer = targetElement.closest('li, p, h1, h2, h3, h4, h5, h6')
    const textOffset =
      textContainer && previewArticle.contains(textContainer) ? getTextOffsetWithinElement(textContainer, event) : null

    const listItem = targetElement.closest('li')
    if (listItem && previewArticle.contains(listItem)) {
      const items = Array.from(previewArticle.querySelectorAll('li'))
      const listItemIndex = items.indexOf(listItem)
      if (listItemIndex >= 0) {
        return {
          clientX: event.clientX,
          clientY: event.clientY,
          listItemIndex,
          textOffset: textOffset ?? 0,
        }
      }
    }

    if (typeof textOffset === 'number') {
      return {
        clientX: event.clientX,
        clientY: event.clientY,
        textOffset,
      }
    }

    return null
  }

  function setEditorBusy(cid, busy) {
    const block = blockMap.get(cid)
    const shell = getBlockShell(cid)
    if (!shell) return

    shell.querySelectorAll('.editable-block-save, .editable-block-cancel, .editable-block-textarea').forEach((node) => {
      node.disabled = busy
    })

    const previewArticle = getPreviewArticle(cid)
    if (previewArticle && block && isVisualBlock(block)) {
      previewArticle.contentEditable = busy ? 'false' : 'true'
    }
  }

  function setBlockActive(cid, active) {
    const shell = getBlockShell(cid)
    if (!shell) return
    shell.dataset.active = active ? 'true' : 'false'
  }

  function closeEditor(cid) {
    const block = blockMap.get(cid)
    const preview = getPreview(cid)
    const previewArticle = getPreviewArticle(cid)
    const form = getForm(cid)
    const textarea = getTextarea(cid)
    const visual = block && isVisualBlock(block)
    if (preview) preview.hidden = false
    if (preview) preview.dataset.editing = 'false'
    if (previewArticle && block) {
      previewArticle.contentEditable = 'false'
      previewArticle.removeAttribute('data-inline-reveal')
      clearInlineFocusMarkers(previewArticle)
      previewArticle.innerHTML = block.previewHtml
    }
    if (form) form.hidden = visual ? true : true
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

  function placeCaretAtPoint(article, clickContext) {
    if (!clickContext || typeof clickContext.clientX !== 'number' || typeof clickContext.clientY !== 'number') {
      return false
    }

    const range = getPointRange(article.ownerDocument, clickContext.clientX, clickContext.clientY)
    if (!range || !article.contains(range.startContainer)) {
      return false
    }

    const selection = article.ownerDocument.getSelection()
    if (!selection) {
      return false
    }

    selection.removeAllRanges()
    selection.addRange(range)
    return true
  }

  function placeCaretAtEnd(article) {
    const selection = article.ownerDocument.getSelection()
    if (!selection) return
    const range = article.ownerDocument.createRange()
    range.selectNodeContents(article)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  function clearInlineFocusMarkers(article) {
    article.querySelectorAll('[data-inline-focus="true"]').forEach((node) => {
      if (node instanceof HTMLElement) {
        node.removeAttribute('data-inline-focus')
      }
    })
  }

  function setInlineRevealEnabled(article, enabled) {
    if (enabled) {
      article.setAttribute('data-inline-reveal', 'true')
      return
    }

    article.removeAttribute('data-inline-reveal')
  }

  function findFocusedInlineElement(article, node) {
    let current = node instanceof HTMLElement ? node : node.parentElement
    while (current && current !== article) {
      if (current.matches('strong, em, del, code, a, u')) {
        return current
      }
      current = current.parentElement
    }
    return null
  }

  function refreshInlineFocusMarkers(article) {
    clearInlineFocusMarkers(article)
    const range = getSelectionRangeWithin(article)
    if (!range) {
      setInlineRevealEnabled(article, false)
      return
    }

    setInlineRevealEnabled(article, true)
    const target = findFocusedInlineElement(article, range.startContainer)
    if (target) {
      target.setAttribute('data-inline-focus', 'true')
    }
  }

  function openEditor(cid, clickContext) {
    if (activeCid === cid) return

    if (dirty && activeCid && !window.confirm('Discard unsaved changes in the current block?')) {
      return
    }

    if (activeCid) {
      closeEditor(activeCid)
    }

    const block = blockMap.get(cid)
    const preview = getPreview(cid)
    const previewArticle = getPreviewArticle(cid)
    const form = getForm(cid)
    const textarea = getTextarea(cid)
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
        placeCaretAtEnd(previewArticle)
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

  async function pollForExternalChanges() {
    try {
      const snapshot = await fetchSnapshot(true)
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

  function getSelectionRangeWithin(article) {
    const selection = article.ownerDocument.getSelection()
    if (!selection || selection.rangeCount === 0) {
      return null
    }

    const range = selection.getRangeAt(0)
    if (!article.contains(range.startContainer) || !article.contains(range.endContainer)) {
      return null
    }

    return range
  }

  function getClosestElementWithin(root, node, selector) {
    const element = node instanceof Element ? node : node.parentElement
    if (!element) {
      return null
    }

    const closest = element.closest(selector)
    if (!(closest instanceof HTMLElement) || !root.contains(closest)) {
      return null
    }

    return closest
  }

  function isRangeAtStart(container, range) {
    const prefixRange = container.ownerDocument.createRange()
    prefixRange.selectNodeContents(container)
    prefixRange.setEnd(range.startContainer, range.startOffset)
    return prefixRange.toString().length === 0
  }

  function isRangeAtEnd(container, range) {
    const suffixRange = container.ownerDocument.createRange()
    suffixRange.selectNodeContents(container)
    suffixRange.setStart(range.endContainer, range.endOffset)
    return suffixRange.toString().length === 0
  }

  function isRangeEquivalentToElementContents(range, element) {
    const elementRange = element.ownerDocument.createRange()
    elementRange.selectNodeContents(element)
    return (
      range.compareBoundaryPoints(Range.START_TO_START, elementRange) === 0 &&
      range.compareBoundaryPoints(Range.END_TO_END, elementRange) === 0
    )
  }

  function hasMeaningfulChildNodes(fragment) {
    return Array.from(fragment.childNodes).some((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return (node.textContent || '').length > 0
      }

      return node instanceof HTMLElement
    })
  }

  function clearNode(element) {
    while (element.firstChild) {
      element.removeChild(element.firstChild)
    }
  }

  function createPlaceholder(doc) {
    return doc.createElement('br')
  }

  function setElementFromFragment(element, fragment) {
    clearNode(element)
    if (hasMeaningfulChildNodes(fragment)) {
      element.appendChild(fragment)
      return
    }

    element.appendChild(createPlaceholder(element.ownerDocument))
  }

  function removePlaceholderIfNeeded(element) {
    if (element.childNodes.length !== 1) {
      return
    }

    const firstChild = element.firstChild
    if (firstChild instanceof HTMLElement && firstChild.tagName === 'BR') {
      element.removeChild(firstChild)
    }
  }

  function placeCaretAtElementStart(element) {
    const selection = element.ownerDocument.getSelection()
    if (!selection) return

    const range = element.ownerDocument.createRange()
    range.selectNodeContents(element)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  function placeCaretAtElementEnd(element) {
    const selection = element.ownerDocument.getSelection()
    if (!selection) return

    const range = element.ownerDocument.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  function splitElementAtRange(element, range, nextTagName) {
    const doc = element.ownerDocument
    const beforeRange = doc.createRange()
    beforeRange.selectNodeContents(element)
    beforeRange.setEnd(range.startContainer, range.startOffset)

    const afterRange = doc.createRange()
    afterRange.selectNodeContents(element)
    afterRange.setStart(range.endContainer, range.endOffset)

    const beforeFragment = beforeRange.cloneContents()
    const afterFragment = afterRange.cloneContents()

    setElementFromFragment(element, beforeFragment)

    const nextElement = doc.createElement(nextTagName)
    setElementFromFragment(nextElement, afterFragment)

    element.parentNode?.insertBefore(nextElement, element.nextSibling)
    placeCaretAtElementStart(nextElement)
    markDirtyState()

    return nextElement
  }

  function replaceElementTag(element, tagName) {
    const replacement = element.ownerDocument.createElement(tagName)
    while (element.firstChild) {
      replacement.appendChild(element.firstChild)
    }
    element.replaceWith(replacement)
    return replacement
  }

  function getLeadingBlockElement(article) {
    return Array.from(article.children).find((node) => node instanceof HTMLElement) || null
  }

  function normalizeVisualBlockType(article) {
    const firstElement = getLeadingBlockElement(article)
    if (!(firstElement instanceof HTMLElement)) {
      return 'paragraph'
    }

    const tag = firstElement.tagName.toLowerCase()
    if (/^h[1-6]$/.test(tag)) {
      return 'heading'
    }
    if (tag === 'blockquote') {
      return 'blockquote'
    }
    if (tag === 'ul' || tag === 'ol') {
      return 'list'
    }
    if (tag === 'hr') {
      return 'hr'
    }

    return 'paragraph'
  }

  function countTopLevelBlockElements(article) {
    return Array.from(article.children).filter((node) => {
      if (!(node instanceof HTMLElement)) {
        return false
      }

      const tag = node.tagName.toLowerCase()
      return ['p', 'div', 'blockquote', 'ul', 'ol', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)
    }).length
  }

  function applyHeadingShortcut(article, block) {
    const range = getSelectionRangeWithin(article)
    if (!range || !range.collapsed) {
      return false
    }

    const firstElement = getLeadingBlockElement(article)
    if (!(firstElement instanceof HTMLElement)) {
      return false
    }

    const tag = firstElement.tagName.toLowerCase()
    if (tag !== 'p' && tag !== 'div') {
      return false
    }

    const prefixRange = article.ownerDocument.createRange()
    prefixRange.selectNodeContents(firstElement)
    prefixRange.setEnd(range.startContainer, range.startOffset)

    const suffixRange = article.ownerDocument.createRange()
    suffixRange.selectNodeContents(firstElement)
    suffixRange.setStart(range.endContainer, range.endOffset)

    const prefixText = normalizeText(prefixRange.toString()).trim()
    const suffixText = normalizeText(suffixRange.toString()).trim()
    const fullText = normalizeText(firstElement.textContent || '').trim()
    const match = fullText.match(/^#{1,6}$/)
    if (!match) {
      return false
    }

    if (prefixText !== fullText || suffixText.length > 0) {
      return false
    }

    const heading = replaceElementTag(firstElement, 'h' + fullText.length)
    clearNode(heading)
    heading.appendChild(createPlaceholder(heading.ownerDocument))
    block.type = 'heading'
    placeCaretAtElementStart(heading)
    return true
  }

  function createEmptyParagraph(documentRef) {
    const paragraph = documentRef.createElement('p')
    paragraph.appendChild(createPlaceholder(documentRef))
    return paragraph
  }

  function createEmptyListItem(documentRef, checked) {
    const listItem = documentRef.createElement('li')
    if (typeof checked === 'boolean') {
      const checkbox = documentRef.createElement('input')
      checkbox.setAttribute('type', 'checkbox')
      checkbox.checked = checked
      if (checked) {
        checkbox.setAttribute('checked', '')
      }
      listItem.appendChild(checkbox)
      listItem.appendChild(documentRef.createTextNode(' '))
    }
    listItem.appendChild(createPlaceholder(documentRef))
    return listItem
  }

  function createContinuationListItem(sourceListItem) {
    const checkbox = getDirectCheckboxInput(sourceListItem)
    return createEmptyListItem(sourceListItem.ownerDocument, checkbox ? false : undefined)
  }

  function createParagraphFromListItem(listItem) {
    const paragraph = listItem.ownerDocument.createElement('p')
    const childNodes = Array.from(listItem.childNodes)

    childNodes.forEach((node) => {
      if (node instanceof HTMLInputElement && node.getAttribute('type') === 'checkbox') {
        return
      }

      if (node instanceof HTMLElement && (node.tagName === 'UL' || node.tagName === 'OL')) {
        return
      }

      paragraph.appendChild(node)
    })

    if (!hasMeaningfulChildNodes(paragraph)) {
      paragraph.appendChild(createPlaceholder(listItem.ownerDocument))
    }

    return paragraph
  }

  function replaceArticleContent(article, rootElement) {
    clearNode(article)
    article.appendChild(rootElement)
  }

  function applyParagraphPrefixShortcut(article, block) {
    const range = getSelectionRangeWithin(article)
    if (!range || !range.collapsed) {
      return false
    }

    const firstElement = getLeadingBlockElement(article)
    if (!(firstElement instanceof HTMLElement)) {
      return false
    }

    const tag = firstElement.tagName.toLowerCase()
    if (tag !== 'p' && tag !== 'div') {
      return false
    }

    const prefixRange = article.ownerDocument.createRange()
    prefixRange.selectNodeContents(firstElement)
    prefixRange.setEnd(range.startContainer, range.startOffset)

    const suffixRange = article.ownerDocument.createRange()
    suffixRange.selectNodeContents(firstElement)
    suffixRange.setStart(range.endContainer, range.endOffset)

    const prefixText = normalizeText(prefixRange.toString()).trim()
    const suffixText = normalizeText(suffixRange.toString()).trim()
    const fullText = normalizeText(firstElement.textContent || '').trim()

    if (prefixText !== fullText || suffixText.length > 0) {
      return false
    }

    const documentRef = article.ownerDocument

    if (/^[-+*]$/.test(fullText)) {
      const list = documentRef.createElement('ul')
      const listItem = createEmptyListItem(documentRef)
      list.appendChild(listItem)
      replaceArticleContent(article, list)
      block.type = 'list'
      placeCaretAtElementEnd(listItem)
      return true
    }

    if (/^\d+[.)]$/.test(fullText)) {
      const list = documentRef.createElement('ol')
      const listItem = createEmptyListItem(documentRef)
      list.appendChild(listItem)
      replaceArticleContent(article, list)
      block.type = 'list'
      placeCaretAtElementEnd(listItem)
      return true
    }

    if (/^\[(?: |x|X)\]$/.test(fullText)) {
      const list = documentRef.createElement('ul')
      const listItem = createEmptyListItem(documentRef, /x/i.test(fullText))
      list.appendChild(listItem)
      replaceArticleContent(article, list)
      block.type = 'list'
      placeCaretAtElementEnd(listItem)
      return true
    }

    if (fullText === '>') {
      const quote = documentRef.createElement('blockquote')
      const paragraph = createEmptyParagraph(documentRef)
      quote.appendChild(paragraph)
      replaceArticleContent(article, quote)
      block.type = 'blockquote'
      placeCaretAtElementStart(paragraph)
      return true
    }

    return false
  }

  function applyThematicBreakShortcut(article) {
    const range = getSelectionRangeWithin(article)
    if (!range || !range.collapsed) {
      return false
    }

    const firstElement = getLeadingBlockElement(article)
    if (!(firstElement instanceof HTMLElement)) {
      return false
    }

    const tag = firstElement.tagName.toLowerCase()
    if (tag !== 'p' && tag !== 'div') {
      return false
    }

    const prefixRange = article.ownerDocument.createRange()
    prefixRange.selectNodeContents(firstElement)
    prefixRange.setEnd(range.startContainer, range.startOffset)

    const suffixRange = article.ownerDocument.createRange()
    suffixRange.selectNodeContents(firstElement)
    suffixRange.setStart(range.endContainer, range.endOffset)

    const fullText = normalizeText(firstElement.textContent || '').trim()
    const prefixText = normalizeText(prefixRange.toString()).trim()
    const suffixText = normalizeText(suffixRange.toString()).trim()

    if (!/^(-{3,}|\*{3,}|_{3,})$/.test(fullText)) {
      return false
    }

    if (prefixText !== fullText || suffixText.length > 0) {
      return false
    }

    const documentRef = article.ownerDocument
    const hr = documentRef.createElement('hr')
    const paragraph = createEmptyParagraph(documentRef)
    clearNode(article)
    article.appendChild(hr)
    article.appendChild(paragraph)
    placeCaretAtElementStart(paragraph)
    markDirtyState()
    return true
  }

  function applyTaskListShortcutFallback(article, block) {
    const firstElement = getLeadingBlockElement(article)
    if (!(firstElement instanceof HTMLElement)) {
      return false
    }

    const tag = firstElement.tagName.toLowerCase()
    if (tag !== 'p' && tag !== 'div') {
      return false
    }

    const fullText = normalizeText(firstElement.textContent || '')
    const match = fullText.match(/^\[( |x|X)\]\s+([\s\S]*)$/)
    if (!match) {
      return false
    }

    const checked = (match[1] || '').toLowerCase() === 'x'
    const content = match[2] ?? ''
    const documentRef = article.ownerDocument
    const list = documentRef.createElement('ul')
    const listItem = createEmptyListItem(documentRef, checked)
    clearNode(listItem)

    const checkbox = documentRef.createElement('input')
    checkbox.setAttribute('type', 'checkbox')
    checkbox.checked = checked
    if (checked) {
      checkbox.setAttribute('checked', '')
    }
    listItem.appendChild(checkbox)
    listItem.appendChild(documentRef.createTextNode(' '))

    if (content.length > 0) {
      listItem.appendChild(documentRef.createTextNode(content))
    } else {
      listItem.appendChild(createPlaceholder(documentRef))
    }

    list.appendChild(listItem)
    replaceArticleContent(article, list)
    block.type = 'list'
    placeCaretAtElementEnd(listItem)
    return true
  }

  function applyMarkdownShortcuts(article, block) {
    if (applyTaskListShortcutFallback(article, block)) {
      return true
    }
    block.type = normalizeVisualBlockType(article)
    return false
  }

  function getPreviousElementSibling(element) {
    let candidate = element.previousSibling
    while (candidate) {
      if (candidate instanceof HTMLElement) {
        return candidate
      }
      candidate = candidate.previousSibling
    }
    return null
  }

  function getDirectCheckboxInput(li) {
    const candidate = li.firstElementChild
    if (candidate instanceof HTMLInputElement && candidate.getAttribute('type') === 'checkbox') {
      return candidate
    }

    return null
  }

  function cloneCheckboxInput(checkbox, checked) {
    const clone = checkbox.cloneNode(true)
    clone.checked = checked
    if (checked) {
      clone.setAttribute('checked', '')
    } else {
      clone.removeAttribute('checked')
    }
    return clone
  }

  function setListItemFromFragment(element, fragment, checkboxTemplate) {
    clearNode(element)
    if (checkboxTemplate) {
      element.appendChild(cloneCheckboxInput(checkboxTemplate, false))
      element.appendChild(element.ownerDocument.createTextNode(' '))
    }

    if (hasMeaningfulChildNodes(fragment)) {
      element.appendChild(fragment)
      return
    }

    element.appendChild(createPlaceholder(element.ownerDocument))
  }

  function getListItemInlineText(li) {
    const clone = li.cloneNode(true)
    Array.from(clone.childNodes).forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return
      }

      if (node.tagName === 'INPUT' && node.getAttribute('type') === 'checkbox') {
        node.remove()
        return
      }

      if (node.tagName === 'UL' || node.tagName === 'OL') {
        node.remove()
      }
    })

    return normalizeText(clone.textContent || '').trim()
  }

  function hasDirectNestedList(li) {
    return Array.from(li.children).some((child) => child.tagName === 'UL' || child.tagName === 'OL')
  }

  function getListItemInsertionPoint(li) {
    return Array.from(li.children).find((child) => child.tagName === 'UL' || child.tagName === 'OL') || null
  }

  function insertNodeIntoListItem(li, node) {
    const nestedList = getListItemInsertionPoint(li)
    if (nestedList) {
      li.insertBefore(node, nestedList)
      return
    }

    li.appendChild(node)
  }

  function mergeBlockElements(target, source) {
    removePlaceholderIfNeeded(target)

    const movingNodes = Array.from(source.childNodes)
    for (const node of movingNodes) {
      target.appendChild(node)
    }

    source.remove()
    placeCaretAtElementEnd(target)
    markDirtyState()
  }

  function getDeepestLastListItem(list) {
    if (!(list instanceof HTMLElement) || (list.tagName !== 'UL' && list.tagName !== 'OL')) {
      return null
    }

    let currentList = list
    let lastItem = Array.from(currentList.children)
      .filter((child) => child.tagName === 'LI')
      .at(-1)

    while (lastItem instanceof HTMLElement) {
      const nestedList = Array.from(lastItem.children)
        .filter((child) => child.tagName === 'UL' || child.tagName === 'OL')
        .at(-1)

      if (!(nestedList instanceof HTMLElement)) {
        return lastItem
      }

      currentList = nestedList
      lastItem = Array.from(currentList.children)
        .filter((child) => child.tagName === 'LI')
        .at(-1)
    }

    return null
  }

  function mergeParagraphIntoListItem(listItem, paragraph) {
    removePlaceholderIfNeeded(listItem)
    const movingNodes = Array.from(paragraph.childNodes)
    for (const node of movingNodes) {
      insertNodeIntoListItem(listItem, node)
    }
    paragraph.remove()
    placeCaretAtElementEnd(listItem)
    markDirtyState()
    return true
  }

  function mergeParagraphWithPrevious(paragraph) {
    const previous = getPreviousElementSibling(paragraph)
    if (!previous) {
      return false
    }

    const tag = previous.tagName
    if (tag === 'P' || tag === 'DIV' || /^H[1-6]$/.test(tag)) {
      mergeBlockElements(previous, paragraph)
      return true
    }

    if (tag === 'BLOCKQUOTE') {
      const targetParagraph = Array.from(previous.children)
        .filter((child) => child.tagName === 'P')
        .at(-1)

      if (targetParagraph instanceof HTMLElement) {
        mergeBlockElements(targetParagraph, paragraph)
        return true
      }
    }

    if (tag === 'UL' || tag === 'OL') {
      const targetItem = getDeepestLastListItem(previous)
      if (targetItem) {
        return mergeParagraphIntoListItem(targetItem, paragraph)
      }
      previous.remove()
      placeCaretAtElementStart(paragraph)
      markDirtyState()
      return true
    }

    if (tag === 'HR') {
      previous.remove()
      placeCaretAtElementStart(paragraph)
      markDirtyState()
      return true
    }

    return false
  }

  function mergeListItems(target, source) {
    removePlaceholderIfNeeded(target)

    const movingNodes = Array.from(source.childNodes)
    for (const node of movingNodes) {
      if (node instanceof HTMLInputElement && node.getAttribute('type') === 'checkbox') {
        continue
      }
      insertNodeIntoListItem(target, node)
    }

    source.remove()
    placeCaretAtElementEnd(target)
    markDirtyState()
  }

  function ensureNestedList(parentItem, tagName) {
    const existing = Array.from(parentItem.children).find((child) => child.tagName === tagName)
    if (existing instanceof HTMLElement) {
      return existing
    }

    const nestedList = parentItem.ownerDocument.createElement(tagName.toLowerCase())
    parentItem.appendChild(nestedList)
    return nestedList
  }

  function unwrapListItemToParagraph(listItem) {
    const list = listItem.parentElement
    if (!(list instanceof HTMLElement) || (list.tagName !== 'UL' && list.tagName !== 'OL')) {
      return false
    }

    const nestedLists = Array.from(listItem.children).filter(
      (child) => child.tagName === 'UL' || child.tagName === 'OL',
    )
    const insertionPoint = listItem.nextSibling
    nestedLists.forEach((nestedList) => {
      Array.from(nestedList.children)
        .filter((child) => child.tagName === 'LI')
        .forEach((childItem) => {
          list.insertBefore(childItem, insertionPoint)
        })
      nestedList.remove()
    })

    const paragraph = createParagraphFromListItem(listItem)
    list.parentNode?.insertBefore(paragraph, list)
    listItem.remove()

    if (list.children.length === 0) {
      list.remove()
    }

    placeCaretAtElementStart(paragraph)
    markDirtyState()
    return true
  }

  function isNestedListItem(listItem) {
    const list = listItem.parentElement
    if (!(list instanceof HTMLElement) || (list.tagName !== 'UL' && list.tagName !== 'OL')) {
      return false
    }

    return list.parentElement instanceof HTMLElement && list.parentElement.tagName === 'LI'
  }

  function unwrapBlockquoteParagraph(paragraph) {
    const blockquote = paragraph.parentElement
    if (!(blockquote instanceof HTMLElement) || blockquote.tagName !== 'BLOCKQUOTE') {
      return false
    }

    const previousSibling = getPreviousElementSibling(paragraph)
    if (previousSibling) {
      return false
    }

    const parent = blockquote.parentNode
    if (!parent) {
      return false
    }

    const liftedParagraph = paragraph.ownerDocument.createElement('p')
    while (paragraph.firstChild) {
      liftedParagraph.appendChild(paragraph.firstChild)
    }
    if (!hasMeaningfulChildNodes(liftedParagraph)) {
      liftedParagraph.appendChild(createPlaceholder(paragraph.ownerDocument))
    }

    parent.insertBefore(liftedParagraph, blockquote)
    paragraph.remove()

    if (!blockquote.children.length) {
      blockquote.remove()
    }

    placeCaretAtElementStart(liftedParagraph)
    markDirtyState()
    return true
  }

  function indentListItem(listItem) {
    const list = listItem.parentElement
    if (!list || (list.tagName !== 'UL' && list.tagName !== 'OL')) {
      return false
    }

    const previousItem = getPreviousElementSibling(listItem)
    if (!previousItem || previousItem.tagName !== 'LI') {
      return false
    }

    const nestedList = ensureNestedList(previousItem, list.tagName)
    nestedList.appendChild(listItem)
    placeCaretAtElementStart(listItem)
    markDirtyState()
    return true
  }

  function outdentListItem(listItem) {
    const list = listItem.parentElement
    if (!list || (list.tagName !== 'UL' && list.tagName !== 'OL')) {
      return false
    }

    const parentItem = list.parentElement
    const parentList = parentItem?.parentElement
    if (!(parentItem instanceof HTMLElement) || parentItem.tagName !== 'LI') {
      return false
    }
    if (!(parentList instanceof HTMLElement) || (parentList.tagName !== 'UL' && parentList.tagName !== 'OL')) {
      return false
    }

    parentList.insertBefore(listItem, parentItem.nextSibling)
    if (list.children.length === 0) {
      list.remove()
    }
    placeCaretAtElementStart(listItem)
    markDirtyState()
    return true
  }

  function splitActiveHeading(article, range) {
    const heading = getClosestElementWithin(article, range.startContainer, 'h1, h2, h3, h4, h5, h6')
    if (!heading) {
      return false
    }

    if (isRangeAtStart(heading, range)) {
      const paragraph = createEmptyParagraph(heading.ownerDocument)
      heading.parentNode?.insertBefore(paragraph, heading)
      placeCaretAtElementStart(paragraph)
      markDirtyState()
      return true
    }

    if (isRangeAtEnd(heading, range)) {
      const paragraph = createEmptyParagraph(heading.ownerDocument)
      heading.parentNode?.insertBefore(paragraph, heading.nextSibling)
      placeCaretAtElementStart(paragraph)
      markDirtyState()
      return true
    }

    splitElementAtRange(heading, range, 'p')
    return true
  }

  function splitActiveParagraph(article, range) {
    const paragraph = getClosestElementWithin(article, range.startContainer, 'p')
    if (!paragraph) {
      return false
    }

    if (isRangeAtStart(paragraph, range)) {
      const nextParagraph = createEmptyParagraph(paragraph.ownerDocument)
      paragraph.parentNode?.insertBefore(nextParagraph, paragraph)
      placeCaretAtElementStart(nextParagraph)
      markDirtyState()
      return true
    }

    if (isRangeAtEnd(paragraph, range)) {
      const nextParagraph = createEmptyParagraph(paragraph.ownerDocument)
      paragraph.parentNode?.insertBefore(nextParagraph, paragraph.nextSibling)
      placeCaretAtElementStart(nextParagraph)
      markDirtyState()
      return true
    }

    splitElementAtRange(paragraph, range, 'p')
    return true
  }

  function splitActiveBlockquoteParagraph(article, range) {
    const paragraph = getClosestElementWithin(article, range.startContainer, 'p')
    if (!paragraph) {
      return false
    }
    if (paragraph.parentElement?.tagName !== 'BLOCKQUOTE') {
      return false
    }

    if (normalizeText(paragraph.textContent || '').trim().length === 0) {
      const blockquote = paragraph.parentElement
      if (!(blockquote instanceof HTMLElement) || blockquote.tagName !== 'BLOCKQUOTE') {
        return false
      }

      const nextParagraph = paragraph.ownerDocument.createElement('p')
      nextParagraph.appendChild(createPlaceholder(paragraph.ownerDocument))
      blockquote.parentNode?.insertBefore(nextParagraph, blockquote.nextSibling)
      paragraph.remove()
      if (!blockquote.children.length) {
        blockquote.remove()
      }
      placeCaretAtElementStart(nextParagraph)
      markDirtyState()
      return true
    }

    if (isRangeAtStart(paragraph, range)) {
      const nextParagraph = createEmptyParagraph(paragraph.ownerDocument)
      paragraph.parentNode?.insertBefore(nextParagraph, paragraph)
      placeCaretAtElementStart(nextParagraph)
      markDirtyState()
      return true
    }

    if (isRangeAtEnd(paragraph, range)) {
      const nextParagraph = createEmptyParagraph(paragraph.ownerDocument)
      paragraph.parentNode?.insertBefore(nextParagraph, paragraph.nextSibling)
      placeCaretAtElementStart(nextParagraph)
      markDirtyState()
      return true
    }

    splitElementAtRange(paragraph, range, 'p')
    return true
  }

  function splitActiveListItem(article, range) {
    const listItem = getClosestElementWithin(article, range.startContainer, 'li')
    if (!listItem) {
      return false
    }

    if (getListItemInlineText(listItem).length === 0 && !hasDirectNestedList(listItem)) {
      const list = listItem.parentElement
      if (!list) {
        return false
      }

      const paragraph = list.ownerDocument.createElement('p')
      paragraph.appendChild(createPlaceholder(list.ownerDocument))
      listItem.remove()

      if (list.children.length === 0) {
        list.replaceWith(paragraph)
      } else {
        list.parentNode?.insertBefore(paragraph, list.nextSibling)
      }

      placeCaretAtElementStart(paragraph)
      markDirtyState()
      return true
    }

    if (isRangeAtStart(listItem, range)) {
      const previousItem = createContinuationListItem(listItem)
      listItem.parentNode?.insertBefore(previousItem, listItem)
      placeCaretAtElementStart(previousItem)
      markDirtyState()
      return true
    }

    if (isRangeAtEnd(listItem, range)) {
      const nextItem = createContinuationListItem(listItem)
      listItem.parentNode?.insertBefore(nextItem, listItem.nextSibling)
      placeCaretAtElementStart(nextItem)
      markDirtyState()
      return true
    }

    const doc = listItem.ownerDocument
    const beforeRange = doc.createRange()
    beforeRange.selectNodeContents(listItem)
    beforeRange.setEnd(range.startContainer, range.startOffset)

    const afterRange = doc.createRange()
    afterRange.selectNodeContents(listItem)
    afterRange.setStart(range.endContainer, range.endOffset)

    const beforeFragment = beforeRange.cloneContents()
    const afterFragment = afterRange.cloneContents()
    const checkbox = getDirectCheckboxInput(listItem)

    setElementFromFragment(listItem, beforeFragment)

    const nextItem = doc.createElement('li')
    setListItemFromFragment(nextItem, afterFragment, checkbox)
    listItem.parentNode?.insertBefore(nextItem, listItem.nextSibling)

    placeCaretAtElementStart(nextItem)
    markDirtyState()
    return true
  }

  function handleEnterForVisualBlock(article, event) {
    if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
      return false
    }

    const range = getSelectionRangeWithin(article)
    if (!range) {
      return false
    }

    if (getClosestElementWithin(article, range.startContainer, 'li')) {
      return splitActiveListItem(article, range)
    }

    const quoteParagraph = getClosestElementWithin(article, range.startContainer, 'p')
    if (quoteParagraph?.parentElement?.tagName === 'BLOCKQUOTE') {
      return splitActiveBlockquoteParagraph(article, range)
    }

    if (getClosestElementWithin(article, range.startContainer, 'h1, h2, h3, h4, h5, h6')) {
      return splitActiveHeading(article, range)
    }

    if (getClosestElementWithin(article, range.startContainer, 'p')) {
      if (applyThematicBreakShortcut(article)) {
        return true
      }
      return splitActiveParagraph(article, range)
    }

    return false
  }

  function handleBackspaceForVisualBlock(article) {
    const range = getSelectionRangeWithin(article)
    if (!range || !range.collapsed) {
      return false
    }

    const heading = getClosestElementWithin(article, range.startContainer, 'h1, h2, h3, h4, h5, h6')
    if (heading && isRangeAtStart(heading, range)) {
      const paragraph = replaceElementTag(heading, 'p')
      placeCaretAtElementStart(paragraph)
      markDirtyState()
      return true
    }

    const listItem = getClosestElementWithin(article, range.startContainer, 'li')
    if (listItem && isRangeAtStart(listItem, range)) {
      if (isNestedListItem(listItem)) {
        return outdentListItem(listItem)
      }

      const previousItem = getPreviousElementSibling(listItem)
      if (previousItem && previousItem.tagName === 'LI') {
        mergeListItems(previousItem, listItem)
        return true
      }

      return unwrapListItemToParagraph(listItem)
    }

    const paragraph = getClosestElementWithin(article, range.startContainer, 'p')
    if (paragraph && paragraph.parentElement?.tagName === 'BLOCKQUOTE' && isRangeAtStart(paragraph, range)) {
      return unwrapBlockquoteParagraph(paragraph)
    }

    if (paragraph && isRangeAtStart(paragraph, range)) {
      return mergeParagraphWithPrevious(paragraph)
    }

    return false
  }

  function handleTabForVisualBlock(article, event) {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return false
    }

    const range = getSelectionRangeWithin(article)
    if (!range) {
      return false
    }

    const listItem = getClosestElementWithin(article, range.startContainer, 'li')
    if (!listItem) {
      return false
    }

    return event.shiftKey ? outdentListItem(listItem) : indentListItem(listItem)
  }

  function unwrapInlineElement(element) {
    const parent = element.parentNode
    if (!parent) {
      return false
    }

    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element)
    }

    element.remove()
    return true
  }

  function applyUnderlineShortcut(article) {
    const range = getSelectionRangeWithin(article)
    if (!range || range.collapsed) {
      return false
    }

    const startUnderline = getClosestElementWithin(article, range.startContainer, 'u')
    const endUnderline = getClosestElementWithin(article, range.endContainer, 'u')

    if (
      startUnderline &&
      endUnderline &&
      startUnderline === endUnderline &&
      isRangeEquivalentToElementContents(range, startUnderline)
    ) {
      const firstNode = startUnderline.firstChild
      const lastNode = startUnderline.lastChild
      if (!firstNode || !lastNode) {
        return false
      }

      if (!unwrapInlineElement(startUnderline)) {
        return false
      }

      const selection = article.ownerDocument.getSelection()
      if (selection) {
        const unwrappedRange = article.ownerDocument.createRange()
        unwrappedRange.setStart(firstNode, 0)
        if (lastNode.nodeType === Node.TEXT_NODE) {
          unwrappedRange.setEnd(lastNode, (lastNode.textContent || '').length)
        } else {
          unwrappedRange.setEnd(lastNode, lastNode.childNodes.length)
        }
        selection.removeAllRanges()
        selection.addRange(unwrappedRange)
      }

      return true
    }

    const fragment = range.extractContents()
    if (!hasMeaningfulChildNodes(fragment)) {
      return false
    }

    const underline = article.ownerDocument.createElement('u')
    underline.appendChild(fragment)
    range.insertNode(underline)

    const selection = article.ownerDocument.getSelection()
    if (selection) {
      const underlinedRange = article.ownerDocument.createRange()
      underlinedRange.selectNodeContents(underline)
      selection.removeAllRanges()
      selection.addRange(underlinedRange)
    }

    return true
  }

  async function renderPreviewHtml(type, raw) {
    const response = await fetch(state.renderBlockApiPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, raw }),
    })

    if (!response.ok) {
      throw new Error('Failed to render updated block preview')
    }

    const payload = await response.json()
    if (!payload || typeof payload.html !== 'string') {
      throw new Error('Render block API returned an invalid payload')
    }

    return payload.html
  }

  function normalizeText(text) {
    return text.replace(/\u00a0/g, ' ').replace(/[\u200b\u200c\u200d\ufeff]/g, '')
  }

  function sanitizeUrl(value) {
    const normalized = value.trim()
    if (!normalized || /^javascript:/i.test(normalized)) {
      return ''
    }

    return normalized
  }

  function appendSanitizedNode(target, node) {
    if (!node) {
      return
    }

    target.appendChild(node)
  }

  function appendSanitizedChildren(source, target, documentRef) {
    Array.from(source.childNodes).forEach((child) => {
      appendSanitizedNode(target, sanitizePastedNode(child, documentRef))
    })
  }

  function createMultilineParagraph(documentRef, text) {
    const paragraph = documentRef.createElement('p')
    const lines = normalizeText(text).replace(/\r\n?/g, '\n').split('\n')

    lines.forEach((line, index) => {
      if (index > 0) {
        paragraph.appendChild(documentRef.createElement('br'))
      }
      paragraph.appendChild(documentRef.createTextNode(line))
    })

    return paragraph
  }

  function createTableFragment(table, documentRef) {
    const fragment = documentRef.createDocumentFragment()
    const rows = Array.from(table.querySelectorAll('tr'))
      .map((row) =>
        Array.from(row.querySelectorAll('th, td'))
          .map((cell) =>
            normalizeText(cell.textContent || '')
              .replace(/\s+/g, ' ')
              .trim(),
          )
          .filter((cell) => cell.length > 0)
          .join(' / '),
      )
      .filter((rowText) => rowText.length > 0)

    rows.forEach((rowText) => {
      fragment.appendChild(createMultilineParagraph(documentRef, rowText))
    })

    if (fragment.firstChild) {
      return fragment
    }

    const fallback = normalizeText(table.textContent || '').trim()
    if (fallback.length > 0) {
      fragment.appendChild(createMultilineParagraph(documentRef, fallback))
    }
    return fragment
  }

  function sanitizePastedNode(node, documentRef) {
    if (node.nodeType === Node.TEXT_NODE) {
      return documentRef.createTextNode(normalizeText(node.textContent || ''))
    }

    if (!(node instanceof HTMLElement)) {
      return null
    }

    const tag = node.tagName.toLowerCase()

    switch (tag) {
      case 'strong':
      case 'b':
      case 'em':
      case 'i':
      case 'u':
      case 'del':
      case 's':
      case 'code':
      case 'p':
      case 'div':
      case 'blockquote':
      case 'ul':
      case 'ol':
      case 'li':
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const element = documentRef.createElement(tag)
        appendSanitizedChildren(node, element, documentRef)
        return element
      }
      case 'a': {
        const href = sanitizeUrl(node.getAttribute('href') || '')
        const element = documentRef.createElement('a')
        if (href) {
          element.setAttribute('href', href)
        }
        appendSanitizedChildren(node, element, documentRef)
        return element
      }
      case 'img': {
        const src = sanitizeUrl(node.getAttribute('src') || '')
        if (!src) {
          return null
        }
        const image = documentRef.createElement('img')
        image.setAttribute('src', src)
        image.setAttribute('alt', node.getAttribute('alt') || '')
        return image
      }
      case 'input': {
        if (node.getAttribute('type') !== 'checkbox') {
          return null
        }

        const checkbox = documentRef.createElement('input')
        checkbox.setAttribute('type', 'checkbox')
        const checked = node.hasAttribute('checked') || node.getAttribute('aria-checked') === 'true'
        if (checked) {
          checkbox.checked = true
          checkbox.setAttribute('checked', '')
        }
        return checkbox
      }
      case 'br':
        return documentRef.createElement('br')
      case 'pre':
        return createMultilineParagraph(documentRef, node.textContent || '')
      case 'table':
        return createTableFragment(node, documentRef)
      case 'hr':
        return createMultilineParagraph(documentRef, '---')
      case 'style':
      case 'script':
      case 'link':
      case 'meta':
      case 'noscript':
      case 'template':
        return null
      default: {
        const fragment = documentRef.createDocumentFragment()
        appendSanitizedChildren(node, fragment, documentRef)
        return fragment
      }
    }
  }

  function sanitizePastedHtml(rawHtml, documentRef) {
    const parser = new DOMParser()
    const parsed = parser.parseFromString(rawHtml, 'text/html')
    const container = documentRef.createElement('div')
    appendSanitizedChildren(parsed.body, container, documentRef)
    return container.innerHTML
  }

  function escapeHtmlForInsert(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function plainTextToHtml(text) {
    const normalized = normalizeText(text).replace(/\r\n?/g, '\n').trimEnd()
    if (!normalized) {
      return ''
    }

    return normalized
      .split(/\n{2,}/)
      .map((paragraph) => '<p>' + paragraph.split('\n').map(escapeHtmlForInsert).join('<br>') + '</p>')
      .join('')
  }

  function insertHtmlAtSelection(article, html) {
    if (!html) {
      return false
    }

    const documentRef = article.ownerDocument
    article.focus()

    if (typeof documentRef.execCommand === 'function') {
      try {
        if (documentRef.execCommand('insertHTML', false, html)) {
          return true
        }
      } catch (_) {
        // Fall back to a manual Range insert.
      }
    }

    const selection = documentRef.getSelection()
    if (!selection || selection.rangeCount === 0) {
      return false
    }

    const range = selection.getRangeAt(0)
    if (!article.contains(range.commonAncestorContainer)) {
      return false
    }

    range.deleteContents()

    const wrapper = documentRef.createElement('div')
    wrapper.innerHTML = html
    const fragment = documentRef.createDocumentFragment()
    let lastNode = null

    while (wrapper.firstChild) {
      lastNode = fragment.appendChild(wrapper.firstChild)
    }

    range.insertNode(fragment)

    if (lastNode) {
      const nextRange = documentRef.createRange()
      nextRange.setStartAfter(lastNode)
      nextRange.collapse(true)
      selection.removeAllRanges()
      selection.addRange(nextRange)
    }

    return true
  }

  function escapeMarkdownText(text) {
    const tick = String.fromCharCode(96)
    return normalizeText(text)
      .replace(/\\/g, '\\\\')
      .replace(new RegExp(tick, 'g'), '\\' + tick)
      .replace(/([*_{}\[\]])/g, '\\$1')
  }

  function serializeCodeText(text) {
    const normalized = normalizeText(text)
    const tick = String.fromCharCode(96)
    const marker = normalized.includes(tick) ? tick + tick : tick
    return marker + normalized + marker
  }

  function serializeInlineNodes(nodes) {
    let output = ''

    Array.from(nodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        output += escapeMarkdownText(node.textContent || '')
        return
      }

      if (!(node instanceof HTMLElement)) {
        return
      }

      const tag = node.tagName.toLowerCase()

      switch (tag) {
        case 'strong':
        case 'b':
          output += '**' + serializeInlineNodes(node.childNodes) + '**'
          return
        case 'em':
        case 'i':
          output += '*' + serializeInlineNodes(node.childNodes) + '*'
          return
        case 'del':
        case 's':
          output += '~~' + serializeInlineNodes(node.childNodes) + '~~'
          return
        case 'u':
          output += '<u>' + serializeInlineNodes(node.childNodes) + '</u>'
          return
        case 'code':
          output += serializeCodeText(node.textContent || '')
          return
        case 'a': {
          const href = node.getAttribute('href') || ''
          output += '[' + serializeInlineNodes(node.childNodes) + '](' + href.replace(/\)/g, '\\)') + ')'
          return
        }
        case 'img': {
          const src = node.getAttribute('src') || ''
          const alt = node.getAttribute('alt') || ''
          output += '![' + escapeMarkdownText(alt) + '](' + src.replace(/\)/g, '\\)') + ')'
          return
        }
        case 'br':
          output += '\n'
          return
        case 'input':
          return
        default:
          output += serializeInlineNodes(node.childNodes)
      }
    })

    return output
  }

  function isWhitespaceNode(node) {
    return node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim().length === 0
  }

  function serializeBlockElement(element, depth) {
    const tag = element.tagName.toLowerCase()

    switch (tag) {
      case 'p':
        return serializeInlineNodes(element.childNodes).trimEnd()
      case 'div':
        return serializeInlineNodes(element.childNodes).trimEnd()
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return '#'.repeat(Number(tag.slice(1))) + ' ' + serializeInlineNodes(element.childNodes).trimEnd()
      case 'blockquote':
        return serializeBlockquote(element, depth)
      case 'ul':
      case 'ol':
        return serializeList(element, depth)
      case 'hr':
        return '---'
      default:
        return serializeInlineNodes(element.childNodes).trimEnd()
    }
  }

  function serializeBlockChildren(container, depth) {
    const parts = []
    const directNodes = Array.from(container.childNodes).filter((node) => !isWhitespaceNode(node))

    directNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = normalizeSerializedMarkdown(escapeMarkdownText(node.textContent || '')).trim()
        if (text.length > 0) {
          parts.push(text)
        }
        return
      }

      if (!(node instanceof HTMLElement)) {
        return
      }

      const serialized = normalizeSerializedMarkdown(serializeBlockElement(node, depth))
      if (serialized.trim().length === 0) {
        return
      }
      parts.push(serialized)
    })

    return parts.join('\n\n')
  }

  function serializeBlockquote(blockquote, depth) {
    const inner = serializeBlockChildren(blockquote, depth).trimEnd()
    if (inner.length === 0) {
      return '>'
    }

    return inner
      .split('\n')
      .map((line) => (line.length > 0 ? '> ' + line : '>'))
      .join('\n')
  }

  function serializeListItem(li, ordered, index, depth) {
    const indent = '  '.repeat(depth)
    const checkbox = li.querySelector(':scope > input[type="checkbox"]')
    const checkboxPrefix = checkbox ? (checkbox.checked ? '[x] ' : '[ ] ') : ''

    const inlineNodes = []
    const nestedLists = []

    Array.from(li.childNodes).forEach((node) => {
      if (node instanceof HTMLElement && (node.tagName === 'UL' || node.tagName === 'OL')) {
        nestedLists.push(node)
        return
      }

      if (node instanceof HTMLElement && node.tagName === 'INPUT' && node.getAttribute('type') === 'checkbox') {
        return
      }

      inlineNodes.push(node)
    })

    const marker = ordered ? String(index + 1) + '. ' : '- '
    const lineBody = serializeInlineNodes(inlineNodes).trim()
    const lines = [indent + marker + checkboxPrefix + lineBody]

    nestedLists.forEach((list) => {
      const nestedMarkdown = serializeList(list, depth + 1)
      if (nestedMarkdown.length > 0) {
        lines.push(nestedMarkdown)
      }
    })

    return lines.join('\n')
  }

  function serializeList(listElement, depth) {
    const ordered = listElement.tagName === 'OL'
    return Array.from(listElement.children)
      .filter((node) => node instanceof HTMLElement && node.tagName === 'LI')
      .map((li, index) => serializeListItem(li, ordered, index, depth))
      .join('\n')
  }

  function normalizeSerializedMarkdown(markdown) {
    return markdown
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => {
        if (/^[ \t]+$/.test(line)) {
          return ''
        }
        return line.replace(/[ \t]+$/g, '')
      })
      .join('\n')
  }

  function serializeVisualBlock(block, previewArticle) {
    const markdown = normalizeSerializedMarkdown(serializeBlockChildren(previewArticle, 0)).trimEnd()
    return markdown.length > 0 ? markdown + '\n' : '\n'
  }

  function normalizeVisualSaveRaw(raw) {
    return raw.replace(/\r\n?/g, '\n').replace(/\n[ \t]+\n/g, '\n\n')
  }

  function normalizeVisualSaveSuffix(suffix) {
    return suffix.replace(/^[^\S\n]+\n/, '')
  }

  function applySavedBlock(block, nextRaw, previewHtml) {
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

    const previewArticle = getPreviewArticle(block.cid)
    if (
      previewArticle &&
      !(activeCid === block.cid && isVisualBlock(block) && previewArticle.contentEditable === 'true')
    ) {
      previewArticle.innerHTML = previewHtml
    }
  }

  async function saveActiveBlock(force) {
    if (!activeCid || saving) return

    const cid = activeCid
    const block = blockMap.get(cid)
    const textarea = getTextarea(cid)
    const previewArticle = getPreviewArticle(cid)
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
      const response = await fetch(state.apiPath, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: nextContent,
          version: currentVersion,
          force,
        }),
      })

      if (response.status === 409) {
        pendingCloseCid = null
        setConflictVisible(cid, true)
        setOverwriteVisible(true)
        setStatus('conflict', 'Changed on disk. Reload or overwrite.')
        return
      }

      if (!response.ok) {
        throw new Error('Failed to save markdown document')
      }

      const saved = await response.json()
      const previewHtml = await renderPreviewHtml(block.type, nextRaw)
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

  function attachBlockEventHandlers() {
    root.querySelectorAll('.editable-block-preview-shell').forEach((preview) => {
      preview.addEventListener('click', (event) => {
        const shell = preview.closest('.editable-block')
        if (!shell) return
        if (shell.dataset.interactive !== 'true') {
          return
        }
        if (shell.dataset.active === 'true' && shell.dataset.visual === 'true') {
          return
        }
        event.preventDefault()
        openEditor(shell.dataset.cid, resolveClickContext(preview, event))
      })

      preview.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        const shell = preview.closest('.editable-block')
        if (!shell) return
        if (shell.dataset.interactive !== 'true') {
          return
        }
        if (shell.dataset.active === 'true') {
          return
        }
        event.preventDefault()
        openEditor(shell.dataset.cid, null)
      })
    })

    root.querySelectorAll('.editable-block-cancel').forEach((button) => {
      button.addEventListener('click', () => {
        if (dirty && !window.confirm('Discard unsaved changes in this block?')) {
          return
        }

        const cid = button.dataset.cid
        if (!cid) return
        closeEditor(cid)
        if (activeCid === cid) activeCid = null
        dirty = false
        setStatus('saved', 'Saved')
      })
    })

    root.querySelectorAll('.editable-block-save').forEach((button) => {
      button.addEventListener('click', () => {
        void saveActiveBlock(false)
      })
    })

    root.querySelectorAll('.editable-block-reload').forEach((button) => {
      button.addEventListener('click', () => {
        void reloadDocumentState('Reloaded disk version')
      })
    })

    root.querySelectorAll('.editable-block-overwrite').forEach((button) => {
      button.addEventListener('click', () => {
        void saveActiveBlock(true)
      })
    })

    root.querySelectorAll('.editable-block-textarea').forEach((textarea) => {
      textarea.addEventListener('input', () => {
        if (activeCid !== textarea.dataset.cid) return
        resizeTextarea(textarea)
        markDirtyState()
      })

      textarea.addEventListener('blur', () => {
        const cid = textarea.dataset.cid
        if (!cid || activeCid !== cid) return

        window.setTimeout(() => {
          const shell = getBlockShell(cid)
          if (!shell) return

          const nextFocused = document.activeElement
          if (nextFocused instanceof Node && shell.contains(nextFocused)) {
            return
          }

          if (dirty) {
            pendingCloseCid = cid
            void saveActiveBlock(false)
            return
          }

          closeEditor(cid)
        }, 0)
      })

      textarea.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return
        const cid = textarea.dataset.cid
        if (!cid) return
        event.preventDefault()
        if (dirty && !window.confirm('Discard unsaved changes in this block?')) {
          return
        }
        closeEditor(cid)
      })
    })

    root.querySelectorAll('.editable-block-preview').forEach((article) => {
      article.addEventListener('input', () => {
        const shell = article.closest('.editable-block')
        if (!shell || activeCid !== shell.dataset.cid || shell.dataset.visual !== 'true') return
        const block = blockMap.get(shell.dataset.cid)
        if (block) {
          applyMarkdownShortcuts(article, block)
        }
        refreshInlineFocusMarkers(article)
        markDirtyState()
      })

      article.addEventListener('focus', () => {
        const shell = article.closest('.editable-block')
        if (!shell || activeCid !== shell.dataset.cid || shell.dataset.visual !== 'true') return
        setInlineRevealEnabled(article, true)
        refreshInlineFocusMarkers(article)
      })

      article.addEventListener('keyup', () => {
        const shell = article.closest('.editable-block')
        if (!shell || activeCid !== shell.dataset.cid || shell.dataset.visual !== 'true') return
        refreshInlineFocusMarkers(article)
      })

      article.addEventListener('mouseup', () => {
        const shell = article.closest('.editable-block')
        if (!shell || activeCid !== shell.dataset.cid || shell.dataset.visual !== 'true') return
        refreshInlineFocusMarkers(article)
      })

      article.addEventListener('blur', () => {
        const shell = article.closest('.editable-block')
        const cid = shell?.dataset.cid
        if (!cid || activeCid !== cid || shell?.dataset.visual !== 'true') return

        window.setTimeout(() => {
          const nextFocused = document.activeElement
          if (nextFocused instanceof Node && shell.contains(nextFocused)) {
            return
          }

          setInlineRevealEnabled(article, false)
          clearInlineFocusMarkers(article)

          if (dirty) {
            pendingCloseCid = cid
            void saveActiveBlock(false)
            return
          }

          closeEditor(cid)
        }, 0)
      })

      article.addEventListener('keydown', (event) => {
        const shell = article.closest('.editable-block')
        const cid = shell?.dataset.cid
        if (!cid || activeCid !== cid || shell?.dataset.visual !== 'true') return

        const block = blockMap.get(cid)
        if (!block) return

        if (event.key === 'Escape') {
          event.preventDefault()
          if (dirty && !window.confirm('Discard unsaved changes in this block?')) {
            return
          }
          closeEditor(cid)
          return
        }

        if (event.key === ' ' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
          if (applyHeadingShortcut(article, block) || applyParagraphPrefixShortcut(article, block)) {
            event.preventDefault()
            markDirtyState()
            return
          }
        }

        if (event.key === 'Enter') {
          if (handleEnterForVisualBlock(article, event)) {
            event.preventDefault()
            return
          }
        }

        if (event.key === 'Backspace') {
          if (handleBackspaceForVisualBlock(article)) {
            event.preventDefault()
            return
          }
        }

        if (event.key === 'Tab') {
          if (handleTabForVisualBlock(article, event)) {
            event.preventDefault()
            return
          }
        }

        const wantsUnderline =
          (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'u'
        if (wantsUnderline) {
          event.preventDefault()
          if (applyUnderlineShortcut(article)) {
            refreshInlineFocusMarkers(article)
            markDirtyState()
          }
          return
        }
      })

      article.addEventListener('paste', async (event) => {
        const shell = article.closest('.editable-block')
        const cid = shell?.dataset.cid
        if (!cid || activeCid !== cid || shell?.dataset.visual !== 'true') return

        const html = event.clipboardData?.getData('text/html') || ''
        const markdown = event.clipboardData?.getData('text/markdown') || ''
        const plain = event.clipboardData?.getData('text/plain') || ''

        if (html) {
          const sanitizedHtml = sanitizePastedHtml(html, article.ownerDocument)
          if (!sanitizedHtml) {
            return
          }

          event.preventDefault()
          if (insertHtmlAtSelection(article, sanitizedHtml)) {
            markDirtyState()
          }
          return
        }

        const markdownInput = markdown || plain
        if (!markdownInput) {
          return
        }

        event.preventDefault()
        try {
          const rendered = await renderPreviewHtml(
            'paragraph',
            markdownInput.endsWith('\n') ? markdownInput : markdownInput + '\n',
          )
          const sanitizedRendered = sanitizePastedHtml(rendered, article.ownerDocument)
          if (sanitizedRendered && insertHtmlAtSelection(article, sanitizedRendered)) {
            markDirtyState()
            return
          }
        } catch (_) {
          // Fall back to plain text HTML insertion below.
        }

        const fallbackHtml = plainTextToHtml(markdownInput)
        if (fallbackHtml && insertHtmlAtSelection(article, fallbackHtml)) {
          markDirtyState()
        }
      })
    })
  }

  // The first render: the blocks as shells, the frontmatter above them, the handlers on both.
  const blockList = document.createElement('div')
  blockList.className = 'editable-block-list'
  blockList.innerHTML = renderBlockListHtml(state.blocks)
  root.replaceChildren(blockList)
  ensureFrontmatterPanel(currentFrontmatter)
  attachBlockEventHandlers()

  const onKeydown = (event) => {
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

    const previewArticle = getPreviewArticle(activeCid)
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
