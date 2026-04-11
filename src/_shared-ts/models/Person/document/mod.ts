import Document from '#shared/models/Markdown/Document/mod.ts'
import { stringify } from '#shared/yaml/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import ImmutableSet from '#shared/models/ImmutableSet/mod.ts'
import { slugify } from '#lib/string/mod.ts'
import { PlainDate, PlainYear, PlainYearMonth } from '#universal/dates/nbdt/mod.ts'
import { REGEX_YM_EXACT, REGEX_YMD_EXACT } from '#universal/dates/mod.ts'

export default class PersonDocument extends Document {
  constructor(yaml: Record<string, unknown> = {}, markdown = '', yamlError?: string) {
    // Normalize tags to string format if they're an array or other format
    const normalizedYaml = { ...yaml }
    if (normalizedYaml['tags']) {
      const tags = TagSet.fromUnknown(normalizedYaml['tags'])
      normalizedYaml['tags'] = String(tags)
    }

    // Normalize 'who' to 'name' - convert legacy 'who' field to 'name'
    if (normalizedYaml['who']) {
      normalizedYaml['name'] = normalizedYaml['who']
      delete normalizedYaml['who']
    }

    super(normalizedYaml, markdown, yamlError)
  }

  // Typed accessors for YAML fields
  get names(): string[] {
    const nameValue = this.yaml['name']

    if (nameValue === undefined || nameValue === null) {
      return []
    }

    if (Array.isArray(nameValue)) {
      return nameValue
    }

    if (typeof nameValue === 'string') {
      return [nameValue]
    }

    return []
  }

  get name(): string {
    const names = this.names
    return names.length > 0 ? names[0] : ''
  }

  get slug(): string {
    return slugify(this.name)
  }

  get slugPreserveCase(): string {
    return slugify(this.name, { preserveCase: true })
  }

  get alt(): string | undefined {
    const alt = this.yaml['alt']
    if (typeof alt === 'string') return alt
    return undefined
  }

  get email(): {
    personal?: string | string[]
    business?: string | string[]
  } {
    return (
      (this.yaml['email'] as {
        personal?: string | string[]
        business?: string | string[]
      }) ?? {}
    )
  }

  get title(): string | undefined {
    return this.yaml['title'] as string | undefined
  }

  /**
   * Structured organizations with current and past arrays.
   * YAML format: `orgs: { current: [...], past: [...] }`
   * Both current and past accept string or array of strings in YAML.
   */
  get orgs(): { current: string[]; past: string[] } {
    const orgsRaw = this.yaml['orgs']
    if (!orgsRaw || typeof orgsRaw !== 'object' || Array.isArray(orgsRaw)) {
      return { current: [], past: [] }
    }

    const parseArray = (value: unknown): string[] => {
      if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      }
      if (typeof value === 'string' && value.trim() !== '') {
        return [value]
      }
      return []
    }

    const obj = orgsRaw as Record<string, unknown>
    return {
      current: parseArray(obj['current']),
      past: parseArray(obj['past']),
    }
  }

  /**
   * Current organization - returns simple `org:` field or first from `orgs.current[]`
   */
  get org(): string | undefined {
    const orgSimple = this.yaml['org']
    if (typeof orgSimple === 'string' && orgSimple.trim() !== '') {
      return orgSimple
    }
    return this.orgs.current[0]
  }

  get location(): string | undefined {
    return this.yaml['location'] as string | undefined
  }

  get met(): PlainDate | PlainYearMonth | PlainYear | undefined {
    const met = this.yaml['met']
    if (typeof met === 'string') {
      // Check if it's a full date (YYYY-MM-DD), year-month (YYYY-MM), or year-only (YYYY)
      if (REGEX_YMD_EXACT.test(met)) {
        return PlainDate.from(met)
      }
      if (REGEX_YM_EXACT.test(met)) {
        return PlainYearMonth.from(met)
      }
      if (/^\d{4}$/.test(met)) {
        return PlainYear.from(met)
      }
    }
    // Handle year as number (e.g., met: 2004)
    if (typeof met === 'number' && met >= 1900 && met <= 2100) {
      return new PlainYear(met)
    }
    return undefined
  }

  get sites(): ImmutableSet<string> {
    const sitesValue = this.yaml['sites']

    if (sitesValue === undefined || sitesValue === null) {
      return new ImmutableSet<string>()
    }

    if (Array.isArray(sitesValue)) {
      return ImmutableSet._fromArray(ImmutableSet<string>, sitesValue)
    }

    if (typeof sitesValue === 'string') {
      // Handle semicolon-separated string format (for backwards compatibility)
      const items = sitesValue
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s !== '')
      return ImmutableSet._fromArray(ImmutableSet<string>, items)
    }

    return new ImmutableSet<string>()
  }

  setSites(sites: ImmutableSet<string>): PersonDocument {
    const person = this.clone() as PersonDocument
    const sitesArray = Array.from(sites)
    person.yaml['sites'] = sitesArray.length > 0 ? sitesArray : undefined
    return person
  }

  addSite(site: string | ImmutableSet<string>): PersonDocument {
    let siteToAdd: ImmutableSet<string>

    if (typeof site === 'string') {
      const items = site
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s !== '')
      siteToAdd = ImmutableSet._fromArray(ImmutableSet<string>, items)
    } else {
      siteToAdd = site
    }

    const currentSites = this.sites
    const newSites = currentSites.union(siteToAdd)
    return this.setSites(newSites)
  }

  /**
   * Generate a default markdown template for a new person
   */
  static createTemplate(yaml: Record<string, unknown>): string {
    const name = yaml.name as string

    const markdown = `
# ${name}

## Background
`
    return markdown.trim()
  }

  /**
   * Create a new PersonDocument from YAML data
   */
  static create(yaml: Record<string, unknown>): PersonDocument {
    const markdown = PersonDocument.createTemplate(yaml)
    let person = new PersonDocument(yaml, markdown)

    // Only ensure dates if neither created nor updated are provided
    if (!yaml['created'] && !yaml['updated']) {
      person = person.ensureCreatedUpdated() as PersonDocument
    }

    return person
  }

  /**
   * Load a PersonDocument from a markdown file
   */
  static override fromMarkdown(contentsWithYamlHeader: string): PersonDocument {
    const doc = super.fromMarkdown(contentsWithYamlHeader)
    return new PersonDocument(doc.yaml, doc.markdown, doc.yamlError)
  }

  /** Preferred YAML field order for Person documents */
  static readonly YAML_FIELD_ORDER = [
    'name',
    'alt',
    'location',
    'org',
    'orgs',
    'title',
    'email',
    'sites',
    'created',
    'updated',
    'met',
    'rel',
    'tags',
    'ib',
  ]

  /**
   * Override toMarkdown to ensure YAML fields are in preferred order
   */
  public override toMarkdown(opts?: { yaml?: boolean; links?: boolean }): string {
    const { yaml = true, links = true } = opts ?? {}

    // If yaml is disabled, just use parent implementation
    if (!yaml) {
      return super.toMarkdown({ yaml: false, links })
    }

    // Reorder yaml according to YAML_FIELD_ORDER
    const reorderedYaml: Record<string, unknown> = {}
    const order = PersonDocument.YAML_FIELD_ORDER

    // Add fields in preferred order
    for (const key of order) {
      if (key in this.yaml) {
        reorderedYaml[key] = this.yaml[key]
      }
    }

    // Add any remaining fields not in the order list
    for (const key of Object.keys(this.yaml)) {
      if (!(key in reorderedYaml)) {
        reorderedYaml[key] = this.yaml[key]
      }
    }

    // Build yaml string
    const yamlLines = ['---', stringify(reorderedYaml), '---']
    if (Object.keys(reorderedYaml).length === 0) yamlLines.splice(1, 1)
    const yamlStr = yamlLines.join('\n')

    // Get markdown without yaml from parent
    const markdown = super.toMarkdown({ yaml: false, links })

    return yamlStr + '\n\n' + markdown
  }
}
