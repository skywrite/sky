import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { openai } from '@ai-sdk/openai'
import { generateImage } from 'ai'
import open from 'open'
import colors from 'picocolors'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_OUTPUT } from '#config'
import { slugify } from '#lib/string/mod.ts'
import { formatAIWarning, logAIError } from '#shared/ai/errorLog.ts'
import { exists } from '#shared/fs/mod.ts'
import { actionKindRel } from '#shared/nbfs/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { writeImageArtifact } from './lib/artifact.ts'
import {
  IMAGE_MODEL,
  MAX_COUNT,
  MAX_REF_BYTES,
  MAX_REF_IMAGES,
  parseRefs,
  REF_EXT_RE,
  validateBackground,
  validateQuality,
  validateSize,
} from './lib/options.ts'

/**
 * A high-quality batch renders serially on OpenAI's side, so the worst case
 * (4 images, high quality, large canvas) runs many minutes. Past this the
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
  size: Flag.string(
    'WIDTHxHEIGHT in pixels, e.g. 1536x1024 (edges multiples of 16, at most 3840, aspect at most 3:1); omit to let the model choose',
    { short: 's' },
  ),
  quality: Flag.string('Rendering quality: low, medium, high, or auto — lower is much faster, for drafts', {
    short: 'q',
    default: 'high',
  }),
  count: Flag.number(`How many variations to generate (1-${MAX_COUNT})`, { short: 'n', default: 1 }),
  background: Flag.string('Background: transparent (stickers, logos), opaque, or auto', { short: 'b' }),
  name: Flag.string('Filename slug for the saved image(s); derived from the prompt when omitted'),
  out: Flag.string('Directory to save into (default: Desktop)', { short: 'o' }),
  noOpen: Flag.bool('Do not open the finished image(s) in Preview', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { report: string; images: string[]; artifact?: string; model: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ai:image': { params: Params; result: Result }
  }
}

const expandHome = (p: string) => (p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p)

function extensionFor(mediaType: string): string {
  if (mediaType === 'image/jpeg') return 'jpg'
  if (mediaType === 'image/webp') return 'webp'
  return 'png'
}

@AIChatTool({ needsApproval: false })
export default class AiImageTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:image',
    description:
      "Generate or edit images with OpenAI's gpt-image-2 (the ChatGPT image model): posters, logos, illustrations, photoreal scenes, images with rendered text. Give a full visual description; pass reference images to edit or draw from.",
    descriptionLong: [
      'Renders the prompt with gpt-image-2, saves the result to the Desktop',
      '(or --out), opens it in Preview, and records prompt + settings in the',
      `notebook under ${actionKindRel('image')}/.`,
      'With --refs the reference images are edited/combined instead of',
      'generating from scratch — the way to iterate on an earlier result',
      '(pass its saved path) or restyle an existing picture.',
    ],
    usage: [
      'sky ai:image "A watercolor poster of a lighthouse at dawn, the word ATLAS across the top"',
      'sky ai:image "Product hero shot of a smartwatch on slate, soft studio light" -s 1536x1024',
      'sky ai:image "Make the sky stormy and add rain" -r ~/Pictures/lighthouse.png',
      'sky ai:image "Sticker of a happy robot waving" -b transparent -n 4 -q medium',
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

    const quality = args.quality ?? 'high'
    const count = args.count ?? 1
    for (const problem of [
      validateQuality(quality),
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
    const refImages: Uint8Array[] = []
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
      refImages.push(data)
    }

    const log = (line: string) => output.log(colors.dim(`◦ ${line}`))
    log(
      `Generating ${count} image${count > 1 ? 's' : ''} with ${IMAGE_MODEL} (quality ${quality}${
        args.size ? `, ${args.size}` : ''
      }${refImages.length > 0 ? `, editing ${refImages.length} reference image${refImages.length > 1 ? 's' : ''}` : ''})${
        quality === 'high' ? ' — high quality can take a few minutes' : ''
      }`,
    )

    let generated
    try {
      generated = await generateImage({
        model: openai.image(IMAGE_MODEL),
        // Reference images route the call to the edits endpoint: the prompt
        // then describes the change/composition rather than a blank canvas.
        prompt: refImages.length > 0 ? { text: prompt, images: refImages } : prompt,
        n: count,
        size: args.size as `${number}x${number}` | undefined,
        providerOptions: {
          openai: {
            quality,
            outputFormat: 'png',
            ...(args.background ? { background: args.background } : {}),
          },
        },
        abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      // An APICallError carries the raw body — without it, a 200 whose body
      // fails to parse logs only "Failed to process successful response".
      const responseBody = (err as { responseBody?: unknown }).responseBody
      await logAIError({
        source: 'ai:image',
        stage: 'generate',
        message: typeof responseBody === 'string' ? `${message} — body: ${responseBody.slice(0, 300)}` : message,
      })
      return CommandResult.error(
        timedOut
          ? `Image generation timed out after ${GENERATION_TIMEOUT_MS / 60_000} minutes — try a lower quality or fewer images.`
          : `Image generation failed: ${message}`,
      )
    }
    for (const warning of generated.warnings) log(`OpenAI warning: ${formatAIWarning(warning)}`)
    if (generated.images.length === 0) {
      return CommandResult.error('OpenAI returned no images — try rephrasing the prompt.')
    }

    const now = context.notebookNow
    const outDir = args.out ? expandHome(args.out) : DIR_OUTPUT
    await mkdir(outDir, { recursive: true })

    const title = args.name?.trim() || prompt
    const slug = slugify(title, { preserveCase: true, suggestedLength: 40 })
    const saved: string[] = []
    for (const image of generated.images) {
      const ext = extensionFor(image.mediaType)
      let fileName = `${now.date}_image_${slug}.${ext}`
      let n = 1
      while (await exists(path.join(outDir, fileName))) {
        n += 1
        fileName = `${now.date}_image_${slug}-${n}.${ext}`
      }
      const filePath = path.join(outDir, fileName)
      await writeFile(filePath, image.uint8Array)
      saved.push(filePath)
      log(`Saved ${fileName} (${Math.round(image.uint8Array.length / 1024)} KB)`)
    }

    if (!args.noOpen) {
      for (const filePath of saved) open(filePath).catch(() => undefined)
    }

    const report = [
      `Generated ${saved.length} image${saved.length === 1 ? '' : 's'} with ${IMAGE_MODEL} (quality ${quality}${
        args.size ? `, ${args.size}` : ''
      }${refPaths.length > 0 ? `, from ${refPaths.length} reference image${refPaths.length === 1 ? '' : 's'}` : ''}).`,
      ...saved.map((filePath) => `- ${filePath}`),
    ].join('\n')

    let artifact: string | undefined
    try {
      artifact = await writeImageArtifact(
        { date: now.date, time: now.time },
        {
          title,
          prompt,
          model: IMAGE_MODEL,
          quality,
          size: args.size,
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
    return CommandResult.success({ report, images: saved, artifact, model: IMAGE_MODEL })
  }
}
