import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { withProcessLock } from '#lib/jobs/files.ts'
import { hash } from '#lib/outbox/files.ts'

/** Appends and browser edits share a short lock; never hold it while calling a model. */
export async function withMarkdownWrite<T>(file: string, run: () => Promise<T>): Promise<T> {
  const canonical = await realpath(file)
  return withProcessLock(path.join(tmpdir(), 'sky-markdown-writes', hash(canonical)), run)
}
