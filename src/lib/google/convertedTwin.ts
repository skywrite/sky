import type { GoogleClient } from './client.ts'
import { WORKSPACE_MIME, conversionTarget, copyFile, escapeDriveQueryValue, listFiles } from './drive.ts'
import type { DriveFile, WorkspaceKind } from './drive.ts'

/** appProperties stamped on a converted twin so later reads find and reuse it. */
export const TWIN_SOURCE_KEY = 'skyConvertedFrom'
export const TWIN_SOURCE_MODIFIED_KEY = 'skySourceModified'

const TWIN_SUFFIX: Record<WorkspaceKind, string> = {
  doc: 'Google Docs',
  sheet: 'Google Sheets',
  slides: 'Google Slides',
}

/** "Tracker v4.xlsx" → "Tracker v4 (Google Sheets)": the name a person gives the Save-as copy. */
export function twinName(sourceName: string, kind: WorkspaceKind): string {
  return `${sourceName.replace(/\.[^.]+$/, '')} (${TWIN_SUFFIX[kind]})`
}

export function twinProperties(source: DriveFile): Record<string, string> {
  return { [TWIN_SOURCE_KEY]: source.id, [TWIN_SOURCE_MODIFIED_KEY]: source.modifiedTime ?? '' }
}

/** The newest native twin previously converted from this source, if any. */
export async function findConvertedTwin(client: GoogleClient, sourceId: string): Promise<DriveFile | undefined> {
  const q = `appProperties has { key='${TWIN_SOURCE_KEY}' and value='${escapeDriveQueryValue(sourceId)}' } and trashed = false`
  const [twin] = await listFiles(client, { q, orderBy: 'createdTime desc', limit: 1 })
  return twin
}

export interface ConvertedTwin {
  twin: DriveFile
  kind: WorkspaceKind
  /** True when the twin was converted by this call rather than found. */
  created: boolean
  /** An earlier twin left in place because the source changed after it was made. */
  superseded?: DriveFile
}

/**
 * The native Google twin of an uploaded Office/csv/pdf file — the Drive
 * "Save as Google Sheets/Docs/Slides" action, done once and reused: found
 * when a twin of this same source revision exists, otherwise converted now.
 * The source is never touched.
 */
export async function ensureConvertedTwin(client: GoogleClient, source: DriveFile): Promise<ConvertedTwin> {
  const kind = conversionTarget(source.mimeType)
  if (!kind) throw new Error(`Drive has no Google conversion for "${source.name}" (${source.mimeType})`)
  const existing = await findConvertedTwin(client, source.id)
  if (existing && existing.appProperties?.[TWIN_SOURCE_MODIFIED_KEY] === (source.modifiedTime ?? '')) {
    return { twin: existing, kind, created: false }
  }
  const twin = await copyFile(client, source.id, twinName(source.name, kind), {
    mimeType: WORKSPACE_MIME[kind],
    appProperties: twinProperties(source),
  })
  return { twin, kind, created: true, superseded: existing }
}
