/**
 * The shared read path for Google Workspace files: resolve a file id to
 * something exportable (uploaded Office/csv/pdf files go through their
 * native Google twin, converted once and reused), export one page of
 * content, and surface tab structure so callers can target follow-ups.
 */

import {
  EXPORT_MIME,
  conversionTarget,
  ensureConvertedTwin,
  exportFile,
  getDocTabTexts,
  getFile,
  listDocTabs,
  workspaceKind,
} from '#lib/google/mod.ts'
import type { DocTabInfo, DriveFile, GoogleClient, WorkspaceKind } from '#lib/google/mod.ts'

export const READ_LIMIT_CHARS = 40_000

export interface ReadPage {
  content: string
  /** Clamped offset the page actually starts at. */
  start: number
  /** One past the last content char returned (the next page's offset). */
  end: number
  /** True when the page reaches the end of the file. */
  complete: boolean
}

/**
 * Slice one read page out of an export. A truncated page carries a
 * self-directing continuation marker so the model knows there is more and
 * exactly how to get it. Returns null for an offset past the end.
 */
export function paginateRead(full: string, offset = 0): ReadPage | null {
  const start = Math.max(0, Math.floor(offset))
  if (start > 0 && start >= full.length) return null
  const end = Math.min(full.length, start + READ_LIMIT_CHARS)
  const complete = end >= full.length
  const body = full.slice(start, end)
  return {
    content: complete ? body : `${body}\n\n[Truncated — ${full.length} chars total; continue with offset: ${end}]`,
    start,
    end,
    complete,
  }
}

export interface WorkspaceReadRequest {
  fileId: string
  /** Docs only: read just this tab (plain text rather than markdown). */
  tabId?: string
  /** Character offset a truncated read named to continue from. */
  offset?: number
}

export interface WorkspaceRead {
  /** The file the content came from — the native twin when the source is an uploaded Office file. */
  file: DriveFile
  kind: WorkspaceKind
  /** One page of content, ending with a continuation marker when truncated. */
  content: string
  /** Docs with more than one tab: the tab map, in document order. */
  tabs?: DocTabInfo[]
  /** The tab that was read, when the request named one. */
  tab?: { tabId?: string; title?: string }
  /** The uploaded source, when reading went through a converted twin. */
  convertedFrom?: DriveFile
  /** True when this call minted the twin rather than reusing one. */
  twinCreated: boolean
}

export type WorkspaceReadOutcome = { ok: true; read: WorkspaceRead } | { ok: false; message: string }

/** Domain misses come back as plain sentences for the caller to relay; API failures throw. */
export async function readWorkspaceFile(
  client: GoogleClient,
  request: WorkspaceReadRequest,
): Promise<WorkspaceReadOutcome> {
  const source = await getFile(client, request.fileId)
  let file = source
  let kind = workspaceKind(source.mimeType)
  let convertedFrom: DriveFile | undefined
  let twinCreated = false
  if (!kind) {
    if (!conversionTarget(source.mimeType)) {
      return {
        ok: false,
        message: `"${source.name}" is not a Doc/Sheet/Slides file or an upload Drive can convert (${source.mimeType})`,
      }
    }
    // Drive's "Save as Google Docs/Sheets/Slides", done once and reused — the source itself stays untouched.
    const converted = await ensureConvertedTwin(client, source)
    file = converted.twin
    kind = converted.kind
    convertedFrom = source
    twinCreated = converted.created
  }

  if (request.tabId !== undefined) {
    if (kind !== 'doc') return { ok: false, message: `tabId applies only to Docs — "${file.name}" is a ${kind}` }
    const tabs = await getDocTabTexts(client, file.id)
    const tab = tabs.find((t) => t.tabId === request.tabId)
    if (!tab) {
      const known = tabs.map((t) => `${t.tabId} ("${t.tabTitle ?? 'untitled'}")`).join(', ')
      return { ok: false, message: `No tab ${request.tabId} in "${file.name}" — its tabs: ${known}` }
    }
    const page = paginateRead(tab.text, request.offset)
    if (!page) {
      return { ok: false, message: `Offset ${request.offset} is past the end — the tab is ${tab.text.length} chars` }
    }
    return {
      ok: true,
      read: {
        file,
        kind,
        content: page.content,
        tab: { tabId: tab.tabId, title: tab.tabTitle },
        convertedFrom,
        twinCreated,
      },
    }
  }

  const [full, docTabs] = await Promise.all([
    exportFile(client, file.id, EXPORT_MIME[kind]),
    kind === 'doc' ? listDocTabs(client, file.id) : Promise.resolve<DocTabInfo[]>([]),
  ])
  const page = paginateRead(full, request.offset)
  if (!page) {
    return { ok: false, message: `Offset ${request.offset} is past the end — "${file.name}" is ${full.length} chars` }
  }
  return {
    ok: true,
    read: {
      file,
      kind,
      content: page.content,
      tabs: docTabs.length > 1 ? docTabs : undefined,
      convertedFrom,
      twinCreated,
    },
  }
}
