import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import splitYamlMarkdown from '#shared/models/Markdown/util/splitYamlMarkdown.ts'
import { isCommandAvailable, runCommand } from '#lib/sys/command.ts'
import { env } from '#shared/sys/mod.ts'
import * as XLSX from 'xlsx'

const PROMPT_FILE = new URL('./prompts/doc.prompt.md', import.meta.url).pathname

/** Sent as native PDF file content part to Claude */
const PDF_EXTENSIONS = new Set(['.pdf'])

/** Sent as native image content part to Claude */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

/** Read directly as text */
const TEXT_EXTENSIONS = new Set([
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
])

/** Converted to text via macOS `textutil` */
const TEXTUTIL_EXTENSIONS = new Set(['.docx', '.doc', '.rtf', '.odt', '.pages'])

/** Converted to text via `pandoc` */
const PANDOC_EXTENSIONS = new Set(['.pptx', '.keynote'])

/** Converted to CSV text via SheetJS */
const SPREADSHEET_EXTENSIONS = new Set(['.xlsx', '.xls', '.numbers'])

const params = {
  file: Arg.string('Path to the document to summarize', { required: true }),
  model: Flag.string('Claude model to use', { short: 'm', default: () => 'claude-opus-4-6' }),
  dryRun: Flag.boolean('Show prompt without calling AI', { default: false }),
  stdout: Flag.boolean('Output summary to stdout', { default: false }),
  output: Flag.string('Write summary to this file path', { short: 'o' }),
}

type Params = InferParams<typeof params>
type Result = { summary: string; outputPath: string | null }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'summary:doc': { params: Params; result: Result }
  }
}

function imageMediaType(ext: string): string {
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}

export default class SummaryDocTask extends Command {
  static override description: CommandDescription = {
    name: 'summary:doc',
    description: 'Summarize a document (PDF, image, Office, Apple, text) using AI',
    descriptionLong: [
      'Takes a file path and generates an AI-powered summary.',
      'Supports PDF (native), images (png, jpg, gif, webp), Office (docx, pptx, xlsx),',
      'Apple (pages, keynote, numbers), and text formats (csv, markdown, plain text).',
      'Outputs to stdout by default, or to a file with --output.',
    ],
    usage: [
      'sky summary:doc report.pdf                    # Summarize a PDF',
      'sky summary:doc photo.png                     # Describe an image',
      'sky summary:doc screenshot.jpg                # Describe a screenshot',
      'sky summary:doc data.csv                      # Summarize a CSV',
      'sky summary:doc notes.md                      # Summarize markdown',
      'sky summary:doc proposal.docx                 # Summarize Word doc (via textutil)',
      'sky summary:doc deck.pptx                     # Summarize PowerPoint (via pandoc)',
      'sky summary:doc financials.xlsx               # Summarize Excel (via SheetJS)',
      'sky summary:doc report.pdf --dry-run           # Preview prompt without calling AI',
      'sky summary:doc report.pdf -o /tmp/summary.md  # Write summary to file',
      'sky summary:doc report.pdf -m claude-opus-4-6  # Use a specific model',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { file, model, dryRun, stdout: _stdout, output: outputPath } = args

    // Resolve file path against user's original CWD (sky script pushd's to SKY_CODE_DIR)
    const userCwd = env.get('SKY_USER_CWD')
    const filePath = path.isAbsolute(file) ? file : path.resolve(userCwd || '.', file)
    const ext = path.extname(filePath).toLowerCase()
    const fileName = path.basename(filePath)

    // Load system prompt
    const systemPrompt = await this.loadPromptTemplate()

    // Read document content based on file type
    let textContent: string | undefined
    let pdfData: Uint8Array | undefined
    let imageData: Uint8Array | undefined

    if (PDF_EXTENSIONS.has(ext)) {
      output.log(`Reading PDF: ${fileName}`)
      try {
        pdfData = await readFile(filePath)
      } catch (err) {
        return CommandResult.error(err as Error, `Failed to read PDF: ${filePath}`)
      }
    } else if (IMAGE_EXTENSIONS.has(ext)) {
      output.log(`Reading image: ${fileName}`)
      try {
        imageData = await readFile(filePath)
      } catch (err) {
        return CommandResult.error(err as Error, `Failed to read image: ${filePath}`)
      }
    } else if (TEXTUTIL_EXTENSIONS.has(ext)) {
      output.log(`Converting ${ext} via textutil: ${fileName}`)
      const result = await this.convertWithTextutil(filePath)
      if (!result.success) return CommandResult.fail(result.error)
      textContent = result.text
    } else if (PANDOC_EXTENSIONS.has(ext)) {
      output.log(`Converting ${ext} via pandoc: ${fileName}`)
      const result = await this.convertWithPandoc(filePath)
      if (!result.success) return CommandResult.fail(result.error)
      textContent = result.text
    } else if (SPREADSHEET_EXTENSIONS.has(ext)) {
      output.log(`Converting ${ext} via SheetJS: ${fileName}`)
      const result = await this.convertSpreadsheet(filePath)
      if (!result.success) return CommandResult.fail(result.error)
      textContent = result.text
    } else {
      // Try reading as text (known text extensions or unknown)
      const isText = TEXT_EXTENSIONS.has(ext)
      output.log(`Reading ${isText ? ext.slice(1).toUpperCase() : 'text'} file: ${fileName}`)
      try {
        textContent = await readTextFile(filePath)
      } catch (err) {
        return CommandResult.error(err as Error, `Failed to read file: ${filePath}`)
      }
    }

    if (!pdfData && !imageData && (!textContent || textContent.trim().length === 0)) {
      return CommandResult.fail('File is empty or conversion produced no text')
    }

    // Build user prompt
    const userPrompt = `Summarize the following document.\n\n**Filename**: ${fileName}\n`

    if (dryRun) {
      output.log('\n=== SYSTEM PROMPT ===')
      output.log(systemPrompt)
      output.log('\n=== USER PROMPT ===')
      output.log(userPrompt)
      if (textContent) {
        output.log('\n=== DOCUMENT CONTENT (first 2000 chars) ===')
        output.log(textContent.slice(0, 2000))
      } else if (pdfData) {
        output.log('\n=== DOCUMENT: PDF binary data ===')
      } else {
        output.log('\n=== DOCUMENT: Image binary data ===')
      }
      return CommandResult.success({ summary: '', outputPath: null })
    }

    // Call Claude
    output.log(`Calling Claude (${model})...`)
    let response: string
    try {
      if (pdfData) {
        // PDF: use messages array with file content part
        const result = await generateText({
          model: anthropic(model),
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'file', data: pdfData, mediaType: 'application/pdf' },
                { type: 'text', text: userPrompt },
              ],
            },
          ],
          temperature: 0,
        })
        response = result.text
      } else if (imageData) {
        // Image: use messages array with image content part
        const result = await generateText({
          model: anthropic(model),
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', image: imageData, mediaType: imageMediaType(ext) },
                { type: 'text', text: userPrompt },
              ],
            },
          ],
          temperature: 0,
        })
        response = result.text
      } else {
        // Text: use simple system + prompt
        const fullPrompt = `${userPrompt}\n---\n\n${textContent}`
        const result = await generateText({
          model: anthropic(model),
          system: systemPrompt,
          prompt: fullPrompt,
          temperature: 0,
        })
        response = result.text
      }
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to call Claude API')
    }

    // Output
    if (outputPath) {
      const resolvedOutput = path.isAbsolute(outputPath) ? outputPath : path.resolve(userCwd || '.', outputPath)
      await writeTextFile(resolvedOutput, response)
      output.log(`Summary written to ${resolvedOutput}`)
      return CommandResult.success({ summary: response, outputPath: resolvedOutput })
    }

    // Default: stdout
    output.log('')
    output.log(response)
    return CommandResult.success({ summary: response, outputPath: null })
  }

  /** Convert docx, doc, rtf, odt, pages to plain text via macOS textutil */
  private async convertWithTextutil(
    filePath: string,
  ): Promise<{ success: true; text: string } | { success: false; error: string }> {
    const result = await runCommand('textutil', ['-convert', 'txt', '-stdout', filePath])
    if (!result.success) {
      return { success: false, error: `textutil failed: ${result.stderr}` }
    }
    return { success: true, text: result.stdout }
  }

  /** Convert pptx, keynote to plain text via pandoc */
  private async convertWithPandoc(
    filePath: string,
  ): Promise<{ success: true; text: string } | { success: false; error: string }> {
    if (!(await isCommandAvailable('pandoc'))) {
      return { success: false, error: 'pandoc is not installed. Install with: brew install pandoc' }
    }
    const result = await runCommand('pandoc', [filePath, '-t', 'plain'])
    if (!result.success) {
      return { success: false, error: `pandoc failed: ${result.stderr}` }
    }
    return { success: true, text: result.stdout }
  }

  /** Convert xlsx, xls, numbers to CSV text via SheetJS */
  private async convertSpreadsheet(
    filePath: string,
  ): Promise<{ success: true; text: string } | { success: false; error: string }> {
    try {
      const data = await readFile(filePath)
      const workbook = XLSX.read(data)
      const parts: string[] = []

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName]
        const csv = XLSX.utils.sheet_to_csv(sheet)
        if (csv.trim()) {
          if (workbook.SheetNames.length > 1) {
            parts.push(`## Sheet: ${sheetName}\n`)
          }
          parts.push(csv)
          parts.push('')
        }
      }

      if (parts.length === 0) {
        return { success: false, error: 'Spreadsheet contains no data' }
      }

      return { success: true, text: parts.join('\n') }
    } catch (err) {
      return { success: false, error: `Failed to read spreadsheet: ${(err as Error).message}` }
    }
  }

  private async loadPromptTemplate(): Promise<string> {
    const content = await readTextFile(PROMPT_FILE)
    const { markdown } = splitYamlMarkdown(content)
    return markdown.trim()
  }
}
