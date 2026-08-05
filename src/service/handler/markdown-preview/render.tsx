import * as path from 'node:path'
import { marked } from 'marked'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readTextFile } from '#shared/fs/mod.ts'
import splitYamlMarkdown from '#shared/models/Markdown/util/splitYamlMarkdown.ts'
import { MarkdownPreviewDocument } from './components/MarkdownPreviewDocument.tsx'
import { readMarkdownContent } from './content.ts'
import { buildMarkdownDocumentEditorState } from './documentState.ts'
import { buildMarkdownExplorerTree } from './explorer.ts'
import { buildMarkdownContentApiPath, buildMarkdownDocumentApiPath, buildMarkdownPdfExportPath } from './request.ts'
import type { MarkdownPreviewMode, MarkdownPreviewRenderOptions, MarkdownPreviewRequest } from './types.ts'

const THEMES_DIR = new URL('../../../commands/all/markdown/pdf/themes', import.meta.url).pathname
const EMPTY_STATE_HTML = `
<h1>Choose a document</h1>
<p>Select a markdown file from the explorer to preview it here.</p>
`

export async function renderMarkdownPreviewDocument(
  request: MarkdownPreviewRequest | null,
  options: MarkdownPreviewRenderOptions,
): Promise<string> {
  const mode = options.mode ?? 'preview'
  const theme = request?.theme ?? options.defaultTheme ?? 'github'
  const selectedRelativePath = request?.relativePath ?? ''
  const themeCss = await readTextFile(path.join(THEMES_DIR, `${theme}.css`))
  const explorerRoots = await buildMarkdownExplorerTree(
    options.markdownBaseDir,
    options.markdownDirs,
    selectedRelativePath,
  )
  const page = request ? await buildSelectedDocumentPage(request, mode) : buildExplorerHomePage(mode)

  return (
    '<!DOCTYPE html>' +
    renderToStaticMarkup(
      <MarkdownPreviewDocument
        eyebrow={page.eyebrow}
        title={page.title}
        description={page.description}
        metaLabel={page.metaLabel}
        metaValue={page.metaValue}
        themePath={page.themePath}
        pdfExportPath={page.pdfExportPath}
        mode={page.mode}
        canEdit={page.canEdit}
        theme={theme}
        bodyHtml={page.bodyHtml}
        frontmatter={page.frontmatter}
        themeCss={themeCss}
        explorerRoots={explorerRoots}
        previewState={page.previewState}
        editorState={page.editorState}
      />,
    )
  )
}

async function buildSelectedDocumentPage(request: MarkdownPreviewRequest, mode: MarkdownPreviewMode) {
  const snapshot = await readMarkdownContent(request.filePath)
  const raw = snapshot.content
  const { yaml, markdown } = splitYamlMarkdown(raw)
  const cleaned = markdown.replace(/<!--[\s\S]*?-->/g, '').trim()
  const bodyHtml = cleaned.length > 0 ? await marked.parse(cleaned) : '<p><em>This markdown file is empty.</em></p>'

  return {
    eyebrow: mode === 'edit' ? 'Phase 3' : 'Phase 1',
    title: path.basename(request.filePath),
    description:
      mode === 'edit'
        ? 'Rendered block editing. Click a block to edit only that block and save it back into the document at its preserved source range.'
        : 'Browser preview for a markdown file served by the local notebook service. Edit mode uses the rendered block editor.',
    metaLabel: 'Notebook Path',
    metaValue: request.relativePath,
    themePath: request.relativePath,
    pdfExportPath: buildMarkdownPdfExportPath(request.relativePath, { theme: request.theme }),
    mode,
    canEdit: true,
    bodyHtml,
    frontmatter: yaml,
    previewState:
      mode === 'preview'
        ? {
            apiPath: buildMarkdownContentApiPath(request.relativePath),
            initialVersion: snapshot.version,
          }
        : undefined,
    editorState:
      mode === 'edit'
        ? {
            relativePath: request.relativePath,
            initialContent: raw,
            initialVersion: snapshot.version,
            apiPath: buildMarkdownContentApiPath(request.relativePath),
            documentApiPath: buildMarkdownDocumentApiPath(request.relativePath),
            renderBlockApiPath: '/docs/_api/render-block',
            blocks: (await buildMarkdownDocumentEditorState(raw, snapshot.version)).blocks,
          }
        : undefined,
  }
}

function buildExplorerHomePage(mode: MarkdownPreviewMode) {
  return {
    eyebrow: 'Notebook',
    title: 'Docs',
    description:
      mode === 'edit'
        ? 'Choose a markdown file from the explorer to open it in the browser editor.'
        : 'Browse notebook markdown files from the explorer and open any document in this browser view.',
    metaLabel: 'Route',
    metaValue: '/docs/',
    themePath: '',
    pdfExportPath: undefined,
    mode,
    canEdit: false,
    bodyHtml: EMPTY_STATE_HTML,
    frontmatter: '',
    previewState: undefined,
    editorState: undefined,
  }
}
