import Document from '#shared/models/Markdown/Document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'

const DEFAULT_TEMPLATE = `# Meeting

## Agenda Items


## Outcomes`

export default class MeetingDocument extends Document {
  /**
   * Create a new meeting:  new MeetingDocument({ who, when, medium, summary, body?, rel? })
   * Parse an existing one: MeetingDocument.fromMarkdown(contents)
   *
   * When no markdown is provided (creation), builds YAML with known fields in
   * display order. Day-partitioned docs carry no created/updated stamps — the
   * day dir dates them — so any incoming ones are stripped. Extra fields from
   * input pass through via ...extra. The 'body' input field becomes markdown content.
   */
  constructor(input: Record<string, unknown>, markdown?: string, yamlError?: string) {
    let yaml: Record<string, unknown>
    let md: string

    if (markdown === undefined) {
      // Creation: destructure fields that need normalization, rest passes through
      const { when: whenRaw, created: _c, updated: _u, body, ...extra } = input
      const when = whenRaw instanceof PlainDateTime ? whenRaw.time : (whenRaw ?? new PlainDateTime().time)
      const medium = input['medium'] ?? 'Zoom'

      yaml = {
        who: input['who'],
        when,
        medium,
        context: input['context'] ?? null,
        summary: input['summary'] ?? null,
        rel: input['rel'] ?? null,
        tags: input['tags'] ?? null,
        ...extra,
      }

      if (medium === 'In Person') {
        yaml['where'] = input['where'] ?? null
      }

      md = typeof body === 'string' ? body : DEFAULT_TEMPLATE
    } else {
      yaml = { ...input }
      md = markdown
    }

    // Normalize tags
    if (yaml['tags']) {
      yaml['tags'] = String(TagSet.fromUnknown(yaml['tags']))
    }

    super(yaml, md, yamlError)
  }

  // Typed accessors for YAML fields
  get who(): string {
    return (this.yaml['who'] as string) ?? ''
  }

  get when(): PlainDateTime {
    const when = this.yaml['when']
    if (typeof when === 'string') {
      return PlainDateTime.fromString(when)
    }
    if (when instanceof PlainDateTime) {
      return when
    }
    return new PlainDateTime()
  }

  get medium(): string {
    return (this.yaml['medium'] as string) ?? 'Zoom'
  }

  get context(): string | undefined {
    return this.yaml['context'] as string | undefined
  }

  get summary(): string | undefined {
    return this.yaml['summary'] as string | undefined
  }

  get where(): string | undefined {
    return this.yaml['where'] as string | undefined
  }

  static override fromMarkdown(contentsWithYamlHeader: string): MeetingDocument {
    const doc = super.fromMarkdown(contentsWithYamlHeader)
    return new MeetingDocument(doc.yaml, doc.markdown, doc.yamlError)
  }
}
