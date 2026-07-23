import * as vscode from 'vscode'
import { readFileSync } from 'node:fs'
import Anthropic from '@anthropic-ai/sdk'
import SectionDocument from '#shared/models/Markdown/SectionDocument/mod.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'

/**
 * The template ships next to this file. Read on use rather than at import so
 * activation stays free of disk I/O — this extension activates on every window.
 */
function promptTemplate(): string {
  return readFileSync(new URL('./prompt.prompt.md', import.meta.url), 'utf8')
}

const MODEL_ID = 'claude-opus-4-6'
const SUMMARY_HEADING = 'Summary (Claude - Opus 4.6)'

// TODO: Replace findHeadingLine/findSectionEnd with SectionDocument.findSection() + position offset
// (see summarizeAttachment for the pattern)

/**
 * Find line number where a section heading appears.
 */
function findHeadingLine(lines: string[], heading: string, level: number): number {
  const prefix = '#'.repeat(level) + ' '
  const pattern = new RegExp(`^${prefix}${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')

  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      return i
    }
  }
  return -1
}

/**
 * Find the end of a section (next same-or-higher level heading or EOF).
 */
function findSectionEnd(lines: string[], startLine: number, level: number): number {
  const pattern = new RegExp(`^#{1,${level}} `)

  for (let i = startLine + 1; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      return i
    }
  }
  return lines.length
}

/**
 * Summarize the transcript section using Claude Opus 4.6.
 * Finds ## Transcript section, sends to AI with YAML context, and inserts/appends to ## Summary (Claude - Opus 4.6).
 */
export default async function summarizeTranscript(): Promise<void> {
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

  // Find ## Transcript section
  const transcriptSection = doc.findSection(
    (s) => s.level === 2 && s.heading.toLowerCase() === 'transcript',
  )

  if (!transcriptSection) {
    vscode.window.showWarningMessage('No ## Transcript section found in this document')
    return
  }

  const transcript = transcriptSection.content
  if (!transcript.trim()) {
    vscode.window.showWarningMessage('## Transcript section is empty')
    return
  }

  // Check if summary section already exists
  const existingSummary = doc.findSection(
    (s) => s.level === 2 && s.heading.toLowerCase() === SUMMARY_HEADING.toLowerCase(),
  )

  // Show progress
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Generating summary with Claude Opus 4.6...',
      cancellable: false,
    },
    async () => {
      try {
        // Build YAML context string
        const yamlContext = Object.entries(doc.yaml)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join('\n')

        // Render prompt using the prompt system
        const { output: prompt } = renderPromptFile(
          promptTemplate(),
          'transcript-summary.prompt.md',
          {
            user: {
              yamlContext,
              transcript,
            },
          },
        )

        // Get API key from environment
        const apiKey = process.env.ANTHROPIC_API_KEY
        if (!apiKey) {
          throw new Error('ANTHROPIC_API_KEY environment variable not set')
        }

        // Call Claude API
        const client = new Anthropic({
          apiKey,
          maxRetries: 0,
          timeout: 10 * 60 * 1000,
        })

        const response = await client.messages.create({
          model: MODEL_ID,
          max_tokens: 64000,
          temperature: 0,
          messages: [{ role: 'user', content: prompt }],
        })

        const content = response.content[0]
        if (content.type !== 'text') {
          throw new Error('Unexpected response type from Claude')
        }

        const summary = content.text.trim()
        const lines = text.split('\n')

        if (existingSummary) {
          // Append to existing section
          const summaryLine = findHeadingLine(lines, SUMMARY_HEADING, 2)
          const sectionEnd = findSectionEnd(lines, summaryLine, 2)

          // Find last non-empty line in section
          let insertLine = sectionEnd
          for (let i = sectionEnd - 1; i > summaryLine; i--) {
            if (lines[i].trim() !== '') {
              insertLine = i + 1
              break
            }
          }

          const newContent = `\n${summary}\n`
          const position = new vscode.Position(insertLine, 0)

          await editor.edit((editBuilder) => {
            editBuilder.insert(position, newContent)
          })
        } else {
          // Insert new section above ## Transcript
          const transcriptLine = findHeadingLine(lines, 'Transcript', 2)
          const newSection = `## ${SUMMARY_HEADING}\n\n${summary}\n\n`
          const position = new vscode.Position(transcriptLine, 0)

          await editor.edit((editBuilder) => {
            editBuilder.insert(position, newSection)
          })
        }

        vscode.window.showInformationMessage('Transcript summary generated successfully')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        vscode.window.showErrorMessage(`Failed to generate summary: ${message}`)
        console.error('Summarize transcript error:', error)
      }
    },
  )
}
