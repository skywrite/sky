import { CODE_TO_ENTITY, ENTITY_CODES } from './types.ts'
import type { EntityCode, SecretEntry } from './types.ts'

const SCHEMA_VERSION = '1.0.0'
const SIZE_WARN_BYTES = 2048

// ── Wire format (terse keys, stored in keychain) ─────────────────────

interface WireBase {
  s: string
  e: string
  c: string
  u: string
  n?: string
}

interface WireLogin extends WireBase {
  user: string
  pass: string
}

interface WireSecret extends WireBase {
  val: string
}

type WireEntry = WireLogin | WireSecret

// ── Marshal / Unmarshal ──────────────────────────────────────────────

export function marshal(entry: SecretEntry): string {
  const wire: Record<string, unknown> = {
    s: entry.schema,
    e: ENTITY_CODES[entry.type],
    c: entry.created,
    u: entry.updated,
  }
  if (entry.notes) wire.n = entry.notes

  switch (entry.type) {
    case 'login':
      wire.user = entry.user
      wire.pass = entry.pass
      break
    case 'secret':
      wire.val = entry.val
      break
  }

  const json = JSON.stringify(wire)
  if (json.length > SIZE_WARN_BYTES) {
    console.warn(`[secrets] payload is ${json.length} bytes (soft limit: ${SIZE_WARN_BYTES})`)
  }
  return json
}

export function unmarshal(raw: string): SecretEntry {
  const wire = JSON.parse(raw) as WireEntry
  const entityType = CODE_TO_ENTITY[wire.e as EntityCode]
  if (!entityType) throw new Error(`Unknown entity code: ${wire.e}`)

  const base = {
    schema: wire.s,
    created: wire.c,
    updated: wire.u,
    ...(wire.n ? { notes: wire.n } : {}),
  }

  switch (entityType) {
    case 'login':
      return { ...base, type: 'login', user: (wire as WireLogin).user, pass: (wire as WireLogin).pass }
    case 'secret':
      return { ...base, type: 'secret', val: (wire as WireSecret).val }
  }
}

// ── Factories ────────────────────────────────────────────────────────

export function createLogin(payload: { user: string; pass: string }, notes?: string): SecretEntry {
  const now = new Date().toISOString()
  return {
    type: 'login',
    schema: SCHEMA_VERSION,
    created: now,
    updated: now,
    ...(notes ? { notes } : {}),
    user: payload.user,
    pass: payload.pass,
  }
}

export function createSecret(val: string, notes?: string): SecretEntry {
  const now = new Date().toISOString()
  return {
    type: 'secret',
    schema: SCHEMA_VERSION,
    created: now,
    updated: now,
    ...(notes ? { notes } : {}),
    val,
  }
}

export function updateEntry(existing: SecretEntry, changes: Record<string, unknown>): SecretEntry {
  return {
    ...existing,
    ...changes,
    type: existing.type,
    schema: existing.schema,
    created: existing.created,
    updated: new Date().toISOString(),
  } as SecretEntry
}
