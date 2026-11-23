/** An explicit tool read, distinct from a record admitted by background retrieval. */
export interface NotebookRead {
  /** Original notebook-relative Markdown path. */
  path: string
  /** First turn that read the record, so forks inherit only their prefix's sources. */
  turn: number
}

export function mergeNotebookReads(...groups: (readonly NotebookRead[] | undefined)[]): NotebookRead[] {
  const reads = new Map<string, NotebookRead>()
  for (const group of groups) {
    for (const read of group ?? []) {
      const prior = reads.get(read.path)
      if (!prior || read.turn < prior.turn) reads.set(read.path, { ...read })
    }
  }
  return [...reads.values()]
}
