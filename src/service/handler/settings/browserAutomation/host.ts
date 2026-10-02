import { CredentialError } from '#lib/credentials/errors.ts'
import type { OnePasswordAccount } from '#lib/credentials/onePasswordDesktop.ts'
import type { CredentialContainer } from '#lib/credentials/types.ts'
import { PasswordManagerSettingsStore } from './state.ts'
import type { BrowserAutomationData, SavedPasswordManager } from './types.ts'

export interface BrowserAutomationHostOptions {
  settingsFile: string
  discover: () => Promise<OnePasswordAccount[]>
  /** Explicit setup only. This interface cannot list items, read fields, or produce codes. */
  inspectAccount: (source: SavedPasswordManager) => Promise<CredentialContainer[]>
  openOnePasswordSettings: () => Promise<void>
  nativeSignInAvailable?: boolean
  prepareNativeBrowser?: (applePasswords: boolean) => Promise<void>
  openAutofillSettings?: () => Promise<void>
}

/** The settings host owns preferences, not permission to sign in or access a browser session. */
export class BrowserAutomationHost {
  readonly settings: PasswordManagerSettingsStore
  private readonly connecting = new Map<string, Promise<void>>()
  private readonly verified = new Set<string>()
  private discovering: Promise<void> | undefined

  constructor(private readonly options: BrowserAutomationHostOptions) {
    this.settings = new PasswordManagerSettingsStore(options.settingsFile)
  }

  async snapshot(): Promise<BrowserAutomationData> {
    const settings = await this.settings.read()
    // Reading Settings never contacts a provider, including an SDK that can renew authorization.
    return {
      passwordManagers: settings.sources.map((source) => ({ ...source, provider: '1password' })),
      ...(settings.nativeBrowser ? { nativeBrowser: settings.nativeBrowser } : {}),
      signIn:
        (settings.sources.length || settings.nativeBrowser) &&
        (this.options.nativeSignInAvailable ?? process.platform === 'darwin')
          ? 'approval'
          : 'manual',
    }
  }

  connect(): Promise<void> {
    if (this.discovering) return this.discovering
    this.discovering = (async () => {
      const accounts = await this.options.discover()
      if (!accounts.length) throw new CredentialError('no-accounts')
      for (const account of accounts) {
        // Separate accounts retain native approval; successful accounts survive a later refusal.
        if (!this.verified.has(`1password:${account.id}`)) await this.connectAccount(account.id, account.label)
      }
    })().finally(() => {
      this.discovering = undefined
    })
    return this.discovering
  }

  async refresh(id: string): Promise<void> {
    const source = (await this.settings.read()).sources.find((source) => source.id === id)
    if (!source) throw new CredentialError('not-found')
    await this.connectAccount(source.account, source.label)
  }

  private connectAccount(account: string, label: string): Promise<void> {
    const id = `1password:${account}`
    const running = this.connecting.get(id)
    if (running) return running
    const work = (async () => {
      const current = await this.settings.read()
      const source = current.sources.find((entry) => entry.id === id) ?? {
        id,
        account,
        label,
        excludedVaultIds: [],
        containers: [],
      }
      const containers = await this.options.inspectAccount(source)
      await this.settings.update((settings) => {
        const previous = settings.sources.find((entry) => entry.id === id)
        if (previous) previous.containers = containers
        else settings.sources.push({ ...source, containers })
      })
      this.verified.add(id)
    })().finally(() => {
      this.connecting.delete(id)
    })
    this.connecting.set(id, work)
    return work
  }

  async disconnect(id: string): Promise<void> {
    if (this.connecting.has(id)) throw new CredentialError('conflict')
    await this.settings.update((settings) => {
      if (!settings.sources.some((source) => source.id === id)) throw new CredentialError('not-found')
      settings.sources = settings.sources.filter((source) => source.id !== id)
      if (settings.destination?.connectionId === id) settings.destination = null
    })
    this.verified.delete(id)
  }

  async setVaults(id: string, excludedVaultIds: string[]): Promise<void> {
    await this.settings.update((settings) => {
      const source = settings.sources.find((source) => source.id === id)
      if (!source) throw new CredentialError('not-found')
      source.excludedVaultIds = [...new Set(excludedVaultIds)]
      if (settings.destination?.connectionId === id && excludedVaultIds.includes(settings.destination.containerId))
        settings.destination = null
    })
  }

  openSettings(): Promise<void> {
    return this.options.openOnePasswordSettings()
  }

  async setNativeBrowser(applePasswords: boolean): Promise<void> {
    if (!this.options.prepareNativeBrowser) throw new CredentialError('native-browser-required')
    await this.options.prepareNativeBrowser(applePasswords)
    await this.settings.update((settings) => {
      settings.nativeBrowser = { browser: 'brave', applePasswords }
    })
  }

  async useBundledBrowser(): Promise<void> {
    await this.settings.update((settings) => {
      delete settings.nativeBrowser
    })
  }

  async openAutofillSettings(): Promise<void> {
    if (!this.options.openAutofillSettings) throw new CredentialError('unsupported')
    await this.options.openAutofillSettings()
  }
}
import process from 'node:process'
