import type { CredentialError } from './errors.ts'
import type { SensitiveValue } from './SensitiveValue.ts'

export interface CredentialConnection {
  /** A configured connection, not a provider name: two accounts have different IDs. */
  id: string
  provider: 'keychain' | '1password'
  label: string
}

export interface ItemRef {
  connectionId: string
  containerId: string
  itemId: string
}

export interface FieldSelector {
  id: string
  sectionId?: string
}

export interface FieldRef extends FieldSelector {
  item: ItemRef
}

export interface CredentialField extends FieldSelector {
  label: string
  kind: 'text' | 'secret'
  nativeType?: string
  role?: 'username' | 'password' | 'otp'
}

export interface CredentialWebsite {
  url: string
  match: 'exact' | 'subdomains' | 'never'
}

export interface CredentialSummary {
  ref: ItemRef
  title: string
  nativeCategory: string
  websites: CredentialWebsite[]
  tags: string[]
}

/** Descriptions only. Even ordinary field values require an explicit read. */
export interface CredentialItem extends CredentialSummary {
  fields: CredentialField[]
  revision: string
}

export interface CredentialContainer {
  id: string
  label: string
}

export interface CredentialIssue {
  connectionId: string
  containerId?: string
  error: CredentialError
}

export interface CredentialListing {
  items: CredentialSummary[]
  /** A failed provider or vault must not masquerade as an empty collection. */
  issues: CredentialIssue[]
}

export interface FieldValue {
  field: FieldSelector
  value: SensitiveValue
}

export interface FieldInput extends CredentialField {
  value: string
}

export interface CredentialDraft {
  /** Creation always has an explicit destination; reads span all accessible containers. */
  containerId: string
  title: string
  nativeCategory: string
  fields: FieldInput[]
  websites?: CredentialWebsite[]
  tags?: string[]
}

export interface FieldPatch extends FieldSelector {
  value: string
}

export interface OtpCode {
  code: SensitiveValue
  /** UTC instant, when the provider supplies or Sky can calculate it. */
  expiresAt?: string
}

export interface CredentialProvider {
  readonly connection: CredentialConnection
  listContainers(): Promise<CredentialContainer[]>
  list(): Promise<CredentialListing>
  inspect(ref: ItemRef): Promise<CredentialItem>
  readFields(ref: ItemRef, fields: readonly FieldSelector[]): Promise<FieldValue[]>
  create?(draft: CredentialDraft): Promise<CredentialItem>
  updateFields?(ref: ItemRef, fields: readonly FieldPatch[], revision: string): Promise<CredentialItem>
  delete?(ref: ItemRef, revision: string): Promise<void>
  getOtp?(field: FieldRef): Promise<OtpCode>
}

/** Purpose is a natural lookup key (e.g. widget/api), independent of provider titles. */
export interface CredentialBinding {
  purpose: string
  fields: Record<string, FieldRef>
}
