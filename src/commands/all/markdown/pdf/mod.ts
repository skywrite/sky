import * as path from 'node:path'
import { marked } from 'marked'
import { chromium } from 'playwright'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_OUTPUT } from '#config'
import { readTextFile } from '#shared/fs/mod.ts'
import splitYamlMarkdown from '#shared/models/Markdown/util/splitYamlMarkdown.ts'

const THEMES_DIR = new URL('./themes', import.meta.url).pathname
const AVAILABLE_THEMES = ['github', 'gothic', 'newsprint', 'night', 'pixyll', 'whitey'] as const
type Theme = (typeof AVAILABLE_THEMES)[number]

const params = {
  file: Arg.string('Path to markdown file'),
  output: Flag.string('Output PDF path (default: ~/Desktop/<filename>.pdf)', { short: 'o' }),
  title: Flag.string('PDF title (default: derived from filename)', { short: 't' }),
  theme: Flag.string(`Editor theme: ${AVAILABLE_THEMES.join(', ')} (default: github)`, {
    default: () => 'github' as string,
  }),
}

type Params = InferParams<typeof params>
type Result = { pdfPath: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'markdown:pdf': { params: Params; result: Result }
  }
}

export default class MarkdownPdfTask extends Command {
  static override description: CommandDescription = {
    name: 'markdown:pdf',
    description: 'Convert a markdown file to a styled PDF via Playwright',
    descriptionLong: [
      'Reads a markdown file, strips YAML frontmatter and HTML comments,',
      'converts to HTML with a Editor theme, and renders to PDF.',
      'Uses Brave Browser via Playwright for rendering.',
      '',
      `Available themes: ${AVAILABLE_THEMES.join(', ')}`,
    ],
    usage: [
      'sky markdown:pdf path/to/file.md                          # PDF with github theme',
      'sky markdown:pdf path/to/file.md --theme night            # PDF with night theme',
      'sky markdown:pdf path/to/file.md -o /tmp/out.pdf          # Custom output path',
      'sky markdown:pdf path/to/file.md -t "My Report"           # Custom title',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { file, title: titleFlag, output: outputFlag, theme: themeInput } = args

    // Validate theme
    const theme = themeInput as Theme
    if (!AVAILABLE_THEMES.includes(theme)) {
      return CommandResult.fail(`Unknown theme "${theme}". Available: ${AVAILABLE_THEMES.join(', ')}`)
    }

    // Derive defaults from filename
    const basename = path.basename(file, path.extname(file))
    const title = titleFlag ?? basename
    const pdfPath = outputFlag ?? path.join(DIR_OUTPUT, `${basename}.pdf`)

    // 1. Read markdown and theme CSS
    const cssPath = path.join(THEMES_DIR, `${theme}.css`)
    output.log(`Reading ${file} (theme: ${theme})...`)
    const [raw, css] = await Promise.all([readTextFile(file), readTextFile(cssPath)])

    // 2. Strip YAML frontmatter
    const { markdown } = splitYamlMarkdown(raw)

    // 3. Strip HTML comments (e.g. <!-- CONTEXT: ... --> blocks)
    const cleaned = markdown.replace(/<!--[\s\S]*?-->/g, '').trim()

    // 4. Convert markdown → HTML
    const bodyHtml = await marked.parse(cleaned)

    // 5. Wrap in styled HTML document
    const fullHtml = buildHtmlDocument(title, bodyHtml, css)

    // 6. Ensure output directory exists
    const dir = path.dirname(pdfPath)
    await import('node:fs/promises').then((fs) => fs.mkdir(dir, { recursive: true }))

    // 7. Render to PDF with Playwright
    output.log(`Rendering PDF...`)
    const browser = await chromium.launch({
      headless: true,
      executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    })
    try {
      const page = await browser.newPage()
      await page.setContent(fullHtml, { waitUntil: 'networkidle' })
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        margin: { top: '1in', right: '1in', bottom: '1in', left: '1in' },
        printBackground: true,
      })
    } finally {
      await browser.close()
    }

    output.log(`PDF exported to ${pdfPath}`)
    return CommandResult.success({ pdfPath })
  }
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
