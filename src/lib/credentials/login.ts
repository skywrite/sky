import type { SensitiveValue } from './SensitiveValue.ts'
import type { CredentialSummary, FieldSelector } from './types.ts'

/** Binds a follow-up code to the same field and item revision as the approved password. */
export interface LoginOtp {
  field: FieldSelector
  revision: string
}

/** The private browser consumes these; they never cross the model/tool transport. */
export interface LoginValues {
  username: SensitiveValue
  password: SensitiveValue
  otp?: LoginOtp
}

export function secureOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null
  } catch {
    return null
  }
}

/** Filling is stricter than discovery: no inherited subdomain or scheme/port permissions. */
export function matchesLoginOrigin(item: CredentialSummary, origin: string): boolean {
  return (
    secureOrigin(origin) === origin &&
    item.nativeCategory === 'Login' &&
    item.websites.some((site) => site.match !== 'never' && secureOrigin(site.url) === origin)
  )
}
