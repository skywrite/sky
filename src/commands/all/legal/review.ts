import * as path from 'node:path'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { profileContext } from '#commands/lib/chat/profileContext.ts'
import {
  ArgOrFlag,
  Command,
  CommandResult,
  Flag,
  type CommandArgs,
  type CommandDescription,
  type InferParams,
} from '#commands/mod.ts'
import { legalReviewChat } from '#lib/legalReview/chat.ts'
import { createLegalReviewer } from '#lib/legalReview/runtime.ts'
import { activeDocuments, openFindings, type LegalReview, type ReviewSource } from '#lib/legalReview/types.ts'
import { env } from '#shared/sys/mod.ts'

const params = {
  document: ArgOrFlag.string(
    'Local agreement path or attached filename; omit to use the agreements attached in this chat',
    { optional: true },
  ),
  documents: Flag.string('JSON array of local agreement paths or attached filenames, when selecting several files'),
  review: Flag.string('Saved review ID to continue; defaults to this conversation’s linked review'),
  focus: Flag.string('Known priorities or areas to weight, while still reading the whole set', { short: 'f' }),
  expected: Flag.number('Total agreements expected, when the user has stated it'),
  replaces: Flag.string('Prior document ID when this upload is explicitly a revised replacement'),
  action: Flag.string('review (default), add (register without analysis), or status (read saved results)', {
    default: 'review',
  }),
}
type Params = InferParams<typeof params>
type Result = { report: string; reviewId: string; artifact: string; review: LegalReview }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'legal:review': { params: Params; result: Result }
  }
}

export function reviewReport(review: LegalReview): string {
  const documents = activeDocuments(review)
  const findings = openFindings(review)
  const highlights = findings.filter((finding) => finding.severity === 'glaring')
  for (const finding of findings) {
    if (highlights.length >= 3) break
    if (!highlights.includes(finding)) highlights.push(finding)
  }
  return [
    `${documents.length}${review.expectedDocuments ? ` of ${review.expectedDocuments}` : ''} agreements · ${documents.filter((doc) => doc.status === 'reviewed').length} reviewed · ${findings.length} ${findings.length === 1 ? 'issue' : 'issues'} to discuss`,
    review.comparison.status === 'needed'
      ? 'Some coverage or findings still need review; see the review summary.'
      : 'The supplied agreements have been compared together.',
    ...(review.lastError ? [`Last analysis failed: ${review.lastError}`] : []),
    ...highlights.map((finding) => `- ${finding.title}: ${finding.explanation}`),
    ...(findings.length > highlights.length
      ? [`${findings.length - highlights.length} more findings are available in the review summary.`]
      : []),
    ...(review.missingDocuments.length ? [`Missing: ${review.missingDocuments.join('; ')}`] : []),
    ...(review.perspective?.uncertainties ?? []),
  ].join('\n\n')
}

@AIChatTool({ needsApproval: false })
export default class LegalReviewTask extends Command {
  constructor(private readonly createReviewer: typeof createLegalReviewer = createLegalReviewer) {
    super()
  }
  static override description: CommandDescription = {
    name: 'legal:review',
    description:
      'Review related agreements directly from PDFs or local documents. Maintain a shared document map, evidence and material findings in chat. No Google upload, comments, or edits. Reuse the same review across files and revisions.',
    usage: [
      'sky legal:review ~/deals/atlas-msa.pdf --expected 5',
      'sky legal:review ~/deals/atlas-schedule.pdf --review <review-id>',
      'sky legal:review --review <review-id> --action status',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    let reviewer: ReturnType<typeof createLegalReviewer> | undefined
    let reviewId = args.review
    try {
      const chat = legalReviewChat.getStore()
      reviewer = this.createReviewer(context.config)
      const id = args.review ?? chat?.id()
      reviewId = id
      const action = args.action ?? 'review'
      if (!['review', 'add', 'status'].includes(action)) return CommandResult.fail('Choose review, add, or status.')
      let review: LegalReview
      if (action === 'status') {
        const saved = id ? await reviewer.store.read(id) : null
        if (!saved) return CommandResult.fail('No saved review is linked yet. Attach an agreement to begin.')
        review = saved
        await chat?.link(review.id)
      } else {
        const attached = chat?.sources() ?? []
        const raw = args.documents
          ? (JSON.parse(args.documents) as unknown)
          : args.document
            ? [args.document]
            : undefined
        if (raw !== undefined && (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')))
          return CommandResult.fail('documents must be a JSON array of paths or attached filenames.')
        const sources: ReviewSource[] =
          raw === undefined
            ? attached
            : (raw as string[]).map((file) => {
                if (/^https?:\/\//.test(file))
                  throw new Error(
                    'Attach or download the original agreement to review it in chat. Google annotation is a separate action.',
                  )
                const matches = attached.filter(
                  (item) => item.path === file || item.name === file || item.name.endsWith(`_${file}`),
                )
                if (matches.length > 1)
                  throw new Error(`Several attachments match ${file}; use the complete attached filename.`)
                if (matches[0]) return matches[0]
                const resolved = file.startsWith('~/')
                  ? path.join(context.config.DIR_HOME, file.slice(2))
                  : path.resolve(chat ? context.config.DIR_HOME : env.get('SKY_USER_CWD') || '.', file)
                return { path: resolved, name: path.basename(resolved) }
              })
        const input = {
          id,
          sources,
          replaces: args.replaces,
          focus: args.focus,
          expectedDocuments: args.expected,
          context: chat?.context ?? {
            source: 'legal:review',
            instructions: await profileContext(context.config),
            conversation: [],
          },
          onCreated: async (id: string) => {
            reviewId = id
            await chat?.link(id)
          },
        }
        review =
          action === 'add'
            ? await reviewer.register(input)
            : await reviewer.review(input, (line) => context.output.log(line))
      }
      const report = reviewReport(review)
      context.output.log(report)
      context.output.log(`Review: ${review.id}`)
      return CommandResult.success({ report, reviewId: review.id, artifact: reviewer.store.file(review.id), review })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const saved = reviewer && reviewId ? await reviewer.store.read(reviewId).catch(() => null) : null
      if (!saved) return CommandResult.fail(message)
      const retained = `No new analysis was saved. ${activeDocuments(saved).length} original agreements and ${saved.findings.length} earlier findings are retained in review ${saved.id}. Use action=status to inspect saved work. Do not repeat analysis in this turn.`
      context.output.log(retained)
      return CommandResult.fail(`${message}\n\n${retained}`)
    }
  }
}
