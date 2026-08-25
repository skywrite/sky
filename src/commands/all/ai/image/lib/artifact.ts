import * as path from 'node:path'
import DayDirFileWriter from '#lib/nbfs/DayDirFileWriter.ts'
import { slugify } from '#lib/string/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

/** Day-relative artifact path, chronological like actions/docs and actions/messages. */
export function imageArtifactFileName(time: string, title: string): string {
  const slug = slugify(title, { preserveCase: true, suggestedLength: 40 })
  return `actions/images/${time.replace(':', '-')}_image_${slug}.md`
}

/** Human title for the artifact: the prompt collapsed and ellipsized at a word boundary. */
export function promptTitle(prompt: string, max = 80): string {
  const collapsed = prompt.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  const cut = collapsed.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > max / 2 ? lastSpace : max).trimEnd()}…`
}

export interface ImageArtifactInput {
  date: string
  time: string
  prompt: string
  model: string
  quality: string
  size?: string
  /** Basenames of the reference images the generation drew from. */
  refs: string[]
  /** Absolute paths of the saved images. */
  files: string[]
  report: string
}

/**
 * Notebook record of an ai:image generation. The image files are the build
 * artifact; this file is the notebook's provenance trail (prompt, model,
 * settings) and what future chats/recaps find via normal /time/ context.
 */
export function buildImageArtifact(input: ImageArtifactInput): string {
  const lines = [
    '---',
    `created: ${input.date} ${input.time}`,
    `model: ${input.model}`,
    'tags: images',
    '---',
    '',
    `# ${promptTitle(input.prompt)}`,
    '',
    `**Prompt:** ${input.prompt}`,
    '',
    `Settings: ${input.model}, quality ${input.quality}${input.size ? `, ${input.size}` : ''}`,
    ...(input.refs.length > 0 ? ['', `**Reference images:** ${input.refs.join(', ')}`] : []),
    '',
    ...input.files.map((file) => `- ${file}`),
    '',
    '## Report',
    '',
    input.report.trim(),
    '',
  ]
  return lines.join('\n')
}

/** Write the artifact into the notebook's day dir; returns the absolute path. */
export async function writeImageArtifact(
  now: { date: string; time: string },
  input: Omit<ImageArtifactInput, 'date' | 'time'> & { title: string },
): Promise<string> {
  const writer = new DayDirFileWriter(new PlainDate(now.date))
  const fileName = imageArtifactFileName(now.time, input.title)
  const content = buildImageArtifact({ ...input, date: now.date, time: now.time })
  const written = await writer.write(fileName, content)
  return path.join(writer.fullDir, written)
}
