import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import OpenAI from 'openai'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import slugify from '#lib/string/slugify.ts'

const params = {
  prompt: Arg.string('Prompt to generate images'),
  number: Flag.number('Number of images', { short: 'n', default: 3 }),
  size: Flag.string('Size of image (1024x1024, 512x512, 256x256)', { short: 's', default: '1024x1024' }),
}

type Params = InferParams<typeof params>
type Result = { dir: string; imageCount: number }

export default class AiOpenaiImageGenTask extends Command {
  static override description: CommandDescription = {
    name: 'openai:image:gen',
    description: 'Generate images using OpenAI DALL-E',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, env } = context
    const { prompt, number, size } = args
    const { DIR_DESKTOP } = config

    const ymd = context.systemNow.date

    const promptSlug = slugify(prompt, 20)

    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    })

    let resp
    try {
      resp = await openai.images.generate({
        prompt,
        n: number,
        size: size as '1024x1024' | '512x512' | '256x256',
      })
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to generate images')
    }

    const baseExportDir = `${ymd}_OpenAI-${promptSlug}`
    const dir = path.join(<string>DIR_DESKTOP, baseExportDir)

    await mkdir(dir, { recursive: true })

    const images = Array.from(resp?.data?.data)

    try {
      for (const [i, img] of images.entries()) {
        const file = path.join(dir, `${i + 1}.png`)
        await downloadImage(<string>(img as { url?: string }).url, file)
      }
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to download images')
    }

    return CommandResult.success({ dir, imageCount: images.length })
  }
}

async function downloadImage(url: string, filePath: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch image from ${url}`)
  }

  const blob = await response.blob()
  const buffer = await blob.arrayBuffer()
  const data = new Uint8Array(buffer)
  await writeFile(filePath, data)
}
