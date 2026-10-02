/**
 * The Google accounts block of the chat system prompt: which accounts are
 * connected, which side of the day each is on, and the organization its
 * email domain belongs to. The model reads it to choose the account for
 * something new and to say which account a tool used. A single connected
 * account needs no block — there is nothing to choose.
 */

import { accountCategory, accountOrg, listAccountEmails } from '#lib/google/mod.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { loadSkyConfig } from '#shared/config/loader.ts'
import OrgStore from '#shared/models/Store/OrgStore/mod.ts'

export interface GoogleAccountLine {
  email: string
  /** Professional on the Google settings page — the default there too */
  work: boolean
  /** The organization whose website shares the email's domain */
  org?: string
}

/** One line per account; nothing at all for fewer than two. */
export function renderGoogleAccountsBlock(accounts: GoogleAccountLine[]): string {
  if (accounts.length < 2) return ''
  return accounts
    .map(({ email, work, org }) => `- ${email} - ${work ? 'work' : 'personal'}${org ? ` (${org})` : ''}`)
    .join('\n')
}

/**
 * Read the connected accounts and describe them. Any failure — a keychain
 * that cannot be read, an orgs folder that is not there — leaves the block
 * out rather than failing the chat.
 */
export async function googleAccountsBlock(options: { secrets: SecretsProvider; orgsDir?: string }): Promise<string> {
  try {
    const emails = await listAccountEmails(options.secrets)
    if (emails.length < 2) return ''
    const orgs = options.orgsDir
      ? await OrgStore.build([options.orgsDir]).then(
          (store) =>
            store
              .getAll()
              .toArray()
              .map(({ doc }) => ({ name: doc.name, sites: doc.sites }))
              .filter((org) => org.name),
          () => [],
        )
      : []
    const config = loadSkyConfig()
    return renderGoogleAccountsBlock(
      emails.map((email) => ({
        email,
        work: accountCategory(email, config) === 'Professional',
        org: accountOrg(email, orgs),
      })),
    )
  } catch {
    return ''
  }
}
