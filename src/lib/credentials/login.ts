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
  /** Website scope from the same native item revision as the fields; stays inside the worker. */
  permitsOrigin?(origin: string): boolean
}

export function secureOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null
  } catch {
    return null
  }
}

/** HTTPS website scope, including private suffixes so separate hosted tenants never match. */
export function sameLoginWebsite(first: string, second: string): boolean {
  const a = secureOrigin(first)
  const b = secureOrigin(second)
  if (!a || !b) return false
  if (a === b) return true
  const left = new URL(a)
  const right = new URL(b)
  if (left.port !== right.port) return false
  const domain = getDomain(left.hostname, { allowPrivateDomains: true })
  return domain !== null && domain === getDomain(right.hostname, { allowPrivateDomains: true })
}

/** Native website metadata can omit a scheme; live browser origins must still be explicit HTTPS. */
function savedLoginOrigin(value: string): string | null {
  const address = value.trim()
  if (!address || /^[/?#]/.test(address) || /[\s\\]/.test(address)) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(address)) return secureOrigin(address)
  const authority = address.split(/[/?#]/, 1)[0]
  if (!/^(?:\[[\da-f:.]+\]|[^:@]+)(?::\d+)?$/i.test(authority)) return null
  return secureOrigin(`https://${address}`)
}

/** Respect each saved website's native autofill scope; never infer permission for unrelated sites. */
export function matchesLoginOrigin(item: CredentialSummary, origin: string): boolean {
  return (
    secureOrigin(origin) === origin &&
    item.nativeCategory === 'Login' &&
    item.websites.some((site) => {
      if (site.match === 'never') return false
      const saved = savedLoginOrigin(site.url)
      return saved !== null && (saved === origin || (site.match === 'subdomains' && sameLoginWebsite(saved, origin)))
    })
  )
}
import { getDomain } from 'tldts'
