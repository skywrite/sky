import type { GoogleClient } from '#lib/google/client.ts'
import type { DocSnapshot, DocSnapshotStore } from '#lib/google/docSnapshots.ts'
import type { MissionFile } from './tools.ts'

export interface DocumentCopy {
  fileId: string
  version: string
  capturedAt: string
  markdown: string
}

/** Complete exports observed during this mission, suitable for its notebook record. */
export class DocumentCopies {
  private readonly copies = new Map<string, DocumentCopy>()
  private readonly generations = new Map<string, number>()
  private readonly writes = new Map<string, number>()

  checkpoint(): ReadonlyMap<string, number> {
    return new Map(this.generations)
  }

  observe(snapshot: DocSnapshot, checkpoint: ReadonlyMap<string, number>): void {
    const id = snapshot.file.id
    // A read can finish after a concurrent write. Its old export must not
    // reappear as the finished document, even if the write timed out.
    if ((checkpoint.get(id) ?? 0) !== (this.generations.get(id) ?? 0) || this.writes.get(id)) return
    if (snapshot.markdown !== undefined) {
      this.copies.set(id, {
        fileId: id,
        version: snapshot.file.version,
        capturedAt: snapshot.capturedAt,
        markdown: snapshot.markdown,
      })
    } else if (this.copies.get(id)?.version !== snapshot.file.version) {
      this.copies.delete(id)
    }
  }

  beginWrite(fileId: string): () => void {
    const invalidate = () => {
      this.copies.delete(fileId)
      this.generations.set(fileId, (this.generations.get(fileId) ?? 0) + 1)
    }
    invalidate()
    this.writes.set(fileId, (this.writes.get(fileId) ?? 0) + 1)
    return () => {
      invalidate()
      this.writes.set(fileId, (this.writes.get(fileId) ?? 1) - 1)
    }
  }

  get(fileId: string): DocumentCopy | undefined {
    return this.copies.get(fileId)
  }

  isWriting(fileId: string): boolean {
    return (this.writes.get(fileId) ?? 0) > 0
  }
}

/** Reuse final read-backs; fill a missing copy without asking the model for another turn. */
export async function preserveDocumentCopies(
  client: GoogleClient,
  files: MissionFile[],
  copies: DocumentCopies,
  snapshots: DocSnapshotStore,
): Promise<{ documents: DocumentCopy[]; issues: string[] }> {
  const results = await Promise.all(
    files.map(async (file) => {
      const existing = copies.get(file.id)
      if (existing) return { document: existing }
      if (file.kind !== 'doc') return {}
      try {
        if (copies.isWriting(file.id))
          throw new Error('An earlier write is still running; read the document again when it finishes.')
        const checkpoint = copies.checkpoint()
        const snapshot = await snapshots.read(client, file.id)
        copies.observe(snapshot, checkpoint)
        const document = copies.get(file.id)
        if (!document) throw new Error('The document changed while its copy was being saved; read it again.')
        return { document }
      } catch (error) {
        return {
          issue: `Could not save the content of "${file.title}" (${file.url ?? file.id}) in the notebook: ${(error as Error).message}`,
        }
      }
    }),
  )
  return {
    documents: results.flatMap((result) => (result.document ? [result.document] : [])),
    issues: results.flatMap((result) => (result.issue ? [result.issue] : [])),
  }
}
