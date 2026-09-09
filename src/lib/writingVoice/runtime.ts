import * as path from 'node:path'
import { hash } from '#lib/outbox/files.ts'
import { WritingVoice } from './agent.ts'
import { WritingVoiceStore } from './store.ts'

export function createWritingVoice(config: { DIR_BASE: string; DIR_STATE: string }): WritingVoice {
  return new WritingVoice(
    new WritingVoiceStore(
      config.DIR_BASE,
      path.join(config.DIR_STATE, 'writing-voice', hash(config.DIR_BASE).slice(0, 16)),
    ),
  )
}
