import * as path from 'node:path'
import { DIR_STATE } from '#config'
import DayDirFileWriter from '#lib/nbfs/DayDirFileWriter.ts'
import { atomicWrite } from '#lib/outbox/files.ts'
import { slugify } from '#lib/string/mod.ts'
import { actionKindRel } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { DocumentCopy } from './documentCopies.ts'
import type { MissionTiming } from './timing.ts'
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
  return `${actionKindRel('googleDoc')}/${time.replace(':', '-')}_${medium}_${slug}.md`
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
  documents?: DocumentCopy[]
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
    ...input.files.map((f) => `  - ${JSON.stringify(`[${f.title}](${f.url ?? f.id})`)} # ${f.action}`),
    // rel repeats the files as plain links so relContains queries find this
    // record by title or host, like any other rel'd document.
    'rel:',
    ...input.files.map((f) => `  - ${JSON.stringify(`[${f.title}](${f.url ?? f.id})`)}`),
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
  const documents = new Map(input.documents?.map((doc) => [doc.fileId, doc]))
  for (const file of input.files) {
    const document = documents.get(file.id)
    if (file.kind !== 'doc' && !document) continue
    lines.push('## Document content', '', `**[${file.title}](${file.url ?? file.id})**`, '')
    if (document) {
      lines.push('Content as read during this run.', '', document.markdown || '(The document was empty.)', '')
    } else {
      lines.push('A complete copy was not captured after the last change. Open the document above to read it.', '')
    }
  }
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

export interface MissionRecordInput extends Omit<DocArtifactInput, 'date' | 'time'> {
  /** The existing timing span ID joins this record to the central diagnostic trace. */
  runId: string
  agentModel: { provider: string; model: string; profile: string; effort: string | null; serviceTier?: string }
  timing: MissionTiming
  contentIssues?: string[]
}

/** Keep the readable history even if diagnostic storage fails, and vice versa. */
export async function writeMissionRecords(
  now: { date: string; time: string },
  input: MissionRecordInput,
  options: { timeDir?: string; stateDir?: string } = {},
): Promise<{ artifact?: string; diagnostics?: string; issues: string[] }> {
  const result: { artifact?: string; diagnostics?: string; issues: string[] } = { issues: [] }
  if (input.files.length > 0) {
    try {
      result.artifact = await writeDocArtifact(now, input, options.timeDir)
    } catch (error) {
      result.issues.push(`Could not write the notebook record: ${(error as Error).message}`)
    }
  }
  try {
    // This is an execution record keyed by its existing trace span, not a new
    // user-content ID. The day artifact remains chronological and title-based.
    const file = path.join(
      options.stateDir ?? DIR_STATE,
      'google',
      'missions',
      `${encodeURIComponent(input.runId)}.json`,
    )
    const { documents, ...details } = input
    await atomicWrite(
      file,
      JSON.stringify({
        schema: 1,
        ...now,
        ...details,
        artifact: result.artifact,
        documents: documents?.map(({ fileId, version, capturedAt }) => ({ fileId, version, capturedAt })),
      }),
    )
    result.diagnostics = file
  } catch (error) {
    result.issues.push(`Could not write the mission diagnostics: ${(error as Error).message}`)
  }
  return result
}
