import { tool } from 'ai'
import { z } from 'zod'
import type { CommandResult } from '#commands/mod.ts'
import { browserTaskHost } from '#lib/browser/task/host.ts'
import type { ChatPlanController } from './plan.ts'
import { BROWSER_REFUSAL, planRefusal, type TaskAdmission } from './taskAdmission.ts'

/** Tool routing checks the person's request before a plan or browser can be started. */
export function createTaskTools(options: {
  plan: ChatPlanController
  admit: TaskAdmission
  runBrowser: (objective: string, signal?: AbortSignal) => Promise<CommandResult>
}) {
  const { plan, admit, runBrowser } = options
  return {
    ...plan.tools(async (status) => {
      const intent = await admit()
      // A requested file adjustment can update existing results without restarting the rest of the plan.
      if (status === 'paused' && plan.plan?.status === 'paused' && intent.kind === 'action') return
      const refusal = planRefusal(intent, status)
      if (refusal) return refusal
    }),
    browser_task: tool({
      description:
        'Carry out a bounded website interaction that actually needs a browser, or an explicit request to operate the browser. ' +
        'Prefer connected email, calendar, Google document, file and research tools for their supported operations. ' +
        'Do not use this to search/read email, continue truncated tool results, or retry connected-account sign-in. ' +
        'A small browser task does not require a plan; create a live checklist only for delegated work with several meaningful outcomes. ' +
        'Sky uses the selected browser connection. Give the objective and destination folder when collecting files.',
      inputSchema: z.object({
        objective: z.string().min(1).max(12_000),
        uploads: z.object({ paths: z.array(z.string().min(1)).min(1).max(50), origin: z.string().url() }).optional(),
      }),
      execute: async (
        { objective, uploads }: { objective: string; uploads?: { paths: string[]; origin: string } },
        options?: { abortSignal?: AbortSignal },
      ) => {
        const intent = await admit()
        if (intent.browser === false || intent.kind === 'draft') return { success: false, error: BROWSER_REFUSAL }
        const signal = options?.abortSignal
        signal?.throwIfAborted()
        // The checklist is optional. An unrelated paused plan does not own this task.
        if (intent.kind === 'workflow') await plan.begin()
        const tracked = plan.plan?.status === 'working' && intent.kind !== 'answer' && intent.kind !== 'action'
        let needsYou: string | undefined
        const result = await browserTaskHost.run(
          {
            needsYou: async (message) => {
              if (tracked) return plan.wait(message, 'browser', signal)
              needsYou = message
              return false
            },
            ...(tracked
              ? {
                  nativeSignIn: <T>(run: () => Promise<T>) => plan.nativeSignIn(run),
                  browserRun: plan.browserRun,
                  runObjective: `${plan.plan!.title}: ${plan.plan!.outcome}`,
                }
              : {}),
            signInFailed: async (message) => {
              needsYou = message
              if (tracked && !signal?.aborted) await plan.pause(message)
            },
            uploads,
          },
          () => runBrowser(objective, signal),
        )
        const data = result.data && typeof result.data === 'object' ? (result.data as Record<string, unknown>) : {}
        if (needsYou || data.signInFailure || ['blocked', 'stopped', 'out_of_steps'].includes(String(data.outcome)))
          return { ...data, success: false, error: needsYou ?? data.signInFailure ?? data.report }
        return result.status === 'success'
          ? { success: true, ...data }
          : { success: false, error: String(result.error ?? result.message ?? 'Browser task did not finish.') }
      },
    }),
  }
}
