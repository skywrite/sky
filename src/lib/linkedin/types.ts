export interface LinkedInOrganization {
  name: string
  linkedin?: string
}

export interface LinkedInDraft {
  url: string
  name: string
  title: string
  location: string
  about: string
  current: LinkedInOrganization[]
  past: LinkedInOrganization[]
  warning?: string
}

export interface LinkedInImport {
  id: string
  url: string
  status: 'running' | 'complete' | 'failed'
  stage: string
  draft?: LinkedInDraft
  error?: string
}

export interface LinkedInImportHost {
  start: (url: string) => Promise<LinkedInImport>
  status: () => Promise<LinkedInImport | null>
  cancel: (id: string) => Promise<void>
}

/** The user selects one public-facing LinkedIn page, never an arbitrary browser destination. */
export function linkedInUrl(value: string, kind: 'person' | 'org' = 'person'): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Use a full LinkedIn profile URL.')
  }
  const prefix = kind === 'person' ? 'in' : 'company'
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !/^(?:[a-z]{2,3}\.)?linkedin\.com$/i.test(url.hostname) ||
    !new RegExp(`^/${prefix}/[a-zA-Z0-9_%.-]+/?$`).test(url.pathname)
  ) {
    throw new Error(
      `Use a LinkedIn ${kind === 'person' ? 'profile' : 'company'} URL beginning with https://www.linkedin.com/${prefix}/.`,
    )
  }
  const slug = url.pathname.split('/')[2]
  if (/^(?:\.|%2e)+$/i.test(slug) || /%2f|%5c/i.test(slug)) throw new Error('Use a valid LinkedIn profile URL.')
  return `https://www.linkedin.com/${prefix}/${slug}/`
}
