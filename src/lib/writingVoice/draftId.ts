import { z } from 'zod'

// Existing hexadecimal IDs remain valid so saved chats keep their links.
export const WRITING_DRAFT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/
export const WritingDraftId = z.string().regex(WRITING_DRAFT_ID)
