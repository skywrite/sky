import * as path from 'node:path'
import { SLACK_ENRICH } from '#commands/all/slack/lib/enrich.ts'
import mapLimit from '#commands/all/slack/lib/mapLimit.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_TIME } from '#config'
import { chooseTags } from '#lib/notebook/enrich/classify.ts'
import type { ClassifyRequest } from '#lib/notebook/enrich/classify.ts'
import {
  buildTagMenu,
  loadMessageCorpus,
  majorityTagsFor,
  sliceBefore,
  tagHistoryFor,
} from '#lib/notebook/enrich/corpus.ts'
import type { MessageRecord, TagCount } from '#lib/notebook/enrich/corpus.ts'
import type { Role } from '#shared/ai/models.ts'
import { outputFile } from '#shared/fs/mod.ts'
import { mulberry32, stratifiedSample } from './lib/sample.ts'
import { aggregate, pct, scorePrediction } from './lib/score.ts'
import type { FileScore } from './lib/score.ts'

const FAMILY_MEDIUMS = ['email', 'message', 'meeting']
const MODELS: Role[] = ['fast', 'balanced']

const VARIANTS = [
  { key: 'base', history: true, family: false },
  { key: 'no-history', history: false, family: false },
  { key: 'family', history: true, family: true },
  { key: 'family-no-history', history: false, family: true },
] as const

type VariantKey = (typeof VARIANTS)[number]['key']

const params = {
  sample: Flag.number('Tagged threads to evaluate', { default: 200, short: 's' }),
  seed: Flag.number('Random seed for reproducible sampling', { default: 1 }),
  model: Flag.string('Model role for a single run: fast, balanced, or reasoning', { default: 'fast' }),
  variant: Flag.string('Single-run variant: base, no-history, family, or family-no-history', { default: 'base' }),
  matrix: Flag.bool('Run every variant with fast and balanced models on the same sample', { default: false }),
  since: Flag.string(
    'Ignore archives before this date (YYYY-MM-DD) — excludes the old taxonomy era from menus, history, and sampling',
    {
      default: '2025-01-01',
    },
  ),
  minPrior: Flag.number('Skip threads with fewer prior slack archives than this (cold-start guard)', { default: 50 }),
  concurrency: Flag.number('Parallel AI calls', { default: 6 }),
  outDir: Flag.string('Directory for per-run detail JSONL files', { default: '/tmp/sky/evals' }),
}

type Params = InferParams<typeof params>

type RunSummary = {
  variant: string
  model: string
  files: number
  exact: number
  overlap: number
  family: number
  harmful: number
  abstained: number
  errors: number
  invented: number
  detailPath?: string
}

type Result = {
  corpus: {
    slackFiles: number
    taggedFiles: number
    familyFiles: number
    eligible: number
    sampled: number
  }
  baseline: RunSummary
  runs: RunSummary[]
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:tags:eval': { params: Params; result: Result }
  }
}

type EvalCase = {
  record: MessageRecord
  menu: TagCount[]
  history: TagCount[]
  familyMenu: TagCount[]
  baseline: string[]
}

export default class SlackTagsEvalTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:tags:eval',
    description: 'Backtest the Slack auto-tag classifier against already-tagged archives.',
    descriptionLong: [
      'Samples already-tagged Slack archives, rebuilds each classification input from',
      'the file plus a time-sliced corpus (only strictly-earlier days — no leakage),',
      'hides the real tags, and scores the model prediction against them.',
      '',
      'Reports exact-set, any-overlap, branch-family, harmful (foreign top-level branch),',
      'and abstain rates next to the channel-majority rubber-stamp baseline. Detail lines',
      'for every prediction land in a JSONL file per run (real notebook data — kept',
      'outside the repo).',
    ],
    usage: [
      'sky slack:tags:eval --sample 3 --concurrency 2',
      'sky slack:tags:eval --sample 200',
      'sky slack:tags:eval --sample 100 --matrix',
      'sky slack:tags:eval --variant family --model balanced',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context

    const singleModel = args.model as Role
    if (!args.matrix && !['fast', 'balanced', 'reasoning'].includes(args.model)) {
      return CommandResult.fail(`Unknown model role: ${args.model} (use fast, balanced, or reasoning)`)
    }
    const singleVariant = VARIANTS.find((v) => v.key === (args.variant as VariantKey))
    if (!args.matrix && !singleVariant) {
      return CommandResult.fail(`Unknown variant: ${args.variant} (use ${VARIANTS.map((v) => v.key).join(', ')})`)
    }

    // One query collects slack + family mediums (bodies included — records get
    // re-classified); slices below stay leakage-free per case
    const corpus = await loadMessageCorpus([...SLACK_ENRICH.mediums, ...FAMILY_MEDIUMS], { withBody: true })
    const records = corpus.records.filter((r) => r.date >= args.since)
    const slackRecords = records.filter((r) => r.medium === 'slack')
    const familyRecords = records.filter((r) => r.medium !== 'slack')

    // Files on the first day of each date group know how many strictly-earlier archives exist
    const priorCount = new Map<string, number>()
    for (const [index, record] of slackRecords.entries()) {
      if (!priorCount.has(record.date)) priorCount.set(record.date, index)
    }

    const tagged = slackRecords.filter((r) => r.tags.length > 0)
    const eligible = tagged.filter((r) => (priorCount.get(r.date) ?? 0) >= args.minPrior)

    const rand = mulberry32(args.seed)
    const sampled = stratifiedSample(eligible, (r) => r.date.slice(0, 7), args.sample, rand)

    output.log(`Corpus: ${slackRecords.length} slack archives since ${args.since} (${tagged.length} tagged)`)
    output.log(
      `Eligible after cold-start guard (>=${args.minPrior} prior): ${eligible.length}; sampled: ${sampled.length}`,
    )

    const needFamily = args.matrix || (singleVariant?.family ?? false)
    const cases: EvalCase[] = sampled.map((record) => {
      const slice = sliceBefore(slackRecords, record.date)
      return {
        record,
        menu: buildTagMenu(slice),
        history: tagHistoryFor(slice, record.to),
        familyMenu: needFamily ? buildTagMenu(sliceBefore(familyRecords, record.date)) : [],
        baseline: majorityTagsFor(slice, record.to),
      }
    })

    const stamp = `${context.systemNow.date}_${context.systemNow.time.replace(':', '-')}`

    const baselineScores = cases.map((c) => scorePrediction(c.record.tags, c.baseline))
    const baseline: RunSummary = {
      variant: 'channel-majority',
      model: '-',
      errors: 0,
      invented: 0,
      ...aggregate(baselineScores),
    }

    const plan: { variant: (typeof VARIANTS)[number]; model: Role }[] = args.matrix
      ? MODELS.flatMap((model) => VARIANTS.map((variant) => ({ variant, model })))
      : [{ variant: singleVariant as (typeof VARIANTS)[number], model: singleModel }]

    const runs: RunSummary[] = []
    for (const { variant, model } of plan) {
      const started = performance.now()
      const outcomes = await mapLimit(cases, args.concurrency, (c) =>
        chooseTags(requestFor(c, variant.history, variant.family), model),
      )

      const detailLines: string[] = []
      const scores: FileScore[] = []
      let errors = 0
      let invented = 0
      for (const [index, outcome] of outcomes.entries()) {
        const c = cases[index]
        const score = outcome.error ? undefined : scorePrediction(c.record.tags, outcome.tags)
        if (score) scores.push(score)
        else errors++
        invented += outcome.invented
        detailLines.push(
          JSON.stringify({
            path: path.relative(DIR_TIME, c.record.path),
            date: c.record.date,
            to: c.record.to,
            actual: c.record.tags,
            predicted: outcome.tags,
            baseline: c.baseline,
            invented: outcome.invented,
            ...(outcome.error ? { error: outcome.error } : {}),
            ...score,
          }),
        )
      }

      const detailPath = path.join(args.outDir, `slack-tags-eval_${stamp}_${model}_${variant.key}.jsonl`)
      await outputFile(detailPath, detailLines.join('\n') + '\n')

      const run: RunSummary = { variant: variant.key, model, errors, invented, detailPath, ...aggregate(scores) }
      runs.push(run)
      output.log(
        `Run ${variant.key}/${model}: ${run.files} scored in ${Math.round((performance.now() - started) / 1000)}s`,
      )
    }

    output.log('')
    printTable(output, baseline, runs)
    output.log('')
    output.log(`Detail JSONL: ${args.outDir}`)

    return CommandResult.success({
      corpus: {
        slackFiles: slackRecords.length,
        taggedFiles: tagged.length,
        familyFiles: familyRecords.length,
        eligible: eligible.length,
        sampled: sampled.length,
      },
      baseline,
      runs,
    })
  }
}

function requestFor(evalCase: EvalCase, history: boolean, family: boolean): ClassifyRequest {
  return {
    body: evalCase.record.body,
    kind: SLACK_ENRICH.kind,
    to: evalCase.record.to,
    from: evalCase.record.from,
    summary: evalCase.record.summary,
    tagHistory: history ? evalCase.history : [],
    menu: evalCase.menu,
    familyMenu: family ? evalCase.familyMenu : undefined,
  }
}

function printTable(output: { log: (message: string) => void }, baseline: RunSummary, runs: RunSummary[]): void {
  const rows = [baseline, ...runs]
  const header = ['variant', 'model', 'files', 'exact', 'overlap', 'family', 'harmful', 'abstain', 'errors', 'invented']
  const cells = rows.map((r) => [
    r.variant,
    r.model,
    String(r.files),
    pct(r.exact, r.files),
    pct(r.overlap, r.files),
    pct(r.family, r.files),
    pct(r.harmful, r.files),
    pct(r.abstained, r.files),
    String(r.errors),
    String(r.invented),
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...cells.map((row) => row[i].length)))
  const line = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i])).join('  ')
  output.log(line(header))
  output.log(line(widths.map((w) => '-'.repeat(w))))
  for (const row of cells) output.log(line(row))
}
