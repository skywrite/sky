import * as path from 'node:path'
import latinize from '#lib/string/latinize.ts'
import { slugify } from '#lib/string/mod.ts'
import PersonDocument from '#shared/models/Person/mod.ts'

/**
 * Generate the directory path for a person based on their first name
 * Uses year/first-two-letters-of-first-name pattern with underscore padding
 */
export function generatePersonHierarchyPath(personName: string, year?: number): string {
  const currentYear = year ?? new Date().getFullYear()

  // Parse the name to get the first name
  const nameParts = personName.trim().split(/\s+/)
  const firstName = nameParts[0] || ''

  // Latinize and create directory path
  const firstNameLatin = latinize(firstName).toLowerCase()

  // Create 2-letter directory name with underscore padding if needed
  let dirName: string
  if (firstNameLatin.length >= 2) {
    dirName = firstNameLatin.substring(0, 2)
  } else if (firstNameLatin.length === 1) {
    dirName = firstNameLatin + '_'
  } else {
    dirName = '__' // Fallback for empty names
  }

  // Build the directory path: year/first-two-letters/
  return path.join(String(currentYear), dirName)
}

/** A person's file name without `.md`: `Jane Doe` → `Jane-Doe`. */
export function personFileStem(personName: string): string {
  return slugify(personName, { preserveCase: true })
}

/** A year alone is written `met: 2021`, as people files write it, rather than a quoted string. */
export function metValue(met: string): string | number {
  return /^\d{4}$/.test(met) ? Number(met) : met
}

type OrgLists<T> = { current?: T[]; past?: T[] }

export interface NewPerson {
  /** One name, or the name list when they go by several (the first is preferred) */
  name: string | string[]
  /** When they met: YYYY, YYYY-MM or YYYY-MM-DD */
  met: string
  /** YYYY-MM-DD, also the first `updated` */
  created: string
  location?: string
  title?: string
  orgs?: OrgLists<string>
  email?: { personal?: string[]; business?: string[] }
  sites?: string[]
  /** Opening lines under the name heading */
  notes?: string
}

/** Only the lists that hold something; undefined when none do. */
function lists<T>(value: OrgLists<T> | undefined): OrgLists<T> | undefined {
  const kept = Object.fromEntries(Object.entries(value ?? {}).filter(([, items]) => items?.length))
  return Object.keys(kept).length ? kept : undefined
}

/**
 * A new person file as person:new writes it: every field in this order, blank until known, then
 * the name heading and an empty Background section. A list with nothing in it is left blank or out.
 */
export function newPersonMarkdown(person: NewPerson): string {
  const list = (values?: string[]) => (values?.length ? values : null)
  const yaml: Record<string, unknown> = { name: person.name, location: person.location || null }
  if (person.title) yaml.title = person.title
  const orgs = lists(person.orgs)
  if (orgs) yaml.orgs = orgs
  yaml.email = { personal: list(person.email?.personal), business: list(person.email?.business) }
  yaml.sites = list(person.sites)
  yaml.created = person.created
  yaml.updated = person.created
  yaml.met = metValue(person.met)
  yaml.tags = null
  // The heading shows the preferred name, even when the name field lists several
  const template = PersonDocument.createTemplate({ name: Array.isArray(person.name) ? person.name[0] : person.name })
  const notes = person.notes?.trim()
  return new PersonDocument(yaml, notes ? template.replace(/^(# .*)$/m, `$1\n\n${notes}`) : template).toMarkdown()
}
