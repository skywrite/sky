import * as path from 'node:path'
import { slugify } from '#lib/string/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import DayDirFileWriter from '#lib/nbfs/DayDirFileWriter.ts'
import type { MissionFile } from './tools.ts'

/** Artifact medium tag by workspace kind (gdoc / gslides / gsheet). */
export function artifactMedium(kind?: string): string {
  if (kind === 'slides') return 'gslides'
  if (kind === 'sheet') return 'gsheet'
  return 'gdoc'
}

/** Day-relative artifact path, chronological like actions/messages and actions/ai-chats. */
export function docArtifactFileName(time: string, title: string, medium = 'gdoc'): string {
  const slug = slugify(title, { preserveCase: true, suggestedLength: 40 })
  return `actions/docs/${time.replace(':', '-')}_${medium}_${slug}.md`
}

export interface DocArtifactInput {
  date: string
  time: string
  account: string
  mission: string
  files: MissionFile[]
  report: string
}

/**
 * Notebook record of a google:agent mission that touched files. The Google
 * copy is the build artifact; this file is the notebook's provenance trail
 * and what future chats/resumes find via normal /time/ context.
 */
export function buildDocArtifact(input: DocArtifactInput): string {
  const primary = input.files[0]
  const lines = [
    '---',
    `created: ${input.date} ${input.time}`,
    `account: ${input.account}`,
    'files:',
    ...input.files.map((f) => `  - "[${f.title}](${f.url ?? f.id})" # ${f.action}`),
    'tags: google-docs',
    '---',
    '',
    `# ${primary ? primary.title : 'Google Docs mission'}`,
    '',
    `**Mission:** ${input.mission}`,
    '',
    ...input.files.map((f) => `- ${f.action}: [${f.title}](${f.url ?? f.id})`),
    '',
    '## Report',
    '',
    input.report.trim(),
    '',
  ]
  return lines.join('\n')
}

/** Write the artifact into the notebook's day dir; returns the absolute path. */
export async function writeDocArtifact(
  now: { date: string; time: string },
  input: Omit<DocArtifactInput, 'date' | 'time'>,
  timeDir?: string,
): Promise<string> {
  const writer = timeDir
    ? new DayDirFileWriter(new PlainDate(now.date), timeDir)
    : new DayDirFileWriter(new PlainDate(now.date))
  const primary = input.files[0]
  const fileName = docArtifactFileName(now.time, primary?.title ?? input.mission, artifactMedium(primary?.kind))
  const content = buildDocArtifact({ ...input, date: now.date, time: now.time })
  const written = await writer.write(fileName, content)
  return path.join(writer.fullDir, written)
}
