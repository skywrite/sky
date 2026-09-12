import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { prepareImageEdit } from './lib/edit.ts'
import { imageEvaluationCases, runImageEvaluations } from './lib/evaluation/mod.ts'
import type { ImageEvaluationDefinition, ImageEvaluationReport } from './lib/evaluation/mod.ts'
import { writeImageEvidence } from './lib/evidence.ts'
import { selectImageSettings } from './lib/preflight.ts'
import { prepareReferenceImage, referencePreview } from './lib/references.ts'
import { runImageWorkflow } from './lib/workflow.ts'

const params = {
  list: Flag.bool('List the synthetic cases without making paid API calls', { default: false }),
  cases: Flag.string('Comma-separated case IDs; defaults to all cases shown by --list'),
  out: Flag.string('Parent directory for a unique evaluation run; defaults to a temporary directory', { short: 'o' }),
  attempts: Flag.number('Maximum image workflow attempts per case (1–5)', { default: 3 }),
  budgetMinutes: Flag.number('Time budget for the entire evaluation in minutes (1–120)', { default: 20 }),
}

type Params = InferParams<typeof params>
type Result = {
  cases: readonly ImageEvaluationDefinition[]
  outputDirectory?: string
  reportFile?: string
  evaluation?: ImageEvaluationReport
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ai:image:evaluate': { params: Params; result: Result }
  }
}

export default class AiImageEvaluate extends Command {
  static override description: CommandDescription = {
    name: 'ai:image:evaluate',
    description:
      'Run paid image-workflow evaluations on reproducible synthetic imagery, graphics, lettering and transparency. Use --list for a free case listing.',
    descriptionLong: [
      'Runs the same selection, edit preparation, drawing and image workflow used by ai:image.',
      'All cases use synthetic references on a fixed 1024px square canvas. Protected RGBA,',
      'dimensions, transparency and defined geometric checks are measured separately from',
      'the model visual review. An objective pass does not prove semantic or visual correctness.',
      'The shaded still life tests synthetic material transitions; it is not a photographic benchmark.',
      'Each run retains source images, protected masks, outputs, editable SVG when available,',
      'workflow attempts and a JSON report. It does not write to the notebook.',
      'Running cases makes paid OpenAI calls; --attempts and --budgetMinutes bound the run.',
    ],
    usage: [
      'sky ai:image:evaluate --list',
      'sky ai:image:evaluate --cases expanded-star,diagram-label --attempts 3',
      'sky ai:image:evaluate --cases transparent-cutout --attempts 1 --budgetMinutes 5',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const definitions = args.cases
      ? args.cases
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : imageEvaluationCases.map((item) => item.id)
    if (!definitions.length || new Set(definitions).size !== definitions.length)
      return CommandResult.fail('Choose one or more unique case IDs from --list.')
    for (const id of definitions)
      if (!imageEvaluationCases.some((item) => item.id === id))
        return CommandResult.fail(`Unknown case "${id}". Use --list to see available cases.`)
    const cases = definitions.map((id) => imageEvaluationCases.find((item) => item.id === id)!)
    if (args.list) {
      for (const item of cases) context.output.log(`${item.id} (${item.medium}): ${item.prompt}`)
      return CommandResult.success({ cases })
    }
    const maxAttempts = args.attempts ?? 3
    const minutes = args.budgetMinutes ?? 20
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5)
      return CommandResult.fail('--attempts must be an integer between 1 and 5.')
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120)
      return CommandResult.fail('--budgetMinutes must be between 1 and 120.')
    if (!env.get('OPENAI_API_KEY'))
      return CommandResult.fail(
        'Set OPENAI_API_KEY to run paid image evaluations. Use --list to inspect the cases without an API key.',
      )
    try {
      const parent = args.out
        ? path.resolve(args.out.startsWith('~/') ? path.join(os.homedir(), args.out.slice(2)) : args.out)
        : os.tmpdir()
      await mkdir(parent, { recursive: true })
      const directory = await mkdtemp(path.join(parent, 'sky-image-evaluation-'))
      context.output.log(
        `Running ${cases.length} paid evaluation case${cases.length === 1 ? '' : 's'}; evidence: ${directory}`,
      )
      const evaluation = await runImageEvaluations({
        caseIds: definitions,
        maxAttemptsPerCase: 1,
        maxDurationMs: Math.round(minutes * 60_000),
        signal: context.signal,
        generate: async ({ fixture, signal, remaining }) => {
          const caseStarted = performance.now()
          const caseDir = path.join(directory, fixture.definition.id)
          await mkdir(caseDir)
          const sourceFile = path.join(caseDir, 'source.png')
          const maskFile = path.join(caseDir, 'protected-mask.png')
          await Promise.all([
            writeFile(sourceFile, fixture.source, { flag: 'wx' }),
            writeFile(maskFile, fixture.protectedMask, { flag: 'wx' }),
          ])
          const prompt = fixture.definition.prompt
          const brief = `Synthetic evaluation; preserve the original canvas and unchanged content. Visual requirements: ${fixture.definition.visualRequirements.join(' ')}`
          const reference = await prepareReferenceImage(fixture.source, `${fixture.definition.id}.png`, signal)
          const preview = await referencePreview(reference, signal)
          const size = '1024x1024'
          const selection = await selectImageSettings({ prompt, brief, refs: [preview], size, count: 1, signal })
          context.output.log(`${fixture.definition.id}: ${selection.method}, ${selection.model}/${selection.quality}`)
          const prepared = await prepareImageEdit({
            prompt,
            brief,
            refs: [reference],
            intent: selection.intent,
            complexity: selection.complexity,
            method: selection.method,
            size,
            signal,
          })
          const images = await runImageWorkflow({
            prompt,
            brief,
            selection,
            refs: [reference],
            count: 1,
            size,
            edit: prepared.edit,
            maxAttempts,
            // Leave time to persist a checkpointed partial result before the run's outer cancellation.
            budgetMs: Math.max(1, remaining.durationMs - (performance.now() - caseStarted) - 2000),
            signal,
            onProgress: (message) => context.output.log(`${fixture.definition.id}: ${message}`),
          })
          const image = images[0]
          if (!image) throw new Error('The image workflow returned no evaluation output.')
          const outputFile = path.join(caseDir, 'output.png')
          const workflowFile = path.join(caseDir, 'workflow.json')
          await writeFile(outputFile, image.data, { flag: 'wx' })
          const artifacts: Record<string, string> = {
            source: sourceFile,
            protectedMask: maskFile,
            output: outputFile,
            workflow: workflowFile,
          }
          const retained = await writeImageEvidence(outputFile, image, prepared.edit, {
            prompt,
            brief,
            size,
            model: selection.model,
            quality: selection.quality,
            method: image.method,
          })
          artifacts.evidence = retained.directory
          if (retained.mask) artifacts.finalMask = retained.mask
          if (image.svg) {
            artifacts.svg = path.join(caseDir, 'output.svg')
            await writeFile(artifacts.svg, image.svg, { flag: 'wx' })
          }
          for (const [index, version] of image.versions.entries()) {
            const file = path.join(caseDir, `attempt-${index + 1}.png`)
            await writeFile(file, version.data, { flag: 'wx' })
            artifacts[`attempt${index + 1}`] = file
          }
          await writeFile(
            workflowFile,
            `${JSON.stringify({ prompt, brief, size, selection, method: image.method, attempts: image.attempts, review: image.review, versions: image.versions.map((version, index) => ({ attempt: index + 1, review: version.review })) }, null, 2)}\n`,
            { flag: 'wx' },
          )
          return { data: image.data, review: image.review, artifacts }
        },
      })
      const reportFile = path.join(directory, 'report.json')
      await writeFile(reportFile, `${JSON.stringify(evaluation, null, 2)}\n`, { flag: 'wx' })
      const { objectivePasses, failures, incomplete } = evaluation.totals
      const summary = `${objectivePasses} objective passes, ${failures} failures, ${incomplete} incomplete. Visual requirements and model reviews are separate. Report: ${reportFile}`
      context.output.log(summary)
      const result: Result = { cases, outputDirectory: directory, reportFile, evaluation }
      return failures || incomplete ? CommandResult.fail(summary, result) : CommandResult.success(result, summary)
    } catch (error) {
      if (context.signal?.aborted) return CommandResult.error('Image evaluation cancelled.')
      return CommandResult.error(error instanceof Error ? error : String(error))
    }
  }
}
