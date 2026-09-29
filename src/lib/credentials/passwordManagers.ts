import { z } from 'zod'
import { CredentialError, credentialCall } from '#lib/credentials/errors.ts'
import { readJson, withProcessLock, writeJson } from '#lib/jobs/files.ts'
import type { CredentialContainer } from './types.ts'

export interface SavedPasswordManager {
  id: string
  account: string
  label: string
  excludedVaultIds: string[]
  containers: CredentialContainer[]
}

/** Preferences never grant permission to use a login or browser session. */
export interface PasswordManagerSettings {
  version: 1
  sources: SavedPasswordManager[]
  destination: { connectionId: string; containerId: string } | null
}

export const identifier = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value.trim().length > 0)
const destinationSchema = z.object({ connectionId: identifier, containerId: identifier }).strict()
const containerSchema = z.object({ id: identifier, label: z.string().max(1024) }).strict()
const sourceSchema = z
  .object({
    id: identifier,
    account: identifier,
    label: identifier,
    excludedVaultIds: z.array(identifier).max(1000),
    containers: z.array(containerSchema),
  })
  .strict()
const settingsSchema = z
  .object({
    version: z.literal(1),
    sources: z.array(sourceSchema).max(20),
    destination: destinationSchema.nullable(),
  })
  .strict()
  .refine((value) => new Set(value.sources.map((source) => source.id)).size === value.sources.length)

/** Only account names, vault IDs and preferences. No session token or item value is persisted. */
export class PasswordManagerSettingsStore {
  constructor(private readonly file: string) {}

  read(): Promise<PasswordManagerSettings> {
    return credentialCall(async () => {
      const raw = await readJson<unknown>(this.file)
      if (raw === null) return { version: 1, sources: [], destination: null }
      const parsed = settingsSchema.safeParse(raw)
      if (!parsed.success) throw new CredentialError('invalid-input')
      return parsed.data
    })
  }

  update(change: (settings: PasswordManagerSettings) => void): Promise<PasswordManagerSettings> {
    return credentialCall(() =>
      withProcessLock(`${this.file}.lock`, async () => {
        const settings = await this.read()
        change(settings)
        const parsed = settingsSchema.safeParse(settings)
        if (!parsed.success) throw new CredentialError('invalid-input')
        await writeJson(this.file, parsed.data)
        return parsed.data
      }),
    )
  }
}
