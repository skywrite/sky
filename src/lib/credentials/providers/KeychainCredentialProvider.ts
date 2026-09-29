import { createHmac, randomBytes } from 'node:crypto'
import { withProcessLock } from '#lib/jobs/files.ts'
import { KeychainAccessError } from '#lib/secrets/keychainProtocol.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import type { SecretEntry } from '#lib/secrets/types.ts'
import slugify from '#lib/string/slugify.ts'
import { Instant, instantNow } from '#universal/dates/nbdt/mod.ts'
import { credentialError, CredentialError } from '../errors.ts'
import { SensitiveValue } from '../SensitiveValue.ts'
import { generateTotp } from '../totp.ts'
import type {
  CredentialConnection,
  CredentialDraft,
  CredentialItem,
  CredentialListing,
  CredentialProvider,
  CredentialSummary,
  FieldInput,
  FieldPatch,
  FieldRef,
  FieldSelector,
  ItemRef,
} from '../types.ts'
import { fieldDescription, fieldKey, validateDraft, validateFields, validateRef } from '../validation.ts'

export const KEYCHAIN_CREDENTIALS_CONTAINER = 'credentials'

interface StoredItem {
  format: 'sky.credentials'
  version: 1
  title: string
  nativeCategory: string
  fields: FieldInput[]
  websites: NonNullable<CredentialDraft['websites']>
  tags: string[]
}

interface LoadedItem {
  entry: SecretEntry
  document?: StoredItem
  fields: FieldInput[]
}

/** Adapts the existing Sky store; it does not enumerate Apple Passwords. */
export class KeychainCredentialProvider implements CredentialProvider {
  readonly connection: CredentialConnection
  // Revisions are opaque, connection-local comparison tokens. A keyed digest avoids
  // exposing an offline password guess oracle, and ignores synthetic legacy timestamps.
  #revisionKey = randomBytes(32)

  constructor(
    id: string,
    private readonly secrets: SecretsProvider,
    private readonly lockDir: string,
    label = 'Keychain',
    private readonly now: () => string = instantNow,
  ) {
    this.connection = Object.freeze({ id, label, provider: 'keychain' })
  }

  async listContainers() {
    return this.call(async () =>
      [...new Set([KEYCHAIN_CREDENTIALS_CONTAINER, ...(await this.secrets.list()).map((entry) => entry.category)])].map(
        (id) => ({ id, label: id }),
      ),
    )
  }

  async list(): Promise<CredentialListing> {
    return this.call(async () => {
      const result: CredentialListing = { items: [], issues: [] }
      for (const entry of await this.secrets.list()) {
        const ref = { connectionId: this.connection.id, containerId: entry.category, itemId: entry.name }
        if (entry.category !== KEYCHAIN_CREDENTIALS_CONTAINER) {
          result.items.push(this.summary(ref, entry.type))
          continue
        }
        try {
          // The old index has no title/website metadata. New records keep it encrypted.
          const loaded = await this.load(ref)
          result.items.push(this.summary(ref, loaded.entry.type, loaded.document))
        } catch (error) {
          result.issues.push({
            connectionId: this.connection.id,
            containerId: entry.category,
            error: this.error(error),
          })
        }
      }
      return result
    })
  }

  inspect(ref: ItemRef): Promise<CredentialItem> {
    return this.call(async () => this.describe(ref, await this.load(ref)))
  }

  readFields(ref: ItemRef, fields: readonly FieldSelector[]) {
    return this.call(async () => {
      validateFields(fields)
      const loaded = await this.load(ref)
      return fields.map((selector) => ({
        field: { ...selector },
        value: new SensitiveValue(this.field(loaded, selector).value),
      }))
    })
  }

  create(draft: CredentialDraft): Promise<CredentialItem> {
    return this.call(async () => {
      validateDraft(draft)
      if (draft.containerId !== KEYCHAIN_CREDENTIALS_CONTAINER) throw new CredentialError('unsupported')
      // A separate namespace and envelope leave every legacy consumer's wire format intact.
      return withProcessLock(this.lockDir, async () => {
        const now = this.now()
        const stem = `${now.slice(0, 10)}_${now.slice(11, 19).replaceAll(':', '')}_${slugify(draft.title, { preserveCase: true, suggestedLength: 60 }) || 'Credential'}`
        const taken = new Set((await this.secrets.list(draft.containerId)).map((entry) => entry.name.toLowerCase()))
        let itemId = stem
        for (
          let suffix = 2;
          taken.has(itemId.toLowerCase()) || (await this.secrets.get(draft.containerId, itemId));
          suffix++
        )
          itemId = `${stem}-${suffix}`
        const document: StoredItem = {
          format: 'sky.credentials',
          version: 1,
          title: draft.title,
          nativeCategory: draft.nativeCategory,
          fields: draft.fields.map((field) => ({ ...fieldDescription(field), value: field.value })),
          websites: draft.websites?.map((site) => ({ url: site.url, match: site.match })) ?? [],
          tags: [...(draft.tags ?? [])],
        }
        const entry: SecretEntry = {
          type: 'secret',
          schema: '1.0.0',
          created: now,
          updated: now,
          val: JSON.stringify(document),
        }
        const ref = { connectionId: this.connection.id, containerId: draft.containerId, itemId }
        await this.secrets.set(ref.containerId, ref.itemId, entry)
        return this.describe(ref, { entry, document, fields: document.fields })
      })
    })
  }

  updateFields(ref: ItemRef, patches: readonly FieldPatch[], revision: string): Promise<CredentialItem> {
    return this.call(async () => {
      validateRef(ref, this.connection.id)
      validateFields(patches)
      if (patches.some((patch) => typeof patch.value !== 'string')) throw new CredentialError('invalid-input')
      return withProcessLock(this.lockDir, async () => {
        const loaded = await this.load(ref)
        this.checkRevision(ref, loaded, revision)
        for (const patch of patches) this.field(loaded, patch).value = patch.value
        const entry = { ...loaded.entry, updated: this.updatedAfter(loaded.entry.updated) }
        if (loaded.document && entry.type === 'secret') entry.val = JSON.stringify(loaded.document)
        else if (entry.type === 'login') {
          entry.user = this.field(loaded, { id: 'username' }).value
          entry.pass = this.field(loaded, { id: 'password' }).value
        } else if (entry.type === 'secret') entry.val = this.field(loaded, { id: 'value' }).value
        await this.secrets.set(ref.containerId, ref.itemId, entry)
        return this.describe(ref, { ...loaded, entry })
      })
    })
  }

  delete(ref: ItemRef, revision: string): Promise<void> {
    return this.call(async () => {
      validateRef(ref, this.connection.id)
      return withProcessLock(this.lockDir, async () => {
        this.checkRevision(ref, await this.load(ref), revision)
        await this.secrets.delete(ref.containerId, ref.itemId)
      })
    })
  }

  getOtp(field: FieldRef) {
    return this.call(async () => {
      validateFields([field])
      const loaded = await this.load(field.item)
      // Only explicit otpauth URIs are accepted; arbitrary API keys are never inferred to be seeds.
      return generateTotp(this.field(loaded, field).value, this.now())
    })
  }

  private async load(ref: ItemRef): Promise<LoadedItem> {
    validateRef(ref, this.connection.id)
    const entry = await this.secrets.get(ref.containerId, ref.itemId)
    if (!entry) throw new CredentialError('not-found')
    if (ref.containerId === KEYCHAIN_CREDENTIALS_CONTAINER && entry.type === 'secret') {
      let document: StoredItem | undefined
      try {
        document = JSON.parse(entry.val)
      } catch {
        /* A legacy secret in this category. */
      }
      if (document?.format === 'sky.credentials') {
        if (document.version !== 1) throw new CredentialError('unsupported')
        validateDraft({ ...document, containerId: ref.containerId })
        return { entry, document, fields: document.fields }
      }
    }
    return {
      entry,
      fields:
        entry.type === 'login'
          ? [
              { id: 'username', label: 'Username', kind: 'text', role: 'username', value: entry.user },
              { id: 'password', label: 'Password', kind: 'secret', role: 'password', value: entry.pass },
            ]
          : [{ id: 'value', label: 'Value', kind: 'secret', value: entry.val }],
    }
  }

  private summary(ref: ItemRef, nativeCategory: string, document?: StoredItem): CredentialSummary {
    return {
      ref: { ...ref },
      title: document?.title ?? ref.itemId,
      nativeCategory: document?.nativeCategory ?? nativeCategory,
      websites: document?.websites.map((site) => ({ url: site.url, match: site.match })) ?? [],
      tags: [...(document?.tags ?? [])],
    }
  }

  private describe(ref: ItemRef, loaded: LoadedItem): CredentialItem {
    return {
      ...this.summary(ref, loaded.entry.type, loaded.document),
      revision: this.revision(ref, loaded.entry),
      fields: loaded.fields.map(fieldDescription),
    }
  }

  private field(loaded: LoadedItem, selector: FieldSelector): FieldInput {
    const field = loaded.fields.find((candidate) => fieldKey(candidate) === fieldKey(selector))
    if (!field) throw new CredentialError('not-found')
    return field
  }

  private checkRevision(ref: ItemRef, loaded: LoadedItem, revision: string): void {
    if (!revision || this.revision(ref, loaded.entry) !== revision) throw new CredentialError('conflict')
  }

  private revision(ref: ItemRef, entry: SecretEntry): string {
    // Raw legacy strings are wrapped with a new created/updated timestamp on every get.
    // Compare the actual data instead; titles and all new metadata live inside val.
    const content = entry.type === 'login' ? [entry.user, entry.pass] : [entry.val]
    return createHmac('sha256', this.#revisionKey)
      .update(JSON.stringify([ref.containerId, ref.itemId, entry.type, entry.schema, entry.notes, ...content]))
      .digest('hex')
  }

  private updatedAfter(previous: string): string {
    const now = Instant.from(this.now())
    const before = Instant.from(previous)
    return (Instant.compare(now, before) > 0 ? now : before.add({ nanoseconds: 1 })).toString()
  }

  private error(error: unknown): CredentialError {
    if (error instanceof KeychainAccessError)
      return new CredentialError(error.kind === 'access' ? 'access-required' : 'unavailable')
    return credentialError(error)
  }

  private async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    } catch (error) {
      throw this.error(error)
    }
  }
}
