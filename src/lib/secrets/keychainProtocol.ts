export type KeychainOperation = 'get' | 'set' | 'delete'
export type KeychainFailure = 'access' | 'timeout' | 'busy' | 'unavailable'

export interface KeychainEntryRequest {
  operation: KeychainOperation
  service: string
  account: string
  value?: string
  interactive?: boolean
  stateDir: string
}

export type KeychainRequest = KeychainEntryRequest | { operation: 'restore'; interactive: true; stateDir: string }

export type KeychainReply =
  | { ok: true; value: string | null }
  | { ok: false; kind: KeychainFailure; status?: number; retryAfterMs?: number }

// A cold, successful macOS read can spend about twenty seconds in securityd.
export const KEYCHAIN_TIMEOUT_MS = 30_000
export const KEYCHAIN_INTERACTIVE_TIMEOUT_MS = 120_000

export class KeychainAccessError extends Error {
  readonly kind: KeychainFailure
  readonly status?: number
  readonly retryAfterMs: number

  constructor(kind: KeychainFailure, status?: number, retryAfterMs = 0) {
    super(
      kind === 'access'
        ? 'Keychain access needs your attention. Open Settings → Connections and choose Restore access.'
        : kind === 'busy'
          ? 'Another Keychain request is in progress. Waiting for it to finish.'
          : kind === 'timeout'
            ? 'Keychain did not respond. Sky has paused these requests; retry in Settings → Connections.'
            : 'Keychain is temporarily unavailable. Sky will retry after a cooldown.',
    )
    this.name = 'KeychainAccessError'
    this.kind = kind
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}
