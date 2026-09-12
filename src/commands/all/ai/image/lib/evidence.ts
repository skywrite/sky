import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import sharp from 'sharp'
import type { MaskedImageEdit } from './mask.ts'
import type { RenderedImage } from './render.ts'
import type { WorkflowImage } from './workflow.ts'

type EvidenceImage = RenderedImage &
  Partial<
    Pick<
      WorkflowImage,
      | 'method'
      | 'svg'
      | 'drawingScene'
      | 'feedback'
      | 'artwork'
      | 'artworkMask'
      | 'artworkGeneration'
      | 'mixedPlan'
      | 'refinedMask'
      | 'attempts'
      | 'versions'
    >
  >

export interface ImageEvidenceSettings {
  prompt: string
  brief?: string
  model: string
  quality: string
  size?: string
  method?: WorkflowImage['method']
}

export interface SavedImageEvidence {
  directory: string
  mask?: string
  svg?: string
}

interface VersionEvidence {
  method?: WorkflowImage['method']
  generationPrompt: string
  feedback?: string
  background?: RenderedImage['background']
  focus?: RenderedImage['focus']
  review?: RenderedImage['review']
  artworkGeneration?: VersionEvidence
  files: Record<string, string>
}

export function writeImageEvidence(
  file: string,
  image: EvidenceImage,
  settings: ImageEvidenceSettings,
): Promise<SavedImageEvidence>
export function writeImageEvidence(
  file: string,
  image: EvidenceImage,
  edit: MaskedImageEdit,
  settings: ImageEvidenceSettings,
): Promise<SavedImageEvidence & { mask: string }>
export function writeImageEvidence(
  file: string,
  image: EvidenceImage,
  edit: MaskedImageEdit | undefined,
  settings: ImageEvidenceSettings,
): Promise<SavedImageEvidence>

/** Private runtime evidence beside the user's output; only the final composite enters chat previews. */
export async function writeImageEvidence(
  file: string,
  image: EvidenceImage,
  editOrSettings: MaskedImageEdit | ImageEvidenceSettings | undefined,
  explicitSettings?: ImageEvidenceSettings,
): Promise<SavedImageEvidence> {
  const edit = editOrSettings && 'canvas' in editOrSettings ? editOrSettings : undefined
  const settings = explicitSettings ?? (editOrSettings as ImageEvidenceSettings)
  const parsed = path.parse(file)
  const directory = await mkdtemp(path.join(parsed.dir, `${parsed.name}.edit-`))
  const sourceFiles: Record<string, string> = {}
  if (edit) {
    for (const [key, name, data] of [
      ['source', 'source.png', edit.canvas.data],
      ['generationMask', 'generation-mask.png', (edit.generationMask ?? edit.mask).data],
      ['initialMask', 'initial-mask.png', edit.mask.data],
    ] as const) {
      await writeFile(path.join(directory, name), data, { flag: 'wx' })
      sourceFiles[key] = name
    }
  }
  const selected = await saveVersion(
    directory,
    '',
    { ...image, mask: image.mask ?? image.refinedMask ?? edit?.mask },
    edit,
  )
  const versions: (VersionEvidence & { attempt: number })[] = []
  for (const [index, candidate] of (image.versions ?? []).entries()) {
    const prefix = `attempt-${String(index + 1).padStart(2, '0')}`
    await mkdir(path.join(directory, prefix))
    const version = await saveVersion(
      directory,
      prefix,
      { ...candidate, mask: candidate.mask ?? candidate.refinedMask ?? edit?.mask },
      edit,
    )
    versions.push({ attempt: index + 1, ...version })
  }
  await writeFile(
    path.join(directory, 'review.json'),
    JSON.stringify(
      {
        version: 2,
        settings: { ...settings, background: image.background, generationPrompt: image.generationPrompt },
        plan: edit?.plan,
        review: image.review,
        method: image.method,
        attempts: image.attempts,
        files: { ...sourceFiles, ...selected.files },
        selected,
        versions,
        result: path.basename(file),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  )
  return {
    directory,
    mask: selected.files.mask ? path.join(directory, selected.files.mask) : undefined,
    svg: selected.files.svg ? path.join(directory, selected.files.svg) : undefined,
  }
}

/** Keep binary assets out of JSON; every version remains independently inspectable. */
async function saveVersion(
  directory: string,
  prefix: string,
  image: EvidenceImage,
  edit?: MaskedImageEdit,
): Promise<VersionEvidence> {
  const files: Record<string, string> = {}
  const asset = async (key: string, name: string, data: Uint8Array | string | undefined) => {
    if (data === undefined) return
    const relative = prefix ? `${prefix}/${name}` : name
    await writeFile(path.join(directory, relative), data, { flag: 'wx' })
    files[key] = relative
  }
  const json = (value: unknown) => (value === undefined ? undefined : JSON.stringify(value, null, 2) + '\n')
  await asset('image', prefix ? 'image.png' : 'selected.png', image.data)
  await asset('generated', 'generated.png', image.generated)
  await asset('providerGenerated', 'provider-generated.png', image.providerGenerated)
  if (image.focus && edit) {
    const { source, padding } = image.focus.geometry
    const crop = (data: Uint8Array, alpha: number) =>
      sharp(data)
        .extract(source)
        .extend({ ...padding, background: { r: 0, g: 0, b: 0, alpha } })
        .png()
        .toBuffer()
    await asset('providerCanvas', 'provider-canvas.png', await crop(edit.canvas.data, 0))
    await asset('providerMask', 'provider-mask.png', await crop((edit.generationMask ?? edit.mask).data, 1))
  }
  await asset('mask', 'final-mask.png', image.mask?.data)
  await asset('refinedMask', 'refined-mask.png', image.refinedMask?.data)
  await asset('artwork', 'artwork.png', image.artwork)
  await asset('artworkMask', 'artwork-mask.png', image.artworkMask?.data)
  await asset('svg', prefix ? 'drawing.svg' : 'final.svg', image.svg)
  await asset('drawingScene', 'drawing-scene.json', json(image.drawingScene))
  await asset('mixedPlan', 'mixed-plan.json', json(image.mixedPlan))
  let artworkGeneration: VersionEvidence | undefined
  if (image.artworkGeneration) {
    const artworkDirectory = prefix ? `${prefix}/artwork-generation` : 'artwork-generation'
    await mkdir(path.join(directory, artworkDirectory))
    artworkGeneration = await saveVersion(
      directory,
      artworkDirectory,
      { ...image.artworkGeneration, mask: image.artworkGeneration.mask ?? image.artworkMask },
      edit,
    )
    files.artworkGeneration = `${artworkDirectory}/version.json`
  }
  const metadata: VersionEvidence = {
    method: image.method,
    generationPrompt: image.generationPrompt,
    feedback: image.feedback,
    background: image.background,
    focus: image.focus,
    review: image.review,
    artworkGeneration,
    files,
  }
  await writeFile(path.join(directory, prefix, 'version.json'), JSON.stringify(metadata, null, 2) + '\n', {
    flag: 'wx',
  })
  return metadata
}
