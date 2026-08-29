import * as path from 'node:path'
import { generateText } from 'ai'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { loadDocument, type LoadedDocument, loadLabel } from '#lib/documents/loadDocument.ts'
import { aiModelByProfile, ROLES } from '#shared/ai/models.ts'
import { stripWrappingCodeFence } from '#shared/ai/stripCodeFence.ts'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import splitYamlMarkdown from '#shared/models/Markdown/util/splitYamlMarkdown.ts'
import { env } from '#shared/sys/mod.ts'

const PROMPT_FILE = new URL('./prompts/doc.prompt.md', import.meta.url).pathname

const params = {
  file: Arg.string('Path to the document to summarize', { required: true }),
  // Defaults to the registry's reasoning role so repoints reach this command
  // (and the VS Code extension's attachment summaries, which shell to it).
  model: Flag.string('Model profile to use', { short: 'm', default: () => ROLES.reasoning }),
  dryRun: Flag.bool('Show prompt without calling AI', { default: false }),
  stdout: Flag.bool('Output summary to stdout', { default: false }),
  output: Flag.string('Write summary to this file path', { short: 'o' }),
}

type Params = InferParams<typeof params>
type Result = { summary: string; outputPath: string | null }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'summary:doc': { params: Params; result: Result }
  }
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
      'sky summary:doc report.pdf -m default-sonnet-5  # Use a specific model profile',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { file, model, dryRun, stdout: _stdout, output: outputPath } = args

    // Resolve file path against user's original CWD (sky script pushd's to SKY_CODE_DIR)
    const userCwd = env.get('SKY_USER_CWD')
    const filePath = path.isAbsolute(file) ? file : path.resolve(userCwd || '.', file)
    const fileName = path.basename(filePath)

    const systemPrompt = await this.loadPromptTemplate()

    output.log(`${loadLabel(filePath)}: ${fileName}`)
    const loaded = await loadDocument(filePath)
    if (!loaded.success) return CommandResult.fail(loaded.error)
    const document = loaded.document

    const userPrompt = `Summarize the following document.\n\n**Filename**: ${fileName}\n`

    if (dryRun) {
      output.log('\n=== SYSTEM PROMPT ===')
      output.log(systemPrompt)
      output.log('\n=== USER PROMPT ===')
      output.log(userPrompt)
      if (document.kind === 'text') {
        output.log('\n=== DOCUMENT CONTENT (first 2000 chars) ===')
        output.log(document.text.slice(0, 2000))
      } else {
        output.log(`\n=== DOCUMENT: ${document.kind === 'pdf' ? 'PDF' : 'Image'} binary data ===`)
      }
      return CommandResult.success({ summary: '', outputPath: null })
    }

    output.log(`Calling Claude (${model})...`)
    let response: string
    try {
      response = await this.summarize(model, systemPrompt, userPrompt, document)
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to call Claude API')
    }

    // Models sometimes wrap the whole summary in a ```markdown fence — unwrap.
    response = stripWrappingCodeFence(response)

    if (outputPath) {
      const resolvedOutput = path.isAbsolute(outputPath) ? outputPath : path.resolve(userCwd || '.', outputPath)
      await writeTextFile(resolvedOutput, response)
      output.log(`Summary written to ${resolvedOutput}`)
      return CommandResult.success({ summary: response, outputPath: resolvedOutput })
    }

    output.log('')
    output.log(response)
    return CommandResult.success({ summary: response, outputPath: null })
  }

  /** PDFs and images ride as native file parts; text goes inline in the prompt. */
  private async summarize(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    document: LoadedDocument,
  ): Promise<string> {
    if (document.kind === 'text') {
      const result = await generateText({
        ...aiModelByProfile(model, { temperature: 0 }),
        instructions: systemPrompt,
        prompt: `${userPrompt}\n---\n\n${document.text}`,
      })
      return result.text
    }

    const result = await generateText({
      ...aiModelByProfile(model, { temperature: 0 }),
      instructions: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'file', data: document.data, mediaType: document.mediaType },
            { type: 'text', text: userPrompt },
          ],
        },
      ],
    })
    return result.text
  }

  private async loadPromptTemplate(): Promise<string> {
    const content = await readTextFile(PROMPT_FILE)
    const { markdown } = splitYamlMarkdown(content)
    return markdown.trim()
  }
}
