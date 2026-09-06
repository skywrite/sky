import * as path from 'node:path'
import DayDirFileWriter from '#lib/nbfs/DayDirFileWriter.ts'
import { slugify } from '#lib/string/mod.ts'
import { actionKindRel } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { type MissionTiming, timingLines } from './timing.ts'
import type { MissionFile } from './tools.ts'

/** Artifact medium tag by workspace kind (gdoc / gslides / gsheet). */
export function artifactMedium(kind?: string): string {
  if (kind === 'slides') return 'gslides'
  if (kind === 'sheet') return 'gsheet'
  return 'gdoc'
}

/** Day-relative artifact path, chronological like messages and chats. */
export function docArtifactFileName(time: string, title: string, medium = 'gdoc'): string {
  const slug = slugify(title, { preserveCase: true, suggestedLength: 40 })
  return `${actionKindRel('doc')}/${time.replace(':', '-')}_${medium}_${slug}.md`
}

/**
 * The mission's result files: everything touched, plus the `--file` target
 * when the mission only read it. Touched files stay first and verbatim; a
 * target that was itself created or updated is already among them and is
 * not repeated. Read-only targets belong in the result (the caller may
 * cross-reference them) but not in `state.files`, which gates the notebook
 * artifact and the "touched" recap.
 */
export function withReadTarget(files: MissionFile[], readTarget?: MissionFile): MissionFile[] {
  if (!readTarget || files.some((f) => f.id === readTarget.id)) return files
  return [...files, readTarget]
}

export interface DocArtifactInput {
  date: string
  time: string
  account: string
  mission: string
  files: MissionFile[]
  report: string
  /** Where the mission's time went; absent for records written before timing existed */
  timing?: MissionTiming
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
    // rel repeats the files as plain links so relContains queries find this
    // record by title or host, like any other rel'd document.
    'rel:',
    ...input.files.map((f) => `  - "[${f.title}](${f.url ?? f.id})"`),
    'tags: google-docs',
    ...(input.timing ? [`profile: ${input.timing.profile}`, `steps: ${input.timing.steps}`] : []),
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
    ...(input.timing ? ['## Timing', '', ...timingLines(input.timing), ''] : []),
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
