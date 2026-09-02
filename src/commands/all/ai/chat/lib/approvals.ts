/**
 * Session approval blessings for gated chat tools: which (tool, key) pairs
 * may run without asking. Two tiers with different lifetimes — durable keys
 * (files this session created, explicit "always" answers) persist into the
 * transcript and survive --resume; mention keys (file refs the user pasted)
 * last only as long as the process, because a paste is permission for now,
 * not a standing grant.
 */

import { resolveFileRef } from '#lib/google/mod.ts'

export class SessionBlessings {
  private readonly durable = new Set<string>()
  private readonly mentioned = new Set<string>()

  has(toolName: string, key: string): boolean {
    return this.durable.has(`${toolName}:${key}`) || this.mentioned.has(key)
  }

  /** An explicit "always" answer, or a file this session created — scoped to the tool. */
  blessDurably(toolName: string, key: string): void {
    this.durable.add(`${toolName}:${key}`)
  }

  /**
   * A file reference the user pasted — the file itself is blessed, whichever
   * session-keyed tool targets it. Tool-agnostic on purpose: pastes land
   * before the turn's tool discovery has run, so there is no tool list to
   * scope against yet.
   */
  blessMention(fileId: string): void {
    this.mentioned.add(fileId)
  }

  /** What the transcript persists. */
  serializeDurable(): string[] {
    return [...this.durable].sort()
  }

  /** Seed from a resumed transcript's saved `tool:key` entries. */
  restoreDurable(entries: readonly string[]): void {
    for (const entry of entries) {
      if (entry.includes(':')) this.durable.add(entry)
    }
  }
}

const GOOGLE_URL_RE = /https:\/\/(?:docs|drive|sheets|slides)\.google\.com\/[^\s)\]>'"]+/g

/**
 * Google file ids referenced in a user's message: every Google URL, plus
 * standalone id-shaped tokens. A bare token must carry a digit — real
 * Drive ids virtually always do, and the guard keeps 20-char English
 * words ("internationalization") from blessing phantom files.
 */
export function harvestFileRefs(text: string): string[] {
  const ids = new Set<string>()
  for (const match of text.match(GOOGLE_URL_RE) ?? []) {
    const parsed = resolveFileRef(match.replace(/[.,;:!?]+$/, ''))
    if (parsed) ids.add(parsed.fileId)
  }
  for (const token of text.split(/\s+/)) {
    const bare = token.replace(/^[('"<[]+/, '').replace(/[)'">\],.;:!?]+$/, '')
    if (bare.length < 20 || !/\d/.test(bare) || bare.includes('/')) continue
    if (resolveFileRef(bare)?.fileId === bare) ids.add(bare)
  }
  return [...ids]
}
