import type { McpClient } from '../mcp/client.ts'

export type PrivateBrowserClient = Pick<McpClient, 'callTool' | 'listTools' | 'close' | 'serverInfo'>

/** A chat run owns one worker; bounded browser tasks borrow it in order, with fresh tabs and file scopes. */
export class PrivateBrowserRun {
  private client?: PrivateBrowserClient
  private opening?: Promise<PrivateBrowserClient>
  private generation = 0
  private tail = Promise.resolve()
  private closing = Promise.resolve()
  private release?: () => void
  private configuration?: string

  async close(): Promise<void> {
    this.generation++
    const client = this.client
    const opening = this.opening
    const release = this.release
    this.client = undefined
    this.opening = undefined
    this.closing = this.closing
      .then(async () => {
        await (client ?? (await opening?.catch(() => undefined)))?.close()
      })
      .catch(() => {})
      .finally(() => release?.())
    await this.closing
  }

  async acquire(
    start: () => Promise<PrivateBrowserClient>,
    request: Record<string, unknown>,
    signal?: AbortSignal,
    configuration = '',
  ): Promise<PrivateBrowserClient> {
    const generation = this.generation
    const prior = this.tail
    let release!: () => void
    const done = new Promise<void>((resolve) => {
      release = resolve
    })
    this.tail = prior.then(() => done)
    await prior
    await this.closing
    let ended = false
    const current = () => {
      signal?.throwIfAborted()
      if (ended || generation !== this.generation) throw new Error('The browser run was stopped.')
    }
    const abort = () => {
      void this.close()
    }
    try {
      current()
      this.release = release
      signal?.addEventListener('abort', abort, { once: true })
      if (this.client && this.configuration !== configuration)
        throw new Error('The browser connection changed during this run. Resume to use the newly selected browser.')
      if (!this.client) {
        this.configuration = configuration
        this.opening = start()
        const client = await this.opening
        current()
        this.client = client
        this.opening = undefined
      }
      const client = this.client
      const started = await client.callTool('sky_start', request, { signal })
      if (started.isError) throw new Error('The private browser could not start.')
      current()
      return {
        serverInfo: client.serverInfo,
        listTools: () => {
          current()
          return client.listTools()
        },
        callTool: (name, args, options) => {
          current()
          return client.callTool(name, args, options)
        },
        close: async () => {
          if (ended) return
          ended = true
          try {
            if (generation === this.generation) {
              const finished = await client.callTool('sky_finish', {}, { signal })
              if (finished.isError) throw new Error('The browser task could not finish.')
            }
          } catch {
            await this.close()
          } finally {
            signal?.removeEventListener('abort', abort)
            if (this.release === release) this.release = undefined
            release()
          }
        },
      }
    } catch (error) {
      signal?.removeEventListener('abort', abort)
      if (generation === this.generation) await this.close()
      release()
      throw error
    }
  }
}
