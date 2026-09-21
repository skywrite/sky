import { unlink } from 'node:fs/promises'
import { atomicWrite, readOptional } from '#lib/outbox/files.ts'
import { createDayFile } from './createDayFile.ts'
import { ItemEditError } from './listBlocks.ts'

export interface PlanningChange {
  file: string
  before: string | undefined
  after: string | undefined
}
type Change = PlanningChange

export async function writePlanningChanges(
  changes: Change[],
  write?: (file: string, content: string) => Promise<void>,
): Promise<void> {
  for (const change of changes)
    if ((await readOptional(change.file)) !== change.before)
      throw new ItemEditError('A file changed while saving. Refresh and try again.')
  const attempted: Change[] = []
  try {
    for (const change of changes) {
      if (change.before === change.after) continue
      if ((await readOptional(change.file)) !== change.before)
        throw new ItemEditError('A file changed while saving. Refresh and try again.')
      if (change.after === undefined) await unlink(change.file)
      else if (write) {
        // A test writer may fail after writing; inspect its bytes during rollback too.
        attempted.push(change)
        await write(change.file, change.after)
        continue
      } else if (change.before === undefined) {
        if (!(await createDayFile(change.file, change.after)))
          throw new ItemEditError('The destination file was just created elsewhere. Refresh and try again.')
      } else await atomicWrite(change.file, change.after)
      attempted.push(change)
    }
  } catch (error) {
    for (const change of attempted.reverse()) {
      if ((await readOptional(change.file)) !== change.after) continue
      if (change.before === undefined) await unlink(change.file)
      else await atomicWrite(change.file, change.before)
    }
    throw error
  }
}
