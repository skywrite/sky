import * as path from 'node:path'
import { DIR_STATE } from '#config'
import { connectOnePassword } from '#lib/credentials/connect.ts'
import { CredentialError } from '#lib/credentials/errors.ts'
import { discoverOnePasswordAccounts } from '#lib/credentials/onePasswordDesktop.ts'
import { runCommand } from '#lib/sys/mod.ts'
import { BrowserAutomationHost } from './browserAutomation/host.ts'

export function createBrowserAutomationHost(): BrowserAutomationHost {
  return new BrowserAutomationHost({
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
  })
}
