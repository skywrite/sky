import type { ItemRef } from './types.ts'

/** A passkey handle is optional: some authenticators only offer a browser/native picker. */
export interface PasskeyReference {
  authenticatorId: string
  item?: ItemRef
  credentialId?: string
  relyingPartyId: string
}

export type PasskeyResult<T> =
  | { status: 'completed'; credential: T }
  | { status: 'needs-user'; reason: 'unlock' | 'verification' | 'choose-account'; message: string }
  | { status: 'cancelled' }
  | { status: 'unsupported' }

/**
 * Separate from vault CRUD. No storage adapter claims to implement this interface.
 * The host must bind the request to a real site/session; a free-standing challenge
 * or an item's presence in a vault does not grant authentication capability.
 */
export interface PasskeyAuthenticator {
  readonly id: string
  register(
    request: { origin: string; sessionId: string; options: PublicKeyCredentialCreationOptionsJSON },
    signal?: AbortSignal,
  ): Promise<PasskeyResult<RegistrationResponseJSON>>
  authenticate(
    request: {
      origin: string
      sessionId: string
      options: PublicKeyCredentialRequestOptionsJSON
      credential?: PasskeyReference
    },
    signal?: AbortSignal,
  ): Promise<PasskeyResult<AuthenticationResponseJSON>>
}
