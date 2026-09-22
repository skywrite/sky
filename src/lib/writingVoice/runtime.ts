import * as path from 'node:path'
import { createOutboxDraftGuard } from '#lib/outbox/draftContext.ts'
import { hash } from '#lib/outbox/files.ts'
import type { SavedMessagesConfig } from '#lib/outbox/sources.ts'
import { outboxStateDir } from '#lib/outbox/storage.ts'
import { WritingVoice } from './agent.ts'
import { WritingDraftStore } from './drafts.ts'
import { WritingVoiceStore } from './store.ts'

const voiceOf = (config: { DIR_BASE: string; DIR_STATE: string }): WritingVoice =>
  new WritingVoice(
    new WritingVoiceStore(
      config.DIR_BASE,
      path.join(config.DIR_STATE, 'writing-voice', hash(config.DIR_BASE).slice(0, 16)),
      undefined,
      outboxStateDir(config),
    ),
  )

/** The notebook's drafts without the Outbox guard, for places that learn from edits but never revise an Outbox reply. */
export function createWritingLessons(config: { DIR_BASE: string; DIR_STATE: string }): WritingDraftStore {
  return new WritingDraftStore(voiceOf(config))
}

/** A writer for callers that only draft. Its lessons still come from the notebook's drafts. */
export function createWritingVoice(config: { DIR_BASE: string; DIR_STATE: string }): WritingVoice {
  return createWritingLessons(config).voice
}

export function createWritingDrafts(config: SavedMessagesConfig & { DIR_STATE: string }): WritingDraftStore {
  return new WritingDraftStore(voiceOf(config), undefined, undefined, createOutboxDraftGuard(config))
}
