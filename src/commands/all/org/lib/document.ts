import * as path from 'node:path'
import OrganizationDocument, { type OrgKind } from '#shared/models/Organization/mod.ts'

/** What org:new is asked: the name, and optionally the website to read and a category to use as given. */
export interface OrganizationRequest {
  name: string
  site?: string
  sector?: string
  subcategory?: string
}

/** What org:new has learned about an organization before it writes the file. */
export interface OrganizationDraft {
  name: string
  sector: string
  subcategory: string
  kind: OrgKind
  site?: string
  ticker?: string
  /** A sentence or two; the file's overview */
  description?: string
  /** The matching Wikipedia article */
  wikipediaUrl?: string
}

/** Filesystem-safe stem derived from the org name; the slug is its lowercased form. */
export function nameToFileStem(name: string): string {
  return name
    .replace(/&/g, 'and')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

/** The first category name that cannot be a directory name, if any. */
export function pathHostileCategory(
  draft: Pick<OrganizationDraft, 'sector' | 'subcategory'>,
): { label: 'sector' | 'subcategory'; value: string } | undefined {
  for (const label of ['sector', 'subcategory'] as const) {
    if (!/^[\w-]+$/.test(draft[label])) return { label, value: draft[label] }
  }
  return undefined
}

/** Where org:new files an organization: `<sector>/<subcategory>/` under orgs/. */
export function organizationDir(orgsDir: string, draft: Pick<OrganizationDraft, 'sector' | 'subcategory'>): string {
  return path.join(orgsDir, draft.sector, draft.subcategory)
}

/**
 * The organization file org:new writes: name, slug, website, category, kind tag and Wikipedia link,
 * with the description as its overview. One website goes in `site`, several in `sites`, never both.
 */
export function organizationDocument(
  draft: OrganizationDraft,
  extra: { sites?: string[]; created?: string } = {},
): OrganizationDocument {
  const sites = [...new Set([draft.site, ...(extra.sites ?? [])].filter((site): site is string => Boolean(site)))]
  const yamlData: Record<string, unknown> = {
    name: draft.name,
    slug: nameToFileStem(draft.name).toLowerCase().replace(/^-|-$/g, ''),
    ...(sites.length > 1 ? { sites } : { site: sites[0] }),
    sector: draft.sector,
    subcategory: draft.subcategory,
  }
  if (draft.ticker) yamlData.ticker = draft.ticker
  if (extra.created) {
    yamlData.updated = extra.created
    yamlData.created = extra.created
  }
  // The description goes into the markdown body, not YAML
  let org = OrganizationDocument.create(yamlData, draft.description)
  org = org.setKind(draft.kind)
  if (draft.wikipediaUrl) org = org.addRel(draft.wikipediaUrl)
  return org
}
