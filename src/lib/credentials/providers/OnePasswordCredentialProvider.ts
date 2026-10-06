import type { Client, Item, ItemCategory, ItemField, ItemFieldType, ItemOverview, Website } from '@1password/sdk'
import { credentialError, CredentialError } from '../errors.ts'
import { matchesLoginOrigin, type LoginOtp, type LoginValues } from '../login.ts'
import { onePasswordRequest } from '../onePasswordRequest.ts'
import { SensitiveValue } from '../SensitiveValue.ts'
import type {
  CredentialConnection,
  CredentialDraft,
  CredentialField,
  CredentialItem,
  CredentialListing,
  CredentialProvider,
  CredentialSummary,
  FieldPatch,
  FieldRef,
  FieldSelector,
  ItemRef,
  OtpCode,
} from '../types.ts'
import { fieldKey, validateDraft, validateFields, validateRef } from '../validation.ts'

export interface OnePasswordClient {
  vaults: Pick<Client['vaults'], 'list'>
  items: Pick<Client['items'], 'list' | 'get' | 'create' | 'put' | 'delete'>
}

export interface OnePasswordProviderOptions {
  id: string
  label?: string
  /** Empty by default: every vault the connected account can access participates. */
  excludedVaultIds?: readonly string[]
}

/** An explicitly connected SDK client. Constructing this adapter never signs in. */
export class OnePasswordCredentialProvider implements CredentialProvider {
  readonly connection: CredentialConnection
  private excluded: ReadonlySet<string>
  private readonly mutations = new Map<string, Promise<unknown>>()

  constructor(
    private readonly client: OnePasswordClient,
    options: OnePasswordProviderOptions,
  ) {
    this.connection = Object.freeze({ id: options.id, provider: '1password', label: options.label ?? '1Password' })
    this.excluded = new Set(options.excludedVaultIds ?? [])
  }

  /** Source settings can show excluded vaults without reading their items. */
  listAllContainers() {
    return this.call(async () =>
      (await onePasswordRequest(() => this.client.vaults.list({ decryptDetails: true }))).map((vault) => ({
        id: vault.id,
        label: vault.title,
      })),
    )
  }

  async listContainers() {
    return (await this.listAllContainers()).filter((vault) => !this.excluded.has(vault.id))
  }

  setExcludedVaultIds(ids: readonly string[]): void {
    this.excluded = new Set(ids)
  }

  async list(): Promise<CredentialListing> {
    const result: CredentialListing = { items: [], issues: [] }
    for (const vault of await this.listContainers()) {
      try {
        // Listing never requests the full item bodies or secret values.
        for (const item of await onePasswordRequest(() => this.client.items.list(vault.id))) {
          if (item.state === 'archived') continue
          result.items.push(this.summary(item))
        }
      } catch (error) {
        result.issues.push({ connectionId: this.connection.id, containerId: vault.id, error: this.error(error) })
      }
    }
    return result
  }

  inspect(ref: ItemRef): Promise<CredentialItem> {
    return this.call(async () => this.describe(await this.load(ref)))
  }

  /** Revalidate the website and read both fields from one native item revision. */
  readLogin(ref: ItemRef, origin: string): Promise<LoginValues> {
    return this.call(async () => {
      const item = await this.load(ref)
      const summary = this.summary(item)
      if (!matchesLoginOrigin(summary, origin)) throw new CredentialError('invalid-input')
      const username = item.fields.find((field) => !field.sectionId && field.id === 'username')
      const password = item.fields.find((field) => !field.sectionId && field.id === 'password')
      if (!username?.value || !password?.value || password.fieldType !== 'Concealed')
        throw new CredentialError('unsupported')
      const codes = item.fields.filter((field) => field.fieldType === 'Totp')
      return {
        username: new SensitiveValue(username.value),
        password: new SensitiveValue(password.value),
        permitsOrigin: (destination) => matchesLoginOrigin(summary, destination),
        ...(codes.length === 1
          ? { otp: { field: { id: codes[0].id, sectionId: codes[0].sectionId }, revision: String(item.version) } }
          : {}),
      }
    })
  }

  /** Fresh code for the approved login only, never a search for another item's authenticator. */
  readLoginOtp(ref: ItemRef, origin: string, binding: LoginOtp): Promise<OtpCode> {
    return this.call(async () => {
      validateFields([binding.field])
      const item = await this.load(ref)
      this.checkRevision(item, binding.revision)
      if (!matchesLoginOrigin(this.summary(item), origin)) throw new CredentialError('invalid-input')
      const codes = item.fields.filter((field) => field.fieldType === 'Totp')
      if (codes.length !== 1 || fieldKey(codes[0]) !== fieldKey(binding.field)) throw new CredentialError('unsupported')
      return this.otp(codes[0])
    })
  }

  readFields(ref: ItemRef, selectors: readonly FieldSelector[]) {
    return this.call(async () => {
      validateFields(selectors)
      const item = await this.load(ref)
      return selectors.map((selector) => ({
        field: { ...selector },
        value: new SensitiveValue(this.field(item, selector).value),
      }))
    })
  }

  create(draft: CredentialDraft): Promise<CredentialItem> {
    return this.call(async () => {
      validateDraft(draft)
      this.checkVault(draft.containerId)
      const fields: ItemField[] = draft.fields.map((field) => {
        const fieldType =
          field.nativeType ?? (field.role === 'otp' ? 'Totp' : field.kind === 'secret' ? 'Concealed' : 'Text')
        // Creation initially covers ordinary values, concealed values and authenticator setups.
        // Other native types survive field updates without being reconstructed.
        if (!['Text', 'Concealed', 'Totp'].includes(fieldType)) throw new CredentialError('unsupported')
        if (fieldType !== 'Text' && field.kind !== 'secret') throw new CredentialError('invalid-input')
        return {
          id: field.id,
          title: field.label,
          value: field.value,
          sectionId: field.sectionId,
          fieldType: fieldType as ItemFieldType,
        }
      })
      const sections = [...new Set(fields.map((field) => field.sectionId).filter((id): id is string => !!id))].map(
        (id) => ({ id, title: id }),
      )
      // 1Password allocates the native ID; references must retain it across title changes.
      const item = await onePasswordRequest(() =>
        this.client.items.create({
          vaultId: draft.containerId,
          category: draft.nativeCategory as ItemCategory,
          title: draft.title,
          fields,
          sections,
          tags: draft.tags,
          websites: draft.websites?.map((site) => ({
            url: site.url,
            label: '',
            autofillBehavior: (site.match === 'never'
              ? 'Never'
              : site.match === 'subdomains'
                ? 'AnywhereOnWebsite'
                : 'ExactDomain') as Website['autofillBehavior'],
          })),
        }),
      )
      return this.describe(item)
    })
  }

  updateFields(ref: ItemRef, patches: readonly FieldPatch[], revision: string): Promise<CredentialItem> {
    return this.call(async () => {
      validateRef(ref, this.connection.id)
      validateFields(patches)
      if (patches.some((patch) => typeof patch.value !== 'string')) throw new CredentialError('invalid-input')
      return this.mutate(ref, async () => {
        const item = await this.load(ref)
        this.checkRevision(item, revision)
        // Pass the SDK's complete native object and version back. Do not build a lossy
        // JSON template: those can remove passkeys and other fields Sky cannot inspect.
        for (const patch of patches) {
          const field = this.field(item, patch)
          if (field.fieldType === 'Unsupported') throw new CredentialError('unsupported')
          field.value = patch.value
        }
        return this.describe(await onePasswordRequest(() => this.client.items.put(item)))
      })
    })
  }

  delete(ref: ItemRef, revision: string): Promise<void> {
    return this.call(async () => {
      validateRef(ref, this.connection.id)
      return this.mutate(ref, async () => {
        this.checkRevision(await this.load(ref), revision)
        // The SDK has no conditional delete; the revision check is a preflight only.
        await onePasswordRequest(() => this.client.items.delete(ref.containerId, ref.itemId))
      })
    })
  }

  getOtp(ref: FieldRef): Promise<OtpCode> {
    return this.call(async () => {
      validateFields([ref])
      const field = this.field(await this.load(ref.item), ref)
      return this.otp(field)
    })
  }

  private otp(field: ItemField): OtpCode {
    if (field.fieldType !== 'Totp') throw new CredentialError('unsupported')
    if (field.details?.type !== 'Otp' || !field.details.content.code) throw new CredentialError('unavailable')
    // The SDK supplies a current code, but no expiry. Do not invent a 30s lifetime.
    return { code: new SensitiveValue(field.details.content.code) }
  }

  private load(ref: ItemRef): Promise<Item> {
    validateRef(ref, this.connection.id)
    this.checkVault(ref.containerId)
    return onePasswordRequest(() => this.client.items.get(ref.containerId, ref.itemId))
  }

  private checkVault(id: string): void {
    if (this.excluded.has(id)) throw new CredentialError('excluded')
  }

  private field(item: Item, selector: FieldSelector): ItemField {
    const field = item.fields.find((candidate) => fieldKey(candidate) === fieldKey(selector))
    if (!field) throw new CredentialError('not-found')
    return field
  }

  private summary(item: Item | ItemOverview): CredentialSummary {
    return {
      ref: { connectionId: this.connection.id, containerId: item.vaultId, itemId: item.id },
      title: item.title,
      nativeCategory: item.category,
      tags: [...item.tags],
      websites: item.websites.map((site) => ({
        url: site.url,
        match:
          site.autofillBehavior === 'AnywhereOnWebsite'
            ? 'subdomains'
            : site.autofillBehavior === 'ExactDomain'
              ? 'exact'
              : 'never',
      })),
    }
  }

  private describe(item: Item): CredentialItem {
    return {
      ...this.summary(item),
      revision: String(item.version),
      fields: item.fields.map(
        (field): CredentialField => ({
          id: field.id,
          ...(field.sectionId ? { sectionId: field.sectionId } : {}),
          label: field.title,
          kind: ['Text', 'Email', 'Url', 'Phone', 'Menu'].includes(field.fieldType) ? 'text' : 'secret',
          nativeType: field.fieldType,
          ...(field.fieldType === 'Totp'
            ? { role: 'otp' }
            : !field.sectionId && field.id === 'username'
              ? { role: 'username' }
              : !field.sectionId && field.id === 'password'
                ? { role: 'password' }
                : {}),
        }),
      ),
    }
  }

  private checkRevision(item: Item, revision: string): void {
    if (String(item.version) !== revision) throw new CredentialError('conflict')
  }

  private async mutate<T>(ref: ItemRef, work: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([ref.containerId, ref.itemId])
    const pending = (this.mutations.get(key) ?? Promise.resolve()).catch(() => {}).then(work)
    this.mutations.set(key, pending)
    try {
      return await pending
    } finally {
      if (this.mutations.get(key) === pending) this.mutations.delete(key)
    }
  }

  private error(error: unknown): CredentialError {
    const name = error instanceof Error ? error.constructor.name : ''
    if (name === 'DesktopSessionExpiredError' || name === 'AuthExpiredError')
      return new CredentialError('access-required')
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
