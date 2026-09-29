import { CredentialError } from './errors.ts'
import type { CredentialDraft, CredentialField, FieldSelector, ItemRef } from './types.ts'

export const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

export function validateRef(ref: ItemRef, connectionId?: string): void {
  if (
    !ref ||
    !nonempty(ref.connectionId) ||
    !nonempty(ref.containerId) ||
    !nonempty(ref.itemId) ||
    (connectionId !== undefined && ref.connectionId !== connectionId)
  )
    throw new CredentialError('invalid-input')
}

export const fieldKey = (field: FieldSelector): string => JSON.stringify([field.sectionId ?? '', field.id])

export function validateFields(fields: readonly FieldSelector[]): void {
  const keys = new Set<string>()
  if (fields.length === 0) throw new CredentialError('invalid-input')
  for (const field of fields) {
    if (!nonempty(field.id) || (field.sectionId !== undefined && !nonempty(field.sectionId)))
      throw new CredentialError('invalid-input')
    const key = fieldKey(field)
    if (keys.has(key)) throw new CredentialError('invalid-input')
    keys.add(key)
  }
}

export function validateDraft(draft: CredentialDraft): void {
  if (!nonempty(draft.containerId) || !nonempty(draft.title) || !nonempty(draft.nativeCategory))
    throw new CredentialError('invalid-input')
  validateFields(draft.fields)
  if (
    draft.fields.some(
      (field) =>
        typeof field.value !== 'string' ||
        !['text', 'secret'].includes(field.kind) ||
        typeof field.label !== 'string' ||
        (field.nativeType !== undefined && !nonempty(field.nativeType)) ||
        (field.role !== undefined && !['username', 'password', 'otp'].includes(field.role)),
    )
  )
    throw new CredentialError('invalid-input')
  if (draft.tags !== undefined && (!Array.isArray(draft.tags) || draft.tags.some((tag) => typeof tag !== 'string')))
    throw new CredentialError('invalid-input')
  for (const website of draft.websites ?? []) {
    try {
      const url = new URL(website.url)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
        throw new CredentialError('invalid-input')
      if (!['exact', 'subdomains', 'never'].includes(website.match)) throw new CredentialError('invalid-input')
    } catch {
      throw new CredentialError('invalid-input')
    }
  }
}

/** Project metadata explicitly; unexpected native/input properties must never escape. */
export function fieldDescription(field: CredentialField): CredentialField {
  return {
    id: field.id,
    label: field.label,
    kind: field.kind,
    ...(field.sectionId === undefined ? {} : { sectionId: field.sectionId }),
    ...(field.nativeType === undefined ? {} : { nativeType: field.nativeType }),
    ...(field.role === undefined ? {} : { role: field.role }),
  }
}
