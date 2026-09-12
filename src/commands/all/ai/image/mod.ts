import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import open from 'open'
import colors from 'picocolors'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { CommandPlatform } from '#commands/lib/core/CommandContext.ts'
import { ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_OUTPUT } from '#config'
import { slugify } from '#lib/string/mod.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { exists } from '#shared/fs/mod.ts'
import { actionKindRel } from '#shared/nbfs/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { writeImageArtifact } from './lib/artifact.ts'
import type { AttemptSummary } from './lib/attempts.ts'
import { validateDrawingSize } from './lib/drawingSize.ts'
import { prepareImageEdit } from './lib/edit.ts'
import type { PreparedImageEdit } from './lib/edit.ts'
import { writeImageEvidence } from './lib/evidence.ts'
import type { ImageReviewSummary } from './lib/finish.ts'
import {
  imageModelName,
  MAX_COUNT,
  MAX_REF_BYTES,
  MAX_REF_IMAGES,
  parseRefs,
  REF_EXT_RE,
  validateBackground,
  validateModel,
  validateQuality,
  validateSize,
} from './lib/options.ts'
import type { ImageBackground, ImageQuality } from './lib/options.ts'
import { selectImageSettings } from './lib/preflight.ts'
import type { ImageMethod } from './lib/preflight.ts'
import { prepareReferenceImage, referencePreview } from './lib/references.ts'
import type { ImageReference } from './lib/references.ts'
import { runImageWorkflow } from './lib/workflow.ts'

const params = {
  prompt: ArgOrFlag.string(
    'What to create or change. For photo edits, keep the user request concise and faithful; include only requested constraints.',
    { short: 'p', required: true },
  ),
  refs: Flag.string(
    'Local reference image(s) to edit, combine, or draw style/content from — comma-separated PNG/JPEG/WebP paths',
    { short: 'r' },
  ),
  brief: Flag.string(
    'Selection context: original request, intended use, speed/budget priorities, what must stay faithful to references, and relevant prior edits or failures',
  ),
  method: Flag.string(
    'Production method: auto, image, drawing (precise SVG shapes and text), or mixed (generated artwork with precise overlays). Leave auto unless explicitly chosen.',
    { default: 'auto' },
  ),
  model: Flag.string('Image model: auto (Astra selects), flare, or sunburst; set only for an explicit user choice', {
    short: 'm',
    default: 'auto',
  }),
  size: Flag.string(
    'auto (or omit) uses about 8 MP for photo preservation and source dimensions for graphics. Explicit WIDTHxHEIGHT overrides this. Image/mixed: edges multiples of 16, at most 3840, aspect at most 3:1, 655360–8294400 pixels. Drawing: edges 1–8192, at most 16777216 pixels, including small icons.',
    { short: 's' },
  ),
  mask: Flag.string(
    'Omit for full-image generation/editing; drawing/mixed methods automatically preserve local edits. Only when the user requests masking, use auto to plan a mask or a local PNG alpha mask: transparent edits, opaque protects. Use none to disable masking in any method.',
  ),
  quality: Flag.string(
    'Rendering quality: auto (Astra selects), low, medium, high, xhigh, or max; set only for an explicit user choice',
    {
      short: 'q',
      default: 'auto',
    },
  ),
  count: Flag.number(`How many variations to generate (1-${MAX_COUNT})`, { short: 'n', default: 1 }),
  attempts: Flag.number(
    'Opt into visual review and up to 1–5 corrective attempts per image. Omit for one direct image result. Masked edits and drawing/mixed methods default to 3 attempts for simple requests or 5 for complex ones.',
  ),
  budgetMinutes: Flag.number(
    'Total time budget for the request (1–60 minutes). Keeps available results if time runs out.',
    { default: 15 },
  ),
  focus: Flag.bool('Use a focused crop only within the optional masked editing workflow.', {
    default: true,
  }),
  background: Flag.string('Background: transparent (stickers, logos), opaque, or auto', { short: 'b' }),
  name: Flag.string('Filename slug for the saved image(s); derived from the prompt when omitted'),
  out: Flag.string('Directory to save into (default: Desktop)', { short: 'o' }),
  noOpen: Flag.bool('Do not open the finished image(s) in Preview', { default: false }),
}

type Params = InferParams<typeof params>
type Result = {
  report: string
  images: string[]
  artifact?: string
  model: string
  quality?: ImageQuality
  method: ImageMethod
  selectionReason: string
  size?: string
  preservation?: string
  mask?: string
  evidence?: string[]
  reviews?: ImageReviewSummary[]
  svgs?: string[]
  attempts?: AttemptSummary[]
  warning?: string
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ai:image': { params: Params; result: Result }
  }
}

const expandHome = (p: string) => (p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p)

@AIChatTool({ needsApproval: false })
export default class AiImageTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:image',
    description:
      'Create or edit photos, illustrations and graphics. Astra chooses GPT Image 2.5, precise SVG drawing, or mixed artwork with exact graphic overlays. Pass local references for edits (base first). For photo edits, use the user’s concise requested change without adding unrequested restrictions on anatomy, outlines or geometry. The default image workflow sends the full reference and returns the full generated image directly. Photo preservation uses Sunburst/max and about 8 MP. Leave method/model/quality/size automatic; omit mask and attempts unless the user explicitly requests masking or automatic review/corrections. Drawing/mixed retain their review workflow and also save editable SVG. Include requested priorities in brief. Report any review caveats, incomplete requests and attempt errors accurately.',
    descriptionLong: [
      'Creates a PNG using image generation, precise SVG drawing, or both. Saves to the Desktop',
      '(or --out), opens it in Preview, and records prompt + settings in the',
      `notebook under ${actionKindRel('image')}/.`,
      'Use --refs to edit an earlier result (pass its saved path), combine images,',
      'or provide visual references for a new design. The request determines whether',
      'to edit the first reference in place or create a fresh composition.',
      'Astra at low reasoning effort selects model and quality before rendering:',
      'normally Flare/high, Flare/medium for drafts, Sunburst for precision,',
      'and Sunburst/max for photo edits that preserve the original fidelity.',
      'Those photo edits default to about 8 MP, bounded by the API canvas limits.',
      'Ordinary image edits send the full reference with the concise requested change',
      'and return the complete provider output. Masking, focused crops, compositing',
      'and visual review/corrections are optional for the image method.',
      'Use --mask auto or a PNG alpha mask to opt into protected-area compositing.',
      'A supplied mask is never expanded. Drawing/mixed and masked edits receive',
      'up to 3 reviewed attempts for simple requests or 5 for complex ones.',
      'Graphics keep native dimensions when supported.',
      'Precise shapes and text use a bounded SVG renderer. Mixed designs generate',
      'artwork first and add exact graphic layers; text-only corrections reuse artwork.',
      'All candidates, raw output, masks, source, SVG and review evidence are retained.',
      'Global edits (such as changing all lighting) use the whole image.',
      'Creative restyling (such as photo to illustration) uses normal selection.',
      'Pass --brief for priorities or relevant prior edits. Explicit --model and',
      '--quality choices win; reference edits still classify intent for preservation.',
      'Use --size to override resolution; --mask none disables optional masking.',
      'Use --attempts to opt into or bound reviewed corrections, and --budgetMinutes',
      'to set the time budget. --method overrides routing.',
      'Run sky ai:image:evaluate --list to see repeatable synthetic visual evaluations.',
    ],
    usage: [
      'sky ai:image "A watercolor poster of a lighthouse at dawn, the word ATLAS across the top"',
      'sky ai:image "Product hero shot of a smartwatch on slate, soft studio light" -s 1536x1024',
      'sky ai:image "Make the sky stormy and add rain" -r ~/Pictures/lighthouse.png',
      'sky ai:image "Sticker of a happy robot waving" -b transparent -n 4 -q medium',
      'sky ai:image "Remove the background; preserve the product exactly" -r ~/Pictures/watch.png',
      'sky ai:image "Replace the center icon; keep the lettering and layout unchanged" -r ~/Pictures/atlas-logo.png',
      'sky ai:image "A rough pencil sketch of a lighthouse" -m flare -q low',
      'sky ai:image "A blue five-point star icon" --method drawing -s 64x64',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const prompt = args.prompt?.trim()
    if (!prompt) {
      return CommandResult.fail('Provide a prompt, e.g. sky ai:image "A watercolor poster of a lighthouse at dawn"')
    }
    if (!env.get('OPENAI_API_KEY')) {
      return CommandResult.fail(
        'OPENAI_API_KEY is not set — ai:image uses OpenAI for planning, review and image generation.',
      )
    }

    const requestedModel = args.model ?? 'auto'
    const requestedQuality = args.quality ?? 'auto'
    const count = args.count ?? 1
    const requestedMethod = args.method ?? 'auto'
    const budgetMinutes = args.budgetMinutes ?? 15
    for (const problem of [
      validateModel(requestedModel),
      validateQuality(requestedQuality),
      args.size ? validateDrawingSize(args.size) : null,
      ['auto', 'image', 'drawing', 'mixed'].includes(requestedMethod)
        ? null
        : 'method must be auto, image, drawing, or mixed.',
      args.attempts === undefined || (Number.isInteger(args.attempts) && args.attempts >= 1 && args.attempts <= 5)
        ? null
        : 'attempts must be an integer between 1 and 5.',
      Number.isFinite(budgetMinutes) && budgetMinutes >= 1 && budgetMinutes <= 60
        ? null
        : 'budgetMinutes must be between 1 and 60.',
      args.background ? validateBackground(args.background) : null,
      Number.isInteger(count) && count >= 1 && count <= MAX_COUNT
        ? null
        : `count must be an integer between 1 and ${MAX_COUNT}, got ${count}`,
    ]) {
      if (problem) return CommandResult.fail(problem)
    }

    const refPaths = args.refs ? parseRefs(args.refs).map(expandHome) : []
    if (refPaths.length > MAX_REF_IMAGES) {
      return CommandResult.fail(`--refs takes at most ${MAX_REF_IMAGES} images, got ${refPaths.length}`)
    }
    const log = (line: string) => output.log(colors.dim(`◦ ${line}`))
    const requestedMask = args.mask?.trim() || undefined
    if (requestedMask && requestedMask !== 'auto' && requestedMask !== 'none' && !refPaths.length) {
      return CommandResult.fail('A mask requires --refs with the base image first.')
    }
    const needsPreflight =
      requestedModel === 'auto' ||
      requestedQuality === 'auto' ||
      refPaths.length > 0 ||
      ['drawing', 'mixed'].includes(requestedMethod)
    const started = performance.now()
    const timeout = AbortSignal.timeout(Math.ceil(budgetMinutes * 60_000))
    const planningSignal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout
    const refImages: ImageReference[] = []
    const previews: Uint8Array[] = []
    if (refPaths.length) log('Preparing reference images…')
    for (const refPath of refPaths) {
      if (!REF_EXT_RE.test(refPath)) {
        return CommandResult.fail(`--refs handles PNG/JPEG/WebP files, got: ${refPath}`)
      }
      let data: Uint8Array
      try {
        data = new Uint8Array(await readFile(refPath))
      } catch {
        return CommandResult.fail(`Could not read reference image: ${refPath}`)
      }
      if (data.length > MAX_REF_BYTES) {
        const mb = (n: number) => Math.round(n / (1024 * 1024))
        return CommandResult.fail(
          `Reference image is too large (${mb(data.length)}MB > ${mb(MAX_REF_BYTES)}MB): ${refPath}`,
        )
      }
      try {
        const reference = await prepareReferenceImage(data, refPath, context.signal)
        refImages.push(reference)
        if (needsPreflight) previews.push(await referencePreview(reference, context.signal))
      } catch (err) {
        if (context.signal?.aborted) return CommandResult.error('Image creation cancelled.')
        const message = err instanceof Error ? err.message : String(err)
        return CommandResult.fail(`Could not prepare reference image ${path.basename(refPath)}: ${message}`)
      }
    }

    if (needsPreflight) {
      log('Choosing how to create the image with Astra…')
    }
    let selection
    try {
      selection = await selectImageSettings({
        prompt,
        brief: args.brief?.trim(),
        refs: previews,
        model: imageModelName(requestedModel),
        quality: requestedQuality === 'auto' ? undefined : (requestedQuality as ImageQuality),
        method: requestedMethod === 'auto' ? undefined : (requestedMethod as ImageMethod),
        size: args.size,
        background: args.background,
        count,
        signal: planningSignal,
      })
    } catch (err) {
      if (context.signal?.aborted) return CommandResult.error('Image creation cancelled.')
      const message = err instanceof Error ? err.message : String(err)
      await logAIError({ source: 'ai:image', stage: 'preflight', message })
      return CommandResult.error(`Image selection failed: ${message}. Retry when the selection service is available.`)
    }
    const { model, quality, method, reason: selectionReason } = selection
    if (method !== 'drawing' && args.size) {
      const problem = validateSize(args.size)
      if (problem) return CommandResult.fail(problem)
    }
    const production =
      method === 'drawing'
        ? 'SVG drawing with Astra'
        : `${model}/${quality}${method === 'mixed' ? ' with precise SVG overlays' : ''}`
    log(`Selected ${production}: ${selectionReason}`)
    let prepared: PreparedImageEdit
    try {
      const mask =
        requestedMask === undefined || requestedMask === 'auto' || requestedMask === 'none'
          ? requestedMask
          : new Uint8Array(await readFile(expandHome(requestedMask)))
      if (
        ['preserve_photo', 'preserve_image'].includes(selection.intent) &&
        mask !== 'none' &&
        (mask || method !== 'image')
      ) {
        log('Planning the replacement and identifying the areas to preserve…')
      }
      prepared = await prepareImageEdit({
        prompt,
        brief: args.brief?.trim(),
        refs: refImages,
        intent: selection.intent,
        complexity: selection.complexity,
        method,
        size: args.size,
        mask,
        signal: planningSignal,
      })
    } catch (err) {
      if (context.signal?.aborted) return CommandResult.error('Image creation cancelled.')
      const message = err instanceof Error ? err.message : String(err)
      await logAIError({ source: 'ai:image', stage: 'mask', message })
      return CommandResult.error(`Image edit preparation failed: ${message}`)
    }
    const { size, preservation } = prepared
    if (preservation) log(preservation)
    log(
      `Creating ${count} image${count > 1 ? 's' : ''} with ${production}${size ? `, ${size}` : ''} — this can take a few minutes`,
    )

    let generated
    try {
      generated = await runImageWorkflow({
        selection,
        prompt,
        brief: args.brief?.trim(),
        refs: refImages,
        count,
        size,
        edit: prepared.edit,
        background: args.background as ImageBackground | undefined,
        maxAttempts: args.attempts,
        budgetMs: budgetMinutes * 60_000 - (performance.now() - started),
        focus: args.focus,
        signal: context.signal,
        onProgress: log,
      })
    } catch (err) {
      if (context.signal?.aborted) return CommandResult.error('Image creation cancelled.')
      const message = err instanceof Error ? err.message : String(err)
      const timedOut = timeout.aborted || (err instanceof Error && err.name === 'APIConnectionTimeoutError')
      await logAIError({
        source: 'ai:image',
        stage: 'generate',
        message,
      })
      return CommandResult.error(
        timedOut
          ? `Image creation timed out after ${budgetMinutes} minutes before a result was available.`
          : `Image generation failed: ${message}`,
      )
    }
    if (generated.length === 0) {
      return CommandResult.error('OpenAI returned no images — try rephrasing the prompt.')
    }

    const now = context.notebookNow
    const outDir = args.out ? expandHome(args.out) : DIR_OUTPUT
    await mkdir(outDir, { recursive: true })

    const title = args.name?.trim() || prompt
    const slug = slugify(title, { preserveCase: true, suggestedLength: 40 })
    const saved: string[] = []
    const evidence: string[] = []
    const reviews: ImageReviewSummary[] = []
    const svgs: string[] = []
    let maskPath: string | undefined
    for (const image of generated) {
      let fileName = `${now.date}_image_${slug}.png`
      let n = 1
      while (await exists(path.join(outDir, fileName))) {
        n += 1
        fileName = `${now.date}_image_${slug}-${n}.png`
      }
      const filePath = path.join(outDir, fileName)
      await writeFile(filePath, image.data)
      saved.push(filePath)
      log(`Saved ${fileName} (${Math.round(image.data.length / 1024)} KB)`)
      if (image.review) {
        reviews.push(image.review)
        log(`Review ${image.review.status === 'passed' ? 'passed' : 'needs attention'}: ${image.review.reason}`)
      }
      {
        try {
          const retained = await writeImageEvidence(filePath, image, prepared.edit, {
            prompt,
            brief: args.brief?.trim(),
            model: method === 'drawing' ? 'svg-astra' : model,
            quality: method === 'drawing' ? 'vector' : quality,
            size,
            method,
          })
          evidence.push(retained.directory)
          maskPath ??= retained.mask
          if (retained.svg) svgs.push(retained.svg)
        } catch (err) {
          log(`Image saved, but evidence could not be saved: ${(err as Error).message}`)
        }
      }
    }

    if (!args.noOpen && context.platform !== CommandPlatform.Server) {
      for (const filePath of saved) open(filePath).catch(() => undefined)
    }

    const report = [
      `Created ${saved.length} image${saved.length === 1 ? '' : 's'} with ${production}${size ? `, ${size}` : ''}.`,
      `Selection: ${selectionReason}`,
      ...(preservation ? [`Preservation: ${preservation}`] : []),
      ...(maskPath ? [`Edit mask: ${maskPath}`] : []),
      ...reviews.map((review, i) => `Image ${i + 1} review (${review.status}): ${review.reason}`),
      ...generated.map((image, i) =>
        image.attempts.stopped === 'completed'
          ? `Image ${i + 1}: full generated image returned directly.`
          : `Image ${i + 1}: retained attempt ${image.attempts.selected} of ${image.attempts.used}; ${image.attempts.stopped.replaceAll('_', ' ')}${image.attempts.error ? ` — ${image.attempts.error}` : ''}.`,
      ),
      ...generated.flatMap((image) => (image.batchWarning ? [image.batchWarning] : [])),
      ...saved.map((filePath) => `- ${filePath}`),
      ...svgs.map((filePath) => `Editable SVG: ${filePath}`),
    ].join('\n')

    let artifact: string | undefined
    try {
      artifact = await writeImageArtifact(
        { date: now.date, time: now.time },
        {
          title,
          prompt,
          brief: args.brief?.trim(),
          model: method === 'drawing' ? 'svg-astra' : model,
          quality: method === 'drawing' ? 'vector' : quality,
          selectionReason,
          size,
          preservation,
          mask: maskPath,
          evidence,
          reviews: reviews.map((review) => `${review.status}: ${review.reason}`),
          refs: refPaths.map((refPath) => path.basename(refPath)),
          files: [...saved, ...svgs],
          report,
        },
      )
      log(`Recorded in notebook: ${artifact}`)
    } catch (err) {
      log(`Could not write the notebook record: ${(err as Error).message}`)
    }

    output.log('')
    output.log(report)
    return CommandResult.success({
      report,
      images: saved,
      artifact,
      model: method === 'drawing' ? 'svg-astra' : model,
      quality: method === 'drawing' ? undefined : quality,
      method,
      selectionReason,
      size,
      preservation,
      mask: maskPath,
      evidence,
      reviews,
      svgs,
      attempts: generated.map((image) => image.attempts),
      warning: generated.find((image) => image.batchWarning)?.batchWarning,
    })
  }
}
