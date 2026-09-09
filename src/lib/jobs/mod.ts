import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isProcessAlive, readJson, withProcessLock, writeJson } from './files.ts'

export interface JobRecord<TResult, TInput = unknown> {
  id: string
  status: 'running' | 'complete' | 'failed'
  owner: number
  input: TInput
  result?: TResult
  error?: string
}

export interface ProcessJobOptions {
  /** Local machine state, outside a synchronized notebook. */
  dir: string
  /** A module exporting a default async function with JSON-safe input and output. */
  module: string | URL
  cwd?: string
  /** Passed directly to the child, never persisted in job state. */
  env?: NodeJS.ProcessEnv
}

export const jobFile = (dir: string, id: string): string => {
  if (!/^[a-f0-9-]+$/.test(id)) throw new Error('Invalid background job identifier.')
  return path.join(dir, 'runs', `${id}.json`)
}

export const jobLock = (dir: string): string => path.join(dir, 'lock')
export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

async function readRun<TResult, TInput>(dir: string, id: string): Promise<JobRecord<TResult, TInput> | null> {
  const record = await readJson<JobRecord<TResult, TInput>>(jobFile(dir, id))
  if (record?.status === 'running' && !isProcessAlive(record.owner)) {
    record.status = 'failed'
    record.error = 'The background worker stopped before this job finished. Start it again to retry.'
    await writeJson(jobFile(dir, id), record)
  }
  return record
}

export function createProcessJob<TInput, TResult>(options: ProcessJobOptions) {
  const dir = path.resolve(options.dir)
  const module =
    options.module instanceof URL
      ? options.module.href
      : options.module.startsWith('file:')
        ? new URL(options.module).href
        : pathToFileURL(path.resolve(options.module)).href
  const current = path.join(dir, 'current.json')
  const readCurrent = async (): Promise<JobRecord<TResult, TInput> | null> => {
    const pointer = await readJson<{ id: string }>(current)
    return pointer ? readRun<TResult, TInput>(dir, pointer.id) : null
  }

  return {
    status: (): Promise<JobRecord<TResult, TInput> | null> => withProcessLock(jobLock(dir), readCurrent),

    start: (input: TInput): Promise<JobRecord<TResult, TInput>> =>
      withProcessLock(jobLock(dir), async () => {
        const active = await readCurrent()
        if (active?.status === 'running') return active

        const record: JobRecord<TResult, TInput> = { id: randomUUID(), status: 'running', owner: process.pid, input }
        await writeJson(jobFile(dir, record.id), record)
        await writeJson(current, { id: record.id })
        try {
          const child = spawn(
            process.execPath,
            [fileURLToPath(new URL('./worker.ts', import.meta.url)), dir, record.id, module],
            {
              cwd: options.cwd,
              env: { ...process.env, ...options.env },
              detached: true,
              stdio: 'ignore',
            },
          )
          await new Promise<void>((resolve, reject) => {
            child.once('error', reject)
            child.once('spawn', resolve)
          })
          child.unref()
          record.owner = child.pid!
          // The child takes this same lock before importing user code. If we die
          // before this handoff, either it claims the reservation or a retry fences it out.
          await writeJson(jobFile(dir, record.id), record)
        } catch (error) {
          record.status = 'failed'
          record.error = errorMessage(error)
          await writeJson(jobFile(dir, record.id), record)
        }
        return record
      }),

    wait: async (id: string): Promise<TResult> => {
      for (;;) {
        const record = await withProcessLock(jobLock(dir), () => readRun<TResult, TInput>(dir, id))
        if (!record) throw new Error('Background job was not found.')
        if (record.status === 'complete') return record.result as TResult
        if (record.status === 'failed') throw new Error(record.error ?? 'Background job failed.')
        await delay(100)
      }
    },
  }
}
