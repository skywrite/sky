import type { LinkedInImportHost } from '#lib/linkedin/types.ts'
import { linkedInUrl } from '#lib/linkedin/types.ts'
import type { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import type { Scores } from '../vocabulary/mod.ts'

export type ProfileType = 'person' | 'org'
export type OrgKind = 'company' | 'nonprofit' | 'government' | 'unknown'

/** An unfiled organization stays editable until the person is saved. */
export interface OrganizationChoice {
  name: string
  id?: string
  slug?: string
  linkedin?: string
  create?: boolean
}

export interface ProfileFields {
  type: ProfileType
  name: string
  aliases: string[]
  title: string
  location: string
  emailPersonal: string[]
  emailBusiness: string[]
  sites: string[]
  met: string
  current: OrganizationChoice[]
  past: OrganizationChoice[]
  kind: OrgKind
  sector: string
}

export interface ProfileSummary extends ProfileFields {
  /** Notebook-relative filename, including its extension; used by the editor. */
  id: string
  /** Public route, independent of the notebook folder hierarchy. */
  slug: string
  score: number
  lastInteraction?: string
}

export interface ProfileActivity {
  path: string
  label: string
  date?: string
}

export interface ProfileDetail extends ProfileSummary {
  revision: string
  html: string
  tags: string[]
  activity: ProfileActivity[]
  people: ProfileSummary[]
}

export interface PeopleIndex {
  people: ProfileSummary[]
  orgs: ProfileSummary[]
  linkedInAvailable: boolean
}

export function companyLink(value: string): string | null {
  try {
    return linkedInUrl(value, 'org').toLowerCase()
  } catch {
    return null
  }
}

type OrganizationIdentity = Pick<ProfileSummary, 'id' | 'name' | 'aliases' | 'sites'>

export function organizationMatches<T extends OrganizationIdentity>(choice: OrganizationChoice, orgs: T[]): T[] {
  if (choice.id) return orgs.filter((org) => org.id === choice.id)
  const url = choice.linkedin ? companyLink(choice.linkedin) : null
  if (url) {
    const matches = orgs.filter((org) => org.sites.some((site) => companyLink(site) === url))
    if (matches.length) return matches
  }
  if (choice.create) return []
  const name = choice.name.trim().toLowerCase()
  return orgs.filter((org) => [org.name, ...org.aliases].some((alias) => alias.trim().toLowerCase() === name))
}

export function organizationNeedsChoice(choice: OrganizationChoice, orgs: OrganizationIdentity[]): boolean {
  if (choice.id) return false
  const matches = organizationMatches(choice, orgs)
  if (matches.length > 1) return true
  if (choice.create) return false
  const url = choice.linkedin ? companyLink(choice.linkedin) : null
  const known = matches[0]?.sites.map(companyLink).filter((value): value is string => value !== null) ?? []
  return Boolean(url && known.length && !known.includes(url))
}

export interface SaveProfile extends ProfileFields {
  id?: string
  revision?: string
  /** Initial notes; existing prose is edited separately or appended with a revision. */
  notes?: string
  allowNamesake?: boolean
}

export interface PeopleOptions {
  peopleDir: string
  orgsDir: string
  stateDir: string
  now?: () => ZonedDateTime
  linkedIn?: LinkedInImportHost
  scores?: () => Pick<Scores, 'people' | 'orgs'>
}

export class ProfileError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 422 | 503 = 400,
  ) {
    super(message)
  }
}

export const blankProfile = (type: ProfileType): ProfileFields => ({
  type,
  name: '',
  aliases: [],
  title: '',
  location: '',
  emailPersonal: [],
  emailBusiness: [],
  sites: [],
  met: '',
  current: [],
  past: [],
  kind: 'unknown',
  sector: '',
})

export function profileHref(profile: { type: ProfileType; slug: string }): string {
  return `/${profile.type === 'person' ? 'people' : 'orgs'}/${encodeURIComponent(profile.slug)}`
}
