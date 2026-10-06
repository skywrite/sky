import { tool } from 'ai'
import { z } from 'zod'
import { PrivateBrowserRun } from '#lib/browser/signIn/run.ts'
import type { ChatPlan, ChatPlanItem, QueuedChatInstruction } from '#universal/ai/chatPlan.ts'
import type { ToolRun } from './mod.ts'

const text = z.string().trim().min(1).max(1000)
const item = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  title: text,
  status: z.enum(['pending', 'working', 'blocked', 'done', 'skipped']),
  kind: z.enum(['action', 'reasoning']),
  detail: z.string().max(2000),
  evidence: z.array(z.string().min(1).max(200)).max(30),
})
const updateSchema = z.object({
  revision: z.number().int().min(0),
  title: text,
  outcome: text,
  status: z.enum(['draft', 'working', 'needs-you', 'paused', 'complete']),
  note: z.string().max(2000),
  steps: z
    .array(item.extend({ items: z.array(item).max(50) }))
    .min(1)
    .max(20),
  artifacts: z.array(z.object({ label: text, location: text, evidence: z.string().min(1).max(200) })).max(100),
  finalCheck: z.string().max(2000),
})
const storedSchema = updateSchema.extend({
  version: z.literal(1),
  status: z.enum(['draft', 'working', 'needs-you', 'paused', 'complete']),
  at: z.number().int().min(0),
  attention: z
    .object({ id: text, kind: z.enum(['browser', 'question']), message: text, native: z.boolean().optional() })
    .nullable(),
})
const queueSchema = z
  .array(
    z.object({ id: z.string().min(1).max(100), message: z.string().min(1).max(100_000), held: z.boolean().optional() }),
  )
  .max(10)

export function restorePlan(value: unknown): ChatPlan | null {
  const result = storedSchema.safeParse(value)
  if (!result.success) return null
  const plan = result.data
  if (plan.status === 'working' || plan.status === 'needs-you') {
    plan.status = 'paused'
    plan.attention = null
    plan.note = 'Work was interrupted. Resume to check the last action before continuing.'
    plan.revision++
  }
  return plan
}

export function restoreInstructions(value: unknown): QueuedChatInstruction[] {
  return queueSchema.safeParse(value).data ?? []
}

function succeeded(run: ToolRun): boolean {
  const output = run.output as Record<string, unknown> | undefined
  return (
    run.status === 'success' &&
    !run.error &&
    output?.success !== false &&
    !output?.stopped &&
    !output?.cutShort &&
    !['blocked', 'failed', 'stopped'].includes(String(output?.outcome))
  )
}

function containsLocation(value: unknown, location: string): boolean {
  if (typeof value === 'string') return value === location || value.split(/\s+/).includes(location)
  if (Array.isArray(value)) return value.some((entry) => containsLocation(entry, location))
  return !!value && typeof value === 'object' && Object.values(value).some((entry) => containsLocation(entry, location))
}

function locations(value: unknown, found = new Set<string>(), depth = 0): string[] {
  if (found.size >= 20 || depth > 6) return [...found]
  if (
    typeof value === 'string' &&
    value.length < 2000 &&
    !value.includes('\n') &&
    (value.startsWith('/') || value.startsWith('https://'))
  )
    found.add(value)
  else if (value && typeof value === 'object')
    for (const child of Object.values(value).slice(0, 100)) locations(child, found, depth + 1)
  return [...found]
}

/** One controller per HTTP thread. All changes are saved by the existing session snapshot queue. */
export class ChatPlanController {
  readonly browserRun = new PrivateBrowserRun()
  plan: ChatPlan | null
  queue: QueuedChatInstruction[]
  delivered: string[]
  private waiting?: { id: string; resolve: (continued: boolean) => void }

  constructor(
    private readonly host: {
      plan?: unknown
      queue?: unknown
      delivered?: unknown
      runs: () => readonly ToolRun[]
      at: () => number
      changed: () => Promise<void>
    },
  ) {
    this.plan = restorePlan(host.plan)
    // Recovery must not replay pending actions before the person returns.
    this.queue = restoreInstructions(host.queue).map((entry) => ({ ...entry, held: true }))
    this.delivered = z.array(z.string().max(100)).max(100).safeParse(host.delivered).data ?? []
  }

  async update(input: z.infer<typeof updateSchema>, resume = false): Promise<ChatPlan> {
    if (this.plan?.attention) throw new Error('The person is still helping. Wait for their answer.')
    if (input.status === 'paused' && this.plan?.status !== 'paused')
      throw new Error('Use the Pause control to stop running work before updating a paused plan.')
    if (this.plan?.status === 'paused' && input.status !== 'paused' && !resume)
      throw new Error('Work is paused. Do not continue until the person resumes.')
    if (input.revision !== (this.plan?.revision ?? 0)) throw new Error('The plan changed. Read it before updating.')
    const runs = new Map(
      this.host
        .runs()
        .filter((run) => run.callId && !['update_plan', 'read_plan', 'wait_for_person'].includes(run.tool))
        .map((run) => [run.callId!, run]),
    )
    const ids = new Set<string>()
    const check = (step: ChatPlanItem) => {
      if (ids.has(step.id)) throw new Error(`Duplicate checklist id: ${step.id}`)
      ids.add(step.id)
      for (const id of step.evidence) {
        if (!runs.has(id) || !succeeded(runs.get(id)!))
          throw new Error(`Evidence ${id} is not a successful recorded tool result.`)
      }
      if (step.status === 'done' && (!step.detail || (step.kind === 'action' && !step.evidence.length))) {
        throw new Error(`Completed step “${step.title}” needs a result and, for actions, recorded tool evidence.`)
      }
      if (step.status === 'skipped' && !step.detail) throw new Error(`Explain why “${step.title}” was skipped.`)
    }
    for (const step of input.steps) {
      check(step)
      for (const child of step.items) check(child)
      if (step.status === 'done' && step.items.some((child) => !['done', 'skipped'].includes(child.status))) {
        throw new Error(`“${step.title}” still has unfinished items.`)
      }
    }
    for (const artifact of input.artifacts) {
      const run = runs.get(artifact.evidence)
      if (!run || !succeeded(run) || !containsLocation(run.output, artifact.location)) {
        throw new Error(`“${artifact.label}” must cite its exact location in a successful tool result.`)
      }
      if (!artifact.location.startsWith('/') && !/^https:\/\//i.test(artifact.location)) {
        throw new Error('File locations must be absolute paths or HTTPS links.')
      }
    }
    if (
      input.status === 'complete' &&
      (!input.finalCheck.trim() ||
        this.queue.length ||
        input.steps.some((step) => !['done', 'skipped'].includes(step.status)))
    ) {
      throw new Error(
        'Finish or explicitly skip every step, handle queued instructions, and record the final check first.',
      )
    }
    if (input.status === 'draft' && input.steps.some((step) => step.status !== 'pending')) {
      throw new Error('A draft plan has pending steps; it does not claim execution.')
    }
    this.plan = { ...input, version: 1, revision: input.revision + 1, at: this.host.at(), attention: null }
    if (input.status === 'complete' || input.status === 'draft') await this.browserRun.close()
    await this.host.changed()
    return this.plan
  }

  async pause(note = 'Paused. Resume to check the last action and continue.'): Promise<void> {
    this.waiting?.resolve(false)
    this.waiting = undefined
    await this.browserRun.close()
    if (!this.plan || this.plan.status === 'complete') return
    this.plan = { ...this.plan, status: 'paused', note, attention: null, revision: this.plan.revision + 1 }
    await this.host.changed()
  }

  async begin(explicit = false): Promise<void> {
    if (
      !this.plan ||
      (this.plan.status !== 'paused' && !(explicit && ['draft', 'needs-you'].includes(this.plan.status)))
    )
      return
    this.plan = { ...this.plan, status: 'working', attention: null, revision: this.plan.revision + 1 }
    await this.host.changed()
  }

  async settle(): Promise<void> {
    if (this.plan?.status === 'working')
      await this.pause('This response ended with work remaining. Resume or adjust the plan in chat.')
  }

  /** A paused checklist does not pause new conversation messages. */
  get nextInstruction(): QueuedChatInstruction | undefined {
    return this.queue.find((entry) => !entry.held)
  }

  /** Only a newly arriving instruction may interrupt this reply. */
  yieldToNewInstructions(): () => boolean {
    const waiting = new Set(this.queue.filter((entry) => !entry.held).map((entry) => entry.id))
    return () => this.queue.some((entry) => !entry.held && !waiting.has(entry.id))
  }

  async holdInstructions(): Promise<void> {
    if (!this.queue.some((entry) => !entry.held)) return
    this.queue = this.queue.map((entry) => ({ ...entry, held: true }))
    await this.host.changed()
  }

  async releaseInstructions(id?: string): Promise<void> {
    if (id !== undefined && !this.queue.some((entry) => entry.id === id))
      throw new Error('That instruction is no longer waiting.')
    this.queue = this.queue.map((entry) => (id === undefined || entry.id === id ? { ...entry, held: false } : entry))
    await this.host.changed()
  }

  async enqueue(instruction: QueuedChatInstruction): Promise<void> {
    if (this.delivered.includes(instruction.id)) return
    const existing = this.queue.find((entry) => entry.id === instruction.id)
    if (existing) {
      if (existing.message !== instruction.message) throw new Error('That instruction id is already in use.')
      return
    }
    if (this.queue.length >= 10) throw new Error('Ten instructions are already waiting. Let Sky handle them first.')
    this.queue.push(instruction)
    if (this.plan) this.plan = { ...this.plan, revision: this.plan.revision + 1 }
    await this.host.changed()
  }

  async removeInstruction(id: string): Promise<void> {
    this.queue = this.queue.filter((entry) => entry.id !== id)
    if (this.plan) this.plan = { ...this.plan, revision: this.plan.revision + 1 }
    await this.host.changed()
  }

  take(id: string): QueuedChatInstruction | undefined {
    const index = this.queue.findIndex((entry) => entry.id === id && !entry.held)
    if (index < 0) return
    const [next] = this.queue.splice(index, 1)
    if (next) {
      this.delivered = [...this.delivered.slice(-99), next.id]
      if (this.plan) this.plan = { ...this.plan, revision: this.plan.revision + 1 }
    }
    return next
  }

  async wait(message: string, kind: 'browser' | 'question', signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    if (!this.plan) throw new Error('Create a plan before asking for a handoff.')
    if (kind === 'browser' && this.plan.status === 'paused')
      throw new Error(
        'The browser task has stopped; there is no active browser handoff. Keep the failure visible and ask the person to Resume the plan for a fresh attempt. Use a question if you need to ask when they are ready.',
      )
    if (this.waiting) throw new Error('Another handoff is already waiting.')
    // A nonce identifies this ephemeral handoff; it is never a content filename or an authorization grant.
    const id = crypto.randomUUID()
    const answer = new Promise<boolean>((resolve) => {
      this.waiting = { id, resolve }
    })
    const aborted = () => this.waiting?.id === id && this.waiting.resolve(false)
    signal?.addEventListener('abort', aborted, { once: true })
    try {
      this.plan = {
        ...this.plan,
        status: 'needs-you',
        attention: { id, kind, message },
        revision: this.plan.revision + 1,
      }
      await this.host.changed()
      const continued = await answer
      this.waiting = undefined
      if (this.plan.status !== 'paused') {
        this.plan = {
          ...this.plan,
          status: continued ? 'working' : 'paused',
          attention: null,
          revision: this.plan.revision + 1,
        }
        await this.host.changed()
      }
      return continued
    } finally {
      signal?.removeEventListener('abort', aborted)
      this.waiting = undefined
    }
  }

  answer(id: string): void {
    if (!this.waiting || this.waiting.id !== id) throw new Error('This request is no longer waiting. Refresh the plan.')
    this.waiting.resolve(true)
  }

  async nativeSignIn<T>(run: () => Promise<T>): Promise<T> {
    if (!this.plan || this.plan.status === 'paused') throw new Error('The browser task is paused.')
    if (this.plan.attention) throw new Error('Finish the current browser handoff first.')
    const id = crypto.randomUUID()
    this.plan = {
      ...this.plan,
      status: 'needs-you',
      revision: this.plan.revision + 1,
      attention: {
        id,
        kind: 'browser',
        native: true,
        message:
          'Sky is signing in with 1Password. If prompted, choose Allow this run in the “Sky · 1Password for this run” dialog on the Mac running Sky. Unlock or approve 1Password there if it asks. Matching logins are then used automatically across this run.',
      },
    }
    await this.host.changed()
    try {
      return await run()
    } finally {
      if (this.plan.attention?.id === id) {
        this.plan = { ...this.plan, status: 'working', attention: null, revision: this.plan.revision + 1 }
        await this.host.changed()
      }
    }
  }

  tools(beforeUpdate?: (status: string) => Promise<string | undefined>) {
    return {
      read_plan: tool({
        description: 'Read this chat’s live checklist and the recorded tool results available as evidence.',
        inputSchema: z.object({}),
        execute: async () => this.view(),
      }),
      update_plan: tool({
        description:
          'Create or revise the live plan for a delegated multistep outcome. Use stable step ids, actual tool call ids as evidence, and exact artifact locations. To record requested edits or moved files while work stays paused, keep status paused. This does not authorize any action. Read the latest revision before changing it.',
        inputSchema: updateSchema,
        execute: async (input, options) => {
          try {
            const refusal = await beforeUpdate?.(input.status)
            options.abortSignal?.throwIfAborted()
            if (refusal) return { success: false, error: refusal, ...this.view() }
            return { success: true, plan: await this.update(input, !!beforeUpdate && input.status !== 'draft') }
          } catch (error) {
            return { success: false, error: (error as Error).message, ...this.view() }
          }
        },
      }),
      wait_for_person: tool({
        description:
          'Show a Needs you request in the live plan and wait. Use browser only for a live browser handoff. After a browser task stops or its approval expires, preserve the pause and ask the person to Resume; use question for readiness questions. Never ask for secrets or codes in chat. Acknowledgment means check again, not approval to send or submit.',
        inputSchema: z.object({ message: text, kind: z.enum(['browser', 'question']) }),
        execute: async (
          { message, kind }: { message: string; kind: 'browser' | 'question' },
          options?: { abortSignal?: AbortSignal },
        ) => ({ continued: await this.wait(message, kind, options?.abortSignal) }),
      }),
    }
  }

  view() {
    return {
      plan: this.plan,
      queued: this.queue,
      evidence: this.host
        .runs()
        .filter(
          (run) => run.callId && succeeded(run) && !['update_plan', 'read_plan', 'wait_for_person'].includes(run.tool),
        )
        .slice(-50)
        .map((run) => ({
          callId: run.callId,
          tool: run.tool,
          summary: run.summary ?? run.subject,
          locations: locations(run.output),
        })),
    }
  }
}

export const PLAN_INSTRUCTIONS = `Live plans in chat:
Use a live plan when the user delegates execution with several independently meaningful outcomes to track, such as collecting tax documents, checking the set, and uploading it. Base this on the user's requested outcome, never on the number of tool calls you anticipate. Questions, opinions, research, email/thread analysis, reading files, checking whether you have all the context, and drafting a response in chat stay ordinary chat even when several searches or reads are needed. Do not manufacture a checklist of find/read/analyze/answer. One small action, including a browser action, does not need a plan. An explicit planning request may create a draft with pending steps; a draft is not permission to execute. Existing paused work stays paused during questions or discussion; resume only when the person asks to continue that work.
Use 3–7 outcome-oriented steps, optional per-source items, and a final verification step. Keep stable ids and update after meaningful results, not every browser click. Working means work is actually running; incomplete, blocked, and skipped are distinct from done. Skip only when the user chooses to or a source is verified not applicable; unavailable documents remain blocked. Reasoning steps can cite their result in detail; action steps require real successful tool call ids from read_plan. Keep existing completed results when adjusting the remaining work. Never infer success from an attempted call or a progress line. Only link files and destinations actually returned by tools. Check the folder and destination receipts before marking an upload task complete; downloads alone do not prove upload. Explicitly explain missing documents or unsupported actions.
The current plan is recovery state. On resume, inspect the last action and destination before retrying any upload, send, or submission. Pause stops the running turn, not an action already committed externally. Use wait_for_person for a browser handoff. The user may send instructions while working; finish the current tool, then yield to the queued instruction. A question or Jev suggestion grants no permission for external actions. Continue authorized work without redundant permission requests.`
