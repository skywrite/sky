import { z } from 'zod'
import { readJson, withProcessLock, writeJson } from '#lib/jobs/files.ts'
import { credentialCall, CredentialError } from './errors.ts'
import type { CredentialBinding } from './types.ts'

const identifier = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0)
const reference = z
  .object({
    connectionId: identifier,
    containerId: identifier,
    itemId: identifier,
  })
  .strict()
const bindingSchema = z
  .object({
    purpose: identifier,
    fields: z.record(
      identifier,
      z.object({ item: reference, id: identifier, sectionId: identifier.optional() }).strict(),
    ),
  })
  .strict()
  .refine((binding) => Object.keys(binding.fields).length > 0)
const fileSchema = z.object({ version: z.literal(1), bindings: z.array(bindingSchema) }).strict()

/** References only, at an explicit host-owned path. Unlink never calls a provider. */
export class CredentialBindings {
  constructor(private readonly file: string) {}

  list(): Promise<CredentialBinding[]> {
    return credentialCall(async () => {
      const raw = await readJson<unknown>(this.file)
      if (raw === null) return []
      const result = fileSchema.safeParse(raw)
      if (!result.success) throw new CredentialError('invalid-input')
      const purposes = result.data.bindings.map((binding) => binding.purpose)
      if (new Set(purposes).size !== purposes.length) throw new CredentialError('invalid-input')
      return result.data.bindings
    })
  }

  async get(purpose: string): Promise<CredentialBinding | null> {
    return (await this.list()).find((binding) => binding.purpose === purpose) ?? null
  }

  save(binding: CredentialBinding): Promise<void> {
    return credentialCall(async () => {
      // Strict parsing rejects a mistakenly supplied value/password rather than persisting it.
      const result = bindingSchema.safeParse(binding)
      if (!result.success) throw new CredentialError('invalid-input')
      await withProcessLock(`${this.file}.lock`, async () => {
        const bindings = (await this.list()).filter((entry) => entry.purpose !== result.data.purpose)
        bindings.push(result.data)
        await writeJson(this.file, { version: 1, bindings })
      })
    })
  }

  unlink(purpose: string): Promise<void> {
    return credentialCall(() =>
      withProcessLock(`${this.file}.lock`, async () => {
        const bindings = await this.list()
        const remaining = bindings.filter((binding) => binding.purpose !== purpose)
        if (remaining.length !== bindings.length) await writeJson(this.file, { version: 1, bindings: remaining })
      }),
    )
  }
}
