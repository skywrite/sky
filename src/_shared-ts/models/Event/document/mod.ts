import Document from '#shared/models/Markdown/Document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { PlainDateTime, When } from '#universal/dates/nbdt/mod.ts'

export default class EventDocument extends Document {
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
  get what(): string {
    return (this.yaml['what'] as string) ?? ''
  }

  get when(): When | undefined {
    if (this.yaml['when'] === undefined || this.yaml['when'] === null) return undefined
    return When.fromYaml(this.yaml['when'])
  }

  get where(): string | undefined {
    return this.yaml['where'] as string | undefined
  }

  get who(): string | undefined {
    return this.yaml['who'] as string | undefined
  }

  get context(): string | undefined {
    return this.yaml['context'] as string | undefined
  }

  /**
   * Create a new EventDocument from props
   */
  static create(props: {
    what: string
    when?: PlainDateTime
    where?: string
    who?: string | string[]
    context?: string
    tags?: TagSet | string
    rel?: string | string[]
    body?: string
  }): EventDocument {
    const yaml: Record<string, unknown> = {
      what: props.what,
      when: props.when ? When.from(props.when).toYaml() : undefined,
      where: props.where || null,
      who: props.who || null,
      rel: props.rel || null,
      tags: props.tags || null,
    }

    const markdown = props.body ?? EventDocument.createTemplate(yaml)
    return new EventDocument(yaml, markdown)
  }

  /**
   * Generate a default markdown template for a new event
   */
  static createTemplate(yaml: Record<string, unknown>): string {
    const what = yaml.what as string

    const markdown = `
# ${what}

`
    return markdown.trim()
  }

  /**
   * Load an EventDocument from a markdown file
   */
  static override fromMarkdown(contentsWithYamlHeader: string): EventDocument {
    const doc = super.fromMarkdown(contentsWithYamlHeader)
    return new EventDocument(doc.yaml, doc.markdown, doc.yamlError)
  }
}
