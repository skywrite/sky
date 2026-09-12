import * as path from 'node:path'
import type * as Config from '#config'
import { createWritingDrafts } from '#lib/writingVoice/runtime.ts'
import type { VoiceWriter } from '#lib/writingVoice/types.ts'
import { hash } from './files.ts'
import { createSavedMessages, type SavedMessages } from './sources.ts'
import { OutboxStore } from './store.ts'

export function createOutboxRuntime(config: typeof Config): {
  store: OutboxStore
  sources: SavedMessages
  writeVoice: VoiceWriter
} {
  const drafts = createWritingDrafts(config)
  const voice = drafts.voice
  return {
    writeVoice: (input) => voice.draft(input),
    store: new OutboxStore(
      path.join(config.DIR_BASE, 'outbox'),
      path.join(config.DIR_STATE, 'outbox', hash(config.DIR_BASE).slice(0, 16)),
      voice.store,
      drafts,
    ),
    sources: createSavedMessages(config),
  }
}
