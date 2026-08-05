import { mkdir } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { marked } from 'marked'
import { readTextFile } from '#shared/fs/mod.ts'
import splitYamlMarkdown from '#shared/models/Markdown/util/splitYamlMarkdown.ts'
import type { MarkdownPreviewTheme } from './types.ts'

const THEMES_DIR = new URL('../../../commands/all/markdown/pdf/themes', import.meta.url).pathname
const BRAVE_EXECUTABLE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'

export async function exportMarkdownPreviewPdf(filePath: string, theme: MarkdownPreviewTheme): Promise<string> {
  const basename = path.basename(filePath, path.extname(filePath))
  const pdfPath = path.join(os.homedir(), 'Desktop', `${basename}.pdf`)
  const cssPath = path.join(THEMES_DIR, `${theme}.css`)

  const [raw, css] = await Promise.all([readTextFile(filePath), readTextFile(cssPath)])

  const { markdown } = splitYamlMarkdown(raw)
  const cleaned = markdown.replace(/<!--[\s\S]*?-->/g, '').trim()
  const bodyHtml = await marked.parse(cleaned)
  const html = buildHtmlDocument(basename, bodyHtml, css)

  await mkdir(path.dirname(pdfPath), { recursive: true })

  const { chromium } = await import('playwright')
  const browser = await chromium.launch({
    headless: true,
    executablePath: BRAVE_EXECUTABLE,
  })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle' })
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      margin: { top: '1in', right: '1in', bottom: '1in', left: '1in' },
      printBackground: true,
    })
  } finally {
    await browser.close()
  }

  return pdfPath
}

function buildHtmlDocument(title: string, bodyHtml: string, css: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
${css}
</style>
</head>
<body>
<article class="markdown-body">
${bodyHtml}
</article>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
