/**
 * Client for the notebook service's document API: the GraphQL read/write
 * pair (documentContent / saveDocument) plus the people index. This is the
 * only client-side road to profile bytes — no sky command walks people/
 * itself, so where a profile lives (people/ vs people-old/, and any future
 * reshuffle) stays the service's concern.
 *
 * Version handles come from the service's content hash, shared with the
 * docs editor's REST API — a save carrying a stale version comes back as a
 * conflict with the current snapshot, never a silent overwrite.
 */

import { DIR_BASE, PORT_SERVER } from '#shared/config.ts'
import { fetchWithConnectRetry } from '#shared/models/Chat/ChatContext/fetchContext.ts'
import type { PersonIndexEntry } from '#shared/models/Person/subjects.ts'
import type { DocumentIO, DocumentSaveResult, DocumentSnapshot } from '#shared/models/Person/write.ts'

const GRAPHQL_URL = `http://localhost:${PORT_SERVER}/graphql`

/**
 * DomainCollection queries return absolute paths (every consumer normalizes
 * client-side — ChatContext.relPath does the same); documentContent and
 * saveDocument speak notebook-relative. This is the bridge.
 */
export function toNotebookRelative(path: string, base: string = DIR_BASE): string {
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const resp = await fetchWithConnectRetry(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!resp.ok) throw new Error(`notebook service /graphql returned ${resp.status}`)
  const json = (await resp.json()) as { data?: T; errors?: Array<{ message: string }> }
  if (json.errors && json.errors.length > 0) throw new Error(json.errors[0].message)
  if (!json.data) throw new Error('notebook service /graphql returned no data')
  return json.data
}

/** Every profile's names and path — the matching surface for subject discovery. */
export async function fetchPeopleIndex(): Promise<PersonIndexEntry[]> {
  const data = await gql<{ allPeople: PersonIndexEntry[] }>('{ allPeople { name names path } }')
  return data.allPeople.map((p) => ({ ...p, path: toNotebookRelative(p.path) }))
}

/** A document's current text, or null when no file exists at the path. */
export async function readServiceDocument(path: string): Promise<string | null> {
  const snapshot = await readSnapshot(path)
  return snapshot?.content ?? null
}

const READ_QUERY = 'query($path: String!) { documentContent(path: $path) { path content version } }'

const SAVE_MUTATION = `mutation($path: String!, $content: String!, $version: Float) {
  saveDocument(path: $path, content: $content, version: $version) {
    saved conflict document { path content version }
  }
}`

async function readSnapshot(path: string): Promise<DocumentSnapshot | null> {
  const data = await gql<{ documentContent: DocumentSnapshot | null }>(READ_QUERY, { path })
  return data.documentContent
}

/** The conflict-checked document transport the profile applier writes through. */
export function serviceDocumentIO(): DocumentIO {
  return {
    read: readSnapshot,
    save: async (path, content, version): Promise<DocumentSaveResult> => {
      const data = await gql<{
        saveDocument: { saved: boolean; conflict: boolean; document: DocumentSnapshot }
      }>(SAVE_MUTATION, { path, content, version })
      if (data.saveDocument.saved) return { saved: true }
      return { saved: false, current: data.saveDocument.document }
    },
  }
}
