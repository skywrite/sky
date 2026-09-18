import { z } from 'zod'

export const CaptureHorizonSchema = z.enum(['this-week', 'few-weeks', 'few-months', 'longer-term', 'unsure'])
export type CaptureHorizon = z.infer<typeof CaptureHorizonSchema>
export const CAPTURE_HORIZON_CHOICES: { value: CaptureHorizon; label: string }[] = [
  { value: 'this-week', label: 'This week' },
  { value: 'few-weeks', label: 'A few weeks' },
  { value: 'few-months', label: 'A few months' },
  { value: 'longer-term', label: 'Longer term' },
  { value: 'unsure', label: 'Not sure' },
]
export const CaptureFieldSchema = z.enum(['timing', 'outcome', 'situation'])
export const CaptureAnswerSchema = z.object({
  field: CaptureFieldSchema,
  question: z.string().trim().min(1).max(600),
  answer: z.string().trim().min(1).max(10000),
})
export const CaptureRequestSchema = z.object({
  intent: z.string().trim().min(1).max(20000),
  answers: z.array(CaptureAnswerSchema).max(3).default([]),
  horizon: CaptureHorizonSchema.optional(),
})
export const CaptureQuestionSchema = z.object({
  field: CaptureFieldSchema,
  prompt: z.string().trim().min(1).max(500),
  choices: z
    .array(z.object({ value: z.string().trim().min(1).max(300), label: z.string().trim().min(1).max(200) }))
    .max(5),
})
export const CaptureSourceSchema = z.object({
  id: z.string().min(1).max(160),
  path: z.string().min(1).max(2000),
  label: z.string().min(1).max(300),
})
export const CaptureResponseSchema = z.object({
  title: z.string().trim().min(1).max(160),
  outcome: z.string().trim().min(1).max(20000),
  suggestedOutcome: z.string().trim().min(1).max(500).nullable().optional(),
  understanding: z.string().trim().max(500),
  horizon: CaptureHorizonSchema.nullable(),
  horizonLabel: z.string().max(100),
  question: CaptureQuestionSchema.nullable(),
  sources: z.array(CaptureSourceSchema).max(20),
  contextLimited: z.boolean(),
})

export type CaptureAnswer = z.infer<typeof CaptureAnswerSchema>
export type CaptureRequest = z.infer<typeof CaptureRequestSchema>
export type CaptureResponse = z.infer<typeof CaptureResponseSchema>
export type CaptureQuestion = z.infer<typeof CaptureQuestionSchema>
export type CaptureSource = z.infer<typeof CaptureSourceSchema>
