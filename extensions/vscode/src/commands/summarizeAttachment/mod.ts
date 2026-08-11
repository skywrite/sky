import { execFile } from 'node:child_process'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { DIR_ATTACHMENTS, DIR_CODE } from '#config'
import SectionDocument from '#shared/models/Markdown/SectionDocument/mod.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import parseDateFromDayPath from '#shared/nbfs/parseDateFromDayPath.ts'

export const SUPPORTED_EXTENSIONS = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.csv',
  '.md',
  '.txt',
  '.json',
  '.xml',
  '.html',
  '.htm',
  '.yaml',
  '.yml',
  '.toml',
  '.log',
  '.tsv',
  '.docx',
  '.doc',
  '.rtf',
  '.odt',
  '.pages',
  '.pptx',
  '.keynote',
  '.xlsx',
  '.xls',
  '.numbers',
])

const SKY_BIN = path.join(DIR_CODE, 'bin', 'sky')

/**
 * Run `sky summary:doc <filepath> -o <tmpfile>` and return the summary text.
 */
function runSummaryDoc(filePath: string, tmpFile: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      SKY_BIN,
      ['summary:doc', filePath, '-o', tmpFile],
      {
        timeout: 5 * 60 * 1000,
        env: { ...process.env, PATH: process.env.PATH },
      },
      async (error) => {
        if (error) {
          reject(new Error(`sky summary:doc failed: ${error.message}`))
          return
        }
        try {
          const result = await readFile(tmpFile, 'utf-8')
          resolve(result)
        } catch (err) {
          reject(new Error(`Failed to read summary output: ${(err as Error).message}`))
        }
      },
    )
  })
}

/**
 * Transform heading levels in summary output: +2 levels, and rename the top heading.
 * - `# Summary: [Title]` → `### Summary (filename)`
 * - `## X` → `#### X`
 * - `### X` → `##### X`
 */
function transformHeadings(summary: string, filename: string): string {
  return summary
    .split('\n')
    .map((line) => {
      // Match heading lines: # through ###
      const match = line.match(/^(#{1,3}) (.+)$/)
      if (!match) return line

      const [, hashes, text] = match
      const level = hashes.length

      if (level === 1) {
        // Top-level summary heading → ### Summary (filename)
        return `### Summary (${filename})`
      }
      // Bump by 2 levels
      return '#'.repeat(level + 2) + ' ' + text
    })
    .join('\n')
}

/**
 * Summarize an attachment from the current day file using `sky summary:doc`.
 * Parses attachments from YAML frontmatter, calls the CLI, and inserts the result.
 */
export default async function summarizeAttachment(targetFile?: string): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    vscode.window.showWarningMessage('No active editor')
    return
  }

  if (!editor.document.fileName.endsWith('.md')) {
    vscode.window.showWarningMessage('This command only works on Markdown files')
    return
  }

  const text = editor.document.getText()
  const doc = SectionDocument.fromMarkdown(text)
  const attachments = doc.attachments

  // Filter to supported file types
  const supported = attachments.filter((a) => {
    const ext = path.extname(a.file).toLowerCase()
    return SUPPORTED_EXTENSIONS.has(ext)
  })

  if (supported.length === 0) {
    vscode.window.showWarningMessage('No summarizable attachments found (need PDF, image, Office, or text files)')
    return
  }

  // Select attachment (skip picker if targetFile was passed)
  let selectedFile: string
  if (targetFile) {
    selectedFile = targetFile
  } else if (supported.length === 1) {
    selectedFile = supported[0].file
  } else {
    const picked = await vscode.window.showQuickPick(
      supported.map((a) => a.file),
      { placeHolder: 'Select attachment to summarize' },
    )
    if (!picked) return
    selectedFile = picked
  }

  // Resolve full file path
  let date
  try {
    date = parseDateFromDayPath(editor.document.fileName)
  } catch {
    vscode.window.showWarningMessage('Could not parse date from file path — is this a day file?')
    return
  }

  const filePath = path.join(DIR_ATTACHMENTS, dayAttachmentsDir(date), selectedFile)
  const tmpFile = path.join(os.tmpdir(), `sky-summary-${Date.now()}.md`)

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Summarizing ${selectedFile}...`,
      cancellable: false,
    },
    async () => {
      try {
        const summary = await runSummaryDoc(filePath, tmpFile)

        // Clean up temp file
        try {
          await unlink(tmpFile)
        } catch {
          /* ignore */
        }

        if (!summary.trim()) {
          vscode.window.showWarningMessage('Summary was empty')
          return
        }

        const transformed = transformHeadings(summary.trim(), selectedFile)
        const currentText = editor.document.getText()
        const lines = currentText.split('\n')
        const currentDoc = SectionDocument.fromMarkdown(currentText)
        const offset = lines.length - currentDoc.markdown.split('\n').length

        const attachmentsSection = currentDoc.findSection(
          (s) => s.level === 2 && s.heading.toLowerCase() === 'attachments',
        )

        if (attachmentsSection) {
          // Append to existing ## Attachments section
          const attachmentsLine = attachmentsSection.start.line + offset
          const sectionEnd = attachmentsSection.end.line + offset

          // Find last non-empty line in section
          let insertLine = sectionEnd
          for (let i = sectionEnd - 1; i > attachmentsLine; i--) {
            if (lines[i].trim() !== '') {
              insertLine = i + 1
              break
            }
          }

          const newContent = `\n${transformed}\n`
          const position = new vscode.Position(insertLine, 0)

          await editor.edit((editBuilder) => {
            editBuilder.insert(position, newContent)
          })
        } else {
          // Create new ## Attachments section
          const transcriptSection = currentDoc.findSection(
            (s) => s.level === 2 && s.heading.toLowerCase() === 'transcript',
          )
          const newSection = `## Attachments\n\n${transformed}\n\n`

          if (transcriptSection) {
            // Insert before ## Transcript
            const position = new vscode.Position(transcriptSection.start.line + offset, 0)
            await editor.edit((editBuilder) => {
              editBuilder.insert(position, newSection)
            })
          } else {
            // Append at end of document
            const lastLine = lines.length
            const position = new vscode.Position(lastLine, 0)
            await editor.edit((editBuilder) => {
              editBuilder.insert(position, '\n' + newSection)
            })
          }
        }

        vscode.window.showInformationMessage(`Attachment summary inserted for ${selectedFile}`)
      } catch (error) {
        // Clean up temp file on error
        try {
          await unlink(tmpFile)
        } catch {
          /* ignore */
        }
        const message = error instanceof Error ? error.message : String(error)
        vscode.window.showErrorMessage(`Failed to summarize attachment: ${message}`)
        console.error('Summarize attachment error:', error)
      }
    },
  )
}
