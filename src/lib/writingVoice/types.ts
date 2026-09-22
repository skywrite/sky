import { z } from 'zod'

export const MAX_WRITING_CHARS = 40_000
/** One edit of one draft: `<draft id>:<version>`. Everything Sky learns belongs to a draft's version. */
export const EditId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}:[1-9][0-9]{0,3}$/)
const Text = z.string().trim().min(1)

export const QuestionSchema = z.object({
  before: z.string().max(500),
  after: z.string().max(500),
  question: Text.max(600),
  options: z.array(Text.max(300)).length(2),
})

export const LessonSchema = z.object({
  scope: Text.max(300),
  text: Text.max(1600),
})

/** Words and the owner's change to them, from a place that kept no draft: the settings page, a terminal chat. */
export const EditInputSchema = z.object({
  source: Text.max(500),
  medium: Text.max(80),
  recipient: z.string().max(300).default(''),
  context: z.string().max(8000).default(''),
  instruction: z.string().max(4000).default(''),
  original: z.string().min(1).max(MAX_WRITING_CHARS),
  revised: z.string().min(1).max(MAX_WRITING_CHARS),
})

/**
 * One edit as the learning steps and the pages see it: the version before, the owner's version,
 * and the conversation about why. It is read from a draft's versions, never stored on its own.
 */
export const EditSchema = EditInputSchema.extend({
  id: EditId,
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
  lessons: z.array(LessonSchema.extend({ examples: z.array(EditId).min(1) })).max(24),
  covered: z.array(z.object({ examples: z.array(EditId).min(1), quote: Text.max(2000) })).max(24),
})

export type VoiceQuestion = z.infer<typeof QuestionSchema>
export type VoiceLesson = z.infer<typeof LessonSchema>
export type VoiceEditInput = z.input<typeof EditInputSchema>
export type VoiceEdit = z.infer<typeof EditSchema>
/** `revision` names the edit's learning state, so an answer to a question that has since changed is refused. */
export type VoiceEditRecord = VoiceEdit & { revision: string }
export type VoiceDraftInput = z.input<typeof DraftInputSchema>
export type VoiceDraft = { draft: string; rulesRevision: string }
export type VoiceWriter = (input: VoiceDraftInput) => Promise<VoiceDraft>
export type VoiceCompaction = z.infer<typeof CompactionSchema>
/** `folding`: edits whose lessons the rules now hold, until their drafts are marked. */
export type VoiceRules = { text: string; revision: string; folding: string[] }

export class WritingVoiceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 503 = 400,
  ) {
    super(message)
    this.name = 'WritingVoiceError'
  }
}
