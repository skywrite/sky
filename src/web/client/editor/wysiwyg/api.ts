/** The editor's two calls: the file's version (or its content), and a save — which lands or meets a newer file. */

export interface Snapshot {
  version: number
  content?: string
}

export type SaveResult = { status: 'saved'; version: number } | { status: 'conflict' }

export async function fetchSnapshot(apiPath: string, metaOnly: boolean): Promise<Snapshot> {
  const response = await fetch(metaOnly ? `${apiPath}?meta=1` : apiPath, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error('Failed to read markdown document')
  return (await response.json()) as Snapshot
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
  if (response.status === 409) return { status: 'conflict' }
  if (!response.ok) throw new Error('Failed to save markdown document')
  const saved = (await response.json()) as { version: number }
  return { status: 'saved', version: saved.version }
}
