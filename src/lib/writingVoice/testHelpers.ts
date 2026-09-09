import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { OutboxRecord } from '#lib/outbox/types.ts'
import { WritingVoice } from './agent.ts'
import type { VoiceIntelligence } from './intelligence.ts'
import { WritingVoiceStore } from './store.ts'
import type { VoiceExampleInput } from './types.ts'

export const SAMPLE: VoiceExampleInput = {
  source: 'chat:sample',
  medium: 'Email',
  recipient: 'Jane Doe',
  context: 'A short project update.',
  original: 'I wanted to let you know that the draft is ready.',
  revised: 'The draft is ready.',
}

export function sampleOutboxItem(): OutboxRecord {
  return {
    id: 'a'.repeat(32),
    revision: 'r1',
    created: '2025-03-15',
    updated: '2025-03-15',
    status: 'needs_review',
    conversation: { key: 'sample', version: 'v1', medium: 'Email', sources: [], target: null, limitations: [] },
    title: 'Project update',
    situation: 'A short project update.',
    reasoning: 'The draft is ready.',
    questions: [],
    originalDraft: SAMPLE.original,
    draft: SAMPLE.original,
    edited: false,
    stale: false,
    reviews: [],
    native: null,
    placementError: null,
  }
}

export const intelligence: VoiceIntelligence = {
  draft: async (input) => input.meaning,
  question: async () => ({
    before: 'I wanted to let you know that the draft is ready.',
    after: 'The draft is ready.',
    question: 'Why did you remove the introductory phrase?',
    options: ['I prefer stating the point directly in emails.', 'This recipient already knows the context.'],
  }),
  learn: async (example) => ({ scope: example.medium, text: example.answer! }),
  compact: async (_rules, examples) => ({
    lessons: examples.map((example) => ({ ...example.lesson!, examples: [example.id] })),
    covered: [],
  }),
}

export async function voiceFixture(overrides: Partial<VoiceIntelligence> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-writing-voice-'))
  let tick = 0
  const store = new WritingVoiceStore(
    root,
    path.join(root, 'state'),
    () => `2025-03-15 12:00:${String(tick++).padStart(2, '0')}`,
  )
  const voice = new WritingVoice(store, { ...intelligence, ...overrides })
  return {
    root,
    store,
    voice,
    dispose: async () => {
      await voice.idle()
      await rm(root, { recursive: true, force: true })
    },
  }
}

export async function failure(work: Promise<unknown>): Promise<string> {
  try {
    await work
    return 'unexpected success'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
