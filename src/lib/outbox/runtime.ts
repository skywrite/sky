import * as path from 'node:path'
import type * as Config from '#config'
import { hash } from './files.ts'
import { SavedMessages } from './sources.ts'
import { OutboxStore } from './store.ts'

export function createOutboxRuntime(config: typeof Config): { store: OutboxStore; sources: SavedMessages } {
  return {
    store: new OutboxStore(
      path.join(config.DIR_BASE, 'outbox'),
      path.join(config.DIR_STATE, 'outbox', hash(config.DIR_BASE).slice(0, 16)),
    ),
    sources: new SavedMessages(config.DIR_BASE, {
      Slack: [config.DIR_STATE_FOLLOW_SLACK_ACTIVE, config.DIR_STATE_FOLLOW_SLACK_ARCHIVE],
      Email: [config.DIR_STATE_FOLLOW_EMAIL_ACTIVE, config.DIR_STATE_FOLLOW_EMAIL_ARCHIVE],
    }),
  }
}
