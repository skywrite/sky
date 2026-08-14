import Document from '#shared/models/Markdown/Document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'

export type OrgKind = 'company' | 'government' | 'nonprofit' | 'unknown'

const KIND_TAG_ROOT = 'Organization'
const KINDS = ['company', 'government', 'nonprofit'] as const

/** `Organization/Company` -> "Organization/Company"; the tag written for a kind. */
function kindTag(kind: Exclude<OrgKind, 'unknown'>): string {
  return `${KIND_TAG_ROOT}/${kind.charAt(0).toUpperCase()}${kind.slice(1)}`
}

/**
 * The kind a tag encodes, if any. Kind tags are hierarchical: the corpus carries
 * both bare `Organization/Company` and sector-qualified `Organization/Company/Crypto`
 * or `Organization/Company/Finance/Investment-Banks`. Only the segment after
 * `Organization/` names the kind — the rest is classification we must not read as one.
 */
export function kindOfTag(tag: string): OrgKind {
  const [root, second] = tag.split('/')
  if (root?.toLowerCase() !== KIND_TAG_ROOT.toLowerCase()) return 'unknown'
  const kind = second?.toLowerCase()
  return KINDS.find((k) => k === kind) ?? 'unknown'
}

/** Derive an organization's kind from its tags; the first kind tag wins. */
export function kindFromTags(tags: Iterable<string>): OrgKind {
  for (const tag of tags) {
    const kind = kindOfTag(tag)
    if (kind !== 'unknown') return kind
  }
  return 'unknown'
}

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
    return kindFromTags(this.tags)
  }

  /**
   * Set the organization's kind, preserving any sector classification already
   * hanging off a matching kind tag: setKind('company') on
   * `Organization/Company/Crypto` keeps that tag rather than flattening it.
   * Kind tags naming a different kind are dropped — their classification was
   * filed under the wrong kind anyway.
   */
  setKind(kind: OrgKind): OrganizationDocument {
    const clone = this.clone() as OrganizationDocument

    const kept: string[] = []
    let alreadyTagged = false
    for (const tag of this.tags) {
      const tagKind = kindOfTag(tag)
      if (tagKind === 'unknown') {
        kept.push(tag) // not a kind tag, untouched
        continue
      }
      if (tagKind === kind) {
        kept.push(tag)
        alreadyTagged = true
      }
    }

    if (kind !== 'unknown' && !alreadyTagged) {
      kept.push(kindTag(kind))
    }

    clone.yaml['tags'] = String(TagSet.fromArray(kept))
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
