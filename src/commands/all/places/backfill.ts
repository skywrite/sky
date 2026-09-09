import { mkdtemp, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { autoRelServices } from '#lib/notebook/enrich/autoRel.ts'
import { loadMessageCorpus, sliceBefore } from '#lib/notebook/enrich/corpus.ts'
import { buildEntityIndex } from '#lib/notebook/enrich/resolve.ts'
import { fetchEntityScores } from '#lib/notebook/enrich/scores.ts'
import { previewPlaceBackfill, type PlaceBackfillPreview } from '#lib/places/backfill.ts'
import { planPlaceRepair, type PlaceRepairPlan } from '#lib/places/repair.ts'
import { readServiceDocument, toNotebookRelative } from '#lib/service/documents.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const MEDIUMS = ['chat', 'note', 'journal', 'meeting', 'slack', 'email', 'message', 'recap']
const params = {
  since: Flag.string('Preview records on or after YYYY-MM-DD', { default: '2025-01-01' }),
  limit: Flag.number('Newest records to analyze with AI (existing rel references are checked across the full range)', {
    default: 20,
  }),
  medium: Flag.string('Comma-separated record types', { default: MEDIUMS.join(',') }),
}
type Params = InferParams<typeof params>
type Result = {
  records: number
  analyzed: number
  repair: PlaceRepairPlan
  previews: PlaceBackfillPreview[]
  reportPath: string
}
declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'places:backfill': { params: Params; result: Result }
  }
}

export default class PlacesBackfill extends Command {
  static override description: CommandDescription = {
    name: 'places:backfill',
    description: 'Preview missing place relationships and country records without changing the notebook.',
    descriptionLong: [
      'Uses the same subject extraction and selection as automatic links, with existing links preserved.',
      'The notebook service must be running. AI analyzes the newest records up to --limit; ambiguous places are listed for review.',
      'Writes a review report to a temporary directory outside the notebook. It never applies the proposals.',
    ],
    usage: ['sky places:backfill --limit 10', 'sky places:backfill --medium chat,note --since 2026-01-01'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    if (!Number.isInteger(args.limit) || args.limit < 0)
      return CommandResult.fail('Provide a nonnegative integer --limit.')
    const since = new PlainDate(args.since).ymd
    const mediums = [...new Set(args.medium.split(',').map((medium) => medium.trim()))]
    if (mediums.some((medium) => !MEDIUMS.includes(medium)))
      return CommandResult.fail(`Choose from: ${MEDIUMS.join(', ')}.`)
    const [corpus, index, scores] = await Promise.all([
      loadMessageCorpus(mediums),
      buildEntityIndex(),
      fetchEntityScores(),
    ])
    const records = corpus.records.filter((record) => record.date >= since)
    if (!records.length)
      return CommandResult.fail('No indexed records found in this range. Check the notebook service and filters.')
    const repair = planPlaceRepair(
      records.map((record) => new Document({ rel: record.rel })),
      index.places!.store,
    )
    const selected = [...records].reverse().slice(0, args.limit)
    const previews: PlaceBackfillPreview[] = []
    for (const [i, record] of selected.entries()) {
      context.output.log(`Reviewing ${i + 1}/${selected.length}: ${toNotebookRelative(record.path)}`)
      try {
        const body = await readServiceDocument(toNotebookRelative(record.path))
        if (body === null) throw new Error('The indexed document is no longer available.')
        previews.push(
          await previewPlaceBackfill(
            { ...record, body },
            {
              ...autoRelServices,
              buildIndex: async () => index,
              fetchScores: async () => scores,
              loadCorpus: async (wanted) => ({
                records: sliceBefore(
                  corpus.records.filter((prior) => wanted.includes(prior.medium)),
                  record.date,
                ),
              }),
            },
          ),
        )
      } catch (error) {
        previews.push({ path: record.path, add: [], create: [], review: [], error: (error as Error).message })
      }
    }
    const directory = await mkdtemp('/tmp/sky-place-backfill-')
    const reportPath = path.join(directory, 'preview.md')
    const result = { records: records.length, analyzed: selected.length, repair, previews, reportPath }
    const lines = [
      '# Place relationship preview',
      '',
      `${records.length} records checked for missing targets; ${selected.length} analyzed for new relationships. No notebook changes applied.`,
      '',
      '## Existing references',
      '',
      ...repair.create.map((item) => `- Create ${item.name}: \`${item.ref}\``),
      ...repair.unresolved.map((item) => `- Review \`${item.ref}\`: ${item.reason} (${item.uses} documents)`),
      '',
      '## Proposed relationships',
      '',
    ]
    for (const preview of previews) {
      lines.push(`### ${toNotebookRelative(preview.path)}`, '')
      if (preview.error) lines.push(`Analysis failed: ${preview.error}`, '')
      for (const ref of preview.add) lines.push(`- Add to rel: \`${ref}\``)
      for (const item of preview.create) lines.push(`- Create country record: ${item.name} (\`${item.ref}\`)`)
      for (const item of preview.review)
        lines.push(
          `- Review ${item.name}${item.context.length ? ` (${item.context.join(', ')})` : ''}: ${item.candidates.map((candidate) => `${candidate.name} — ${candidate.ref}`).join('; ') || 'No confirmed place record.'}`,
        )
      if (!preview.error && !preview.add.length && !preview.create.length && !preview.review.length)
        lines.push('No additions proposed.')
      lines.push('')
    }
    await writeFile(reportPath, `${lines.join('\n')}\n`)
    await writeFile(path.join(directory, 'preview.json'), `${JSON.stringify(result, null, 2)}\n`)
    context.output.log(
      `${previews.reduce((count, preview) => count + preview.add.length, 0)} proposed place links; ${repair.create.length} missing country targets; ${repair.unresolved.length} unresolved references.`,
    )
    context.output.log(`Preview: ${reportPath}`)
    return CommandResult.success(result)
  }
}
