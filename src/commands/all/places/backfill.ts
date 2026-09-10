import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { autoRelServices } from '#lib/notebook/enrich/autoRel.ts'
import { loadMessageCorpus, sliceBefore } from '#lib/notebook/enrich/corpus.ts'
import { buildEntityIndex } from '#lib/notebook/enrich/resolve.ts'
import { fetchEntityScores } from '#lib/notebook/enrich/scores.ts'
import { previewPlaceBackfill, samplePlaceRecords, type PlaceBackfillPreview } from '#lib/places/backfill.ts'
import { applyPlaceBackfill, type PlaceBackfillApplied, type PlaceBackfillReport } from '#lib/places/backfillApply.ts'
import { planPlaceRepair } from '#lib/places/repair.ts'
import { serviceDocumentIO, toNotebookRelative } from '#lib/service/documents.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const MEDIUMS = ['chat', 'note', 'journal', 'meeting', 'slack', 'email', 'message', 'recap']
const params = {
  apply: Flag.string('Apply the retained proposals in a reviewed preview.json report'),
  since: Flag.string('Preview records on or after YYYY-MM-DD', { default: '2025-01-01' }),
  limit: Flag.number('Records to analyze with AI (existing rel references are checked across the full range)', {
    default: 20,
  }),
  medium: Flag.string('Comma-separated record types', { default: MEDIUMS.join(',') }),
  sample: Flag.string('Sampling: recent, or spread across dates and record types', { default: 'recent' }),
}
type Params = InferParams<typeof params>
type Result = (PlaceBackfillReport | { applied: PlaceBackfillApplied[] }) & { reportPath: string }
declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'places:backfill': { params: Params; result: Result }
  }
}

export default class PlacesBackfill extends Command {
  static override description: CommandDescription = {
    name: 'places:backfill',
    description: 'Preview missing place relationships, or apply a reviewed report.',
    descriptionLong: [
      'Uses the same subject extraction and selection as automatic links, with existing links preserved.',
      'The notebook service must be running. AI analyzes up to --limit records; --sample spread balances record types across the date range.',
      'Preview writes reports outside the notebook. Review preview.md and remove rejected rows, add entries, or create entries from preview.json.',
      'Pass that JSON file to --apply to write the retained proposals without AI. Changed sources are skipped; existing links and prose are preserved.',
      'The existing-reference repair summary is informational; apply acts only on the retained per-document proposals.',
    ],
    usage: [
      'sky places:backfill --sample spread --limit 100',
      'sky places:backfill --medium chat,note --since 2026-01-01',
      'sky places:backfill --apply /tmp/reviewed-places/preview.json',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const notebook = await realpath(context.config.DIR_BASE)
    const io = serviceDocumentIO()
    if (args.apply) {
      const report: unknown = JSON.parse(await readFile(args.apply, 'utf8'))
      const applied = await applyPlaceBackfill(report, { notebook, io, index: await buildEntityIndex() })
      const directory = await mkdtemp('/tmp/sky-place-apply-')
      const reportPath = path.join(directory, 'result.json')
      await writeFile(reportPath, `${JSON.stringify({ notebook, applied }, null, 2)}\n`)
      const count = (status: PlaceBackfillApplied['status']) => applied.filter((row) => row.status === status).length
      context.output.log(
        `${count('applied')} applied; ${count('unchanged')} unchanged; ${count('skipped')} skipped; ${count('failed')} failed.`,
      )
      context.output.log(`Result: ${reportPath}`)
      return CommandResult.success({ applied, reportPath })
    }
    if (!Number.isInteger(args.limit) || args.limit < 0)
      return CommandResult.fail('Provide a nonnegative integer --limit.')
    if (args.sample !== 'recent' && args.sample !== 'spread')
      return CommandResult.fail('Choose --sample recent or spread.')
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
    const selected = samplePlaceRecords(records, args.limit, args.sample)
    const previews: PlaceBackfillPreview[] = []
    for (const [i, record] of selected.entries()) {
      const file = toNotebookRelative(record.path, context.config.DIR_BASE)
      context.output.log(`Reviewing ${i + 1}/${selected.length}: ${file}`)
      try {
        const snapshot = await io.read(file)
        if (!snapshot) throw new Error('The indexed document is no longer available.')
        previews.push(
          await previewPlaceBackfill(
            { ...record, path: file, body: snapshot.content },
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
        previews.push({ path: file, add: [], create: [], review: [], error: (error as Error).message })
      }
    }
    const directory = await mkdtemp('/tmp/sky-place-backfill-')
    const reportPath = path.join(directory, 'preview.md')
    const result: PlaceBackfillReport = {
      format: 'sky-place-backfill-v1',
      notebook,
      created: PlainDate.today().ymd,
      since,
      sample: args.sample,
      records: records.length,
      analyzed: selected.length,
      repair,
      previews,
    }
    const dates = selected.map((record) => record.date).sort()
    const lines = [
      '# Place relationship preview',
      '',
      `${records.length} records checked for missing targets; ${selected.length} analyzed for new relationships. No notebook changes applied.`,
      '',
      `Sample: ${args.sample}. Dates: ${dates[0] ?? 'none'} through ${dates.at(-1) ?? 'none'}.`,
      '',
      'Review the proposals below. In preview.json, remove rejected document rows, add entries, or country create entries. Then run:',
      '',
      `\`sky places:backfill --apply ${path.join(directory, 'preview.json')}\``,
      '',
      'Apply checks each source fingerprint, preserves existing links and prose, and skips changed files. Unresolved references below still need review.',
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
      lines.push(`### ${preview.path}`, '')
      if (preview.error) lines.push(`Analysis failed: ${preview.error}`, '')
      for (const ref of preview.add) {
        lines.push(`- Add to rel: \`${ref}\``)
        for (const evidence of preview.evidence?.filter((item) => item.ref === ref) ?? [])
          lines.push(`  - Evidence: ${evidence.quote.replace(/\s+/g, ' ')}`)
      }
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
    return CommandResult.success({ ...result, reportPath })
  }
}
