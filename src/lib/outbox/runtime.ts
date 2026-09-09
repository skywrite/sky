import * as path from 'node:path'
import type * as Config from '#config'
import { createWritingVoice } from '#lib/writingVoice/runtime.ts'
import type { VoiceWriter } from '#lib/writingVoice/types.ts'
import { hash } from './files.ts'
import { SavedMessages } from './sources.ts'
import { OutboxStore } from './store.ts'

export function createOutboxRuntime(config: typeof Config): {
  store: OutboxStore
  sources: SavedMessages
  writeVoice: VoiceWriter
} {
  const voice = createWritingVoice(config)
  return {
    writeVoice: (input) => voice.draft(input),
    store: new OutboxStore(
      path.join(config.DIR_BASE, 'outbox'),
      path.join(config.DIR_STATE, 'outbox', hash(config.DIR_BASE).slice(0, 16)),
      voice.store,
    ),
    sources: new SavedMessages(config.DIR_BASE, {
      Slack: [config.DIR_STATE_FOLLOW_SLACK_ACTIVE, config.DIR_STATE_FOLLOW_SLACK_ARCHIVE],
      Email: [config.DIR_STATE_FOLLOW_EMAIL_ACTIVE, config.DIR_STATE_FOLLOW_EMAIL_ARCHIVE],
    }),
  }
}
