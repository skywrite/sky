/**
 * A loop guard for tool loops. The same tool, the same input, the same
 * result is a call that taught the model nothing — the shape of a model
 * stuck retrying a failing tool or re-reading a file in a stall. Inputs
 * alone are not enough: a re-read after a write is normal and comes back
 * different, so a repeat counts only when the result matches too.
 *
 * The ladder: the second identical result carries a note, so the model
 * can change course itself; the third identical call is refused unrun,
 * with the reason in the model's own terms; after `stopAfterRefusals`
 * refusals the guard reports itself exhausted, and the loop that owns it
 * ends the turn. Results that carry a clock never look identical, so the
 * guard fails quiet, never loud.
 */

export interface RepetitionGuardOptions {
  /** Refusals in one turn before the guard asks the loop to stop. Default 3. */
  stopAfterRefusals?: number
  /** Called with the tool's name each time a call is refused — a progress line for the host. */
  onRefusal?: (tool: string) => void
}

export const REPEAT_NOTE = 'Identical to your earlier call with this exact input — nothing has changed since.'

export function refusalMessage(tool: string): string {
  return `Error: refused — this exact ${tool} call, with this exact input, already ran twice and returned the same result both times. Do not repeat it: change the input or the approach, or answer with what you have.`
}

/** The second identical result, annotated so the model notices. */
export type AnnotatedOutput<T> = T | string | { repeated: string; result: T } | (T & { repeated: string })

interface Seen {
  output: string
  repeats: number
}

/** JSON with keys in a fixed order, so two equal inputs spell the same. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
  return `{${entries.join(',')}}`
}

function annotate<T>(output: T): AnnotatedOutput<T> {
  if (typeof output === 'string') return `${output}\n\n(${REPEAT_NOTE})`
  if (output !== null && typeof output === 'object' && !Array.isArray(output)) {
    return { ...(output as object), repeated: REPEAT_NOTE } as T & { repeated: string }
  }
  return { repeated: REPEAT_NOTE, result: output }
}

export class RepetitionGuard {
  private readonly seen = new Map<string, Seen>()
  private readonly stopAfterRefusals: number
  private readonly onRefusal?: (tool: string) => void
  /** Calls refused this turn. */
  refusals = 0

  constructor(options: RepetitionGuardOptions = {}) {
    this.stopAfterRefusals = options.stopAfterRefusals ?? 3
    this.onRefusal = options.onRefusal
  }

  /** True once refusals reach the limit — the owning loop should end the turn. */
  get exhausted(): boolean {
    return this.refusals >= this.stopAfterRefusals
  }

  /** Before running a call: the refusal to return instead, or null to run it. */
  refusal(tool: string, input: unknown): string | null {
    const seen = this.seen.get(`${tool} ${canonical(input)}`)
    if (!seen || seen.repeats < 2) return null
    this.refusals++
    this.onRefusal?.(tool)
    return refusalMessage(tool)
  }

  /** After running a call: records the result; the second identical one comes back annotated. */
  record<T>(tool: string, input: unknown, output: T): AnnotatedOutput<T> {
    const key = `${tool} ${canonical(input)}`
    const spelled = canonical(output)
    const seen = this.seen.get(key)
    if (!seen || seen.output !== spelled) {
      this.seen.set(key, { output: spelled, repeats: 1 })
      return output
    }
    seen.repeats++
    return seen.repeats === 2 ? annotate(output) : output
  }
}

type Executable = { execute?: (...args: never[]) => unknown }

/**
 * The tool set with every execute behind the guard. The tools are copied,
 * never mutated — a host may hand the same set to every turn, and each
 * turn gets its own guard.
 */
export function guardTools<T extends Record<string, Executable>>(tools: T, guard: RepetitionGuard): T {
  const guarded: Record<string, Executable> = {}
  for (const [name, tool] of Object.entries(tools)) {
    const execute = tool.execute as ((...args: unknown[]) => unknown) | undefined
    if (!execute) {
      guarded[name] = tool
      continue
    }
    guarded[name] = {
      ...tool,
      execute: async (input: unknown, ...rest: unknown[]) => {
        const refusal = guard.refusal(name, input)
        if (refusal !== null) return refusal
        const output = await execute(input, ...rest)
        return guard.record(name, input, output)
      },
    }
  }
  return guarded as T
}
