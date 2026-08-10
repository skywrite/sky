import * as vscode from 'vscode'
import { readFileSync } from 'node:fs'
import SectionDocument from '#shared/models/Markdown/SectionDocument/mod.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { stripWrappingCodeFence } from '#shared/ai/stripCodeFence.ts'

/**
 * The template ships next to this file. Read on use rather than at import so
 * activation stays free of disk I/O — this extension activates on every window.
 */
function promptTemplate(): string {
  return readFileSync(new URL('./prompt.prompt.md', import.meta.url), 'utf8')
}

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
 * Summarize the transcript section via the shared AI registry ('reasoning' role).
 * Finds the ## Transcript section, sends it to the model with YAML context, and
 * inserts/appends the result under a model-named heading, e.g.
 * ## Summary (claude-opus-5) — the model id comes from the registry so the
 * recorded provenance tracks role repoints automatically.
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

  // `.content` holds only the tokens directly under the heading — a transcript
  // that opens with a `###` subheading puts every line in a child section and
  // leaves `.content` empty. Slice the whole subtree out of the markdown instead.
  const markdownLines = doc.markdown.split('\n')
  const transcript = markdownLines
    .slice(transcriptSection.start.line + 1, transcriptSection.end.line)
    .join('\n')
    .trim()
  if (!transcript.trim()) {
    vscode.window.showWarningMessage('## Transcript section is empty')
    return
  }

  // Load the AI pipeline on demand — activation never pays for the AI SDK.
  // streamText comes re-exported from the registry so this runs on src's
  // single SDK instance; the extension never imports 'ai' at runtime.
  const { aiModel, aiModelId, streamText } = await import('#shared/ai/models.ts')
  const modelId = aiModelId('reasoning')
  const summaryHeading = `Summary (${modelId})`

  // Check if summary section already exists
  const existingSummary = doc.findSection(
    (s) => s.level === 2 && s.heading.toLowerCase() === summaryHeading.toLowerCase(),
  )

  // Show progress
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Generating summary with ${modelId}...`,
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

        // The provider reads the key from the environment; fail with a clear
        // message rather than a deep SDK error when it's absent.
        if (!process.env.ANTHROPIC_API_KEY) {
          throw new Error('ANTHROPIC_API_KEY environment variable not set')
        }

        // Call through the shared registry: model + effort/thinking come from the
        // 'reasoning' profile, and sampling overrides are dropped automatically
        // when the profile enables thinking. Streaming keeps bytes flowing so
        // Node's undici idle timeouts can't kill a long call (the Bun-only
        // `timeout: false` in the shared provider is a no-op under the ext host).
        const result = streamText({
          ...aiModel('reasoning', { temperature: 0, maxOutputTokens: 64000 }),
          prompt,
        })

        // Unwrap the whole-document ```markdown fence the model sometimes adds.
        const summary = stripWrappingCodeFence(await result.text)
        if (!summary) {
          throw new Error('Model returned an empty summary')
        }
        const lines = text.split('\n')

        if (existingSummary) {
          // Append to existing section
          const summaryLine = findHeadingLine(lines, summaryHeading, 2)
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
          const newSection = `## ${summaryHeading}\n\n${summary}\n\n`
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
