export const PAGE_CSS = `
:root {
  color-scheme: light;
  --content-scale: 1;
  --page-bg: #f4f1eb;
  --panel-bg: rgba(255, 255, 255, 0.92);
  --panel-border: rgba(17, 24, 39, 0.08);
  --text-main: #172033;
  --text-muted: #586377;
  --accent: #146356;
  --accent-strong: #0d4b41;
  --code-bg: rgba(17, 24, 39, 0.06);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  font-family: Georgia, 'Iowan Old Style', 'Palatino Linotype', serif;
  background:
    radial-gradient(circle at top left, rgba(20, 99, 86, 0.12), transparent 32rem),
    linear-gradient(180deg, #faf8f4 0%, var(--page-bg) 100%);
  color: var(--text-main);
}

a {
  color: inherit;
}

.page-shell {
  width: min(1120px, calc(100vw - 3rem));
  margin: 0 auto;
  padding: 2rem 0 3rem;
}

.app-shell {
  display: grid;
  grid-template-columns: clamp(17rem, 20vw, 21rem) minmax(0, 1fr);
  min-height: 100vh;
}

.page-column {
  min-width: 0;
}

.hero {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 1.5rem;
  margin-bottom: 1.5rem;
  padding: 1.25rem 1.5rem;
  border: 1px solid var(--panel-border);
  border-radius: 1.25rem;
  background: var(--panel-bg);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 36px rgba(16, 24, 40, 0.08);
}

.hero-copy {
  min-width: min(100%, 26rem);
  flex: 1 1 26rem;
}

.eyebrow {
  margin: 0 0 0.5rem;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.82rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
}

.hero h1 {
  margin: 0 0 0.5rem;
  font-size: clamp(1.8rem, 3vw, 2.6rem);
  line-height: 1.05;
}

.hero p {
  margin: 0;
  max-width: 44rem;
  color: var(--text-muted);
  line-height: 1.55;
}

.meta-panel {
  min-width: min(100%, 18rem);
  flex: 0 1 22rem;
}

.meta-label {
  margin: 0 0 0.35rem;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.path-chip {
  margin: 0;
  overflow-wrap: anywhere;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.85rem;
  line-height: 1.5;
}

.theme-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1rem;
}

.font-size-controls {
  margin-top: 1rem;
}

.font-size-buttons {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.font-size-button {
  padding: 0.35rem 0.7rem;
  border: 1px solid rgba(17, 24, 39, 0.12);
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.04);
  color: var(--text-main);
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.78rem;
  cursor: pointer;
}

.font-size-value {
  min-width: 3.4rem;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.76rem;
  color: var(--text-muted);
  text-align: right;
}

.pdf-export-status {
  min-width: 7rem;
}

.mode-toggle {
  display: inline-flex;
  gap: 0.4rem;
  margin-top: 0.9rem;
}

.mode-link {
  padding: 0.35rem 0.7rem;
  border: 1px solid rgba(17, 24, 39, 0.12);
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.04);
  color: var(--text-main);
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.78rem;
  text-decoration: none;
}

.mode-link[data-current="true"] {
  border-color: rgba(20, 99, 86, 0.28);
  background: rgba(20, 99, 86, 0.14);
  color: var(--accent-strong);
  font-weight: 700;
}

.theme-link {
  padding: 0.35rem 0.7rem;
  border: 1px solid rgba(20, 99, 86, 0.16);
  border-radius: 999px;
  background: rgba(20, 99, 86, 0.06);
  color: var(--accent-strong);
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.78rem;
  text-decoration: none;
}

.theme-link[data-current="true"] {
  border-color: rgba(20, 99, 86, 0.34);
  background: rgba(20, 99, 86, 0.16);
  font-weight: 700;
}

.frontmatter {
  margin-bottom: 1rem;
  padding: 1rem 1.15rem;
  border: 1px solid var(--panel-border);
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.7);
}

.frontmatter summary {
  cursor: pointer;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.frontmatter pre {
  margin: 0.9rem 0 0;
  padding: 0.9rem 1rem;
  overflow-x: auto;
  border-radius: 0.85rem;
  background: var(--code-bg);
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.84rem;
}

.explorer-shell {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: auto;
  padding: 1.25rem 1rem 1.5rem;
  border-right: 1px solid var(--panel-border);
  background:
    linear-gradient(180deg, rgba(252, 251, 248, 0.98) 0%, rgba(244, 241, 235, 0.94) 100%);
  box-shadow: 16px 0 32px rgba(16, 24, 40, 0.06);
}

.article-shell {
  padding: clamp(1.25rem, 2vw, 2rem);
  border: 1px solid var(--panel-border);
  border-radius: 1.5rem;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 36px rgba(16, 24, 40, 0.08);
}

.editor-shell {
  padding: 1rem;
  border: 1px solid var(--panel-border);
  border-radius: 1.5rem;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 36px rgba(16, 24, 40, 0.08);
}

.editor-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.9rem;
  padding-bottom: 0.9rem;
  border-bottom: 1px solid rgba(17, 24, 39, 0.08);
}

.editor-toolbar-copy {
  display: grid;
  gap: 0.2rem;
}

.editor-label {
  margin: 0;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.editor-status {
  margin: 0;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.82rem;
}

.editor-status[data-state="saved"] {
  color: var(--accent-strong);
}

.editor-status[data-state="loading"],
.editor-status[data-state="dirty"],
.editor-status[data-state="saving"] {
  color: #8b5a17;
}

.editor-status[data-state="conflict"],
.editor-status[data-state="error"] {
  color: #8b1e1e;
}

.editor-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.editor-action-link,
.editor-action-button {
  padding: 0.45rem 0.75rem;
  border: 1px solid rgba(17, 24, 39, 0.12);
  border-radius: 0.8rem;
  background: rgba(17, 24, 39, 0.04);
  color: var(--text-main);
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.78rem;
  text-decoration: none;
}

.editor-action-button {
  cursor: pointer;
}

.editor-action-button[hidden] {
  display: none;
}

.docs-context-menu {
  position: fixed;
  z-index: 50;
  display: grid;
  gap: 0.25rem;
  min-width: 13rem;
  padding: 0.45rem;
  border: 1px solid rgba(17, 24, 39, 0.12);
  border-radius: 0.9rem;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 36px rgba(16, 24, 40, 0.16);
  backdrop-filter: blur(12px);
}

.docs-context-menu[hidden] {
  display: none;
}

.docs-context-button {
  padding: 0.45rem 0.65rem;
  border: 0;
  border-radius: 0.65rem;
  background: transparent;
  color: var(--text-main);
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.78rem;
  text-align: left;
  cursor: pointer;
}

.docs-context-button:hover {
  background: rgba(20, 99, 86, 0.08);
  color: var(--accent-strong);
}

.docs-context-status {
  margin: 0.2rem 0 0;
  padding: 0 0.65rem 0.15rem;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.74rem;
  color: var(--text-muted);
}

.markdown-editor {
  width: 100%;
  min-height: calc(100vh - 21rem);
  resize: vertical;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text-main);
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: calc(0.92rem * var(--content-scale));
  line-height: 1.55;
}

.editable-block-list {
  display: grid;
  gap: 1rem;
}

.editable-block {
  padding: 1rem;
  border: 1px solid rgba(17, 24, 39, 0.1);
  border-radius: 1.1rem;
  background: rgba(250, 249, 246, 0.86);
  transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
}

.editable-block:target {
  border-color: rgba(20, 99, 86, 0.28);
  box-shadow: 0 0 0 3px rgba(20, 99, 86, 0.08);
}

.editable-block[data-active="true"] {
  border-color: rgba(20, 99, 86, 0.32);
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 0 0 3px rgba(20, 99, 86, 0.08);
}

.editable-block[data-visual="true"] {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.editable-block[data-chromeless="true"] {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.editable-block[data-visual="true"][data-active="true"] {
  border: 0;
  background: transparent;
  box-shadow: none;
}

.editable-block[data-chromeless="true"][data-active="true"] {
  border: 0;
  background: transparent;
  box-shadow: none;
}

.editable-block-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.9rem;
  transition: opacity 120ms ease;
}

.editable-block[data-active="true"] .editable-block-header {
  opacity: 0.72;
}

.editable-block-label,
.editable-block-meta,
.editable-block-help {
  margin: 0;
}

.editable-block-label {
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.editable-block-meta {
  margin-top: 0.2rem;
  font-size: 0.85rem;
  color: var(--accent-strong);
}

.editable-block-preview-shell {
  padding: 0.2rem 0.15rem 0.4rem;
  border-radius: 0.9rem;
  cursor: text;
  transition: background 120ms ease, box-shadow 120ms ease;
}

.editable-block[data-visual="true"] .editable-block-preview-shell {
  padding: 0;
  border-radius: 0.45rem;
}

.editable-block[data-interactive="true"] .editable-block-preview-shell:hover,
.editable-block[data-interactive="true"] .editable-block-preview-shell:focus-visible {
  background: rgba(20, 99, 86, 0.04);
  box-shadow: inset 0 0 0 1px rgba(20, 99, 86, 0.12);
}

.editable-block[data-visual="true"] .editable-block-preview-shell:hover,
.editable-block[data-visual="true"] .editable-block-preview-shell:focus-visible {
  background: rgba(20, 99, 86, 0.025);
  box-shadow: inset 0 0 0 1px rgba(20, 99, 86, 0.08);
}

.editable-block-preview-shell[data-editing="true"] {
  background: transparent;
  box-shadow: none;
}

.editable-block[data-interactive="false"] .editable-block-preview-shell {
  cursor: default;
}

.editable-block[data-visual="true"][data-active="true"] .editable-block-preview-shell {
  background: rgba(20, 99, 86, 0.028);
  box-shadow: inset 0 0 0 1px rgba(20, 99, 86, 0.16);
}

.editable-block-preview > :first-child {
  margin-top: 0;
}

.editable-block-preview > :last-child {
  margin-bottom: 0;
}

.article-shell .markdown-body,
.editable-block-preview {
  font-size: calc(1rem * var(--content-scale));
}

.editable-block-preview pre {
  margin: 0;
  padding: 0.9rem 1rem;
  overflow-x: auto;
  border-radius: 0.85rem;
  background: var(--code-bg);
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: calc(0.84rem * var(--content-scale));
}

.editable-block[data-visual="true"] .editable-block-preview[contenteditable="true"] {
  min-height: 1.5em;
  outline: none;
  caret-color: var(--accent-strong);
}

.editable-block[data-visual="true"] .editable-block-preview[contenteditable="true"] a {
  pointer-events: none;
}

.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] strong::before,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] strong::after {
  content: '**';
}

.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] em::before,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] em::after {
  content: '*';
}

.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] del::before,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] del::after {
  content: '~~';
}

.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] code::before,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] code::after {
  content: '\`';
}

.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] a::before {
  content: '[';
}

.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] a::after {
  content: '](' attr(href) ')';
}

.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] u::before {
  content: '<u>';
}

.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] u::after {
  content: '</u>';
}

.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] strong::before,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] strong::after,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] em::before,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] em::after,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] del::before,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] del::after,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] code::before,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] code::after,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] a::before,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] a::after,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] u::before,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] u::after {
  color: rgba(20, 99, 86, 0.42);
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.88em;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] strong[data-inline-focus="true"]::before,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] strong[data-inline-focus="true"]::after,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] em[data-inline-focus="true"]::before,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] em[data-inline-focus="true"]::after,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] del[data-inline-focus="true"]::before,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] del[data-inline-focus="true"]::after,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] code[data-inline-focus="true"]::before,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] code[data-inline-focus="true"]::after,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] a[data-inline-focus="true"]::before,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] a[data-inline-focus="true"]::after,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] u[data-inline-focus="true"]::before,
.editable-block[data-visual="true"][data-active="true"] .editable-block-preview[contenteditable="true"][data-inline-reveal="true"] u[data-inline-focus="true"]::after {
  color: rgba(20, 99, 86, 0.76);
}

.editable-block-form {
  display: grid;
  gap: 0.6rem;
}

.editable-block-textarea {
  width: 100%;
  min-height: 10rem;
  resize: vertical;
  padding: 0.9rem 1rem;
  border: 1px solid rgba(17, 24, 39, 0.14);
  border-radius: 0.95rem;
  outline: none;
  background: rgba(255, 255, 255, 0.9);
  color: var(--text-main);
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.9rem;
  line-height: 1.55;
}

.editable-block-textarea:focus {
  border-color: rgba(20, 99, 86, 0.36);
  box-shadow: 0 0 0 3px rgba(20, 99, 86, 0.08);
}

.editable-block[data-protected="false"] .editable-block-textarea {
  display: none;
  padding: 0.2rem 0.15rem 0.4rem;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  font-family: Georgia, 'Iowan Old Style', 'Palatino Linotype', serif;
  font-size: 1.02rem;
  line-height: 1.72;
}

.editable-block[data-protected="false"] .editable-block-textarea:focus {
  border: 0;
  box-shadow: none;
}

.editable-block-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.editable-block[data-protected="false"] .editable-block-actions .editor-action-button {
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  background: rgba(20, 99, 86, 0.06);
  color: var(--accent-strong);
}

.editable-block[data-protected="false"] .editable-block-form {
  padding-top: 0.1rem;
}

.editable-block[data-visual="true"] .editable-block-form {
  display: none !important;
}

.editable-block-help {
  color: var(--text-muted);
  font-size: 0.86rem;
  line-height: 1.45;
}

.editable-block-help kbd {
  display: inline-block;
  min-width: 1.6rem;
  padding: 0.1rem 0.35rem;
  border: 1px solid rgba(17, 24, 39, 0.14);
  border-bottom-width: 2px;
  border-radius: 0.4rem;
  background: rgba(255, 255, 255, 0.78);
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.78rem;
  text-align: center;
}

.explorer-title {
  margin: 0 0 0.25rem;
  font-size: 1rem;
}

.explorer-copy {
  margin: 0 0 0.9rem;
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.45;
}

.explorer-tree {
  display: grid;
  gap: 0.35rem;
}

.tree-directory {
  margin: 0;
}

.tree-directory > summary {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.3rem 0.4rem;
  border-radius: 0.7rem;
  cursor: pointer;
  list-style: none;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.82rem;
}

.tree-directory > summary::-webkit-details-marker {
  display: none;
}

.tree-directory > summary:hover,
.tree-directory[data-current-branch="true"] > summary {
  background: rgba(20, 99, 86, 0.08);
}

.tree-chevron {
  width: 0.75rem;
  color: var(--text-muted);
  transition: transform 120ms ease;
}

.tree-directory[open] > summary .tree-chevron {
  transform: rotate(90deg);
}

.tree-label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.tree-children {
  display: grid;
  gap: 0.18rem;
  margin-top: 0.18rem;
  padding-left: 1rem;
  border-left: 1px solid rgba(17, 24, 39, 0.08);
}

.tree-file {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.3rem 0.4rem;
  border-radius: 0.7rem;
  color: inherit;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.8rem;
  text-decoration: none;
}

.tree-file:hover {
  background: rgba(20, 99, 86, 0.06);
}

.tree-file[data-current="true"] {
  background: rgba(20, 99, 86, 0.14);
  color: var(--accent-strong);
  font-weight: 700;
}

.tree-file-icon {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.tree-empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.markdown-body {
  max-width: 100%;
}

@media (max-width: 720px) {
  .app-shell {
    grid-template-columns: minmax(0, 1fr);
  }

  .page-shell {
    width: min(100vw - 1rem, 100%);
    padding-top: 1rem;
  }

  .hero,
  .article-shell,
  .editor-shell {
    border-radius: 1rem;
  }

  .explorer-shell {
    position: static;
    height: auto;
    border-right: 0;
    border-bottom: 1px solid var(--panel-border);
    box-shadow: none;
  }
}
`
