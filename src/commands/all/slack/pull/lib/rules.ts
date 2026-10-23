import { atomicWrite, readOptional } from '#lib/outbox/files.ts'
import { parse, stringify } from '#shared/yaml/mod.ts'

/**
 * The person's choices about the pull, kept in their own file because the
 * pull rewrites the roster from memory while it runs and would lose a change
 * made to it meanwhile. For now: the channels switched off.
 */
export type SlackRules = { muted: string[] }

export function parseRules(contents: string | undefined): SlackRules {
  if (!contents?.trim()) return { muted: [] }
  const data = parse(contents) as { muted?: unknown } | null
  const muted = Array.isArray(data?.muted)
    ? data.muted.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
  return { muted: [...new Set(muted)] }
}

export function serializeRules(rules: SlackRules): string {
  return stringify({ muted: [...new Set(rules.muted)].sort() })
}

export async function readRules(file: string): Promise<SlackRules> {
  return parseRules(await readOptional(file))
}

export async function writeRules(file: string, rules: SlackRules): Promise<void> {
  await atomicWrite(file, serializeRules(rules))
}

/** The rules with one channel muted, or not. */
export function withMuted(rules: SlackRules, id: string, muted: boolean): SlackRules {
  const rest = rules.muted.filter((other) => other !== id)
  return { muted: muted ? [...rest, id] : rest }
}
