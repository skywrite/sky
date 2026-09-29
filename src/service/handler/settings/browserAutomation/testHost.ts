import * as path from 'node:path'
import type { VaultOverview } from '@1password/sdk'
import { CredentialError } from '#lib/credentials/errors.ts'
import {
  OnePasswordCredentialProvider,
  type OnePasswordClient,
} from '#lib/credentials/providers/OnePasswordCredentialProvider.ts'
import { BrowserAutomationHost, type BrowserAutomationHostOptions } from './host.ts'

export const SAMPLE_ACCOUNT = 'Example account'
export const SAMPLE_ID = `1password:${SAMPLE_ACCOUNT}`
export const SAMPLE_PASSWORD = 'mock-password-for-atlas'

/** In-memory SDK only: no real account, native prompts, or Keychain reads. */
export function browserAutomationTestHost(dir: string) {
  const vaults = [
    { id: 'work', title: 'Work' },
    { id: 'personal', title: 'Personal' },
  ]
  const counts = { inspected: 0, discovered: 0, vaultLists: 0, itemLists: 0, read: 0, write: 0, opened: 0 }
  const state = { inspectionFailure: false }
  const forbidden = async (kind: 'itemLists' | 'read' | 'write'): Promise<never> => {
    counts[kind]++
    throw new Error(`Unexpected item access: ${SAMPLE_PASSWORD}`)
  }
  const client: OnePasswordClient = {
    vaults: {
      list: async () => {
        counts.vaultLists++
        return vaults.map((vault) => ({ ...vault }) as VaultOverview)
      },
    },
    items: {
      list: () => forbidden('itemLists'),
      get: () => forbidden('read'),
      create: () => forbidden('write'),
      put: () => forbidden('write'),
      delete: () => forbidden('write'),
    },
  }
  const options: BrowserAutomationHostOptions = {
    nativeSignInAvailable: true,
    settingsFile: path.join(dir, 'sources.json'),
    discover: async () => {
      counts.discovered++
      return [{ id: SAMPLE_ACCOUNT, label: SAMPLE_ACCOUNT }]
    },
    inspectAccount: async (source) => {
      counts.inspected++
      if (state.inspectionFailure) throw new Error(`mock-provider-error-with-secret: ${SAMPLE_PASSWORD}`)
      return new OnePasswordCredentialProvider(client, { id: source.id, label: source.label }).listAllContainers()
    },
    openOnePasswordSettings: async () => {
      counts.opened++
    },
  }
  return { host: new BrowserAutomationHost(options), options, counts, state, vaults }
}
