import { z } from 'zod'
import { EFFORTS, type EffortOverride } from '#universal/ai/effort.ts'
import { Flag, type ParamDef } from './params.ts'

/** Omitted or default inherits the preset. Helpers keep their own preset defaults. */
export function aiEffortFlag(): ParamDef<EffortOverride> & { optional: true } {
  return Flag.string('Effort for this run: default, low, medium, high, xhigh, max (only supported levels)', {
    long: 'ai-effort',
    schema: z.enum(['default', ...EFFORTS]),
  }) as ParamDef<EffortOverride> & { optional: true }
}
