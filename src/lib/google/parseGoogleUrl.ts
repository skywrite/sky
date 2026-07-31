import type { WorkspaceKind } from './drive.ts'

export interface ParsedGoogleUrl {
  fileId: string
  /** Known for docs/sheets/slides URLs; undefined for generic Drive links. */
  kind?: WorkspaceKind
}

const WORKSPACE_PATHS: Array<{ prefix: string; kind: WorkspaceKind }> = [
  { prefix: '/document/d/', kind: 'doc' },
  { prefix: '/spreadsheets/d/', kind: 'sheet' },
  { prefix: '/presentation/d/', kind: 'slides' },
]

const FILE_ID_RE = /^[A-Za-z0-9_-]{20,}$/

/** Does a bare string look like a Drive file id (no URL around it)? */
export function isLikelyFileId(value: string): boolean {
  return FILE_ID_RE.test(value)
}

/** Resolve a user-supplied file reference — a Google URL or a bare file id. */
export function resolveFileRef(ref: string): ParsedGoogleUrl | null {
  return parseGoogleUrl(ref) ?? (isLikelyFileId(ref) ? { fileId: ref } : null)
}

/**
 * Extract the file id (and kind, when the URL names it) from a Google
 * Docs/Sheets/Slides/Drive link. Returns null for anything else.
 */
export function parseGoogleUrl(input: string): ParsedGoogleUrl | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (url.hostname === 'docs.google.com') {
    for (const { prefix, kind } of WORKSPACE_PATHS) {
      if (url.pathname.startsWith(prefix)) {
        const fileId = url.pathname.slice(prefix.length).split('/')[0]
        if (fileId) return { fileId, kind }
      }
    }
    return null
  }
  if (url.hostname === 'drive.google.com') {
    if (url.pathname.startsWith('/file/d/')) {
      const fileId = url.pathname.slice('/file/d/'.length).split('/')[0]
      if (fileId) return { fileId }
    }
    const idParam = url.searchParams.get('id')
    if (idParam) return { fileId: idParam }
    return null
  }
  return null
}
