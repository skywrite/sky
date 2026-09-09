import { z } from 'zod'

export const MAX_WRITING_CHARS = 40_000
export const ExampleId = z.string().regex(/^[a-f0-9]{32}$/)
const Text = z.string().trim().min(1)

export const QuestionSchema = z.object({
  before: z.string().max(500),
  after: z.string().max(500),
  question: Text.max(600),
  options: z.tuple([Text.max(300), Text.max(300)]),
})

export const LessonSchema = z.object({
  scope: Text.max(300),
  text: Text.max(1600),
})

export const ExampleInputSchema = z.object({
  source: Text.max(500),
  medium: Text.max(80),
  recipient: z.string().max(300).default(''),
  context: z.string().max(8000).default(''),
  instruction: z.string().max(4000).default(''),
  original: z.string().min(1).max(MAX_WRITING_CHARS),
  revised: z.string().min(1).max(MAX_WRITING_CHARS),
})

export const ExampleSchema = ExampleInputSchema.extend({
  id: ExampleId,
  created: Text,
  updated: Text,
  question: QuestionSchema.optional(),
  answer: Text.max(4000).optional(),
  lesson: LessonSchema.optional(),
  error: z.string().optional(),
})

export const DraftInputSchema = z.object({
  meaning: Text.max(MAX_WRITING_CHARS),
  medium: Text.max(80).default('Message'),
  recipient: z.string().max(300).default(''),
  context: z.string().max(40_000).default(''),
  instruction: z.string().max(4000).default(''),
})

export const CompactionSchema = z.object({
  lessons: z.array(LessonSchema.extend({ examples: z.array(ExampleId).min(1) })).max(24),
  covered: z.array(z.object({ examples: z.array(ExampleId).min(1), quote: Text.max(2000) })).max(24),
})

export type VoiceQuestion = z.infer<typeof QuestionSchema>
export type VoiceLesson = z.infer<typeof LessonSchema>
export type VoiceExampleInput = z.input<typeof ExampleInputSchema>
export type VoiceExample = z.infer<typeof ExampleSchema>
export type VoiceExampleRecord = VoiceExample & { revision: string }
export type VoiceDraftInput = z.input<typeof DraftInputSchema>
export type VoiceDraft = { draft: string; rulesRevision: string }
export type VoiceWriter = (input: VoiceDraftInput) => Promise<VoiceDraft>
export type VoiceCompaction = z.infer<typeof CompactionSchema>
export type VoiceRules = { text: string; revision: string; compacted: string[] }

export class WritingVoiceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 503 = 400,
  ) {
    super(message)
    this.name = 'WritingVoiceError'
  }
}
