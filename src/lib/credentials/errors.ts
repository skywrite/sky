export type CredentialErrorCode =
  | 'access-required'
  | 'not-found'
  | 'unsupported'
  | 'conflict'
  | 'unavailable'
  | 'invalid-input'
  | 'excluded'
  | 'app-required'
  | 'integration-required'
  | 'helper-unavailable'
  | 'no-accounts'
  | 'native-browser-required'
  | 'apple-passwords-unavailable'

const messages: Record<CredentialErrorCode, string> = {
  'access-required': 'The credential provider needs you to restore access.',
  'not-found': 'The credential item or field was not found.',
  unsupported: 'This operation is not supported by the credential provider.',
  conflict: 'The credential changed. Inspect it again before making changes.',
  unavailable: 'The credential provider could not complete the request.',
  'invalid-input': 'The credential request is invalid.',
  excluded: 'This vault is excluded from this connection.',
  'app-required': 'Open and sign in to the 1Password desktop app, then try connecting again.',
  'integration-required':
    'Allow local connections in 1Password: Settings → Developer → Integrate with 1Password CLI and Integrate with 1Password SDKs. Sky will find your accounts automatically.',
  'helper-unavailable': 'Sky could not prepare the 1Password connection helper. Try connecting again.',
  'no-accounts': 'Sign in to an account in the 1Password desktop app, then try connecting again.',
  'native-browser-required':
    'Native Mac passkeys need a signed browser with Apple’s permission. Install Brave in Applications, then try again. Sky uses a separate, temporary profile.',
  'apple-passwords-unavailable':
    'Sky could not prepare Apple Passwords. Update macOS and try again. Apple may ask you to verify the connection in the browser.',
}

/** Never carry a native error or cause: providers can echo submitted secret values. */
export class CredentialError extends Error {
  constructor(readonly code: CredentialErrorCode) {
    super(messages[code])
    this.name = 'CredentialError'
  }

  toJSON() {
    return { code: this.code, message: this.message }
  }
}

export function credentialError(error: unknown): CredentialError {
  return error instanceof CredentialError ? error : new CredentialError('unavailable')
}

export async function credentialCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw credentialError(error)
  }
}
