import type { SavedPasswordManager } from '#lib/credentials/passwordManagers.ts'
export type { SavedPasswordManager, PasswordManagerSettings } from '#lib/credentials/passwordManagers.ts'

export interface PasswordManagerView extends SavedPasswordManager {
  provider: '1password'
}

export interface BrowserAutomationData {
  passwordManagers: PasswordManagerView[]
  /** Describes availability; it never authorizes a credential read. */
  signIn: 'manual' | 'approval'
}
