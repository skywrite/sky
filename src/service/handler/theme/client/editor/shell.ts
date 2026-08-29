import { escapeHtml } from './text.ts'
import type { EditableBlock } from './types.ts'

/**
 * A block's HTML in the column: the rendering to click into, the form with its textarea for
 * a raw block, and the header chrome only a raw block wears.
 */

export function isVisualBlock(block: EditableBlock): boolean {
  return !block.protected && ['paragraph', 'heading', 'blockquote', 'list'].includes(block.type)
}

function isChromelessBlock(block: EditableBlock): boolean {
  return !block.protected && ['paragraph', 'heading', 'blockquote', 'list', 'hr'].includes(block.type)
}

function isInteractiveBlock(block: EditableBlock): boolean {
  return isVisualBlock(block) || block.protected
}

function renderBlockShellHtml(block: EditableBlock): string {
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

export function renderBlockListHtml(blocks: EditableBlock[]): string {
  return blocks.map((block) => renderBlockShellHtml(block)).join('')
}

export function resizeTextarea(textarea: HTMLTextAreaElement) {
  const shell = textarea.closest<HTMLElement>('.editable-block')
  const minHeight = shell && shell.dataset.protected === 'true' ? 120 : 52
  textarea.style.height = '0px'
  textarea.style.height = Math.max(textarea.scrollHeight, minHeight) + 'px'
}
