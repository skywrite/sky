import { CredentialError } from './errors.ts'
import { onePasswordRequest } from './onePasswordRequest.ts'
import { KeychainCredentialProvider } from './providers/KeychainCredentialProvider.ts'
import { OnePasswordCredentialProvider } from './providers/OnePasswordCredentialProvider.ts'
import type { OnePasswordProviderOptions } from './providers/OnePasswordCredentialProvider.ts'
import { nonempty } from './validation.ts'

/** Explicit opt-in: importing credentials never connects, unlocks, or reads a vault. */
export async function connectOnePassword(options: OnePasswordProviderOptions & { account: string }) {
  if (!nonempty(options.id) || !nonempty(options.account)) throw new CredentialError('invalid-input')
  const sdk = await import('@1password/sdk')
  try {
    const client = await onePasswordRequest(() =>
      sdk.createClient({
        auth: new sdk.DesktopAuth(options.account),
        integrationName: 'Sky',
        integrationVersion: '1',
      }),
    )
    return new OnePasswordCredentialProvider(client, options)
  } catch (error) {
    if (error instanceof sdk.AuthExpiredError || error instanceof sdk.DesktopSessionExpiredError)
      throw new CredentialError('access-required')
    throw new CredentialError('unavailable')
  }
}

export async function connectKeychain(options: { id?: string; label?: string } = {}) {
  if (options.id !== undefined && !nonempty(options.id)) throw new CredentialError('invalid-input')
  const [{ KeychainSecretsProvider }, { DIR_STATE }, path] = await Promise.all([
    import('#lib/secrets/KeychainSecretsProvider.ts'),
    import('#config'),
    import('node:path'),
  ])
  return new KeychainCredentialProvider(
    options.id ?? 'keychain',
    new KeychainSecretsProvider(),
    path.join(DIR_STATE, 'credentials', 'keychain.lock'),
    options.label,
  )
}
