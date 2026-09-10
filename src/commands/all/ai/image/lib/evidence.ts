import { mkdtemp, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { MaskedImageEdit } from './mask.ts'
import type { RenderedImage } from './render.ts'

/** Private runtime evidence beside the user's output; only the final composite enters chat previews. */
export async function writeImageEvidence(
  file: string,
  image: RenderedImage,
  edit: MaskedImageEdit,
  settings: { prompt: string; brief?: string; model: string; quality: string; size?: string },
): Promise<{ directory: string; mask: string }> {
  const parsed = path.parse(file)
  const directory = await mkdtemp(path.join(parsed.dir, `${parsed.name}.edit-`))
  const mask = path.join(directory, 'final-mask.png')
  for (const [name, data] of [
    ['source.png', edit.canvas.data],
    ['generated.png', image.generated],
    ['generation-mask.png', (edit.generationMask ?? edit.mask).data],
    ['initial-mask.png', edit.mask.data],
    ['final-mask.png', (image.mask ?? edit.mask).data],
  ] as const)
    await writeFile(path.join(directory, name), data, { flag: 'wx' })
  await writeFile(
    path.join(directory, 'review.json'),
    JSON.stringify(
      {
        version: 1,
        settings: { ...settings, background: image.background, generationPrompt: image.generationPrompt },
        plan: edit.plan,
        review: image.review,
        result: path.basename(file),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  )
  return { directory, mask }
}
