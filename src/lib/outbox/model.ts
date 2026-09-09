import { aiModelByProfile, getProfile } from '#shared/ai/models.ts'

export const OUTBOX_MODEL_PROFILE = 'default-fable-5.1-high'
export const OUTBOX_MODEL_LABEL = 'Fable 5.1 · High'
export const OUTBOX_MODEL_TIMEOUT_MS = 120_000

export const outboxModel = () => aiModelByProfile(OUTBOX_MODEL_PROFILE)
export const outboxModelId = () => getProfile(OUTBOX_MODEL_PROFILE).model
