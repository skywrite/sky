/**
 * What a chat may run without asking. Two tiers: the files its person
 * pasted into this process, and the notebook-wide file grants ledger every
 * chat on every host shares. A go on a file-scoped call and a file a tool
 * created both go to the ledger; a paste is permission for now, not a
 * standing grant, so a mention lasts only as long as the process. A grant
 * the ledger could not take is held here so this process still honours it.
 */

import type { FileGrantDetails, FileGrantInput, FileGrants } from '#commands/lib/chat/fileGrants.ts'
import { resolveFileRef } from '#lib/google/mod.ts'

export class SessionBlessings {
  private readonly mentioned = new Set<string>()
  /** Grants the ledger refused — the go still stands for this process. */
  private readonly held = new Set<string>()

  constructor(private readonly grants?: FileGrants) {}

  async has(fileId: string): Promise<boolean> {
    if (this.mentioned.has(fileId) || this.held.has(fileId)) return true
    // The gate never breaks a turn: a ledger that cannot be read asks.
    return (await this.grants?.has(fileId).catch(() => false)) ?? false
  }

  /**
   * A standing go for a file, from this chat for every chat. When the
   * ledger cannot take it the grant is held for this process and the error
   * is rethrown, so the host can say so.
   */
  async grant(fileId: string, input: FileGrantInput): Promise<void> {
    if (!this.grants) {
      this.held.add(fileId)
      return
    }
    try {
      await this.grants.grant(fileId, input)
    } catch (error) {
      this.held.add(fileId)
      throw error
    }
  }

  /** What a tool reported about a file already granted; nothing is granted here. */
  async describe(fileId: string, details: FileGrantDetails): Promise<void> {
    await this.grants?.describe(fileId, details)
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
