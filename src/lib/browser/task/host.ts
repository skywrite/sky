import { AsyncLocalStorage } from 'node:async_hooks'
import type { McpToolResult } from '../mcp/client.ts'
import { readSignInResult, signInFailed, signInProblem } from '../signIn/outcome.ts'
import type { PrivateBrowserRun } from '../signIn/run.ts'

/** Web chat supplies a durable, visible handoff in place of the terminal prompt. */
export const browserTaskHost = new AsyncLocalStorage<{
  needsYou: (message: string) => Promise<boolean>
  nativeSignIn?: <T>(run: () => Promise<T>) => Promise<T>
  signInFailed?: (message: string) => Promise<void>
  uploads?: { paths: string[]; origin: string }
  browserRun?: PrivateBrowserRun
  runObjective?: string
}>()

export async function withNativeSignIn(run: () => Promise<McpToolResult>): Promise<McpToolResult> {
  const host = browserTaskHost.getStore()
  let result: McpToolResult
  try {
    result = await (host?.nativeSignIn?.(run) ?? run())
  } catch {
    const message = signInProblem(null, '')
    await host?.signInFailed?.(message)
    // The worker transport may wrap a native error. Only fixed copy can leave this boundary.
    throw new Error(message)
  }
  const text = result.content
    .flatMap((entry) =>
      entry.type === 'text' && 'text' in entry && typeof entry.text === 'string' ? [entry.text] : [],
    )
    .join('\n')
  const signed = result.isError ? null : readSignInResult(text)
  if (signInFailed(signed)) await host?.signInFailed?.(signInProblem(signed, signed?.origin ?? ''))
  return result
}
