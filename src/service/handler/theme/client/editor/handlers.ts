import { renderBlock } from './api.ts'
import { type ClickContext, resolveClickContext } from './caret.ts'
import {
  applyUnderlineShortcut,
  clearInlineFocusMarkers,
  refreshInlineFocusMarkers,
  setInlineRevealEnabled,
} from './inline.ts'
import { handleBackspaceForVisualBlock, handleEnterForVisualBlock, handleTabForVisualBlock } from './keys.ts'
import { insertHtmlAtSelection, plainTextToHtml, sanitizePastedHtml } from './paste.ts'
import { resizeTextarea } from './shell.ts'
import { applyHeadingShortcut, applyMarkdownShortcuts, applyParagraphPrefixShortcut } from './shortcuts.ts'
import type { EditableBlock } from './types.ts'

/**
 * The listeners on the blocks — what a click, a key, an input, a blur, a paste does — wired
 * to the editor through EditorOps, which is all they know of it.
 */

/** What the listeners may do to the editor; the document's state stays with the editor. */
export interface EditorOps {
  /** Where one block renders to HTML */
  readonly renderBlockApiPath: string
  block(cid: string): EditableBlock | undefined
  activeCid(): string | null
  isDirty(): boolean
  open(cid: string, clickContext: ClickContext | null): void
  close(cid: string): void
  /** Close once the pending save has landed — focus left a block with changes in it */
  closeAfterSave(cid: string): void
  /** Close and stand down — the Revert button */
  cancel(cid: string): void
  save(force: boolean): void
  reload(): void
  markDirty(): void
}

export function attachBlockHandlers(root: HTMLElement, editor: EditorOps) {
  root.querySelectorAll<HTMLElement>('.editable-block-preview-shell').forEach((preview) => {
    preview.addEventListener('click', (event) => {
      const shell = preview.closest<HTMLElement>('.editable-block')
      if (!shell) return
      if (shell.dataset.interactive !== 'true') {
        return
      }
      if (shell.dataset.active === 'true' && shell.dataset.visual === 'true') {
        return
      }
      event.preventDefault()
      if (shell.dataset.cid) editor.open(shell.dataset.cid, resolveClickContext(preview, event))
    })

    preview.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const shell = preview.closest<HTMLElement>('.editable-block')
      if (!shell) return
      if (shell.dataset.interactive !== 'true') {
        return
      }
      if (shell.dataset.active === 'true') {
        return
      }
      event.preventDefault()
      if (shell.dataset.cid) editor.open(shell.dataset.cid, null)
    })
  })

  root.querySelectorAll<HTMLButtonElement>('.editable-block-cancel').forEach((button) => {
    button.addEventListener('click', () => {
      if (editor.isDirty() && !window.confirm('Discard unsaved changes in this block?')) {
        return
      }

      const cid = button.dataset.cid
      if (!cid) return
      editor.cancel(cid)
    })
  })

  root.querySelectorAll<HTMLButtonElement>('.editable-block-save').forEach((button) => {
    button.addEventListener('click', () => {
      editor.save(false)
    })
  })

  root.querySelectorAll<HTMLButtonElement>('.editable-block-reload').forEach((button) => {
    button.addEventListener('click', () => {
      editor.reload()
    })
  })

  root.querySelectorAll<HTMLButtonElement>('.editable-block-overwrite').forEach((button) => {
    button.addEventListener('click', () => {
      editor.save(true)
    })
  })

  root.querySelectorAll<HTMLTextAreaElement>('.editable-block-textarea').forEach((textarea) => {
    textarea.addEventListener('input', () => {
      if (editor.activeCid() !== textarea.dataset.cid) return
      resizeTextarea(textarea)
      editor.markDirty()
    })

    textarea.addEventListener('blur', () => {
      const cid = textarea.dataset.cid
      if (!cid || editor.activeCid() !== cid) return

      window.setTimeout(() => {
        const shell = textarea.closest<HTMLElement>('.editable-block')
        if (!shell) return

        const nextFocused = document.activeElement
        if (nextFocused instanceof Node && shell.contains(nextFocused)) {
          return
        }

        if (editor.isDirty()) {
          editor.closeAfterSave(cid)
          return
        }

        editor.close(cid)
      }, 0)
    })

    textarea.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      const cid = textarea.dataset.cid
      if (!cid) return
      event.preventDefault()
      if (editor.isDirty() && !window.confirm('Discard unsaved changes in this block?')) {
        return
      }
      editor.close(cid)
    })
  })

  root.querySelectorAll<HTMLElement>('.editable-block-preview').forEach((article) => {
    article.addEventListener('input', () => {
      const shell = article.closest<HTMLElement>('.editable-block')
      if (!shell || editor.activeCid() !== shell.dataset.cid || shell.dataset.visual !== 'true') return
      const block = editor.block(shell.dataset.cid)
      if (block) {
        applyMarkdownShortcuts(article, block)
      }
      refreshInlineFocusMarkers(article)
      editor.markDirty()
    })

    article.addEventListener('focus', () => {
      const shell = article.closest<HTMLElement>('.editable-block')
      if (!shell || editor.activeCid() !== shell.dataset.cid || shell.dataset.visual !== 'true') return
      setInlineRevealEnabled(article, true)
      refreshInlineFocusMarkers(article)
    })

    article.addEventListener('keyup', () => {
      const shell = article.closest<HTMLElement>('.editable-block')
      if (!shell || editor.activeCid() !== shell.dataset.cid || shell.dataset.visual !== 'true') return
      refreshInlineFocusMarkers(article)
    })

    article.addEventListener('mouseup', () => {
      const shell = article.closest<HTMLElement>('.editable-block')
      if (!shell || editor.activeCid() !== shell.dataset.cid || shell.dataset.visual !== 'true') return
      refreshInlineFocusMarkers(article)
    })

    article.addEventListener('blur', () => {
      const shell = article.closest<HTMLElement>('.editable-block')
      const cid = shell?.dataset.cid
      if (!cid || editor.activeCid() !== cid || shell?.dataset.visual !== 'true') return

      window.setTimeout(() => {
        const nextFocused = document.activeElement
        if (nextFocused instanceof Node && shell.contains(nextFocused)) {
          return
        }

        setInlineRevealEnabled(article, false)
        clearInlineFocusMarkers(article)

        if (editor.isDirty()) {
          editor.closeAfterSave(cid)
          return
        }

        editor.close(cid)
      }, 0)
    })

    article.addEventListener('keydown', (event) => {
      const shell = article.closest<HTMLElement>('.editable-block')
      const cid = shell?.dataset.cid
      if (!cid || editor.activeCid() !== cid || shell?.dataset.visual !== 'true') return

      const block = editor.block(cid)
      if (!block) return

      if (event.key === 'Escape') {
        event.preventDefault()
        if (editor.isDirty() && !window.confirm('Discard unsaved changes in this block?')) {
          return
        }
        editor.close(cid)
        return
      }

      if (event.key === ' ' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (applyHeadingShortcut(article, block) || applyParagraphPrefixShortcut(article, block)) {
          event.preventDefault()
          editor.markDirty()
          return
        }
      }

      if (event.key === 'Enter') {
        if (handleEnterForVisualBlock(article, event)) {
          event.preventDefault()
          editor.markDirty()
          return
        }
      }

      if (event.key === 'Backspace') {
        if (handleBackspaceForVisualBlock(article)) {
          event.preventDefault()
          editor.markDirty()
          return
        }
      }

      if (event.key === 'Tab') {
        if (handleTabForVisualBlock(article, event)) {
          event.preventDefault()
          editor.markDirty()
          return
        }
      }

      const wantsUnderline =
        (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'u'
      if (wantsUnderline) {
        event.preventDefault()
        if (applyUnderlineShortcut(article)) {
          refreshInlineFocusMarkers(article)
          editor.markDirty()
        }
        return
      }
    })

    article.addEventListener('paste', async (event) => {
      const shell = article.closest<HTMLElement>('.editable-block')
      const cid = shell?.dataset.cid
      if (!cid || editor.activeCid() !== cid || shell?.dataset.visual !== 'true') return

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
          editor.markDirty()
        }
        return
      }

      const markdownInput = markdown || plain
      if (!markdownInput) {
        return
      }

      event.preventDefault()
      try {
        const rendered = await renderBlock(
          editor.renderBlockApiPath,
          'paragraph',
          markdownInput.endsWith('\n') ? markdownInput : markdownInput + '\n',
        )
        const sanitizedRendered = sanitizePastedHtml(rendered, article.ownerDocument)
        if (sanitizedRendered && insertHtmlAtSelection(article, sanitizedRendered)) {
          editor.markDirty()
          return
        }
      } catch (_) {
        // Fall back to plain text HTML insertion below.
      }

      const fallbackHtml = plainTextToHtml(markdownInput)
      if (fallbackHtml && insertHtmlAtSelection(article, fallbackHtml)) {
        editor.markDirty()
      }
    })
  })
}
