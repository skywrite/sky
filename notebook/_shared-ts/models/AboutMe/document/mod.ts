import SectionDocument from '#shared/models/Markdown/SectionDocument/mod.ts'

/**
 * Parsed profile data from journal/about-me.md.
 *
 * Used for prompt template variable substitution ({{me.firstName}}, etc.)
 * and AI personalization throughout the system.
 */
export default class AboutMe extends SectionDocument {
  private _profile: ParsedProfile | null = null

  private get profile(): ParsedProfile {
    if (!this._profile) {
      this._profile = parseProfile(this)
    }
    return this._profile
  }

  get firstName(): string {
    return this.profile.firstName
  }
  get lastName(): string {
    return this.profile.lastName
  }
  get fullName(): string {
    return `${this.firstName} ${this.lastName}`.trim()
  }
  get location(): string {
    return this.profile.location
  }
  get family(): string {
    return this.profile.family
  }
  get company(): string {
    return this.profile.company
  }
  get title(): string {
    return this.profile.title
  }
  get companyDescription(): string {
    return this.profile.companyDescription
  }
  get communicationStyle(): string {
    return this.profile.communicationStyle
  }
  get decisionMaking(): string {
    return this.profile.decisionMaking
  }
  get technicalContext(): string {
    return this.profile.technicalContext
  }
  get bio(): string {
    return this.profile.bio
  }

  static override fromMarkdown(contentsWithOptionalYamlHeader: string): AboutMe {
    const doc = SectionDocument.fromMarkdown(contentsWithOptionalYamlHeader)
    return new AboutMe(doc.yaml, doc.markdown, doc.yamlError)
  }
}

interface ParsedProfile {
  firstName: string
  lastName: string
  location: string
  family: string
  company: string
  title: string
  companyDescription: string
  communicationStyle: string
  decisionMaking: string
  technicalContext: string
  bio: string
}

function parseProfile(doc: AboutMe): ParsedProfile {
  const profile: ParsedProfile = {
    firstName: '',
    lastName: '',
    location: '',
    family: '',
    company: '',
    title: '',
    companyDescription: '',
    communicationStyle: '',
    decisionMaking: '',
    technicalContext: '',
    bio: '',
  }

  // Parse name from H1: "About Me - First Last"
  const root = doc.root
  if (root) {
    const match = root.heading.match(/About Me\s+-\s+(\S+)\s+(\S+)/)
    if (match) {
      profile.firstName = match[1]
      profile.lastName = match[2]
    }
  }

  const sections = doc.getSectionsAtLevel(2)
  for (const section of sections) {
    switch (section.heading) {
      case 'Personal':
        profile.location = extractKeyValue(section.content, 'Location')
        break
      case 'Family':
        profile.family = section.content
        break
      case 'Professional':
        profile.company = extractKeyValue(section.content, 'Company')
        profile.title = extractKeyValue(section.content, 'Title')
        profile.companyDescription = extractKeyValue(section.content, 'About')
        break
      case 'Preferences':
        profile.communicationStyle = extractKeyValue(section.content, 'Communication style')
        profile.decisionMaking = extractKeyValue(section.content, 'Decision-making')
        profile.technicalContext = extractKeyValue(section.content, 'Technical context')
        break
      case 'Bio':
        profile.bio = section.content
        break
    }
  }

  return profile
}

/** Extract value from **Key:** Value pattern */
function extractKeyValue(content: string, key: string): string {
  const pattern = new RegExp(`\\*\\*${key}:\\*\\*\\s*(.+)`)
  const match = content.match(pattern)
  return match ? match[1].trim() : ''
}
