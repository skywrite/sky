import Document from '#shared/models/Markdown/Document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'

const DEFAULT_TEMPLATE = `# Video

## Summary

(insert summary here)

## Transcript`

export default class VideoDocument extends Document {
  static override yamlKeyOrder = ['from', 'to', 'when', 'medium', 'summary', 'video', 'rel', 'tags', 'attachments']

  /**
   * Create a new video:  new VideoDocument({ from, when, medium, summary, body?, rel? })
   * Parse an existing one: VideoDocument.fromMarkdown(contents)
   *
   * When no markdown is provided (creation), builds YAML with known fields in
   * display order. Extra fields from input (e.g. attachments) pass through via
   * ...extra. The 'body' input field becomes markdown content, defaulting to
   * the summary/transcript template.
   *
   * Like every day-partitioned doc, a video carries no created/updated stamps —
   * the day dir dates it, so `when` is the only date that means anything.
   */
  constructor(input: Record<string, unknown>, markdown?: string, yamlError?: string) {
    let yaml: Record<string, unknown>
    let md: string

    if (markdown === undefined) {
      const { when: whenRaw, body, ...extra } = input
      const when = whenRaw instanceof PlainDateTime ? whenRaw.time : (whenRaw ?? new PlainDateTime().time)
      const medium = input['medium'] ?? 'Video'

      yaml = {
        ...(input['from'] ? { from: input['from'] } : {}),
        ...(input['to'] ? { to: input['to'] } : {}),
        when,
        medium,
        summary: input['summary'] ?? null,
        video: input['video'] ?? { url: null },
        rel: input['rel'] ?? null,
        tags: input['tags'] ?? null,
        ...extra,
      }

      md = typeof body === 'string' ? body : DEFAULT_TEMPLATE
    } else {
      yaml = { ...input }
      md = markdown
    }

    if (yaml['tags']) {
      yaml['tags'] = String(TagSet.fromUnknown(yaml['tags']))
    }

    super(yaml, md, yamlError)
  }

  get from(): string | undefined {
    return this.yaml['from'] as string | undefined
  }

  get to(): string | undefined {
    return this.yaml['to'] as string | undefined
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
    return (this.yaml['medium'] as string) ?? 'Video'
  }

  get summary(): string | undefined {
    return this.yaml['summary'] as string | undefined
  }

  get videoUrl(): string | undefined {
    const video = this.yaml['video']
    if (video && typeof video === 'object' && !Array.isArray(video)) {
      const url = (video as Record<string, unknown>)['url']
      return typeof url === 'string' ? url : undefined
    }
    return undefined
  }

  static override fromMarkdown(contentsWithYamlHeader: string): VideoDocument {
    const doc = super.fromMarkdown(contentsWithYamlHeader)
    return new VideoDocument(doc.yaml, doc.markdown, doc.yamlError)
  }
}
