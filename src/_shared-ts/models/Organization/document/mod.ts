import Document from '#shared/models/Markdown/Document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'

export type OrgKind = 'company' | 'government' | 'nonprofit' | 'unknown'

export default class OrganizationDocument extends Document {
  constructor(yaml: Record<string, unknown> = {}, markdown = '', yamlError?: string) {
    // Normalize tags to string format if they're an array or other format
    const normalizedYaml = { ...yaml }
    if (normalizedYaml['tags']) {
      const tags = TagSet.fromUnknown(normalizedYaml['tags'])
      normalizedYaml['tags'] = String(tags)
    }

    super(normalizedYaml, markdown, yamlError)
  }

  // Typed accessors for YAML fields
  get name(): string {
    return this.yaml['name'] as string
  }

  get slug(): string {
    return this.yaml['slug'] as string
  }

  get site(): string | undefined {
    return this.yaml['site'] as string | undefined
  }

  get sector(): string {
    return this.yaml['sector'] as string
  }

  get subcategory(): string {
    return this.yaml['subcategory'] as string
  }

  get description(): string | undefined {
    return this.yaml['description'] as string | undefined
  }

  get kind(): OrgKind {
    const tags = this.tags

    if (tags.has('Organization/Company')) return 'company'
    if (tags.has('Organization/Government')) return 'government'
    if (tags.has('Organization/Nonprofit')) return 'nonprofit'

    return 'unknown'
  }

  setKind(kind: OrgKind): OrganizationDocument {
    const clone = this.clone() as OrganizationDocument

    // Remove all existing Organization kind tags
    let tags = this.tags
      .delete('Organization/Company')
      .delete('Organization/Government')
      .delete('Organization/Nonprofit')

    // Add the new kind tag (unless it's unknown)
    if (kind !== 'unknown') {
      const kindTag = `Organization/${kind.charAt(0).toUpperCase() + kind.slice(1)}`
      tags = tags.add(kindTag)
    }

    clone.yaml['tags'] = String(tags)
    return clone
  }

  /**
   * Generate a default markdown template for a new organization
   */
  static createTemplate(input: { name: string; description?: string }): string {
    const markdown = `
# ${input.name}

## Overview

${input.description || ''}


## Misc

`
    return markdown.trim()
  }

  /**
   * Create a new OrganizationDocument from YAML data. The description goes into
   * the markdown body (Overview section), not the YAML header.
   */
  static create(yaml: Record<string, unknown>, description?: string): OrganizationDocument {
    const markdown = OrganizationDocument.createTemplate({ name: yaml['name'] as string, description })
    let org = new OrganizationDocument(yaml, markdown)

    // Only ensure dates if neither created nor updated are provided
    if (!yaml['created'] && !yaml['updated']) {
      org = org.ensureCreatedUpdated() as OrganizationDocument
    }

    return org
  }

  /**
   * Load an OrganizationDocument from a markdown file
   */
  static override fromMarkdown(contentsWithYamlHeader: string): OrganizationDocument {
    const doc = super.fromMarkdown(contentsWithYamlHeader)
    return new OrganizationDocument(doc.yaml, doc.markdown, doc.yamlError)
  }
}
