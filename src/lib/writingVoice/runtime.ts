import * as path from 'node:path'
import { createOutboxDraftGuard } from '#lib/outbox/draftContext.ts'
import { hash } from '#lib/outbox/files.ts'
import type { SavedMessagesConfig } from '#lib/outbox/sources.ts'
import { outboxStateDir } from '#lib/outbox/storage.ts'
import { WritingVoice } from './agent.ts'
import { WritingDraftStore } from './drafts.ts'
import { WritingVoiceStore } from './store.ts'

export function createWritingVoice(config: { DIR_BASE: string; DIR_STATE: string }): WritingVoice {
  return new WritingVoice(
    new WritingVoiceStore(
      config.DIR_BASE,
      path.join(config.DIR_STATE, 'writing-voice', hash(config.DIR_BASE).slice(0, 16)),
      undefined,
      outboxStateDir(config),
    ),
  )
}

export function createWritingDrafts(config: SavedMessagesConfig & { DIR_STATE: string }): WritingDraftStore {
  return new WritingDraftStore(createWritingVoice(config), undefined, undefined, createOutboxDraftGuard(config))
}
