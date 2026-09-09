import * as path from 'node:path'
import process from 'node:process'
import { readJson, withProcessLock, writeJson } from './files.ts'
import { errorMessage, jobFile, jobLock, type JobRecord } from './mod.ts'

async function run(): Promise<void> {
  const [dir, id, module] = process.argv.slice(2)
  if (!dir || !id || !module) throw new Error('Missing background worker arguments.')
  const record = await withProcessLock(jobLock(dir), async () => {
    const current = await readJson<{ id: string }>(path.join(dir, 'current.json'))
    const reserved = await readJson<JobRecord<unknown>>(jobFile(dir, id))
    if (current?.id !== id || reserved?.status !== 'running') return null
    reserved.owner = process.pid
    await writeJson(jobFile(dir, id), reserved)
    return reserved
  })
  if (!record) return

  try {
    const implementation = await import(module)
    if (typeof implementation.default !== 'function')
      throw new Error('Background job module must export a default function.')
    record.result = await implementation.default(record.input)
    record.status = 'complete'
    // Persist before exit, including failures loading the task module or serializing its result.
    await withProcessLock(jobLock(dir), () => writeJson(jobFile(dir, id), record))
  } catch (error) {
    record.status = 'failed'
    delete record.result
    record.error = errorMessage(error)
    await withProcessLock(jobLock(dir), () => writeJson(jobFile(dir, id), record))
  }
}

await run()
// Task modules may leave provider connection pools or timers alive after returning.
process.exit(0)
