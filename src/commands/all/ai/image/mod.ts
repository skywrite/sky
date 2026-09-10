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
import { prepareImageEdit } from './lib/edit.ts'
import type { PreparedImageEdit } from './lib/edit.ts'
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
import { prepareReferenceImage, referencePreview } from './lib/references.ts'
import type { ImageReference } from './lib/references.ts'
import { renderImages } from './lib/render.ts'

/**
 * A high-quality batch renders serially on OpenAI's side, so the worst case
 * (4 images, max quality, large canvas) runs many minutes. Past this the
 * call is presumed dead — better a clear timeout than a hung chat turn.
 */
const GENERATION_TIMEOUT_MS = 600_000

const params = {
  prompt: ArgOrFlag.string(
    'What to create — subject, composition, style, colors, mood, and any text to render verbatim',
    { short: 'p', required: true },
  ),
  refs: Flag.string(
    'Local reference image(s) to edit, combine, or draw style/content from — comma-separated PNG/JPEG/WebP paths',
    { short: 'r' },
  ),
  brief: Flag.string(
    'Selection context: original request, intended use, speed/budget priorities, what must stay faithful to references, and relevant prior edits or failures',
  ),
  model: Flag.string('Image model: auto (Astra selects), flare, or sunburst; set only for an explicit user choice', {
    short: 'm',
    default: 'auto',
  }),
  size: Flag.string(
    'auto (or omit) uses about 8 MP for fidelity-preserving photo edits and model-selected size otherwise; explicit WIDTHxHEIGHT overrides this (edges multiples of 16, at most 3840, aspect at most 3:1, 655360–8294400 pixels)',
    { short: 's' },
  ),
  mask: Flag.string(
    'auto (default) identifies editable areas in fidelity-preserving photos and keeps original pixels elsewhere. Or supply a local PNG alpha mask matching the upright first reference or output canvas: transparent edits, opaque protects. Use none only when the user explicitly requests whole-image editing.',
    { default: 'auto' },
  ),
  quality: Flag.string(
    'Rendering quality: auto (Astra selects), low, medium, high, xhigh, or max; set only for an explicit user choice',
    {
      short: 'q',
      default: 'auto',
    },
  ),
  count: Flag.number(`How many variations to generate (1-${MAX_COUNT})`, { short: 'n', default: 1 }),
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
  quality: ImageQuality
  selectionReason: string
  size?: string
  preservation?: string
  mask?: string
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
      'Generate or edit images with GPT Image 2.5. Astra selects Flare or Sunburst and quality from the prompt, brief, and references. Give a full visual description, pass local references for edits (base image first), and include user priorities and prior edit context in brief. Leave model/quality/size/mask auto unless the user explicitly chooses them. Photo edits preserving fidelity use Sunburst/max, about 8 MP in the original proportions, and an automatic edit mask; original pixels outside the mask are retained at output resolution. Creative transformations such as photo-to-illustration follow normal selection. Mask failures need a clearer target or supplied mask; do not disable preservation to retry.',
    descriptionLong: [
      'Renders the prompt with GPT Image 2.5, saves the result to the Desktop',
      '(or --out), opens it in Preview, and records prompt + settings in the',
      `notebook under ${actionKindRel('image')}/.`,
      'With --refs the reference images are edited/combined instead of',
      'generating from scratch — the way to iterate on an earlier result',
      '(pass its saved path) or restyle an existing picture.',
      'Astra at low reasoning effort selects model and quality before rendering:',
      'normally Flare/high, Flare/medium for drafts, Sunburst for precision,',
      'and Sunburst/max for photo edits that preserve the original fidelity.',
      'Those photo edits default to about 8 MP, bounded by the API canvas limits.',
      'Localized edits use an automatic alpha mask and composite changed areas',
      'over the original at output resolution. The mask is saved beside the result.',
      'Global edits (such as changing all lighting) use the whole image.',
      'Creative restyling (such as photo to illustration) uses normal selection.',
      'Pass --brief for priorities or relevant prior edits. Explicit --model and',
      '--quality choices win; reference edits still classify intent for preservation.',
      'Use --size to override resolution; --mask accepts a PNG alpha mask or none.',
    ],
    usage: [
      'sky ai:image "A watercolor poster of a lighthouse at dawn, the word ATLAS across the top"',
      'sky ai:image "Product hero shot of a smartwatch on slate, soft studio light" -s 1536x1024',
      'sky ai:image "Make the sky stormy and add rain" -r ~/Pictures/lighthouse.png',
      'sky ai:image "Sticker of a happy robot waving" -b transparent -n 4 -q medium',
      'sky ai:image "Remove the background; preserve the product exactly" -r ~/Pictures/watch.png',
      'sky ai:image "A rough pencil sketch of a lighthouse" -m flare -q low',
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
      return CommandResult.fail('OPENAI_API_KEY is not set — ai:image calls the OpenAI Image API with it.')
    }

    const requestedModel = args.model ?? 'auto'
    const requestedQuality = args.quality ?? 'auto'
    const count = args.count ?? 1
    for (const problem of [
      validateModel(requestedModel),
      validateQuality(requestedQuality),
      args.size ? validateSize(args.size) : null,
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
    const requestedMask = args.mask?.trim() || 'auto'
    if (requestedMask !== 'auto' && requestedMask !== 'none' && !refPaths.length) {
      return CommandResult.fail('A mask requires --refs with the base image first.')
    }
    const needsPreflight = requestedModel === 'auto' || requestedQuality === 'auto' || refPaths.length > 0
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
      log('Checking image intent, model and quality with Astra (low reasoning effort)…')
    }
    let selection
    try {
      selection = await selectImageSettings({
        prompt,
        brief: args.brief?.trim(),
        refs: previews,
        model: imageModelName(requestedModel),
        quality: requestedQuality === 'auto' ? undefined : (requestedQuality as ImageQuality),
        size: args.size,
        background: args.background,
        count,
        signal: context.signal,
      })
    } catch (err) {
      if (context.signal?.aborted) return CommandResult.error('Image creation cancelled.')
      const message = err instanceof Error ? err.message : String(err)
      await logAIError({ source: 'ai:image', stage: 'preflight', message })
      return CommandResult.error(`Image selection failed: ${message}. Retry when the selection service is available.`)
    }
    const { model, quality, reason: selectionReason } = selection
    log(`Selected ${model}/${quality}: ${selectionReason}`)
    let prepared: PreparedImageEdit
    try {
      const mask =
        requestedMask === 'auto' || requestedMask === 'none'
          ? requestedMask
          : new Uint8Array(await readFile(expandHome(requestedMask)))
      if (selection.intent === 'preserve_photo' && mask !== 'none') {
        log('Preparing a detailed photo edit and identifying the areas to preserve…')
      }
      prepared = await prepareImageEdit({
        prompt,
        brief: args.brief?.trim(),
        refs: refImages,
        intent: selection.intent,
        size: args.size,
        mask,
        signal: context.signal,
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
      `Generating ${count} image${count > 1 ? 's' : ''} with ${model} (quality ${quality}${
        size ? `, ${size}` : ''
      }${refImages.length > 0 ? `, editing ${refImages.length} reference image${refImages.length > 1 ? 's' : ''}` : ''})${
        ['high', 'xhigh', 'max'].includes(quality) ? ' — this can take a few minutes' : ''
      }`,
    )

    let generated
    const timeout = AbortSignal.timeout(GENERATION_TIMEOUT_MS)
    try {
      const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout
      signal.throwIfAborted()
      generated = await renderImages({
        model,
        prompt,
        refs: refImages,
        count,
        size,
        edit: prepared.edit,
        quality,
        background: args.background as ImageBackground | undefined,
        signal,
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
          ? `Image generation timed out after ${GENERATION_TIMEOUT_MS / 60_000} minutes — try a lower quality or fewer images.`
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
    for (const image of generated) {
      let fileName = `${now.date}_image_${slug}.png`
      let n = 1
      while (await exists(path.join(outDir, fileName))) {
        n += 1
        fileName = `${now.date}_image_${slug}-${n}.png`
      }
      const filePath = path.join(outDir, fileName)
      await writeFile(filePath, image)
      saved.push(filePath)
      log(`Saved ${fileName} (${Math.round(image.length / 1024)} KB)`)
    }
    let maskPath: string | undefined
    if (prepared.edit) {
      try {
        const candidate = saved[0]!.replace(/\.png$/, '.mask.png')
        await writeFile(candidate, prepared.edit.mask.data, { flag: 'wx' })
        maskPath = candidate
      } catch (err) {
        log(`Image saved, but the mask copy could not be saved: ${(err as Error).message}`)
      }
    }

    if (!args.noOpen && context.platform !== CommandPlatform.Server) {
      for (const filePath of saved) open(filePath).catch(() => undefined)
    }

    const report = [
      `Generated ${saved.length} image${saved.length === 1 ? '' : 's'} with ${model} (quality ${quality}${
        size ? `, ${size}` : ''
      }${refPaths.length > 0 ? `, from ${refPaths.length} reference image${refPaths.length === 1 ? '' : 's'}` : ''}).`,
      `Selection: ${selectionReason}`,
      ...(preservation ? [`Preservation: ${preservation}`] : []),
      ...(maskPath ? [`Edit mask: ${maskPath}`] : []),
      ...saved.map((filePath) => `- ${filePath}`),
    ].join('\n')

    let artifact: string | undefined
    try {
      artifact = await writeImageArtifact(
        { date: now.date, time: now.time },
        {
          title,
          prompt,
          brief: args.brief?.trim(),
          model,
          quality,
          selectionReason,
          size,
          preservation,
          mask: maskPath,
          refs: refPaths.map((refPath) => path.basename(refPath)),
          files: saved,
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
      model,
      quality,
      selectionReason,
      size,
      preservation,
      mask: maskPath,
    })
  }
}
