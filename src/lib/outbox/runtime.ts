import type * as Config from '#config'
import { createWritingDrafts } from '#lib/writingVoice/runtime.ts'
import type { VoiceWriter } from '#lib/writingVoice/types.ts'
import { createSavedMessages, type SavedMessages } from './sources.ts'
import { createOutboxStorage } from './storage.ts'
import { OutboxStore } from './store.ts'

export function createOutboxRuntime(config: typeof Config): {
  store: OutboxStore
  sources: SavedMessages
  writeVoice: VoiceWriter
} {
  const drafts = createWritingDrafts(config)
  const voice = drafts.voice
  const storage = createOutboxStorage(config)
  return {
    writeVoice: (input) => voice.draft(input),
    store: new OutboxStore(storage.dir, storage.dir, voice.store, drafts, storage.initialize),
    sources: createSavedMessages(config),
  }
}
