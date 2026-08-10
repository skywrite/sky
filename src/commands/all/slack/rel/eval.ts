import * as path from 'node:path'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_TIME, PORT_SERVER } from '#config'
import type { Role } from '#shared/ai/models.ts'
import { outputFile } from '#shared/fs/mod.ts'
import { channelMajorityRel, channelRelHistory, loadMessageCorpus, sliceBefore } from '../tags/lib/corpus.ts'
import type { MessageRecord } from '../tags/lib/corpus.ts'
import mapLimit from '../tags/lib/mapLimit.ts'
import { mulberry32, stratifiedSample } from '../tags/lib/sample.ts'
import { pct } from '../tags/lib/score.ts'
import { extractSubjects } from './lib/extract.ts'
import type { ExtractedSubjects } from './lib/extract.ts'
import { scanMentions } from './lib/mentionScan.ts'
import { aggregateRel, entryTallies, scoreRel } from './lib/relScore.ts'
import type { RelAggregate } from './lib/relScore.ts'
import { buildEntityIndex, normalizeEntityName, resolveSubjects } from './lib/resolve.ts'
import type { EntityIndex } from './lib/resolve.ts'
import { fetchEntityScores } from './lib/scores.ts'
import { rankCandidates, selectRel } from './lib/select.ts'
import type { Exemplar, RelCandidate } from './lib/select.ts'

const MAX_PRIOR_ONLY_CANDIDATES = 4
const MAX_EXEMPLARS = 3

const params = {
  sample: Flag.number('Rel-carrying threads to evaluate', { default: 200, short: 's' }),
  seed: Flag.number('Random seed for reproducible sampling', { default: 1 }),
  since: Flag.string('Ignore archives before this date (YYYY-MM-DD)', { default: '2025-01-01' }),
  minPrior: Flag.number('Skip threads with fewer prior slack archives than this (cold-start guard)', { default: 50 }),
  concurrency: Flag.number('Parallel AI calls', { default: 6 }),
  outDir: Flag.string('Directory for the detail JSONL file', { default: '/tmp/sky/evals' }),
}

type Params = InferParams<typeof params>

type Row = {
  config: string
  entries: number
  correctEntries: number
  actualEntries: number
  recoveredEntries: number
} & RelAggregate

type Result = {
  corpus: { slackFiles: number; relFiles: number; eligible: number; sampled: number; parseSkipped: number }
  entityIndex: { candidates: number }
  scoresAvailable: boolean
  raw: Row[]
  resolvable: Row[]
  agreementEntries: number
  agreementCorrect: number
  extractionsDropped: number
  selectErrors: number
  openOnlyForfeits: number
  detailPath: string
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:rel:eval': { params: Params; result: Result }
  }
}

const CONFIGS = [
  'channel-majority',
  'scan',
  'extract',
  'extract+prior',
  'ranked',
  'select-fast',
  'select-balanced',
] as const
type ConfigKey = (typeof CONFIGS)[number]

type EvalCase = {
  record: MessageRecord
  parties: string[]
  majority: string[]
  relHistory: { tag: string; count: number }[]
  exemplars: Exemplar[]
  candidates: RelCandidate[]
  subjects?: ExtractedSubjects
  extractError?: string
  predictions: Record<ConfigKey, string[]>
  dropped: number
}

export default class SlackRelEvalTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:rel:eval',
    description: 'Backtest rel (subject) prediction against already-annotated Slack archives.',
    descriptionLong: [
      'Samples rel-carrying Slack archives and races: the channel-majority rel',
      'baseline, a deterministic mention scan, AI subject extraction resolved',
      'against the entity graph, extraction unioned with the channel prior, a',
      'deterministic evidence-ranked control, and a selection pass (fast and',
      'balanced) that picks 0-2 refs from the evidence-annotated candidates',
      'with channel exemplars as demonstrations.',
      '',
      'Corpus slices are strictly time-sliced (earlier days only). The entity',
      'index cannot be time-sliced — resolution runs against the current graph,',
      'and project resolution is scored across all statuses; the open-only',
      'production posture is reported as a forfeit count. Detail JSONL holds',
      'real notebook data — kept outside the repo.',
    ],
    usage: ['sky slack:rel:eval --sample 3 --concurrency 2', 'sky slack:rel:eval --sample 200'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context

    const corpus = await loadMessageCorpus(DIR_TIME, ['slack'])
    const records = corpus.records.filter((r) => r.date >= args.since)
    const priorCount = new Map<string, number>()
    for (const [index, record] of records.entries()) {
      if (!priorCount.has(record.date)) priorCount.set(record.date, index)
    }
    const relFiles = records.filter((r) => r.rel.length > 0)
    const eligible = relFiles.filter((r) => (priorCount.get(r.date) ?? 0) >= args.minPrior)

    const rand = mulberry32(args.seed)
    const sampled = stratifiedSample(eligible, (r) => r.date.slice(0, 7), args.sample, rand)

    const index = await buildEntityIndex()
    const scores = await fetchEntityScores()

    output.log(
      `Corpus: ${records.length} slack archives since ${args.since} (${relFiles.length} with rel, ${corpus.skipped} unparseable)`,
    )
    output.log(`Eligible: ${eligible.length}; sampled: ${sampled.length}`)
    output.log(
      `Entity index: ${index.candidates.length} candidates; interaction scores: ${scores ? 'on' : 'unavailable'}`,
    )

    const cases: EvalCase[] = sampled.map((record) => {
      const slice = sliceBefore(records, record.date)
      const channelRecords = slice.filter((r) => r.channel === record.channel && r.rel.length > 0)
      return {
        record,
        parties: partiesOf(record),
        majority: channelMajorityRel(slice, record.channel),
        relHistory: channelRelHistory(slice, record.channel),
        exemplars: channelRecords.slice(-MAX_EXEMPLARS).map((r) => ({
          summary: r.summary ?? '(no summary)',
          rel: r.rel,
        })),
        candidates: [],
        predictions: {
          'channel-majority': [],
          scan: [],
          extract: [],
          'extract+prior': [],
          ranked: [],
          'select-fast': [],
          'select-balanced': [],
        },
        dropped: 0,
      }
    })

    const outcomes = await mapLimit(cases, args.concurrency, (c) =>
      extractSubjects(
        { body: c.record.body, summary: c.record.summary, channel: c.record.channel, from: c.record.from },
        'fast',
      ),
    )

    let extractionsDropped = 0
    let openOnlyForfeits = 0
    for (const [i, outcome] of outcomes.entries()) {
      const c = cases[i]
      c.subjects = outcome.subjects
      c.extractError = outcome.error
      c.predictions['channel-majority'] = c.majority
      c.predictions.scan = scanMentions(c.record.body, index.candidates, c.parties)
      const resolved = resolveSubjects(outcome.subjects, index, scores, {})
      c.predictions.extract = resolved.refs
      c.dropped = resolved.dropped
      extractionsDropped += resolved.dropped
      c.predictions['extract+prior'] = unionByNorm(resolved.refs, c.majority)
      openOnlyForfeits += countOpenOnlyForfeits(resolved.refs, c.record.rel, index)
      c.candidates = buildCandidates(resolved.refs, c.relHistory, scores)
      c.predictions.ranked = rankCandidates(c.candidates)
    }

    let selectErrors = 0
    for (const role of ['fast', 'balanced'] as const) {
      const selections = await mapLimit(cases, args.concurrency, (c) =>
        selectRel(
          {
            body: c.record.body,
            summary: c.record.summary,
            channel: c.record.channel,
            from: c.record.from,
            candidates: c.candidates,
            exemplars: c.exemplars,
          },
          role as Role,
        ),
      )
      for (const [i, selection] of selections.entries()) {
        cases[i].predictions[`select-${role}`] = selection.rel
        if (selection.error) selectErrors++
      }
    }

    const rowFor = (config: ConfigKey, pool: { actual: string[]; predicted: string[] }[]): Row => {
      const agg = aggregateRel(pool.map((p) => scoreRel(p.actual, p.predicted)))
      let entries = 0
      let correctEntries = 0
      let actualEntries = 0
      let recoveredEntries = 0
      for (const p of pool) {
        const t = entryTallies(p.actual, p.predicted)
        entries += t.predicted
        correctEntries += t.correct
        actualEntries += t.actual
        recoveredEntries += t.recovered
      }
      return { config, entries, correctEntries, actualEntries, recoveredEntries, ...agg }
    }

    const raw = CONFIGS.map((config) =>
      rowFor(
        config,
        cases.map((c) => ({ actual: c.record.rel, predicted: c.predictions[config] })),
      ),
    )
    const resolvableCases = cases
      .map((c) => ({ c, actual: c.record.rel.filter((v) => index.canResolve(v)) }))
      .filter(({ actual }) => actual.length > 0)
    const resolvable = CONFIGS.map((config) =>
      rowFor(
        config,
        resolvableCases.map(({ c, actual }) => ({ actual, predicted: c.predictions[config] })),
      ),
    )

    // Precision of the agreement subset: candidates backed by both text and precedent
    let agreementEntries = 0
    let agreementCorrect = 0
    for (const c of cases) {
      const actualNorms = new Set(c.record.rel.map(normalizeEntityName))
      for (const candidate of c.candidates) {
        if (!candidate.inText || !candidate.inPrior) continue
        agreementEntries++
        if (actualNorms.has(normalizeEntityName(candidate.ref))) agreementCorrect++
      }
    }

    const stamp = `${context.systemNow.date}_${context.systemNow.time.replace(':', '-')}`
    const detailPath = path.join(args.outDir, `slack-rel-eval_${stamp}.jsonl`)
    await outputFile(
      detailPath,
      cases
        .map((c) =>
          JSON.stringify({
            path: path.relative(DIR_TIME, c.record.path),
            date: c.record.date,
            channel: c.record.channel,
            actual: c.record.rel,
            extracted: c.subjects,
            candidates: c.candidates,
            unresolvedExtractions: c.dropped,
            ...(c.extractError ? { extractError: c.extractError } : {}),
            predictions: c.predictions,
          }),
        )
        .join('\n') + '\n',
    )

    output.log('')
    output.log(`Raw ground truth (${cases.length} files):`)
    printTable(output, raw)
    output.log('')
    output.log(`Resolvable-only slice (${resolvableCases.length} files):`)
    printTable(output, resolvable)
    output.log('')
    output.log(
      `Agreement subset (in-text ∧ channel-precedent): ${agreementEntries} entries, precision ${pct(agreementCorrect, agreementEntries)}`,
    )
    output.log(`Extractions dropped by resolution: ${extractionsDropped}; selection errors: ${selectErrors}`)
    output.log(`Open-only project resolution would forfeit ${openOnlyForfeits} correct hits`)
    output.log(`Detail JSONL: ${detailPath}`)

    return CommandResult.success({
      corpus: {
        slackFiles: records.length,
        relFiles: relFiles.length,
        eligible: eligible.length,
        sampled: sampled.length,
        parseSkipped: corpus.skipped,
      },
      entityIndex: { candidates: index.candidates.length },
      scoresAvailable: !!scores,
      raw,
      resolvable,
      agreementEntries,
      agreementCorrect,
      extractionsDropped,
      selectErrors,
      openOnlyForfeits,
      detailPath,
    })
  }
}

function partiesOf(record: MessageRecord): string[] {
  const parties: string[] = []
  for (const value of [record.from, record.channel]) {
    if (!value || value.startsWith('#')) continue
    parties.push(
      ...value
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean),
    )
  }
  return [...new Set(parties)]
}

function buildCandidates(
  extractedRefs: string[],
  relHistory: { tag: string; count: number }[],
  scores: Map<string, number> | undefined,
): RelCandidate[] {
  const usesOf = new Map(relHistory.map((h) => [normalizeEntityName(h.tag), h.count]))
  const candidates: RelCandidate[] = extractedRefs.map((ref) => {
    const norm = normalizeEntityName(ref)
    return {
      ref,
      inText: true,
      inPrior: usesOf.has(norm),
      uses: usesOf.get(norm) ?? 0,
      ...(scores?.has(norm) ? { score: scores.get(norm) } : {}),
    }
  })
  const inTextNorms = new Set(extractedRefs.map(normalizeEntityName))
  let added = 0
  for (const h of relHistory) {
    if (added >= MAX_PRIOR_ONLY_CANDIDATES) break
    const norm = normalizeEntityName(h.tag)
    if (inTextNorms.has(norm)) continue
    candidates.push({
      ref: h.tag,
      inText: false,
      inPrior: true,
      uses: h.count,
      ...(scores?.has(norm) ? { score: scores.get(norm) } : {}),
    })
    added++
  }
  return candidates
}

function unionByNorm(a: string[], b: string[]): string[] {
  const out = [...a]
  for (const value of b) {
    if (!out.some((r) => normalizeEntityName(r) === normalizeEntityName(value))) out.push(value)
  }
  return out
}

/** Correct project hits whose project is not currently open — what strict open-only resolution would lose. */
function countOpenOnlyForfeits(predicted: string[], actual: string[], index: EntityIndex): number {
  const actualNorms = new Set(actual.map(normalizeEntityName))
  let forfeits = 0
  for (const ref of predicted) {
    if (!ref.startsWith('projects/')) continue
    if (!actualNorms.has(normalizeEntityName(ref))) continue
    const candidate = index.candidates.find((c) => c.ref === ref)
    if (candidate && candidate.projectStatus !== 'open') forfeits++
  }
  return forfeits
}

function printTable(output: { log: (message: string) => void }, rows: Row[]): void {
  const header = ['config', 'files', 'exact', 'overlap', 'wrong-entity', 'abstain', 'p-prec', 'p-rec', 'avg']
  const cells = rows.map((r) => [
    r.config,
    String(r.files),
    pct(r.exact, r.files),
    pct(r.overlap, r.files),
    pct(r.wrongEntity, r.files),
    pct(r.abstained, r.files),
    pct(r.correctEntries, r.entries),
    pct(r.recoveredEntries, r.actualEntries),
    r.files > 0 ? (r.entries / r.files).toFixed(2) : '-',
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...cells.map((row) => row[i].length)))
  const line = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i])).join('  ')
  output.log(line(header))
  output.log(line(widths.map((w) => '-'.repeat(w))))
  for (const row of cells) output.log(line(row))
}
