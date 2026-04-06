// ── Entity type codes (terse 2-char for wire format) ─────────────────

export const ENTITY_CODES = {
  login: 'lg',
  secret: 'sc',
} as const

export type EntityType = keyof typeof ENTITY_CODES
export type EntityCode = (typeof ENTITY_CODES)[EntityType]

export const CODE_TO_ENTITY: Record<EntityCode, EntityType> = {
  lg: 'login',
  sc: 'secret',
}

// ── Entry types (discriminated union on `type`) ──────────────────────

interface BaseEntry {
  schema: string
  created: string
  updated: string
  notes?: string
}

export interface LoginEntry extends BaseEntry {
  type: 'login'
  user: string
  pass: string
}

export interface SecretValueEntry extends BaseEntry {
  type: 'secret'
  val: string
}

export type SecretEntry = LoginEntry | SecretValueEntry

// ── Index entry (stored in index.yaml, no secret values) ─────────────

export interface IndexEntry {
  category: string
  name: string
  type: EntityType
}
