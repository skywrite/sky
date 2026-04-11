import Document from '#shared/models/Markdown/Document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

/** Matches directory structure under projects/ */
export type ProjectStatus = 'open' | 'hold' | 'completed' | 'canceled' | 'whiteboard'

export const PROJECT_STATUSES: ProjectStatus[] = ['open', 'hold', 'completed', 'canceled', 'whiteboard']

/** Stored at: $SKY_DIR/projects/{status}/{ProjectName}/_project/overview.md */
export default class ProjectDocument extends Document {
  constructor(yaml: Record<string, unknown> = {}, markdown = '', yamlError?: string) {
    // Normalize tags to string format if they're an array
    const normalizedYaml = { ...yaml }
    if (normalizedYaml['tags']) {
      const tags = TagSet.fromUnknown(normalizedYaml['tags'])
      normalizedYaml['tags'] = String(tags)
    }

    super(normalizedYaml, markdown, yamlError)
  }

  get name(): string {
    return (this.yaml['name'] as string) ?? ''
  }

  get status(): ProjectStatus {
    const value = this.yaml['status'] as string
    if (PROJECT_STATUSES.includes(value as ProjectStatus)) {
      return value as ProjectStatus
    }
    return 'open'
  }

  get closedReason(): string | undefined {
    return this.yaml['closedReason'] as string | undefined
  }

  get open(): boolean {
    return this.status === 'open'
  }

  get closed(): boolean {
    return this.status === 'completed' || this.status === 'canceled'
  }

  /** Returns new instance (immutable) */
  close(status: 'completed' | 'canceled', options?: { reason?: string; date?: PlainDate }): ProjectDocument {
    const doc = this.clone()
    doc._yaml['status'] = status
    doc._yaml['updated'] = (options?.date ?? PlainDate.today()).toString()
    if (options?.reason) {
      doc._yaml['closedReason'] = options.reason
    }
    return new ProjectDocument(doc._yaml, doc.markdown, doc.yamlError)
  }

  static create(input: { name: string; tags?: string | TagSet; rel?: string[] }): ProjectDocument {
    const now = PlainDate.today()

    const yaml: Record<string, unknown> = {
      name: input.name,
      created: now.toString(),
      updated: now.toString(),
      status: 'open',
      tags: input.tags ? String(input.tags) : '',
      rel: input.rel && input.rel.length > 0 ? input.rel : undefined,
    }

    const markdown = ProjectDocument.createTemplate({ name: input.name })

    return new ProjectDocument(yaml, markdown)
  }

  static createTemplate(input: { name: string }): string {
    const markdown = `
# ${input.name}

## What is the project?



## Why does this matter?



## What does "done" look like?



## What's the first concrete step?

`
    return markdown.trim()
  }

  static override fromMarkdown(contentsWithYamlHeader: string): ProjectDocument {
    const doc = super.fromMarkdown(contentsWithYamlHeader)
    return new ProjectDocument(doc.yaml, doc.markdown, doc.yamlError)
  }
}
