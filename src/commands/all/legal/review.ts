import * as path from 'node:path'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { resolveFileRef } from '#lib/google/mod.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { IMPORT_EXTENSIONS, resolveImportSource } from '../google/agent/lib/importFile.ts'
import type { MissionFile } from '../google/agent/lib/tools.ts'

const PROMPT_NAME = 'review.prompt.md'

const params = {
  document: ArgOrFlag.string('Legal document to review — a local .pdf/.docx/.md path, or a Google Doc URL/id', {
    required: true,
  }),
  focus: ArgOrFlag.string('What to weight the review toward (e.g. "indemnity and the renewal window")', {
    short: 'f',
  }),
  account: Flag.string('Google account (email or unique part of it)', { short: 'a' }),
}

type Params = InferParams<typeof params>
type Result = { report: string; files: MissionFile[]; url?: string; artifact?: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'legal:review': { params: Params; result: Result }
  }
}

@AIChatTool({ needsApproval: true })
export default class LegalReviewTask extends Command {
  static override description: CommandDescription = {
    name: 'legal:review',
    description:
      'Review a legal document — contract, NDA, lease, terms — and leave the findings as comments and suggested edits on a Google Doc copy.',
    descriptionLong: [
      'Uploads a local document (PDF, docx, markdown) to Drive converted to a',
      'Google Doc — or reviews a Google Doc already in Drive — then runs the',
      'Google agent over it with a legal-review brief: money, term and',
      'renewal, termination, liability and indemnity, IP, confidentiality,',
      'data and compliance, assignment, and dispute terms. Findings land on',
      'the document as severity-tagged anchored comments, concrete rewrites',
      'as suggested edits, plus one summary comment. The document text itself',
      'is never edited. A careful review, not legal advice.',
    ],
    usage: [
      'sky legal:review ~/deals/atlas-msa.pdf',
      'sky legal:review ~/deals/atlas-nda.pdf -f "indemnity and the renewal window"',
      'sky legal:review <google-doc-url>',
      'sky legal:review ~/deals/atlas-msa.pdf -a work',
    ],
    params,
  }

  static formatApproval(input: Record<string, unknown>, output: OutputHandler): void {
    output.log(`  Document: ${String(input.document ?? '')}`)
    if (input.focus) output.log(`  Focus:    ${String(input.focus)}`)
    output.log(`  Account:  ${input.account ? String(input.account) : '(default)'}`)
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { document, focus, account } = args

    if (!document?.trim()) {
      return CommandResult.fail('Provide a document, e.g. sky legal:review ~/deals/atlas-msa.pdf')
    }

    // A Google file goes to the agent as-is; anything else is a local path to
    // import. Checked in this order so a URL is never treated as a file path.
    const target = resolveFileRef(document.trim())
    if (!target && !resolveImportSource(document.trim())) {
      return CommandResult.fail(
        `Not a Google Doc URL/id, and not a document sky can import (${IMPORT_EXTENSIONS}): ${document}`,
      )
    }

    if (!import.meta.dirname) return CommandResult.error('Cannot locate the legal prompt directory')
    const promptPath = path.join(import.meta.dirname, 'prompts', PROMPT_NAME)
    const { output: mission } = renderPromptFile(await readTextFile(promptPath), PROMPT_NAME, {
      review: { focus: focus?.trim() },
    })

    // Both target params are passed explicitly: composition merges the parent's
    // args into the child, so leaving one unset could let a stale value stand.
    const result = await tasks.run<{ report: string; files: MissionFile[]; artifact?: string }>('google:agent', {
      mission,
      file: target ? document.trim() : undefined,
      import: target ? undefined : document.trim(),
      account,
    })

    if (result.status !== 'success' || !result.data) {
      if (result.error) return CommandResult.error(result.error, 'The review mission failed')
      return CommandResult.fail(result.message ?? 'The review mission failed')
    }

    const { report, files, artifact } = result.data
    const url = files.find((file) => file.kind === 'doc')?.url ?? files[0]?.url
    if (url) {
      output.log('')
      output.log(`Reviewed document: ${url}`)
    }

    return CommandResult.success({ report, files, url, artifact })
  }
}
