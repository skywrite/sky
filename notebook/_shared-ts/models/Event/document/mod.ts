import Document from '#shared/models/Markdown/Document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'

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

  get when(): PlainDateTime | undefined {
    const when = this.yaml['when']
    if (typeof when === 'string') {
      return PlainDateTime.fromString(when)
    }
    if (when instanceof PlainDateTime) {
      return when
    }
    return undefined
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
      when: props.when ? props.when.time : undefined,
      where: props.where || null,
      who: props.who || null,
      rel: props.rel || null,
      tags: props.tags || null,
    }

    const markdown = props.body ?? EventDocument.createTemplate(yaml)
    let event = new EventDocument(yaml, markdown)

    // Ensure created/updated dates
    event = event.ensureCreatedUpdated() as EventDocument

    return event
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
