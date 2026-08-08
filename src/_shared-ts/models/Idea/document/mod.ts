import Document from '#shared/models/Markdown/Document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'

/**
 * IdeaDocument model - represents an idea with minimal queryable metadata in YAML
 * and free-form narrative in markdown.
 *
 * Stored at: $SKY_DIR/ideas/{year}/{status}/{month?}/{slug}.md
 *
 * Status is NOT a YAML field — it's derived from the file path:
 * - /draft/   → draft
 * - /exploring/ → exploring
 * - /actioned/  → actioned
 * - /archived/  → archived
 */
export default class IdeaDocument extends Document {
  constructor(yaml: Record<string, unknown> = {}, markdown = '', yamlError?: string) {
    const normalizedYaml = { ...yaml }
    if (normalizedYaml['tags']) {
      const tags = TagSet.fromUnknown(normalizedYaml['tags'])
      normalizedYaml['tags'] = String(tags)
    }

    super(normalizedYaml, markdown, yamlError)
  }

  /**
   * Slug/identifier for easy reference
   */
  get name(): string {
    return (this.yaml['name'] as string) ?? ''
  }

  /**
   * Create a new IdeaDocument from input data.
   *
   * YAML key order: name, created, updated, rel, tags
   */
  static create(input: {
    name: string
    title?: string
    body?: string
    tags?: string | TagSet
    rel?: string[]
    /** YYYY-MM-DD to stamp created/updated with (e.g. notebook time) instead of the system clock */
    createdOn?: string
  }): IdeaDocument {
    const yaml: Record<string, unknown> = {
      name: input.name,
      created: null, // placeholder, filled by ensureCreatedUpdated
      updated: null, // placeholder, filled by ensureCreatedUpdated
      rel: input.rel && input.rel.length > 0 ? input.rel : null,
      tags: input.tags ? String(input.tags) : null,
    }

    const markdown = IdeaDocument.createTemplate({
      title: input.title ?? input.name,
      body: input.body,
    })

    let idea = new IdeaDocument(yaml, markdown)
    idea = idea.ensureCreatedUpdated(input.createdOn) as IdeaDocument

    return idea
  }

  /**
   * Generate a default markdown template for a new idea.
   */
  static createTemplate(input: { title?: string; body?: string }): string {
    const title = input.title ?? 'Idea'

    if (input.body) {
      return `# ${title}\n\n${input.body}\n`
    }

    return `# ${title}

`
  }

  /**
   * Load an IdeaDocument from a markdown file.
   */
  static override fromMarkdown(contentsWithYamlHeader: string): IdeaDocument {
    const doc = super.fromMarkdown(contentsWithYamlHeader)
    return new IdeaDocument(doc.yaml, doc.markdown, doc.yamlError)
  }
}
