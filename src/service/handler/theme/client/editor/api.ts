import type { EditableBlock } from './types.ts'

/**
 * The editor's four calls: the document as blocks, the file's version (or its content), one
 * block rendered, and a save — which lands, or meets a newer file on disk.
 */

/** The document as the document API hands it over: the file, its version, its frontmatter, its blocks. */
export interface DocumentState {
  content: string
  version: number
  frontmatter: string
  blocks: EditableBlock[]
}

/** The file's version — and its content, when more than the version was asked for. */
export interface Snapshot {
  version: number
  content?: string
}

export type SaveResult = { status: 'saved'; version: number } | { status: 'conflict' }

export async function fetchDocument(documentApiPath: string): Promise<DocumentState> {
  const response = await fetch(documentApiPath, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error('Failed to rebuild markdown document state')
  }

  return (await response.json()) as DocumentState
}

export async function fetchSnapshot(apiPath: string, metaOnly: boolean): Promise<Snapshot> {
  const response = await fetch(metaOnly ? apiPath + '?meta=1' : apiPath, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error('Failed to read markdown document')
  }

  return (await response.json()) as Snapshot
}

export async function renderBlock(renderBlockApiPath: string, type: string, raw: string): Promise<string> {
  const response = await fetch(renderBlockApiPath, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, raw }),
  })

  if (!response.ok) {
    throw new Error('Failed to render updated block preview')
  }

  const payload = (await response.json()) as { html?: unknown } | null
  if (!payload || typeof payload.html !== 'string') {
    throw new Error('Render block API returned an invalid payload')
  }

  return payload.html
}

export async function saveDocument(
  apiPath: string,
  content: string,
  version: number,
  force: boolean,
): Promise<SaveResult> {
  const response = await fetch(apiPath, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, version, force }),
  })

  if (response.status === 409) {
    return { status: 'conflict' }
  }

  if (!response.ok) {
    throw new Error('Failed to save markdown document')
  }

  const saved = (await response.json()) as { version: number }
  return { status: 'saved', version: saved.version }
}
