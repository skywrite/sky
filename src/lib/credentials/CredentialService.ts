import { credentialCall, credentialError, CredentialError } from './errors.ts'
import type {
  CredentialDraft,
  CredentialListing,
  CredentialProvider,
  CredentialSummary,
  FieldPatch,
  FieldRef,
  FieldSelector,
  ItemRef,
} from './types.ts'
import { nonempty, validateDraft, validateFields, validateRef } from './validation.ts'

export interface CredentialSearch {
  text?: string
  /** Filters by the stored URL rules, not a title or a guessed domain suffix. */
  website?: string
  connectionId?: string
}

export class CredentialService {
  private readonly providers = new Map<string, CredentialProvider>()

  constructor(providers: readonly CredentialProvider[]) {
    for (const provider of providers) {
      if (!nonempty(provider.connection.id) || this.providers.has(provider.connection.id))
        throw new CredentialError('invalid-input')
      this.providers.set(provider.connection.id, provider)
    }
  }

  connections() {
    return [...this.providers.values()].map((provider) => ({
      ...provider.connection,
      capabilities: {
        create: !!provider.create,
        update: !!provider.updateFields,
        delete: !!provider.delete,
        otp: !!provider.getOtp,
      },
    }))
  }

  listContainers(connectionId: string) {
    return credentialCall(() => this.provider(connectionId).listContainers())
  }

  async search(query: CredentialSearch = {}): Promise<CredentialListing> {
    // Validate before touching providers, including when every provider has no items.
    if (query.website) parseWebsite(query.website)
    const providers = query.connectionId ? [this.provider(query.connectionId)] : [...this.providers.values()]
    const results = await Promise.all(
      providers.map(async (provider): Promise<CredentialListing> => {
        try {
          return await provider.list()
        } catch (error) {
          return { items: [], issues: [{ connectionId: provider.connection.id, error: credentialError(error) }] }
        }
      }),
    )
    const text = query.text?.trim().toLocaleLowerCase()
    return {
      items: results
        .flatMap((result) => result.items)
        .filter(
          (item) =>
            (!text ||
              [item.title, item.nativeCategory, ...item.tags, ...item.websites.map((site) => site.url)].some((value) =>
                value.toLocaleLowerCase().includes(text),
              )) &&
            (!query.website || matchesWebsite(item, query.website)),
        ),
      issues: results.flatMap((result) => result.issues),
    }
  }

  inspect(ref: ItemRef) {
    return credentialCall(() => this.forRef(ref).inspect(ref))
  }

  readFields(ref: ItemRef, fields: readonly FieldSelector[]) {
    return credentialCall(() => {
      validateFields(fields)
      return this.forRef(ref).readFields(ref, fields)
    })
  }

  create(connectionId: string, draft: CredentialDraft) {
    return credentialCall(() => {
      validateDraft(draft)
      const provider = this.provider(connectionId)
      if (!provider.create) throw new CredentialError('unsupported')
      return provider.create(draft)
    })
  }

  updateFields(ref: ItemRef, fields: readonly FieldPatch[], revision: string) {
    return credentialCall(() => {
      validateFields(fields)
      if (!nonempty(revision) || fields.some((field) => typeof field.value !== 'string'))
        throw new CredentialError('invalid-input')
      const provider = this.forRef(ref)
      if (!provider.updateFields) throw new CredentialError('unsupported')
      return provider.updateFields(ref, fields, revision)
    })
  }

  delete(ref: ItemRef, revision: string) {
    return credentialCall(() => {
      if (!nonempty(revision)) throw new CredentialError('invalid-input')
      const provider = this.forRef(ref)
      if (!provider.delete) throw new CredentialError('unsupported')
      return provider.delete(ref, revision)
    })
  }

  getOtp(field: FieldRef) {
    return credentialCall(() => {
      validateFields([field])
      const provider = this.forRef(field.item)
      if (!provider.getOtp) throw new CredentialError('unsupported')
      return provider.getOtp(field)
    })
  }

  private provider(id: string): CredentialProvider {
    const provider = this.providers.get(id)
    if (!provider) throw new CredentialError('not-found')
    return provider
  }

  private forRef(ref: ItemRef): CredentialProvider {
    validateRef(ref)
    return this.provider(ref.connectionId)
  }
}

function parseWebsite(value: string): URL {
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new CredentialError('invalid-input')
    return url
  } catch {
    throw new CredentialError('invalid-input')
  }
}

export function matchesWebsite(item: CredentialSummary, website: string): boolean {
  const target = parseWebsite(website)
  return item.websites.some((site) => {
    if (site.match === 'never') return false
    try {
      const stored = parseWebsite(site.url)
      if (stored.protocol !== target.protocol || stored.port !== target.port) return false
      return (
        stored.hostname === target.hostname ||
        (site.match === 'subdomains' && target.hostname.endsWith(`.${stored.hostname}`))
      )
    } catch {
      return false
    }
  })
}
