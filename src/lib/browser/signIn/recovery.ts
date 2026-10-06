import type { CallOptions, McpToolDefinition, McpToolResult } from '../mcp/client.ts'

export interface RecoverableBrowserSession {
  listTools(): Promise<McpToolDefinition[]>
  callTool(name: string, args: Record<string, unknown>, options?: CallOptions): Promise<McpToolResult>
  recoveryUrl(): string | undefined
  close(): Promise<void>
}

/** Replaces a stalled task page inside the same credential worker, without replaying an uncertain action. */
export class RecoveringBrowserSession {
  private recoveries = 0
  private ended = false

  constructor(
    private session: RecoverableBrowserSession,
    private readonly create: () => Promise<RecoverableBrowserSession>,
  ) {}

  listTools(): Promise<McpToolDefinition[]> {
    return this.session.listTools()
  }

  async close(): Promise<void> {
    this.ended = true
    await this.session.close()
  }

  async callTool(name: string, args: Record<string, unknown>, options: CallOptions = {}): Promise<McpToolResult> {
    const reply = await this.session.callTool(name, args, options)
    const state = reply.structuredContent as { kind?: string } | undefined
    if (state?.kind !== 'browser_timeout' || this.ended || options.signal?.aborted) return reply
    const url = this.session.recoveryUrl()
    if (!url || this.recoveries >= 2) return reply
    this.recoveries++
    await this.session.close()
    if (this.ended || options.signal?.aborted) return reply
    const replacement = await this.create()
    if (this.ended || options.signal?.aborted) {
      await replacement.close()
      return reply
    }
    this.session = replacement
    const opened = await replacement.callTool('browser_navigate', { url }, options)
    if (opened.isError) return opened
    // Snapshots are read-only. Input actions are never retried here: inspect the
    // page and existing files first, including after an upload or download click.
    const message =
      'Sky reconnected to the browser and reopened the last page after it stopped responding. Downloaded files were kept. Check the page and files before repeating the previous action.'
    if (name === 'browser_snapshot') {
      const snapshot = await replacement.callTool(name, args, options)
      return { ...snapshot, content: [{ type: 'text', text: message }, ...snapshot.content] }
    }
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
      structuredContent: { kind: 'browser_recovered' },
    }
  }
}
