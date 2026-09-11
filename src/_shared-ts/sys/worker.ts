import { Worker } from 'node:worker_threads'

/** Run a read/compute task off the caller's event loop, with a deadline it cannot block. */
export function runWorker<T>(file: URL, options: { data: unknown; timeoutMs: number }): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(file, { workerData: options.data, execArgv: [] })
    let settled = false
    const timeout = setTimeout(
      () => finish(new Error(`Worker timed out after ${options.timeoutMs} ms`)),
      options.timeoutMs,
    )

    function finish(error?: Error, result?: T): void {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      void worker.terminate()
      if (error) reject(error)
      else resolve(result as T)
    }

    worker.once('message', (result: T) => finish(undefined, result))
    worker.once('error', (error: Error) => finish(error))
    worker.once('exit', (code) => finish(new Error(`Worker exited without a result (code ${code})`)))
  })
}
