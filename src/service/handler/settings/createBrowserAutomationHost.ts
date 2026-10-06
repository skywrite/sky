import { access } from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_STATE } from '#config'
import { ExistingBrowserSettingsStore } from '#lib/browser/existing/settings.ts'
import { prepareAppleExtension } from '#lib/browser/signIn/applePasswords.ts'
import { nativeBrowserAvailable } from '#lib/browser/signIn/nativeBrowser.ts'
import { connectOnePassword } from '#lib/credentials/connect.ts'
import { CredentialError } from '#lib/credentials/errors.ts'
import { discoverOnePasswordAccounts } from '#lib/credentials/onePasswordDesktop.ts'
import { runCommand } from '#lib/sys/mod.ts'
import { BrowserAutomationHost } from './browserAutomation/host.ts'

export function createBrowserAutomationHost(): BrowserAutomationHost {
  return new BrowserAutomationHost({
    existingBrowser: new ExistingBrowserSettingsStore(),
    // Preserve the existing account identities and exclusions without migrating stored credentials.
    settingsFile: path.join(DIR_STATE, 'credentials', 'sources.json'),
    discover: () => discoverOnePasswordAccounts({ helperDir: path.join(DIR_STATE, 'credentials', 'helpers') }),
    inspectAccount: async (source) => {
      const provider = await connectOnePassword({ id: source.id, account: source.account, label: source.label })
      return provider.listAllContainers()
    },
    openOnePasswordSettings: async () => {
      const result = await runCommand('open', ['onepassword://settings/developer'])
      if (!result.success) throw new CredentialError('unavailable')
    },
    prepareNativeBrowser: async (applePasswords) => {
      if (!(await nativeBrowserAvailable())) throw new CredentialError('native-browser-required')
      if (applePasswords) {
        try {
          await access('/Library/Google/Chrome/NativeMessagingHosts/com.apple.passwordmanager.json')
          await prepareAppleExtension(path.join(DIR_STATE, 'credentials', 'helpers'))
        } catch {
          throw new CredentialError('apple-passwords-unavailable')
        }
      }
    },
    openAutofillSettings: async () => {
      if (process.platform !== 'darwin') throw new CredentialError('unsupported')
      const result = await runCommand('/usr/bin/open', [
        'x-apple.systempreferences:com.apple.Passwords-Settings.extension',
      ])
      if (!result.success) throw new CredentialError('unavailable')
    },
  })
}
